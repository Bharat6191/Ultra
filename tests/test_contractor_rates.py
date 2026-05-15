"""Negotiation workflow (3.3) tests.

Covers:
  * part_master CRUD + activation rules
  * contractor_rate creation with savings calc (vs base / vs previous)
  * multi-round negotiations (round_number + audit + applied negotiated_rate)
  * approval flow:
      - submit holds rate at pending_approval
      - finalize approves the rate, deactivates the previous active one,
        and writes RATE_ACTIVATED + RATE_DEACTIVATED + EXPIRED audit rows
      - rejection moves the rate to ``rejected`` and writes a REJECTED audit row
  * one negotiation thread per (contractor, part): duplicate ``create_rate`` blocked
    while draft / pending / rejected / current approved window exists
  * audit logs written on every state transition
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

# Make sure ALL models register on Base.metadata before create_all() runs.
from db.base import Base
from modules.approvals.model import (  # noqa: F401
    ApprovalAction,
    ApprovalRequest,
    ApprovalStep,
    ApprovalTask,
    ApprovalWorkflow,
    ApprovalWorkflowMapping,
    TaskAuditLog,
    TaskComment,
)
from modules.approvals.assignment_service import WorkflowMappingService
from modules.approvals.service import ApprovalEngineService, ApprovalWorkflowService
from modules.auth.model import UserSession  # noqa: F401
from modules.contractor.models import Contractor  # noqa: F401
from modules.contractor.schema import ContractorCreate
from modules.contractor.service import ContractorService
from modules.contractor_rates.audit import (
    ACTION_APPROVED,
    ACTION_CREATED,
    ACTION_NEGOTIATION_ADDED,
    ACTION_RATE_ACTIVATED,
    ACTION_RATE_DEACTIVATED,
    ACTION_REJECTED,
    ACTION_SENT_FOR_APPROVAL,
)
from modules.contractor_rates.models import (
    ContractorRate,
    ContractorRateAuditLog,
    NegotiationLog,
)
from modules.contractor_rates.schema import (
    ContractorRateCreate,
    ContractorRateUpdate,
    NegotiationRoundCreate,
)
from modules.contractor_rates.service import (
    ACTION_CODE_CREATE,
    ContractorRateService,
)
from modules.part_master.models import PartMaster, PartMasterAuditLog
from modules.part_master.schema import PartMasterCreate, PartMasterUpdate
from modules.part_master.service import PartMasterService
from modules.errors import ConflictError
from modules.features.model import Feature  # noqa: F401
from modules.org_units.model import OrgUnit
from modules.permissions.model import Permission
from modules.roles.model import Role
from modules.users.model import User


# ---------- Fixtures ----------


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(
        bind=engine, autocommit=False, autoflush=False, expire_on_commit=False
    )
    with SessionLocal() as session:
        yield session


@pytest.fixture()
def actor(db: Session) -> User:
    user = User(
        full_name="Op Admin",
        username="op.admin",
        phone="+15550100100",
        email="op@example.com",
        hashed_password="x",
        password_changed_at=date.today(),
    )
    db.add(user)
    db.commit()
    return user


@pytest.fixture()
def plant(db: Session) -> OrgUnit:
    p = OrgUnit(name="Plant Alpha", type="PLANT")
    db.add(p)
    db.commit()
    return p


@pytest.fixture()
def contractor(db: Session, actor: User) -> Contractor:
    return ContractorService(db).create_contractor(
        ContractorCreate(name="Acme Vendor", contractor_type="vendor"),
        actor_user_id=actor.id,
    )


def _map_unit_commercial(unit: str) -> tuple[str, str, str]:
    u = unit.strip().lower()
    if u == "kg":
        return "kg", "weight_based", "per_kg"
    if u == "job":
        return "pcs", "piece_based", "per_piece"
    if u in ("hour", "hr"):
        return "hr", "piece_based", "per_piece"
    if u == "day":
        return "day", "piece_based", "per_piece"
    return u, "piece_based", "per_piece"


def _make_part(
    db: Session,
    *,
    plant_id: int,
    actor_id: int,
    base_rate: str = "100.00",
    job_type: str = "Welder",
    skill_type: str = "skilled",
    unit: str = "hour",
    effective_from: date | None = None,
) -> PartMaster:
    j = job_type.strip().upper().replace(" ", "-")
    sk = skill_type.strip().upper().replace(" ", "-")
    u = unit.strip().upper()
    part_code = f"{j}-{sk}-{u}"[:64]
    unit_type, pricing_method, rate_unit_type = _map_unit_commercial(unit)
    part_name = f"{job_type.strip()} ({skill_type.replace('_', ' ').strip()})"
    return PartMasterService(db).create_part_master(
        PartMasterCreate(
            part_code=part_code,
            part_name=part_name,
            description=None,
            unit_type=unit_type,
            pricing_method=pricing_method,
            weight_per_piece=None,
            base_rate=Decimal(base_rate),
            rate_unit_type=rate_unit_type,
            org_unit_id=plant_id,
            effective_from=effective_from or date.today(),
            is_active=True,
        ),
        actor_user_id=actor_id,
    )


# ---------- Part master ----------


def test_rate_master_create_lists_with_org_name(
    db: Session, actor: User, plant: OrgUnit
) -> None:
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    assert rm.is_active is True
    rows = PartMasterService(db).list_part_masters(active_only=True)
    assert len(rows) == 1
    assert rows[0].id == rm.id


def test_rate_master_activation_supersedes_previous_active(
    db: Session, actor: User, plant: OrgUnit
) -> None:
    """Activating a second rate for the same combo deactivates the first."""
    first = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    second = _make_part(
        db,
        plant_id=int(plant.id),
        actor_id=int(actor.id),
        base_rate="110",
        effective_from=date.today() + timedelta(days=1),
    )
    db.refresh(first)
    assert first.is_active is False
    assert second.is_active is True


def test_rate_master_inverted_dates_rejected(
    db: Session, actor: User, plant: OrgUnit
) -> None:
    with pytest.raises(ConflictError):
        PartMasterService(db).create_part_master(
            PartMasterCreate(
                part_code="WELDER-SKILLED-HOUR",
                part_name="Welder (skilled)",
                description=None,
                unit_type="hr",
                pricing_method="piece_based",
                weight_per_piece=None,
                base_rate=Decimal("100"),
                rate_unit_type="per_piece",
                org_unit_id=int(plant.id),
                effective_from=date.today() + timedelta(days=10),
                effective_to=date.today(),
                is_active=True,
            ),
            actor_user_id=int(actor.id),
        )


# ---------- Savings calc ----------


def test_create_rate_initial_rate_defaults_to_negotiated_and_savings_is_zero(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    """A bare ``create_rate`` records the negotiated_rate as the opening ask;
    savings is therefore 0 (no rounds yet to negotiate the rate down from)."""
    rm = _make_part(
        db, plant_id=int(plant.id), actor_id=int(actor.id), base_rate="100.00"
    )
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("110"),  # contractor's typical "above base" ask
            effective_from=date.today(),
        ),
        actor_user_id=int(actor.id),
    )
    assert rate.previous_rate is None
    assert rate.initial_rate == Decimal("110.00")
    assert rate.savings_amount == Decimal("0.00")
    assert rate.savings_percentage == Decimal("0.00")


def test_upload_opening_evidence_seeds_round_and_stores_files(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    rm = _make_part(
        db, plant_id=int(plant.id), actor_id=int(actor.id), base_rate="100.00"
    )
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("100"),
            effective_from=date.today(),
            remarks="Opening test",
        ),
        actor_user_id=int(actor.id),
    )
    assert int(rate.current_round) == 1
    assert len(rate.negotiation_logs or []) == 1
    assert int(rate.negotiation_logs[0].round_number) == 1
    log, attachments = svc.upload_opening_evidence(
        int(rate.id),
        [("one.txt", b"a", "text/plain"), ("two.txt", b"b", "text/plain")],
        actor_user_id=int(actor.id),
    )
    assert int(log.round_number) == 1
    assert len(attachments) == 2
    refreshed = svc.get_rate(int(rate.id))
    assert int(refreshed.current_round) == 1
    assert len(refreshed.negotiation_logs) == 1
    assert len(refreshed.negotiation_logs[0].attachments or []) == 2


def test_upload_opening_evidence_appends_more_files_to_same_opening_round(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    rm = _make_part(
        db, plant_id=int(plant.id), actor_id=int(actor.id), base_rate="100.00"
    )
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("100"),
            effective_from=date.today(),
            remarks="Opening test",
        ),
        actor_user_id=int(actor.id),
    )
    svc.upload_opening_evidence(
        int(rate.id),
        [("a.txt", b"x", "text/plain")],
        actor_user_id=int(actor.id),
    )
    log2, more = svc.upload_opening_evidence(
        int(rate.id),
        [("b.txt", b"y", "text/plain")],
        actor_user_id=int(actor.id),
    )
    assert len(more) == 1
    refreshed = svc.get_rate(int(rate.id))
    assert len(refreshed.negotiation_logs) == 1
    assert int(log2.id) == int(refreshed.negotiation_logs[0].id)
    assert len(refreshed.negotiation_logs[0].attachments or []) == 2


def test_upload_opening_evidence_conflict_after_non_opening_round(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    """Once a second negotiation round exists, opening-evidence uploads must not apply."""
    rm = _make_part(
        db, plant_id=int(plant.id), actor_id=int(actor.id), base_rate="100.00"
    )
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("100"),
            effective_from=date.today(),
        ),
        actor_user_id=int(actor.id),
    )
    svc.upload_opening_evidence(
        int(rate.id),
        [("a.txt", b"x", "text/plain")],
        actor_user_id=int(actor.id),
    )
    svc.add_negotiation_round(
        int(rate.id),
        NegotiationRoundCreate(
            proposed_rate=None,
            counter_rate=Decimal("95"),
            remarks=None,
            round_summary="Counter",
            apply_to_negotiated_rate=True,
        ),
        actor_user_id=int(actor.id),
    )
    with pytest.raises(ConflictError):
        svc.upload_opening_evidence(
            int(rate.id),
            [("b.txt", b"y", "text/plain")],
            actor_user_id=int(actor.id),
        )


def test_create_rate_with_explicit_initial_rate_computes_savings(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    """When procurement records the contractor's opening ask separately, savings
    equals (initial_rate − negotiated_rate)."""
    rm = _make_part(
        db, plant_id=int(plant.id), actor_id=int(actor.id), base_rate="100.00"
    )
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("105"),
            initial_rate=Decimal("120"),
            effective_from=date.today(),
        ),
        actor_user_id=int(actor.id),
    )
    assert rate.initial_rate == Decimal("120.00")
    # 120 -> 105: saved 15 (12.5 %).
    assert rate.savings_amount == Decimal("15.00")
    assert rate.savings_percentage == Decimal("12.50")


def test_savings_clamped_at_zero_when_negotiated_above_initial(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    """A re-negotiation upward must never produce a negative savings figure."""
    rm = _make_part(
        db, plant_id=int(plant.id), actor_id=int(actor.id), base_rate="100.00"
    )
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("130"),
            initial_rate=Decimal("110"),  # somehow ended up ABOVE the opening
            effective_from=date.today(),
        ),
        actor_user_id=int(actor.id),
    )
    assert rate.savings_amount == Decimal("0.00")
    assert rate.savings_percentage == Decimal("0.00")


def test_round1_proposal_above_initial_lifts_initial_rate(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    """If round 1 records a contractor proposal that is HIGHER than what was
    captured at create time, the panel auto-promotes the round-1 proposal to
    the new ``initial_rate`` so savings reflects the real opening ask."""
    rm = _make_part(
        db, plant_id=int(plant.id), actor_id=int(actor.id), base_rate="100.00"
    )
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("105"),  # internal target
            effective_from=date.today(),
        ),
        actor_user_id=int(actor.id),
    )
    svc.add_negotiation_round(
        int(rate.id),
        NegotiationRoundCreate(
            proposed_rate=Decimal("130"),  # contractor opens at 130
            counter_rate=None,
            remarks="Round 1: vendor opens at 130",
            apply_to_negotiated_rate=False,
        ),
        actor_user_id=int(actor.id),
    )
    refreshed = svc.get_rate(int(rate.id))
    assert refreshed.initial_rate == Decimal("130.00")
    # negotiated_rate stayed at 105 (apply_to_negotiated_rate was False).
    # 130 -> 105 -> save 25 (~19.23 %).
    assert refreshed.savings_amount == Decimal("25.00")


# ---------- Negotiation rounds ----------


def test_multiple_rounds_increment_round_number_and_audit(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            effective_from=date.today(),
        ),
        actor_user_id=int(actor.id),
    )
    svc.add_negotiation_round(
        int(rate.id),
        NegotiationRoundCreate(
            proposed_rate=Decimal("85"),
            remarks="vendor proposal",
            apply_to_negotiated_rate=False,
        ),
        actor_user_id=int(actor.id),
    )
    svc.add_negotiation_round(
        int(rate.id),
        NegotiationRoundCreate(
            counter_rate=Decimal("80"),
            remarks="our counter",
            apply_to_negotiated_rate=True,
        ),
        actor_user_id=int(actor.id),
    )
    refreshed = svc.get_rate(int(rate.id))
    assert refreshed.current_round == 2
    rounds = sorted(refreshed.negotiation_logs, key=lambda r: r.round_number)
    assert [r.round_number for r in rounds] == [1, 2]
    assert rounds[0].proposed_rate == Decimal("85.00")
    assert rounds[1].counter_rate == Decimal("80.00")
    # Round 2 applied -> negotiated_rate is now 80, savings recomputed.
    assert refreshed.negotiated_rate == Decimal("80.00")
    actions = [
        a.action
        for a in db.scalars(
            select(ContractorRateAuditLog).where(
                ContractorRateAuditLog.contractor_rate_id == rate.id
            )
        ).all()
    ]
    assert actions.count(ACTION_NEGOTIATION_ADDED) == 2
    # An UPDATED row must exist for the round-2 application of the counter rate.
    assert "UPDATED" in actions


def test_round_requires_at_least_one_value(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            effective_from=date.today(),
        ),
        actor_user_id=int(actor.id),
    )
    with pytest.raises(ConflictError):
        svc.add_negotiation_round(
            int(rate.id),
            NegotiationRoundCreate(remarks="empty"),
            actor_user_id=int(actor.id),
        )


# ---------- Auto-approve when no workflow ----------


def test_submit_with_no_workflow_auto_approves_and_writes_activation_audit(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            effective_from=date.today(),
        ),
        actor_user_id=int(actor.id),
    )
    svc.submit_for_approval(int(rate.id), actor_user_id=int(actor.id))
    refreshed = svc.get_rate(int(rate.id))
    assert refreshed.status == "approved"
    actions = [
        a.action
        for a in db.scalars(
            select(ContractorRateAuditLog).where(
                ContractorRateAuditLog.contractor_rate_id == rate.id
            )
        ).all()
    ]
    assert ACTION_APPROVED in actions
    assert ACTION_RATE_ACTIVATED in actions


# ---------- Approval workflow ----------


def _setup_workflow_for(
    db: Session, *, action_code: str, actor_id: int
) -> tuple[ApprovalWorkflow, Role, User]:
    role = Role(name=f"Approver-{action_code}", description=None)
    db.add(role)
    db.commit()
    approver = User(
        full_name="Approver",
        username="approver",
        phone="+15550100200",
        email="approver@example.com",
        hashed_password="x",
        password_changed_at=date.today(),
    )
    db.add(approver)
    db.commit()
    approver.roles = [role]
    db.commit()

    svc = ApprovalWorkflowService(db)
    wf = svc.create_workflow(
        name=f"Workflow {action_code}",
        entity_type=action_code,
        created_by=actor_id,
        is_active=False,
    )
    svc.add_step(
        workflow_id=wf.id, step_order=1, approver_role_id=role.id, required_approvals=1
    )
    db.expire_all()
    svc.activate_workflow(wf.id, actor_user_id=actor_id)

    feat = Feature(key="contractor_rates", name="Contractor rates")
    db.add(feat)
    db.commit()
    db.add(Permission(feature_id=feat.id, action="create", code=action_code))
    db.commit()
    WorkflowMappingService(db).create_mapping(action_code=action_code, workflow_id=wf.id)
    return wf, role, approver


def test_submit_with_workflow_holds_pending_then_approves(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    _setup_workflow_for(db, action_code=ACTION_CODE_CREATE, actor_id=int(actor.id))
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            effective_from=date.today(),
        ),
        actor_user_id=int(actor.id),
    )
    svc.submit_for_approval(int(rate.id), actor_user_id=int(actor.id))
    pending = svc.get_rate(int(rate.id))
    assert pending.status == "pending_approval"
    assert pending.approval_request_id is not None

    # Audit shows SENT_FOR_APPROVAL.
    actions = [
        a.action
        for a in db.scalars(
            select(ContractorRateAuditLog).where(
                ContractorRateAuditLog.contractor_rate_id == rate.id
            )
        ).all()
    ]
    assert ACTION_SENT_FOR_APPROVAL in actions

    # Approver approves -> rate is activated.
    req = db.get(ApprovalRequest, int(pending.approval_request_id))
    assert req is not None
    task = req.tasks[0]
    approver = db.scalar(select(User).where(User.username == "approver"))
    assert approver is not None
    ApprovalEngineService(db).act_on_task(
        task_id=int(task.id),
        actor_user_id=int(approver.id),
        action="approve",
        comment="OK",
    )
    finalized = svc.get_rate(int(rate.id))
    assert finalized.status == "approved"
    assert finalized.approved_by == approver.id

    actions_after = [
        a.action
        for a in db.scalars(
            select(ContractorRateAuditLog).where(
                ContractorRateAuditLog.contractor_rate_id == rate.id
            )
        ).all()
    ]
    assert ACTION_APPROVED in actions_after
    assert ACTION_RATE_ACTIVATED in actions_after


def test_approval_deactivates_previous_active_rate(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    """Approving a new rate for the same (contractor, rate_master) marks the previous
    active rate as expired and writes RATE_DEACTIVATED + EXPIRED audit rows on it.
    """
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    svc = ContractorRateService(db)
    # First approved rate (no workflow -> auto-approve).
    first = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            effective_from=date.today() - timedelta(days=60),
            effective_to=date.today() - timedelta(days=31),
        ),
        actor_user_id=int(actor.id),
    )
    svc.submit_for_approval(int(first.id), actor_user_id=int(actor.id))

    second = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("80"),
            effective_from=date.today() - timedelta(days=30),
        ),
        actor_user_id=int(actor.id),
    )
    svc.submit_for_approval(int(second.id), actor_user_id=int(actor.id))

    db.refresh(first)
    assert first.status == "expired"
    deactivation_actions = [
        a.action
        for a in db.scalars(
            select(ContractorRateAuditLog).where(
                ContractorRateAuditLog.contractor_rate_id == first.id
            )
        ).all()
    ]
    assert ACTION_RATE_DEACTIVATED in deactivation_actions
    assert "EXPIRED" in deactivation_actions


def test_rejection_marks_rate_rejected_and_audits(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    _setup_workflow_for(db, action_code=ACTION_CODE_CREATE, actor_id=int(actor.id))
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            effective_from=date.today(),
        ),
        actor_user_id=int(actor.id),
    )
    svc.submit_for_approval(int(rate.id), actor_user_id=int(actor.id))
    pending = svc.get_rate(int(rate.id))

    # Approver rejects.
    req = db.get(ApprovalRequest, int(pending.approval_request_id))
    assert req is not None
    task = req.tasks[0]
    approver = db.scalar(select(User).where(User.username == "approver"))
    assert approver is not None
    ApprovalEngineService(db).act_on_task(
        task_id=int(task.id),
        actor_user_id=int(approver.id),
        action="reject",
        comment="too high",
    )
    rejected = svc.get_rate(int(rate.id))
    assert rejected.status == "rejected"
    actions = [
        a.action
        for a in db.scalars(
            select(ContractorRateAuditLog).where(
                ContractorRateAuditLog.contractor_rate_id == rate.id
            )
        ).all()
    ]
    assert ACTION_REJECTED in actions


# ---------- One negotiation thread per contractor + part ----------


def test_create_rate_rejected_when_draft_exists_for_same_contractor_part(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    svc = ContractorRateService(db)
    svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            effective_from=date.today(),
        ),
        actor_user_id=int(actor.id),
    )
    with pytest.raises(ConflictError, match="negotiation already exists"):
        svc.create_rate(
            ContractorRateCreate(
                contractor_id=int(contractor.id),
                part_master_id=int(rm.id),
                negotiated_rate=Decimal("80"),
                effective_from=date.today(),
            ),
            actor_user_id=int(actor.id),
        )


def test_create_rate_rejected_when_approved_current_window_exists(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    svc = ContractorRateService(db)
    first = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            effective_from=date.today(),
            effective_to=date.today() + timedelta(days=60),
        ),
        actor_user_id=int(actor.id),
    )
    svc.submit_for_approval(int(first.id), actor_user_id=int(actor.id))
    with pytest.raises(ConflictError, match="negotiation already exists"):
        svc.create_rate(
            ContractorRateCreate(
                contractor_id=int(contractor.id),
                part_master_id=int(rm.id),
                negotiated_rate=Decimal("80"),
                effective_from=date.today() + timedelta(days=30),
            ),
            actor_user_id=int(actor.id),
        )


def test_create_rate_allowed_after_prior_approved_thread_ended(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    """Once the only approved window for this pair is entirely in the past, a new row may be created."""
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    svc = ContractorRateService(db)
    past_end = date.today() - timedelta(days=10)
    past_start = date.today() - timedelta(days=100)
    first = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            effective_from=past_start,
            effective_to=past_end,
        ),
        actor_user_id=int(actor.id),
    )
    svc.submit_for_approval(int(first.id), actor_user_id=int(actor.id))
    second = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("80"),
            effective_from=date.today(),
        ),
        actor_user_id=int(actor.id),
    )
    assert int(second.id) != int(first.id)


# ---------- Aggregate summary ----------


def test_aggregate_summary_counts_negotiation_savings_and_vs_base(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    rm = _make_part(
        db, plant_id=int(plant.id), actor_id=int(actor.id), base_rate="100.00"
    )
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("110"),  # approved 10 ABOVE base
            initial_rate=Decimal("130"),  # vendor opened at 130 -> saved 20
            effective_from=date.today(),
        ),
        actor_user_id=int(actor.id),
    )
    svc.submit_for_approval(int(rate.id), actor_user_id=int(actor.id))
    summary = svc.aggregate_summary()
    assert summary["approved"] == 1
    assert summary["pending_approvals"] == 0
    # Negotiation savings: 130 -> 110 = 20
    assert summary["total_savings"] == Decimal("20.00")
    # Vs-base: 110 - 100 = 10 premium above base.
    assert summary["total_premium_above_base"] == Decimal("10.00")
    assert summary["approved_above_base"] == 1
    assert summary["approved_below_base"] == 0
    assert summary["approved_at_base"] == 0


def test_aggregate_summary_counts_below_base_correctly(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    rm = _make_part(
        db, plant_id=int(plant.id), actor_id=int(actor.id), base_rate="100.00"
    )
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("85"),
            initial_rate=Decimal("100"),
            effective_from=date.today(),
        ),
        actor_user_id=int(actor.id),
    )
    svc.submit_for_approval(int(rate.id), actor_user_id=int(actor.id))
    summary = svc.aggregate_summary()
    # 100 -> 85 = 15 negotiation savings.
    assert summary["total_savings"] == Decimal("15.00")
    # 85 - 100 = -15 -> below base by 15.
    assert summary["total_premium_above_base"] == Decimal("0.00")
    assert summary["total_below_base_savings"] == Decimal("15.00")
    assert summary["approved_above_base"] == 0
    assert summary["approved_below_base"] == 1


# ---------- Rate master audit logs ----------


def test_rate_master_create_writes_audit_row(
    db: Session, actor: User, plant: OrgUnit
) -> None:
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    rows = list(
        db.scalars(
            select(PartMasterAuditLog)
            .where(PartMasterAuditLog.part_master_id == int(rm.id))
            .order_by(PartMasterAuditLog.id.asc())
        ).all()
    )
    # 3.4 adds a VERSION_CREATED audit alongside CREATED. Filter to assert
    # the original lifecycle code stays present.
    lifecycle = [r for r in rows if r.action != "VERSION_CREATED"]
    assert len(lifecycle) == 1
    assert lifecycle[0].action == "CREATED"
    assert lifecycle[0].changed_by == int(actor.id)
    new_value = lifecycle[0].new_value or {}
    assert new_value["part_code"] == "WELDER-SKILLED-HOUR"
    assert new_value["part_name"] == "Welder (skilled)"
    assert new_value["is_active"] is True


def test_rate_master_update_diff_audit(
    db: Session, actor: User, plant: OrgUnit
) -> None:
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    PartMasterService(db).update_part_master(
        int(rm.id),
        PartMasterUpdate(base_rate=Decimal("120.00"), notes="Q2 revision"),
        actor_user_id=int(actor.id),
    )
    rows = list(
        db.scalars(
            select(PartMasterAuditLog)
            .where(PartMasterAuditLog.part_master_id == int(rm.id))
            .order_by(PartMasterAuditLog.id.asc())
        ).all()
    )
    # 3.4: filter out the auto-generated VERSION_CREATED rows to keep the
    # original lifecycle assertion intact.
    lifecycle = [r for r in rows if r.action != "VERSION_CREATED"]
    actions = [r.action for r in lifecycle]
    assert actions == ["CREATED", "UPDATED"]
    upd = lifecycle[1]
    old_value = upd.old_value or {}
    new_value = upd.new_value or {}
    # Only the changed fields should be present.
    assert set(old_value.keys()) == set(new_value.keys())
    assert "base_rate" in new_value
    assert new_value["notes"] == "Q2 revision"
    assert old_value.get("notes") in (None, "")
    # The diff is field-scoped — unchanged fields like part_code are not stored.
    assert "part_code" not in new_value


def test_rate_master_supersession_writes_supersede_audit(
    db: Session, actor: User, plant: OrgUnit
) -> None:
    rm_old = _make_part(
        db,
        plant_id=int(plant.id),
        actor_id=int(actor.id),
        effective_from=date.today() - timedelta(days=10),
    )
    rm_new = _make_part(
        db,
        plant_id=int(plant.id),
        actor_id=int(actor.id),
        base_rate="125.00",
        effective_from=date.today(),
    )
    db.refresh(rm_old)
    assert rm_old.is_active is False
    assert rm_new.is_active is True

    old_actions = [
        r.action
        for r in db.scalars(
            select(PartMasterAuditLog)
            .where(PartMasterAuditLog.part_master_id == int(rm_old.id))
            .order_by(PartMasterAuditLog.id.asc())
        ).all()
    ]
    assert "SUPERSEDED" in old_actions
    new_actions = [
        r.action
        for r in db.scalars(
            select(PartMasterAuditLog)
            .where(PartMasterAuditLog.part_master_id == int(rm_new.id))
            .order_by(PartMasterAuditLog.id.asc())
        ).all()
    ]
    # 3.4: CREATED of a row that supersedes another now also writes
    # VERSION_CREATED + RATE_REPLACED audits.
    assert "CREATED" in new_actions
    assert "VERSION_CREATED" in new_actions
    assert "RATE_REPLACED" in new_actions
    # The CREATED audit on the new row should reference the superseded row.
    new_create = db.scalar(
        select(PartMasterAuditLog)
        .where(
            PartMasterAuditLog.part_master_id == int(rm_new.id),
            PartMasterAuditLog.action == "CREATED",
        )
    )
    assert new_create is not None
    meta = new_create.metadata_json or {}
    assert int(rm_old.id) in (meta.get("superseded_ids") or [])


def test_rate_master_deactivate_writes_deactivated_audit(
    db: Session, actor: User, plant: OrgUnit
) -> None:
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    PartMasterService(db).update_part_master(
        int(rm.id),
        PartMasterUpdate(is_active=False),
        actor_user_id=int(actor.id),
    )
    actions = [
        r.action
        for r in db.scalars(
            select(PartMasterAuditLog)
            .where(PartMasterAuditLog.part_master_id == int(rm.id))
            .order_by(PartMasterAuditLog.id.asc())
        ).all()
    ]
    # 3.4: filter out VERSION_CREATED so the lifecycle sequence stays explicit.
    lifecycle = [a for a in actions if a != "VERSION_CREATED"]
    assert lifecycle == ["CREATED", "UPDATED", "DEACTIVATED"]


def test_list_audit_logs_returns_actor_name(
    db: Session, actor: User, plant: OrgUnit
) -> None:
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    rows = PartMasterService(db).list_audit_logs(int(rm.id))
    # Newest first: VERSION_CREATED after CREATED in time.
    actions = [r["action"] for r in rows]
    assert actions == ["VERSION_CREATED", "CREATED"]
    assert rows[0]["changed_by"] == int(actor.id)
    assert rows[0]["changed_by_name"] == "Op Admin"
