#!/usr/bin/env python3
"""Seed Part Master + negotiation dummy data for manual UI testing.

Run from project root:

    ./venv/bin/python scripts/seed_manual_test_rates.py

What this gives you (idempotent — safe to run repeatedly):

* **Part masters**: a mix of active / superseded (history) / future-effective /
  expired rows across 3 plants and several commercial templates.
* **Approval workflow** for ``contractor_rates.create`` mapped to a single-step
  workflow whose approver is the seeded ``Procurement Approver`` role
  (created by ``scripts/seed_admin_test_data.py``).
* **Contractor rates** in every status the UI knows how to render:
  ``draft``, ``pending_approval``, ``approved``, ``rejected``,
  plus a rate that has gone through 3 negotiation rounds.
* Full audit trail: each create / update / round / approval / activation
  generates rows in ``part_master_audit_logs`` and
  ``contractor_rate_audit_logs`` so the timeline UI is non-empty.
* Aggregates so the workspace KPIs on
  ``/dashboard/negotiated-rates`` are non-zero.

The script reuses existing rows where possible:
  * org units of type ``PLANT`` (if none exist: two demo ``CLUSTER`` rows West/East
    plus one plant under West)
  * the contractors seeded by ``seed_manual_test_contractors.py``
  * the ``Procurement Approver`` role from ``seed_admin_test_data.py``

If those scripts have not been run, this script will skip the parts that
require them and print actionable hints.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

import db.models  # noqa: F401 — register all models on Base.metadata
from db.session import SessionLocal
from modules.approvals.model import (
    ApprovalRequest,
    ApprovalStep,
    ApprovalTask,
    ApprovalWorkflow,
    ApprovalWorkflowMapping,
)
from modules.approvals.service import ApprovalEngineService
from modules.contractor.models import Contractor
from modules.contractor_rates.models import (
    ContractorRate,
    ContractorRateAuditLog,
    NegotiationLog,
)
from modules.contractor_rates.schema import (
    ContractorRateCreate,
    NegotiationRoundCreate,
)
from modules.contractor_rates.service import (
    ACTION_CODE_CREATE,
    ContractorRateService,
)
from modules.part_master.models import PartMaster, PartMasterAuditLog
from modules.part_master.schema import PartMasterCreate, PartMasterUpdate
from modules.part_master.service import PartMasterService
from modules.org_units.model import OrgUnit
from modules.permissions.model import Permission
from modules.rbac_sync import sync_all_modules_to_db
from modules.roles.model import Role
from modules.users.model import User


# ---------- helpers ----------


def _earliest_user(db: Session) -> User | None:
    return db.scalars(select(User).order_by(User.id.asc())).first()


def _user_by_username(db: Session, username: str) -> User | None:
    return db.scalar(select(User).where(User.username == username))


def _role_by_name(db: Session, name: str) -> Role | None:
    return db.scalar(select(Role).where(Role.name == name))


def _ensure_approver_role(db: Session) -> Role:
    """Return (and create if missing) a role suitable as the rate approver.

    Prefers the richer ``Procurement Approver`` role from
    ``scripts/seed_admin_test_data.py`` when present; otherwise creates
    ``Rate Seed Approver`` with just the permissions we need to act on tasks.
    """
    existing = _role_by_name(db, "Procurement Approver")
    if existing is not None:
        return existing

    sync_all_modules_to_db(db)

    needed_codes = (
        "contractor_rates.view",
        "contractor_rates.approve",
        "approval.view",
        "approval.act",
    )
    perms = list(
        db.scalars(select(Permission).where(Permission.code.in_(needed_codes))).all()
    )

    role = _role_by_name(db, "Rate Seed Approver")
    if role is None:
        role = Role(
            name="Rate Seed Approver",
            description="Auto-created by seed_manual_test_rates.py — approves negotiation requests.",
        )
        db.add(role)
        db.flush()
    role.permissions = perms
    role.org_units = []  # global across plants
    db.commit()
    db.refresh(role)
    return role


def _ensure_user_has_role(db: Session, user: User, role: Role) -> None:
    if role not in user.roles:
        user.roles.append(role)
        db.commit()
        db.refresh(user)


def _ensure_plants(db: Session) -> list[OrgUnit]:
    """Return at least one PLANT org unit (creating two demo clusters + a plant if none exist)."""
    plants = list(
        db.scalars(
            select(OrgUnit).where(OrgUnit.type == "PLANT").order_by(OrgUnit.id.asc())
        ).all()
    )
    if plants:
        return plants
    west = OrgUnit(name="TiM Demo Cluster — West", type="CLUSTER")
    east = OrgUnit(name="TiM Demo Cluster — East", type="CLUSTER")
    db.add_all([west, east])
    db.flush()
    p = OrgUnit(name="TiM Demo Plant — North", type="PLANT", parent_id=int(west.id))
    db.add(p)
    db.commit()
    db.refresh(p)
    return [p]


def _ensure_workflow_for_action(
    db: Session,
    *,
    action_code: str,
    approver_role: Role,
    creator_user_id: int | None,
) -> ApprovalWorkflow | None:
    """Create (or reuse) a single-step workflow + mapping for ``action_code``.

    Returns ``None`` if no approver role exists; the caller can then fall back
    to the auto-approve path that ``ContractorRateService.submit_for_approval``
    already supports when no workflow is mapped.
    """
    if approver_role is None:
        return None

    name = f"Auto: {action_code} (single-step)"

    wf = db.scalar(
        select(ApprovalWorkflow)
        .where(ApprovalWorkflow.entity_type == "contractor_rate_approval")
        .where(ApprovalWorkflow.name == name)
    )
    if wf is None:
        wf = ApprovalWorkflow(
            name=name,
            entity_type="contractor_rate_approval",
            is_active=True,
            created_by=creator_user_id,
        )
        db.add(wf)
        db.flush()
    else:
        wf.is_active = True

    has_step = db.scalar(
        select(func.count())
        .select_from(ApprovalStep)
        .where(ApprovalStep.workflow_id == wf.id)
    )
    if not has_step:
        db.add(
            ApprovalStep(
                workflow_id=wf.id,
                step_order=1,
                approver_role_id=int(approver_role.id),
                required_approvals=1,
            )
        )

    mapping = db.scalar(
        select(ApprovalWorkflowMapping)
        .where(ApprovalWorkflowMapping.action_code == action_code)
        .where(ApprovalWorkflowMapping.workflow_id == wf.id)
    )
    if mapping is None:
        db.add(
            ApprovalWorkflowMapping(
                action_code=action_code,
                workflow_id=wf.id,
                is_active=True,
            )
        )
    else:
        mapping.is_active = True

    db.commit()
    db.refresh(wf)
    return wf


def _map_unit_commercial(unit: str) -> tuple[str, str, str, Decimal | None]:
    """Map legacy seed ``unit`` strings to Part Master commercial fields."""
    u = unit.strip().lower()
    if u == "kg":
        return "kg", "weight_based", "per_kg", None
    if u == "job":
        return "pcs", "piece_based", "per_piece", None
    if u in ("hour", "hr"):
        return "hr", "piece_based", "per_piece", None
    if u == "day":
        return "day", "piece_based", "per_piece", None
    return u, "piece_based", "per_piece", None


def _find_or_create_part(
    db: Session,
    svc: PartMasterService,
    *,
    job_type: str,
    skill_type: str,
    unit: str,
    base_rate: str,
    plant_id: int,
    effective_from: date,
    effective_to: date | None = None,
    is_active: bool = True,
    notes: str | None = None,
    actor_user_id: int | None = None,
) -> PartMaster:
    j = job_type.strip().upper().replace(" ", "-")
    sk = skill_type.strip().upper().replace(" ", "-")
    u = unit.strip().upper()
    part_code = f"{j}-{sk}-{u}"[:64]
    unit_type, pricing_method, rate_unit_type, wpp = _map_unit_commercial(unit)
    part_name = f"{job_type.strip()} ({skill_type.replace('_', ' ').strip()})"
    existing = db.scalar(
        select(PartMaster).where(
            PartMaster.part_code == part_code,
            PartMaster.org_unit_id == int(plant_id),
            PartMaster.effective_from == effective_from,
        )
    )
    if existing is not None:
        return existing
    return svc.create_part_master(
        PartMasterCreate(
            part_code=part_code,
            part_name=part_name,
            description=None,
            unit_type=unit_type,
            pricing_method=pricing_method,
            weight_per_piece=wpp,
            base_rate=Decimal(base_rate),
            rate_unit_type=rate_unit_type,
            org_unit_id=plant_id,
            effective_from=effective_from,
            effective_to=effective_to,
            is_active=is_active,
            notes=notes,
        ),
        actor_user_id=actor_user_id,
    )


SEED_MARKER_PREFIX = "[seed] "


def _has_seeded_rate(
    db: Session, *, contractor_id: int, part_master_id: int, marker_remarks: str
) -> ContractorRate | None:
    """Look up a previously seeded contractor_rate by a unique remarks marker."""
    return db.scalar(
        select(ContractorRate)
        .where(ContractorRate.contractor_id == int(contractor_id))
        .where(ContractorRate.part_master_id == int(part_master_id))
        .where(ContractorRate.remarks == marker_remarks)
    )


def _reset_seeded_rows(db: Session) -> tuple[int, int]:
    """Delete previously-seeded contractor_rates (and any approval requests they
    spawned). Returns ``(rates_deleted, approval_requests_deleted)``.

    We identify seeded rows by the ``[seed] ...`` marker stored in
    ``contractor_rates.remarks``. Cascades take care of negotiation_logs +
    contractor_rate_audit_logs.
    """
    rows = list(
        db.scalars(
            select(ContractorRate).where(
                ContractorRate.remarks.like(f"{SEED_MARKER_PREFIX}%")
            )
        ).all()
    )
    request_ids = {int(r.approval_request_id) for r in rows if r.approval_request_id}

    rates_deleted = len(rows)
    for r in rows:
        db.delete(r)
    db.flush()

    requests_deleted = 0
    if request_ids:
        for req in db.scalars(
            select(ApprovalRequest).where(ApprovalRequest.id.in_(request_ids))
        ).all():
            db.delete(req)
            requests_deleted += 1
    db.commit()
    return rates_deleted, requests_deleted


def _seed_contractor_rate(
    db: Session,
    rate_svc: ContractorRateService,
    *,
    contractor_id: int,
    part_master_id: int,
    negotiated_rate: str,
    effective_from: date,
    marker_remarks: str,
    actor_user_id: int | None,
    initial_rate: str | None = None,
) -> ContractorRate:
    """Seed one ``contractor_rates`` row.

    ``initial_rate`` represents the contractor's opening ask. Passing it
    explicitly is the realistic case (vendors typically quote above the
    procurement baseline). When omitted, the backend treats the supplied
    ``negotiated_rate`` as the opening ask, producing zero savings — useful for
    seeding rejected / draft rows where the negotiation never produced a saving.
    """
    existing = _has_seeded_rate(
        db,
        contractor_id=contractor_id,
        part_master_id=part_master_id,
        marker_remarks=marker_remarks,
    )
    if existing is not None:
        return existing
    rate = rate_svc.create_rate(
        ContractorRateCreate(
            contractor_id=contractor_id,
            part_master_id=part_master_id,
            negotiated_rate=Decimal(negotiated_rate),
            initial_rate=Decimal(initial_rate) if initial_rate is not None else None,
            effective_from=effective_from,
            remarks=marker_remarks,
        ),
        actor_user_id=actor_user_id,
    )
    return rate


# ---------- main ----------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed Part Master + negotiation dummy data for manual UI testing."
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help=(
            "Delete previously-seeded contractor_rates (matched by '[seed] ...' "
            "remark prefix) before re-creating them. Use this when you want to "
            "rebuild the demo state cleanly (for example, after the approval "
            "workflow was added)."
        ),
    )
    args = parser.parse_args()

    db: Session = SessionLocal()
    try:
        actor = _user_by_username(db, "ctr_manager") or _earliest_user(db)
        if actor is None:
            print("error: no users found. Run create_superuser + scripts/seed_admin_test_data.py first.", file=sys.stderr)
            return 2
        actor_id = int(actor.id)

        if args.reset:
            rates_deleted, requests_deleted = _reset_seeded_rows(db)
            print(
                f"--reset: removed {rates_deleted} seeded contractor_rates "
                f"and {requests_deleted} associated approval_requests."
            )

        # Approver role is required to map a real workflow; if the dedicated
        # ``Procurement Approver`` role isn't there yet, create a minimal one
        # and (as a fallback) attach it to the earliest superuser so the
        # approval engine can find an assignee.
        approver_role = _ensure_approver_role(db)
        approver = _user_by_username(db, "rate_approver")
        if approver is None:
            # Fall back to the earliest superuser, then to the actor itself.
            approver = (
                db.scalars(
                    select(User)
                    .where(User.is_superuser.is_(True))
                    .order_by(User.id.asc())
                ).first()
                or actor
            )
        _ensure_user_has_role(db, approver, approver_role)

        plants = _ensure_plants(db)
        plant = plants[0]
        plant_id = int(plant.id)
        plant_b = plants[1] if len(plants) > 1 else plant
        plant_b_id = int(plant_b.id)

        contractors = list(
            db.scalars(
                select(Contractor)
                .where(Contractor.is_active.is_(True))
                .order_by(Contractor.id.asc())
            ).all()
        )
        if not contractors:
            print(
                "error: no active contractors found. Run "
                "scripts/seed_manual_test_contractors.py first.",
                file=sys.stderr,
            )
            return 3

        # Map contractors by code if available, fall back to position.
        by_code: dict[str, Contractor] = {
            (c.contractor_code or ""): c for c in contractors
        }
        c_acme = by_code.get("CTR-ACME-001") or contractors[0]
        c_zen = by_code.get("CTR-ZEN-002") or contractors[min(1, len(contractors) - 1)]
        c_orion = by_code.get("CTR-ORION-003") or contractors[min(2, len(contractors) - 1)]

        pm_svc = PartMasterService(db)
        rate_svc = ContractorRateService(db)

        # ---- 1. Rate masters ---------------------------------------------------

        today = date.today()

        # Welder · skilled · hour @ Plant A — current active rate.
        rm_welder_active = _find_or_create_part(
            db, pm_svc,
            job_type="Welder",
            skill_type="skilled",
            unit="hour",
            base_rate="120.00",
            plant_id=plant_id,
            effective_from=today - timedelta(days=30),
            effective_to=None,
            is_active=True,
            notes="Q2 base rate revision. Use for all welding work orders.",
            actor_user_id=actor_id,
        )

        # Welder · skilled · hour @ Plant A — superseded historical row (expired).
        rm_welder_old = _find_or_create_part(
            db, pm_svc,
            job_type="Welder",
            skill_type="skilled",
            unit="hour",
            base_rate="100.00",
            plant_id=plant_id,
            effective_from=today - timedelta(days=180),
            effective_to=today - timedelta(days=31),
            is_active=False,
            notes="Q1 rate (history).",
            actor_user_id=actor_id,
        )
        # If create_rate_master saw the active rate first, it would have superseded
        # this row; re-applying explicit deactivation is a no-op when already false.
        if rm_welder_old.is_active:
            pm_svc.update_part_master(
                int(rm_welder_old.id),
                PartMasterUpdate(is_active=False),
                actor_user_id=actor_id,
            )

        # Electrician · semi_skilled · day @ Plant A.
        rm_electrician = _find_or_create_part(
            db, pm_svc,
            job_type="Electrician",
            skill_type="semi_skilled",
            unit="day",
            base_rate="850.00",
            plant_id=plant_id,
            effective_from=today - timedelta(days=15),
            is_active=True,
            notes="Daywage incl. PPE allowance.",
            actor_user_id=actor_id,
        )

        # Helper · unskilled · hour @ Plant A.
        rm_helper = _find_or_create_part(
            db, pm_svc,
            job_type="General Helper",
            skill_type="unskilled",
            unit="hour",
            base_rate="60.00",
            plant_id=plant_id,
            effective_from=today - timedelta(days=20),
            is_active=True,
            actor_user_id=actor_id,
        )

        # Future-effective row to preview "scheduled" rates in UI.
        rm_future = _find_or_create_part(
            db, pm_svc,
            job_type="Pipefitter",
            skill_type="skilled",
            unit="hour",
            base_rate="135.00",
            plant_id=plant_id,
            effective_from=today + timedelta(days=14),
            is_active=False,  # not yet active
            notes="Scheduled effective in 2 weeks.",
            actor_user_id=actor_id,
        )

        # Plant B — Welder skilled hour, distinct combo by plant.
        rm_welder_plant_b = _find_or_create_part(
            db, pm_svc,
            job_type="Welder",
            skill_type="skilled",
            unit="hour",
            base_rate="115.00",
            plant_id=plant_b_id,
            effective_from=today - timedelta(days=10),
            is_active=True,
            actor_user_id=actor_id,
        )

        # Expired row to demonstrate the "expired" warning in the negotiation UI.
        rm_expired = _find_or_create_part(
            db, pm_svc,
            job_type="Crane Operator",
            skill_type="skilled",
            unit="day",
            base_rate="1500.00",
            plant_id=plant_id,
            effective_from=today - timedelta(days=400),
            effective_to=today - timedelta(days=30),
            is_active=False,
            notes="Expired — kept for history; cannot be used in new negotiations.",
            actor_user_id=actor_id,
        )

        # Bulk active rate masters per plant (for Work Order + Invoice dropdowns).
        # Goal: 10+ active items per plant, stable & idempotent.
        templates: list[tuple[str, str, str, str]] = [
            ("Welder", "skilled", "hour", "120.00"),
            ("Welder", "semi_skilled", "hour", "95.00"),
            ("Electrician", "skilled", "day", "950.00"),
            ("Electrician", "semi_skilled", "day", "850.00"),
            ("General Helper", "unskilled", "hour", "60.00"),
            ("Pipefitter", "skilled", "hour", "135.00"),
            ("Fitter", "semi_skilled", "hour", "110.00"),
            ("Painter", "semi_skilled", "day", "780.00"),
            ("Rigger", "skilled", "day", "1050.00"),
            ("Scaffolder", "skilled", "day", "990.00"),
            ("Mason", "semi_skilled", "day", "720.00"),
            ("Store Keeper", "semi_skilled", "day", "700.00"),
            ("Flux Wire", "semi_skilled", "kg", "18.50"),
            ("Welding Rod", "semi_skilled", "kg", "22.00"),
            ("Consumables", "unskilled", "kg", "12.75"),
            ("Pipeline Repair", "skilled", "job", "4500.00"),
            ("Pump Overhaul", "skilled", "job", "12500.00"),
        ]

        def _rate_bump(base: str, *, plant_index: int) -> str:
            try:
                v = Decimal(base)
            except Exception:
                return base
            # Plant A=0%, B=+3%, C=+6% (deterministic, keeps UI interesting)
            bump = Decimal("1.00") + (Decimal("0.03") * Decimal(str(plant_index)))
            return str((v * bump).quantize(Decimal("0.01")))

        plant_c = plants[2] if len(plants) > 2 else plant_b
        plant_c_id = int(plant_c.id)

        all_plants = [plant_id, plant_b_id, plant_c_id]
        for pi, pid in enumerate(all_plants):
            for job_type, skill_type, unit, base_rate in templates:
                _find_or_create_part(
                    db,
                    pm_svc,
                    job_type=job_type,
                    skill_type=skill_type,
                    unit=unit,
                    base_rate=_rate_bump(base_rate, plant_index=pi),
                    plant_id=int(pid),
                    effective_from=today - timedelta(days=7),
                    effective_to=None,
                    is_active=True,
                    notes=f"[seed] bulk active item ({job_type}/{skill_type}/{unit})",
                    actor_user_id=actor_id,
                )

        # Ensure a few negotiated contractor rates for the new units (kg/job),
        # so they appear in Contractor Rates + can resolve in Work Orders/Invoices.
        # We anchor on Plant A because demo WOs typically target the first plant.
        kg_job_pms = list(
            db.scalars(
                select(PartMaster)
                .where(PartMaster.org_unit_id == int(plant_id))
                .where(PartMaster.is_active.is_(True))
                .where(
                    or_(
                        PartMaster.unit_type == "kg",
                        PartMaster.part_code.endswith("-JOB"),
                    )
                )
                .order_by(PartMaster.id.asc())
            ).all()
        )
        for pm in kg_job_pms[:6]:
            # Keep it simple: create a draft rate slightly below base to show savings.
            try:
                base = Decimal(str(pm.base_rate))
            except Exception:
                base = Decimal("1.00")
            negotiated = (base * Decimal("0.97")).quantize(Decimal("0.01"))
            _seed_contractor_rate(
                db,
                rate_svc,
                contractor_id=int(c_acme.id),
                part_master_id=int(pm.id),
                negotiated_rate=str(negotiated),
                initial_rate=str(base),
                effective_from=today,
                marker_remarks=f"[seed] kg/job unit demo for {pm.part_code}",
                actor_user_id=actor_id,
            )

        # ---- 2. Approval workflow mapping --------------------------------------

        wf = _ensure_workflow_for_action(
            db,
            action_code=ACTION_CODE_CREATE,
            approver_role=approver_role,
            creator_user_id=actor_id,
        )

        # ---- 3. Contractor rates (multiple statuses) ---------------------------

        # 3a. DRAFT — never submitted yet. Vendor opened at 130, internal
        # target/draft is 115. Will show "negotiated down by 15" in the UI
        # even before submission.
        draft = _seed_contractor_rate(
            db, rate_svc,
            contractor_id=int(c_acme.id),
            part_master_id=int(rm_welder_active.id),
            negotiated_rate="115.00",
            initial_rate="130.00",
            effective_from=today + timedelta(days=1),
            marker_remarks="[seed] draft offer — initial proposal",
            actor_user_id=actor_id,
        )

        # Alternate vendor on the same welder base row — rate master “all contractors” grid.
        zen_welder = _seed_contractor_rate(
            db, rate_svc,
            contractor_id=int(c_zen.id),
            part_master_id=int(rm_welder_active.id),
            negotiated_rate="118.00",
            initial_rate="125.00",
            effective_from=today - timedelta(days=5),
            marker_remarks="[seed] zen welder — second vendor vs same base job",
            actor_user_id=actor_id,
        )
        if zen_welder.status == "draft":
            try:
                rate_svc.submit_for_approval(int(zen_welder.id), actor_user_id=actor_id)
                zen_welder = rate_svc.get_rate(int(zen_welder.id))
                if zen_welder.status == "pending_approval" and zen_welder.approval_request_id:
                    eng = ApprovalEngineService(db)
                    task = db.scalar(
                        select(ApprovalTask)
                        .where(ApprovalTask.request_id == int(zen_welder.approval_request_id))
                        .where(ApprovalTask.status == "pending")
                        .order_by(ApprovalTask.id.asc())
                    )
                    if task is not None:
                        approver_id = int((approver or actor).id)
                        eng.act_on_task(
                            task_id=int(task.id),
                            actor_user_id=approver_id,
                            action="approve",
                            comment="[seed] auto-approved zen welder rate",
                        )
                        zen_welder = rate_svc.get_rate(int(zen_welder.id))
            except Exception as exc:  # noqa: BLE001
                print(f"warn: could not approve seeded zen welder rate: {exc}", file=sys.stderr)

        # 3b. APPROVED — vendor opened well above base, we negotiated some
        # of it back. Final still lands ABOVE base, so this row contributes
        # to BOTH "negotiation savings" AND "premium vs base" on the dashboard.
        approved = _seed_contractor_rate(
            db, rate_svc,
            contractor_id=int(c_acme.id),
            part_master_id=int(rm_electrician.id),
            negotiated_rate="800.00",
            initial_rate="900.00",  # vendor opened at 900; we shaved 100 off
            effective_from=today - timedelta(days=10),
            marker_remarks="[seed] approved electrician daywage",
            actor_user_id=actor_id,
        )
        if approved.status == "draft":
            try:
                rate_svc.submit_for_approval(int(approved.id), actor_user_id=actor_id)
                approved = rate_svc.get_rate(int(approved.id))
                if approved.status == "pending_approval" and approved.approval_request_id:
                    eng = ApprovalEngineService(db)
                    task = db.scalar(
                        select(ApprovalTask)
                        .where(ApprovalTask.request_id == int(approved.approval_request_id))
                        .where(ApprovalTask.status == "pending")
                        .order_by(ApprovalTask.id.asc())
                    )
                    if task is not None:
                        approver_id = int((approver or actor).id)
                        eng.act_on_task(
                            task_id=int(task.id),
                            actor_user_id=approver_id,
                            action="approve",
                            comment="[seed] auto-approved during seeding",
                        )
                        approved = rate_svc.get_rate(int(approved.id))
            except Exception as exc:  # noqa: BLE001
                print(f"warn: could not approve seeded electrician rate: {exc}", file=sys.stderr)

        # 3c. PENDING_APPROVAL — submitted, sitting in approver's inbox.
        # Vendor opened at 65, current proposal is 55 — a clean savings story
        # that lands BELOW the helper rate's base for variety.
        pending = _seed_contractor_rate(
            db, rate_svc,
            contractor_id=int(c_zen.id),
            part_master_id=int(rm_helper.id),
            negotiated_rate="55.00",
            initial_rate="65.00",
            effective_from=today + timedelta(days=2),
            marker_remarks="[seed] pending approval — helper hourly",
            actor_user_id=actor_id,
        )
        if pending.status == "draft":
            try:
                rate_svc.submit_for_approval(int(pending.id), actor_user_id=actor_id)
                pending = rate_svc.get_rate(int(pending.id))
            except Exception as exc:  # noqa: BLE001
                print(f"warn: could not submit pending rate: {exc}", file=sys.stderr)

        # 3d. REJECTED — submitted then rejected by approver.
        rejected = _seed_contractor_rate(
            db, rate_svc,
            contractor_id=int(c_orion.id),
            part_master_id=int(rm_welder_active.id),
            negotiated_rate="98.00",
            initial_rate="125.00",  # vendor's opening ask before getting rejected
            effective_from=today + timedelta(days=3),
            marker_remarks="[seed] rejected — too low",
            actor_user_id=actor_id,
        )
        if rejected.status == "draft":
            try:
                rate_svc.submit_for_approval(int(rejected.id), actor_user_id=actor_id)
                rejected = rate_svc.get_rate(int(rejected.id))
                if rejected.status == "pending_approval" and rejected.approval_request_id:
                    eng = ApprovalEngineService(db)
                    task = db.scalar(
                        select(ApprovalTask)
                        .where(ApprovalTask.request_id == int(rejected.approval_request_id))
                        .where(ApprovalTask.status == "pending")
                        .order_by(ApprovalTask.id.asc())
                    )
                    if task is not None:
                        approver_id = int((approver or actor).id)
                        eng.act_on_task(
                            task_id=int(task.id),
                            actor_user_id=approver_id,
                            action="reject",
                            comment="[seed] rate below market floor — please revise",
                        )
                        rejected = rate_svc.get_rate(int(rejected.id))
            except Exception as exc:  # noqa: BLE001
                print(f"warn: could not reject seeded rate: {exc}", file=sys.stderr)

        # 3e. MULTI-ROUND negotiation that ends approved. Tells the most
        # complete story for the timeline: vendor opens HIGH, procurement
        # counters DOWN, both meet in the middle. Initial ask captured at
        # create time so the savings figure stays accurate even before round 1.
        multi = _seed_contractor_rate(
            db, rate_svc,
            contractor_id=int(c_zen.id),
            part_master_id=int(rm_welder_plant_b.id),
            negotiated_rate="125.00",  # vendor's opening ask
            initial_rate="125.00",
            effective_from=today,
            marker_remarks="[seed] multi-round welder negotiation",
            actor_user_id=actor_id,
        )
        if int(multi.current_round or 0) == 0 and multi.status == "draft":
            try:
                rate_svc.add_negotiation_round(
                    int(multi.id),
                    NegotiationRoundCreate(
                        proposed_rate=Decimal("125.00"),
                        counter_rate=None,
                        remarks="Round 1: vendor opens at list price (125)",
                        apply_to_negotiated_rate=False,
                    ),
                    actor_user_id=actor_id,
                )
                rate_svc.add_negotiation_round(
                    int(multi.id),
                    NegotiationRoundCreate(
                        proposed_rate=None,
                        counter_rate=Decimal("115.00"),
                        remarks="Round 2: procurement counters at base (115)",
                        apply_to_negotiated_rate=True,
                    ),
                    actor_user_id=actor_id,
                )
                # Final landed rate is intentionally ABOVE base (118 vs base
                # 115). This is the realistic case the dashboard now models:
                # we did save 7 from the contractor's opening ask of 125, but
                # we still ended up paying 3 above the procurement baseline —
                # which shows up as "Premium vs base" on the dashboard
                # without cancelling out the negotiation savings.
                rate_svc.add_negotiation_round(
                    int(multi.id),
                    NegotiationRoundCreate(
                        proposed_rate=None,
                        counter_rate=Decimal("118.00"),
                        remarks="Round 3: settled at 118 — slightly above base, both sides accept",
                        apply_to_negotiated_rate=True,
                    ),
                    actor_user_id=actor_id,
                )
                rate_svc.submit_for_approval(int(multi.id), actor_user_id=actor_id)
                multi = rate_svc.get_rate(int(multi.id))
                if multi.status == "pending_approval" and multi.approval_request_id:
                    eng = ApprovalEngineService(db)
                    task = db.scalar(
                        select(ApprovalTask)
                        .where(ApprovalTask.request_id == int(multi.approval_request_id))
                        .where(ApprovalTask.status == "pending")
                        .order_by(ApprovalTask.id.asc())
                    )
                    if task is not None:
                        approver_id = int((approver or actor).id)
                        eng.act_on_task(
                            task_id=int(task.id),
                            actor_user_id=approver_id,
                            action="approve",
                            comment="[seed] approved after 3 rounds",
                        )
                multi = rate_svc.get_rate(int(multi.id))
            except Exception as exc:  # noqa: BLE001
                print(f"warn: multi-round seed encountered: {exc}", file=sys.stderr)

        # ---- 4. Print summary --------------------------------------------------

        n_part_masters = int(
            db.scalar(select(func.count()).select_from(PartMaster)) or 0
        )
        n_rates = int(
            db.scalar(select(func.count()).select_from(ContractorRate)) or 0
        )
        n_rounds = int(
            db.scalar(select(func.count()).select_from(NegotiationLog)) or 0
        )
        n_rate_audits = int(
            db.scalar(select(func.count()).select_from(ContractorRateAuditLog)) or 0
        )
        n_master_audits = int(
            db.scalar(select(func.count()).select_from(PartMasterAuditLog)) or 0
        )
        by_status: dict[str, int] = {}
        for status, count in db.execute(
            select(ContractorRate.status, func.count(ContractorRate.id)).group_by(
                ContractorRate.status
            )
        ).all():
            by_status[str(status)] = int(count)

        print()
        print("=" * 72)
        print("Part master + negotiation seed complete")
        print("=" * 72)
        print(f"Plants used (PLANT org_units): {len(plants)}")
        print(f"Approval workflow mapped for {ACTION_CODE_CREATE}: "
              f"{'yes (id=' + str(wf.id) + ')' if wf else 'no — skipped (no approver role)'}")
        print()
        print(f"part_master rows                  : {n_part_masters}")
        print(f"  • new rows added this run       : "
              f"{len([rm_welder_active, rm_welder_old, rm_electrician, rm_helper, rm_future, rm_welder_plant_b, rm_expired])}")
        print(f"contractor_rates rows             : {n_rates}")
        print( "  by status                       :")
        for s in ("draft", "pending_approval", "approved", "rejected", "expired", "cancelled"):
            print(f"    - {s:<18} : {by_status.get(s, 0)}")
        print(f"negotiation_logs rows             : {n_rounds}")
        print(f"contractor_rate_audit_logs rows   : {n_rate_audits}")
        print(f"part_master_audit_logs rows       : {n_master_audits}")
        print()
        print("Demo accounts (password from seed_admin_test_data.py — default 'TestPass123!'):")
        print("  • ctr_manager     — creates / negotiates rates")
        print("  • rate_approver   — sees pending rate approvals in My Tasks")
        print()
        print("Try in the UI:")
        print("  • /dashboard/part-master       (filter by plant / part / pricing)")
        print("  • /dashboard/negotiated-rates  (workspace KPIs + table)")
        print(f"  • /dashboard/contractors/{c_acme.id}?tab=rates  (per-contractor rates tab)")
        print(f"  • /dashboard/contractors/{c_zen.id}?tab=rates&focus={multi.id} (deep-link)")
        print()
    finally:
        db.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
