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
from modules.approvals.inbox_service import ApprovalInboxService
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
from modules.tasks.service import TaskService, build_task_detail_public
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
        ContractorCreate(
            contractor_code="CTR-TEST-ACME",
            name="Acme Vendor",
            legal_name="Acme Vendor Legal",
            pan="ABCDE1234F",
            gstin="22ABCDE1234F1Z5",
            contractor_type="vendor",
            contact_person="Ops Admin",
            email="acme.vendor@example.com",
            phone="9876543210",
            address="123 Market Road",
            city="Mumbai",
            state="Maharashtra",
            country="India",
            postal_code="400001",
        ),
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


def test_rate_master_duplicate_part_code_rejected(
    db: Session, actor: User, plant: OrgUnit
) -> None:
    """Part codes are unique; creating a second record with the same code is rejected."""
    first = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    with pytest.raises(ConflictError, match="Part Code already exists"):
        _make_part(
            db,
            plant_id=int(plant.id),
            actor_id=int(actor.id),
            base_rate="110",
            effective_from=date.today() + timedelta(days=1),
        )
    db.refresh(first)
    assert first.is_active is True


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
            remarks="Counter offer",
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
            remarks="round1 lift test",
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


def test_draft_negotiate_revises_round_one_in_place(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    """While draft, negotiate updates round 1 — it does not create round 2."""
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            effective_from=date.today(),
            remarks="draft revise test",
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
    assert refreshed.current_round == 1
    assert len(refreshed.negotiation_logs) == 1
    rnd = refreshed.negotiation_logs[0]
    assert int(rnd.round_number) == 1
    assert rnd.proposed_rate == Decimal("85.00")
    assert rnd.counter_rate == Decimal("80.00")
    assert refreshed.negotiated_rate == Decimal("80.00")
    actions = [
        a.action
        for a in db.scalars(
            select(ContractorRateAuditLog).where(
                ContractorRateAuditLog.contractor_rate_id == rate.id
            )
        ).all()
    ]
    assert actions.count(ACTION_NEGOTIATION_ADDED) == 0
    assert "UPDATED" in actions


def test_draft_negotiate_prunes_erroneous_round_two(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    """Legacy round-2 rows in draft are removed; edits stay on round 1."""
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("125"),
            effective_from=date.today(),
            remarks="prune test",
        ),
        actor_user_id=int(actor.id),
    )
    # Simulate mistaken round 2 from older behaviour.
    stray = NegotiationLog(
        contractor_rate_id=int(rate.id),
        round_number=2,
        counter_rate=Decimal("127"),
        proposed_rate=None,
        round_summary="Stale",
        created_by=int(actor.id),
    )
    db.add(stray)
    row = svc.get_rate(int(rate.id))
    row.current_round = 2
    db.commit()

    svc.add_negotiation_round(
        int(rate.id),
        NegotiationRoundCreate(
            counter_rate=Decimal("120"),
            remarks="prune revise",
            apply_to_negotiated_rate=True,
        ),
        actor_user_id=int(actor.id),
    )
    refreshed = svc.get_rate(int(rate.id))
    assert refreshed.current_round == 1
    assert len(refreshed.negotiation_logs) == 1
    assert int(refreshed.negotiation_logs[0].round_number) == 1
    assert refreshed.negotiation_logs[0].counter_rate == Decimal("120.00")


def test_rejected_negotiation_adds_round_two(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    """After rejection, a new negotiate call starts round 2 (not an in-place draft edit)."""
    rm = _make_part(
        db, plant_id=int(plant.id), actor_id=int(actor.id), base_rate="100.00"
    )
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            effective_from=date.today(),
            remarks="rejected round test",
        ),
        actor_user_id=int(actor.id),
    )
    row = svc.get_rate(int(rate.id))
    row.status = "rejected"
    db.commit()
    svc.add_negotiation_round(
        int(rate.id),
        NegotiationRoundCreate(
            counter_rate=Decimal("82"),
            remarks="revised after rejection",
            apply_to_negotiated_rate=True,
        ),
        actor_user_id=int(actor.id),
    )
    refreshed = svc.get_rate(int(rate.id))
    assert refreshed.current_round == 2
    rounds = sorted(refreshed.negotiation_logs, key=lambda r: r.round_number)
    assert [int(r.round_number) for r in rounds] == [1, 2]
    assert rounds[1].counter_rate == Decimal("82.00")


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
            remarks="initial submission",
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
            remarks="initial submission",
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


def _setup_two_step_workflow_for(
    db: Session, *, action_code: str, actor_id: int
) -> tuple[ApprovalWorkflow, Role, User, Role, User]:
    role_l1 = Role(name=f"Approver-L1-{action_code}", description=None)
    role_l2 = Role(name=f"Approver-L2-{action_code}", description=None)
    db.add_all([role_l1, role_l2])
    db.commit()

    approver_l1 = User(
        full_name="Approver L1",
        username=f"approver.l1.{action_code}",
        phone="+15550100201",
        email=f"approver.l1.{action_code}@example.com",
        hashed_password="x",
        password_changed_at=date.today(),
    )
    approver_l2 = User(
        full_name="Approver L2",
        username=f"approver.l2.{action_code}",
        phone="+15550100202",
        email=f"approver.l2.{action_code}@example.com",
        hashed_password="x",
        password_changed_at=date.today(),
    )
    db.add_all([approver_l1, approver_l2])
    db.commit()

    approver_l1.roles = [role_l1]
    approver_l2.roles = [role_l2]
    db.commit()

    svc = ApprovalWorkflowService(db)
    wf = svc.create_workflow(
        name=f"Workflow {action_code} (2-step)",
        entity_type=action_code,
        created_by=actor_id,
        is_active=False,
    )
    svc.add_step(
        workflow_id=wf.id, step_order=1, approver_role_id=role_l1.id, required_approvals=1
    )
    svc.add_step(
        workflow_id=wf.id, step_order=2, approver_role_id=role_l2.id, required_approvals=1
    )
    db.expire_all()
    svc.activate_workflow(wf.id, actor_user_id=actor_id)

    feat = Feature(key="contractor_rates", name="Contractor rates")
    db.add(feat)
    db.commit()
    db.add(Permission(feature_id=feat.id, action="create", code=action_code))
    db.commit()
    WorkflowMappingService(db).create_mapping(action_code=action_code, workflow_id=wf.id)
    return wf, role_l1, approver_l1, role_l2, approver_l2


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
            remarks="initial submission",
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
            remarks="initial submission",
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


def test_rejected_rate_resubmits_same_approval_request_without_duplicate_pending(
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
            remarks="initial submission",
        ),
        actor_user_id=int(actor.id),
    )
    first_submit = svc.submit_for_approval(int(rate.id), actor_user_id=int(actor.id))
    assert str(first_submit.status) == "pending_approval"
    first_request_id = int(first_submit.approval_request_id or 0)
    assert first_request_id > 0

    req = db.get(ApprovalRequest, first_request_id)
    assert req is not None
    task = req.tasks[0]
    approver = db.scalar(select(User).where(User.username == "approver"))
    assert approver is not None
    ApprovalEngineService(db).act_on_task(
        task_id=int(task.id),
        actor_user_id=int(approver.id),
        action="reject",
        comment="needs another round",
    )

    updated = svc.update_rate(
        int(rate.id),
        ContractorRateUpdate(
            negotiated_rate=Decimal("88"),
            remarks="retry after rejection",
        ),
        actor_user_id=int(actor.id),
    )
    resubmitted = svc.submit_for_approval(int(updated.id), actor_user_id=int(actor.id))
    assert str(resubmitted.status) == "pending_approval"
    assert int(resubmitted.approval_request_id or 0) == first_request_id

    pending_requests = db.scalars(
        select(ApprovalRequest).where(
            ApprovalRequest.entity_type == "contractor_rate_approval",
            ApprovalRequest.entity_id == int(rate.id),
            ApprovalRequest.status == "pending",
        )
    ).all()
    assert len(pending_requests) == 1

    pending_tasks = db.scalars(
        select(ApprovalTask).where(
            ApprovalTask.request_id == first_request_id,
            ApprovalTask.status == "pending",
        )
    ).all()
    assert len(pending_tasks) == 1


def test_reject_archives_stale_in_rework_request_for_same_rate(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    wf, _role, approver = _setup_workflow_for(db, action_code=ACTION_CODE_CREATE, actor_id=int(actor.id))
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            effective_from=date.today(),
            remarks="initial submission",
        ),
        actor_user_id=int(actor.id),
    )
    svc.submit_for_approval(int(rate.id), actor_user_id=int(actor.id))
    first_request_id = int(svc.get_rate(int(rate.id)).approval_request_id or 0)
    assert first_request_id > 0

    first_task = db.scalars(
        select(ApprovalTask)
        .where(ApprovalTask.request_id == first_request_id, ApprovalTask.status == "pending")
        .order_by(ApprovalTask.id.asc())
    ).first()
    assert first_task is not None
    ApprovalEngineService(db).act_on_task(
        task_id=int(first_task.id),
        actor_user_id=int(approver.id),
        action="reject",
        comment="first reject",
    )

    stale_request = db.get(ApprovalRequest, first_request_id)
    assert stale_request is not None
    assert str(stale_request.status) == "in_rework"

    rate_model = db.get(ContractorRate, int(rate.id))
    assert rate_model is not None
    rate_model.status = "pending_approval"
    db.commit()

    duplicate_request = ApprovalEngineService(db).create_request_for_entity(
        workflow=wf,
        entity_type="contractor_rate_approval",
        entity_id=int(rate.id),
        payload={
            "action_code": ACTION_CODE_CREATE,
            "contractor_rate_id": int(rate.id),
            "contractor_id": int(contractor.id),
            "part_master_id": int(rm.id),
            "negotiated_rate": "90.00",
            "previous_rate": None,
            "savings_amount": "0.00",
            "savings_percentage": "0.00",
            "effective_from": date.today().isoformat(),
            "effective_to": None,
        },
        created_by=int(actor.id),
    )
    rate_model.approval_request_id = int(duplicate_request.id)
    db.commit()

    duplicate_task = db.scalars(
        select(ApprovalTask)
        .where(ApprovalTask.request_id == int(duplicate_request.id), ApprovalTask.status == "pending")
        .order_by(ApprovalTask.id.asc())
    ).first()
    assert duplicate_task is not None
    ApprovalEngineService(db).act_on_task(
        task_id=int(duplicate_task.id),
        actor_user_id=int(approver.id),
        action="reject",
        comment="second reject",
    )

    db.expire_all()
    refreshed_first = db.get(ApprovalRequest, first_request_id)
    refreshed_second = db.get(ApprovalRequest, int(duplicate_request.id))
    assert refreshed_first is not None and str(refreshed_first.status) == "rejected"
    assert refreshed_second is not None and str(refreshed_second.status) == "in_rework"

    stale_rework_tasks = db.scalars(
        select(ApprovalTask).where(
            ApprovalTask.request_id == first_request_id,
            ApprovalTask.task_type == "rework",
        )
    ).all()
    assert stale_rework_tasks
    assert all(str(task.status) == "closed" for task in stale_rework_tasks)


def test_second_step_rejection_pending_request_reads_as_rework(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    _wf, _role_l1, approver_l1, _role_l2, approver_l2 = _setup_two_step_workflow_for(
        db, action_code=ACTION_CODE_CREATE, actor_id=int(actor.id)
    )
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            effective_from=date.today(),
            remarks="two-step reject",
        ),
        actor_user_id=int(actor.id),
    )
    submitted = svc.submit_for_approval(int(rate.id), actor_user_id=int(actor.id))
    request_id = int(submitted.approval_request_id or 0)
    assert request_id > 0

    first_task = db.scalars(
        select(ApprovalTask)
        .where(ApprovalTask.request_id == request_id, ApprovalTask.status == "pending")
        .order_by(ApprovalTask.id.asc())
    ).first()
    assert first_task is not None
    ApprovalEngineService(db).act_on_task(
        task_id=int(first_task.id),
        actor_user_id=int(approver_l1.id),
        action="approve",
        comment="l1 ok",
    )

    second_task = db.scalars(
        select(ApprovalTask)
        .where(ApprovalTask.request_id == request_id, ApprovalTask.status == "pending")
        .order_by(ApprovalTask.id.asc())
    ).first()
    assert second_task is not None
    ApprovalEngineService(db).act_on_task(
        task_id=int(second_task.id),
        actor_user_id=int(approver_l2.id),
        action="reject",
        comment="l2 rejected",
    )

    req = db.get(ApprovalRequest, request_id)
    assert req is not None
    assert str(req.status) == "in_rework"

    rework_task = db.scalars(
        select(ApprovalTask)
        .where(ApprovalTask.request_id == request_id, ApprovalTask.task_type == "rework")
        .order_by(ApprovalTask.id.desc())
    ).first()
    assert rework_task is not None

    # Simulate a legacy partial-update row where the request stayed "pending"
    # even though the current cycle had already been rejected at step 2.
    req.status = "pending"
    req.current_step = 2
    req.last_resubmitted_at = None
    db.commit()
    db.expire_all()

    status_payload = ApprovalInboxService(db).get_request_status(
        request_id=request_id,
        viewer_id=int(actor.id),
    )
    assert status_payload["request_status"] == "in_rework"

    detail = build_task_detail_public(db, TaskService(db).get_task(task_id=int(second_task.id)))
    assert detail.approval is not None
    assert detail.approval.status == "in_rework"

    active_tasks = TaskService(db).my_tasks(viewer_id=int(actor.id), inbox="active")
    assert any(
        int(task.request_id or 0) == request_id and str(task.task_type) == "rework"
        for task in active_tasks
    )
    assert not any(
        int(task.request_id or 0) == request_id and str(task.task_type) == "approval"
        for task in active_tasks
    )


def test_resubmitted_request_with_historic_rejection_stays_pending_in_reads(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    _wf, _role_l1, approver_l1, _role_l2, approver_l2 = _setup_two_step_workflow_for(
        db, action_code=ACTION_CODE_CREATE, actor_id=int(actor.id)
    )
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            effective_from=date.today(),
            remarks="two-step resubmit",
        ),
        actor_user_id=int(actor.id),
    )
    submitted = svc.submit_for_approval(int(rate.id), actor_user_id=int(actor.id))
    request_id = int(submitted.approval_request_id or 0)
    assert request_id > 0

    first_task = db.scalars(
        select(ApprovalTask)
        .where(ApprovalTask.request_id == request_id, ApprovalTask.status == "pending")
        .order_by(ApprovalTask.id.asc())
    ).first()
    assert first_task is not None
    ApprovalEngineService(db).act_on_task(
        task_id=int(first_task.id),
        actor_user_id=int(approver_l1.id),
        action="approve",
        comment="l1 ok",
    )

    second_task = db.scalars(
        select(ApprovalTask)
        .where(ApprovalTask.request_id == request_id, ApprovalTask.status == "pending")
        .order_by(ApprovalTask.id.asc())
    ).first()
    assert second_task is not None
    ApprovalEngineService(db).act_on_task(
        task_id=int(second_task.id),
        actor_user_id=int(approver_l2.id),
        action="reject",
        comment="needs revision",
    )

    updated = svc.update_rate(
        int(rate.id),
        ContractorRateUpdate(
            negotiated_rate=Decimal("88"),
            remarks="resubmitted after rejection",
        ),
        actor_user_id=int(actor.id),
    )
    resubmitted = svc.submit_for_approval(int(updated.id), actor_user_id=int(actor.id))
    assert int(resubmitted.approval_request_id or 0) == request_id
    db.expire_all()

    status_payload = ApprovalInboxService(db).get_request_status(
        request_id=request_id,
        viewer_id=int(actor.id),
    )
    assert status_payload["request_status"] == "pending"

    pending_task = db.scalars(
        select(ApprovalTask)
        .where(ApprovalTask.request_id == request_id, ApprovalTask.status == "pending")
        .order_by(ApprovalTask.id.desc())
    ).first()
    assert pending_task is not None

    detail = build_task_detail_public(db, TaskService(db).get_task(task_id=int(pending_task.id)))
    assert detail.approval is not None
    assert detail.approval.status == "pending"

def test_approved_rate_can_start_successor_round_in_new_draft(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    svc = ContractorRateService(db)
    first = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            initial_rate=Decimal("100"),
            effective_from=date.today(),
            remarks="round 1",
        ),
        actor_user_id=int(actor.id),
    )
    svc.submit_for_approval(int(first.id), actor_user_id=int(actor.id))
    approved = svc.get_rate(int(first.id))
    assert approved.status == "approved"

    round2 = svc.add_negotiation_round(
        int(approved.id),
        NegotiationRoundCreate(
            proposed_rate=None,
            counter_rate=Decimal("85"),
            remarks="second cycle",
            apply_to_negotiated_rate=True,
        ),
        actor_user_id=int(actor.id),
    )

    assert int(round2.contractor_rate_id) != int(approved.id)
    assert int(round2.round_number) == 2

    successor = svc.get_rate(int(round2.contractor_rate_id))
    db.refresh(first)
    assert first.status == "approved"
    assert successor.status == "draft"
    assert successor.current_round == 2
    assert successor.previous_rate == Decimal("90")
    assert successor.negotiated_rate == Decimal("85")

    svc.submit_for_approval(int(successor.id), actor_user_id=int(actor.id))
    db.refresh(first)
    finalized = svc.get_rate(int(successor.id))
    assert first.status == "expired"
    assert finalized.status == "approved"


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


def test_rate_master_update_rejects_duplicate_part_code(
    db: Session, actor: User, plant: OrgUnit
) -> None:
    rm_existing = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    rm_other = _make_part(
        db,
        plant_id=int(plant.id),
        actor_id=int(actor.id),
        job_type="Painter",
    )

    with pytest.raises(ConflictError, match="Part Code already exists"):
        PartMasterService(db).update_part_master(
            int(rm_other.id),
            PartMasterUpdate(part_code=rm_existing.part_code),
            actor_user_id=int(actor.id),
        )

    actions = [
        r.action
        for r in db.scalars(
            select(PartMasterAuditLog)
            .where(PartMasterAuditLog.part_master_id == int(rm_other.id))
            .order_by(PartMasterAuditLog.id.asc())
        ).all()
    ]
    assert actions == ["CREATED", "VERSION_CREATED"]


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
