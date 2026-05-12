#!/usr/bin/env python3
"""Seed Part Master + negotiation dummy data for manual UI testing.

Run from project root:

    ./venv/bin/python scripts/seed_manual_test_rates.py

What this gives you (idempotent — safe to run repeatedly):

* **Part masters**: **16** curated active rows on the **first plant** (10–20 style
  catalog) covering hour/day/kg/job commercial templates. With ``--reset``,
  legacy ``[seed] bulk active item …`` rows from older seeds are pruned first.
* **Approval workflow** for ``contractor_rates.create`` mapped to a single-step
  workflow whose approver is the seeded ``Procurement Approver`` role
  (created by ``scripts/seed_admin_test_data.py``).
* **Contractor rates**: one negotiation per catalog part (rotating contractors).
  **Negotiated rate is always strictly above** the Part Master base; the
  vendor **opening** (``initial_rate``) is higher still so savings vs opening
  stay positive. **Some** rows are auto-approved, **some** left pending or draft,
  plus one **rejected** and one **multi-round approved** showcase.
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

from sqlalchemy import delete, func, select
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

    step = db.scalar(
        select(ApprovalStep)
        .where(ApprovalStep.workflow_id == wf.id)
        .order_by(ApprovalStep.step_order.asc())
    )
    if step is None:
        db.add(
            ApprovalStep(
                workflow_id=wf.id,
                step_order=1,
                approver_role_id=int(approver_role.id),
                required_approvals=1,
            )
        )
    elif int(step.approver_role_id) != int(approver_role.id):
        # Keep tasks act-on-able when the DB still points at a retired approver role.
        step.approver_role_id = int(approver_role.id)

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
    if pricing_method == "weight_based" and wpp is None:
        wpp = Decimal("2.500")
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


def _prune_legacy_bulk_seed_parts(db: Session, *, plant_ids: list[int]) -> int:
    """Remove old multi-plant bulk part masters (notes marker) and their rates."""
    if not plant_ids:
        return 0
    pm_ids = [
        int(x)
        for x in db.scalars(
            select(PartMaster.id).where(
                PartMaster.org_unit_id.in_([int(p) for p in plant_ids]),
                PartMaster.notes.like("%[seed] bulk active item%"),
            )
        ).all()
    ]
    if not pm_ids:
        return 0
    db.execute(delete(ContractorRate).where(ContractorRate.part_master_id.in_(pm_ids)))
    db.execute(delete(PartMaster).where(PartMaster.id.in_(pm_ids)))
    db.commit()
    return len(pm_ids)


def _opening_and_negotiated_premium_vs_base(base: Decimal) -> tuple[Decimal, Decimal]:
    """Opening ask and settled negotiated rate; negotiated is strictly above Part Master base."""
    negotiated = (base * Decimal("1.11")).quantize(Decimal("0.01"))
    if negotiated <= base:
        negotiated = (base + Decimal("0.05")).quantize(Decimal("0.01"))
    initial = (base * Decimal("1.28")).quantize(Decimal("0.01"))
    if initial <= negotiated:
        initial = (negotiated + Decimal("1.00")).quantize(Decimal("0.01"))
    return initial, negotiated


def _approve_first_pending_task(
    db: Session, *, request_id: int, approver_id: int, comment: str
) -> bool:
    eng = ApprovalEngineService(db)
    task = db.scalar(
        select(ApprovalTask)
        .where(ApprovalTask.request_id == int(request_id))
        .where(ApprovalTask.status == "pending")
        .order_by(ApprovalTask.id.asc())
    )
    if task is None:
        return False
    eng.act_on_task(
        task_id=int(task.id),
        actor_user_id=int(approver_id),
        action="approve",
        comment=comment,
    )
    return True


def _reject_first_pending_task(
    db: Session, *, request_id: int, approver_id: int, comment: str
) -> bool:
    eng = ApprovalEngineService(db)
    task = db.scalar(
        select(ApprovalTask)
        .where(ApprovalTask.request_id == int(request_id))
        .where(ApprovalTask.status == "pending")
        .order_by(ApprovalTask.id.asc())
    )
    if task is None:
        return False
    eng.act_on_task(
        task_id=int(task.id),
        actor_user_id=int(approver_id),
        action="reject",
        comment=comment,
    )
    return True


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

        pm_svc = PartMasterService(db)
        rate_svc = ContractorRateService(db)

        # ---- 1. Part master catalog (16 rows, first plant) ---------------------

        today = date.today()
        plant_c_id = int(plants[2].id) if len(plants) > 2 else plant_b_id

        if args.reset:
            pruned = _prune_legacy_bulk_seed_parts(
                db,
                plant_ids=list({plant_id, plant_b_id, plant_c_id}),
            )
            if pruned:
                print(
                    f"--reset: pruned {pruned} legacy bulk-seeded part_master rows "
                    "(and their contractor_rates)."
                )

        V2_CATALOG: list[tuple[str, str, str, str]] = [
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
            ("Pipeline Repair", "skilled", "job", "4500.00"),
            ("Pump Overhaul", "skilled", "job", "12500.00"),
        ]

        catalog_parts: list[PartMaster] = []
        for job_type, skill_type, unit, base_rate in V2_CATALOG:
            catalog_parts.append(
                _find_or_create_part(
                    db,
                    pm_svc,
                    job_type=job_type,
                    skill_type=skill_type,
                    unit=unit,
                    base_rate=base_rate,
                    plant_id=plant_id,
                    effective_from=today - timedelta(days=7),
                    effective_to=None,
                    is_active=True,
                    notes=f"[seed] v2 catalog ({job_type}/{skill_type}/{unit})",
                    actor_user_id=actor_id,
                )
            )

        # ---- 2. Approval workflow mapping --------------------------------------

        wf = _ensure_workflow_for_action(
            db,
            action_code=ACTION_CODE_CREATE,
            approver_role=approver_role,
            creator_user_id=actor_id,
        )

        # ---- 3. Contractor rates: negotiate every catalog part -------------------

        approver_id = int((approver or actor).id)
        showcase_multi_id: int | None = None
        showcase_multi_contractor_id: int | None = None

        for idx, pm in enumerate(catalog_parts):
            ctr = contractors[idx % len(contractors)]
            try:
                base = Decimal(str(pm.base_rate))
            except Exception:
                base = Decimal("1.00")
            initial, negotiated = _opening_and_negotiated_premium_vs_base(base)
            if negotiated <= base:
                negotiated = (base + Decimal("0.05")).quantize(Decimal("0.01"))
                if initial <= negotiated:
                    initial = (negotiated + Decimal("1.00")).quantize(Decimal("0.01"))

            marker = f"[seed] v2 neg {pm.part_code} ctr{int(ctr.id)}"
            row = _seed_contractor_rate(
                db,
                rate_svc,
                contractor_id=int(ctr.id),
                part_master_id=int(pm.id),
                negotiated_rate=str(negotiated),
                initial_rate=str(initial),
                effective_from=today,
                marker_remarks=marker,
                actor_user_id=actor_id,
            )

            try:
                if idx == 5:
                    if row.status == "draft" and int(row.current_round or 0) == 0:
                        open_ask = (base * Decimal("1.32")).quantize(Decimal("0.01"))
                        mid = (base * Decimal("1.18")).quantize(Decimal("0.01"))
                        rate_svc.add_negotiation_round(
                            int(row.id),
                            NegotiationRoundCreate(
                                proposed_rate=open_ask,
                                counter_rate=None,
                                remarks="[seed] v2 R1: vendor opening ask",
                                apply_to_negotiated_rate=False,
                            ),
                            actor_user_id=actor_id,
                        )
                        rate_svc.add_negotiation_round(
                            int(row.id),
                            NegotiationRoundCreate(
                                proposed_rate=None,
                                counter_rate=mid,
                                remarks="[seed] v2 R2: procurement counter",
                                apply_to_negotiated_rate=True,
                            ),
                            actor_user_id=actor_id,
                        )
                        rate_svc.add_negotiation_round(
                            int(row.id),
                            NegotiationRoundCreate(
                                proposed_rate=None,
                                counter_rate=negotiated,
                                remarks="[seed] v2 R3: settled above Part Master base",
                                apply_to_negotiated_rate=True,
                            ),
                            actor_user_id=actor_id,
                        )
                        rate_svc.submit_for_approval(int(row.id), actor_user_id=actor_id)
                    row = rate_svc.get_rate(int(row.id))
                    if row.status == "pending_approval" and row.approval_request_id:
                        _approve_first_pending_task(
                            db,
                            request_id=int(row.approval_request_id),
                            approver_id=approver_id,
                            comment="[seed] v2 approved after 3 rounds",
                        )
                    row = rate_svc.get_rate(int(row.id))
                    showcase_multi_id = int(row.id)
                    showcase_multi_contractor_id = int(ctr.id)
                    continue

                if idx == 12:
                    if row.status == "draft":
                        rate_svc.submit_for_approval(int(row.id), actor_user_id=actor_id)
                    row = rate_svc.get_rate(int(row.id))
                    if row.status == "pending_approval" and row.approval_request_id:
                        _reject_first_pending_task(
                            db,
                            request_id=int(row.approval_request_id),
                            approver_id=approver_id,
                            comment="[seed] v2 rejected showcase",
                        )
                    continue

                bucket = idx % 3
                if bucket == 1:
                    if row.status == "draft":
                        rate_svc.submit_for_approval(int(row.id), actor_user_id=actor_id)
                elif bucket == 2:
                    if row.status == "draft":
                        rate_svc.submit_for_approval(int(row.id), actor_user_id=actor_id)
                    row = rate_svc.get_rate(int(row.id))
                    if row.status == "pending_approval" and row.approval_request_id:
                        _approve_first_pending_task(
                            db,
                            request_id=int(row.approval_request_id),
                            approver_id=approver_id,
                            comment=f"[seed] v2 auto-approved {pm.part_code}",
                        )
            except Exception as exc:  # noqa: BLE001
                print(f"warn: rate workflow for {pm.part_code}: {exc}", file=sys.stderr)

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
        print(
            f"  • v2 catalog on first plant       : {len(catalog_parts)} active part masters"
        )
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
        if showcase_multi_id is not None and showcase_multi_contractor_id is not None:
            print(
                f"  • /dashboard/contractors/{showcase_multi_contractor_id}?tab=rates&focus={showcase_multi_id} "
                "(multi-round Pipefitter showcase)"
            )
        print()
    finally:
        db.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
