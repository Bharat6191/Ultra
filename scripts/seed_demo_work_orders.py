#!/usr/bin/env python3
"""Create sample work orders as ``negotiator`` and submit for approval.

Prerequisites (typical TiM demo DB):

- ``scripts/seed_demo_users.py`` — negotiator permissions + WO approval mapping
- ``scripts/seed_manual_test_contractors.py`` — contractors mapped to plants
- ``scripts/seed_manual_test_rates.py`` — part masters per plant

Run from project root:

    ./backend/venv/bin/python scripts/seed_demo_work_orders.py
"""

from __future__ import annotations

import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

_SCRIPTS_ROOT = Path(__file__).resolve().parent
_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
for _p in (_BACKEND_ROOT, _SCRIPTS_ROOT):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from sqlalchemy import select
from sqlalchemy.orm import Session

import db.models  # noqa: F401
from db.session import SessionLocal
from modules.contractor.models import Contractor
from modules.part_master.models import PartMaster
from modules.org_units.model import OrgUnit
from modules.rbac_sync import sync_all_modules_to_db
from modules.roles.model import Role
from modules.users.model import User
from modules.work_orders.models import WorkOrder
from modules.work_orders.schema import (
    WorkOrderContractorCreate,
    WorkOrderCreate,
    WorkOrderItemCreate,
)
from modules.work_orders.service import WorkOrderService

from _work_order_demo_workflow import ensure_work_orders_create_workflow


def _negotiator_user(db: Session) -> User | None:
    return db.scalar(select(User).where(User.username == "negotiator"))


def _first_plant(db: Session) -> OrgUnit | None:
    return db.scalars(select(OrgUnit).where(OrgUnit.type == "PLANT").order_by(OrgUnit.id.asc())).first()


def _first_contractor(db: Session) -> Contractor | None:
    return db.scalars(select(Contractor).order_by(Contractor.id.asc())).first()


def _contractors(db: Session, *, limit: int = 3) -> list[Contractor]:
    return list(
        db.scalars(
            select(Contractor)
            .where(Contractor.is_active.is_(True))
            .order_by(Contractor.id.asc())
            .limit(int(limit))
        ).all()
    )


def _parts_for_plant(db: Session, org_unit_id: int, *, limit: int = 12) -> list[PartMaster]:
    return list(
        db.scalars(
            select(PartMaster)
            .where(PartMaster.org_unit_id == int(org_unit_id))
            .where(PartMaster.is_active.is_(True))
            .order_by(PartMaster.id.asc())
            .limit(int(limit))
        ).all()
    )


def _pick_part_by_unit_type(pms: list[PartMaster], unit_type: str) -> PartMaster | None:
    u = unit_type.strip().lower()
    for p in pms:
        if str(getattr(p, "unit_type", "")).strip().lower() == u:
            return p
    return None


def _pick_lumpsum_job_part(pms: list[PartMaster]) -> PartMaster | None:
    """Parts seeded from legacy ``job`` unit use a ``-JOB`` part code suffix."""
    for p in pms:
        if str(p.part_code).upper().endswith("-JOB"):
            return p
    return None


def _work_order_l1_role(db: Session) -> Role | None:
    return db.scalar(select(Role).where(Role.name == "Work Order Approver (L1)"))


def main() -> int:
    db = SessionLocal()
    try:
        sync_all_modules_to_db(db)
        approver_role = _work_order_l1_role(db)
        if approver_role is None:
            print(
                'error: role "Work Order Approver (L1)" not found. Run scripts/seed_demo_users.py.',
                file=sys.stderr,
            )
            return 3
        if not ensure_work_orders_create_workflow(db, approver_role=approver_role):
            print(
                "error: work_orders.create permission missing. Run migrations + scripts/sync_modules.py.",
                file=sys.stderr,
            )
            return 4

        actor = _negotiator_user(db)
        if actor is None:
            print("error: user `negotiator` not found. Run scripts/seed_demo_users.py.", file=sys.stderr)
            return 5

        plant = _first_plant(db)
        if plant is None:
            print("error: no PLANT org unit found.", file=sys.stderr)
            return 6
        contractors = _contractors(db, limit=4)
        if len(contractors) < 3:
            print("error: no contractor found. Run scripts/seed_manual_test_contractors.py.", file=sys.stderr)
            return 7
        pms = _parts_for_plant(db, int(plant.id), limit=20)
        if len(pms) < 10:
            print(
                "error: not enough active part masters for that plant. Run scripts/seed_manual_test_rates.py.",
                file=sys.stderr,
            )
            return 8

        pm_kg = _pick_part_by_unit_type(pms, "kg")
        pm_job = _pick_lumpsum_job_part(pms)

        svc = WorkOrderService(db)
        created = 0
        submitted = 0
        for i in range(1, 4):
            title = f"Demo WO — negotiator seed #{i}"
            exists = db.scalar(select(WorkOrder.id).where(WorkOrder.title == title))
            if exists is not None:
                print(f"skip (exists): {title}")
                continue
            # 3 contractors, 2 items each (mix rate masters).
            cids = contractors[:3]
            # Rotate parts so each contractor gets distinct items
            pm_pairs = [
                (pms[(i * 2) % len(pms)], pms[(i * 2 + 1) % len(pms)]),
                (pms[(i * 2 + 2) % len(pms)], pms[(i * 2 + 3) % len(pms)]),
                (pms[(i * 2 + 4) % len(pms)], pms[(i * 2 + 5) % len(pms)]),
            ]
            # Inject one kg + one job line (if available) to ensure those units show in WO UI.
            if pm_kg is not None:
                pm_pairs[0] = (pm_kg, pm_pairs[0][1])
            if pm_job is not None:
                pm_pairs[1] = (pm_job, pm_pairs[1][1])
            wo = svc.create(
                WorkOrderCreate(
                    org_unit_id=int(plant.id),
                    title=title,
                    description=f"Seeded work order {i} for approval inbox testing.",
                    work_date=date.today(),
                    contractors=[
                        WorkOrderContractorCreate(
                            contractor_id=int(cids[0].id),
                            scope_notes="Seed: multi-vendor WO (contractor A).",
                            items=[
                                WorkOrderItemCreate(
                                    part_master_id=int(pm_pairs[0][0].id),
                                    progress_type="quantity",
                                    planned_quantity=(Decimal("250") + Decimal(i)) if str(pm_pairs[0][0].unit_type).lower() == "kg" else (Decimal("10") + Decimal(i)),
                                    planned_percentage=None,
                                    notes="Seed line A1",
                                ),
                                WorkOrderItemCreate(
                                    part_master_id=int(pm_pairs[0][1].id),
                                    progress_type="quantity",
                                    planned_quantity=Decimal("6") + Decimal(i),
                                    planned_percentage=None,
                                    notes="Seed line A2",
                                ),
                            ],
                        ),
                        WorkOrderContractorCreate(
                            contractor_id=int(cids[1].id),
                            scope_notes="Seed: multi-vendor WO (contractor B).",
                            items=[
                                WorkOrderItemCreate(
                                    part_master_id=int(pm_pairs[1][0].id),
                                    progress_type="quantity",
                                    planned_quantity=(Decimal("1") + Decimal(i)) if str(pm_pairs[1][0].part_code).upper().endswith("-JOB") else (Decimal("8") + Decimal(i)),
                                    planned_percentage=None,
                                    notes="Seed line B1",
                                ),
                                WorkOrderItemCreate(
                                    part_master_id=int(pm_pairs[1][1].id),
                                    progress_type="quantity",
                                    planned_quantity=Decimal("12") + Decimal(i),
                                    planned_percentage=None,
                                    notes="Seed line B2",
                                ),
                            ],
                        ),
                        WorkOrderContractorCreate(
                            contractor_id=int(cids[2].id),
                            scope_notes="Seed: multi-vendor WO (contractor C).",
                            items=[
                                WorkOrderItemCreate(
                                    part_master_id=int(pm_pairs[2][0].id),
                                    progress_type="quantity",
                                    planned_quantity=Decimal("5") + Decimal(i),
                                    planned_percentage=None,
                                    notes="Seed line C1",
                                ),
                                WorkOrderItemCreate(
                                    part_master_id=int(pm_pairs[2][1].id),
                                    progress_type="quantity",
                                    planned_quantity=Decimal("9") + Decimal(i),
                                    planned_percentage=None,
                                    notes="Seed line C2",
                                ),
                            ],
                        )
                    ],
                ),
                actor_user_id=int(actor.id),
            )
            created += 1
            svc.submit_for_approval(int(wo.id), actor_user_id=int(actor.id))
            submitted += 1
            print(f"created + submitted: {title} (id={wo.id}, status after submit via API refresh)")

        # Extra work orders to guarantee multi-contractor visibility in UI even
        # when earlier runs already created the base set.
        for i in range(1, 4):
            title = f"Demo WO — multi contractor #{i}"
            exists = db.scalar(select(WorkOrder.id).where(WorkOrder.title == title))
            if exists is not None:
                print(f"skip (exists): {title}")
                continue
            cids = contractors[:3]
            pm_pairs = [
                (pms[(i * 2) % len(pms)], pms[(i * 2 + 1) % len(pms)]),
                (pms[(i * 2 + 2) % len(pms)], pms[(i * 2 + 3) % len(pms)]),
                (pms[(i * 2 + 4) % len(pms)], pms[(i * 2 + 5) % len(pms)]),
            ]
            wo = svc.create(
                WorkOrderCreate(
                    org_unit_id=int(plant.id),
                    title=title,
                    description=f"Seeded multi-contractor work order {i} (3 contractors, 6 lines).",
                    work_date=date.today(),
                    contractors=[
                        WorkOrderContractorCreate(
                            contractor_id=int(cids[0].id),
                            scope_notes="Seed: contractor A scope.",
                            items=[
                                WorkOrderItemCreate(part_master_id=int(pm_pairs[0][0].id), progress_type="quantity", planned_quantity=Decimal("10"), planned_percentage=None, notes="A1"),
                                WorkOrderItemCreate(part_master_id=int(pm_pairs[0][1].id), progress_type="quantity", planned_quantity=Decimal("7"), planned_percentage=None, notes="A2"),
                            ],
                        ),
                        WorkOrderContractorCreate(
                            contractor_id=int(cids[1].id),
                            scope_notes="Seed: contractor B scope.",
                            items=[
                                WorkOrderItemCreate(part_master_id=int(pm_pairs[1][0].id), progress_type="quantity", planned_quantity=Decimal("11"), planned_percentage=None, notes="B1"),
                                WorkOrderItemCreate(part_master_id=int(pm_pairs[1][1].id), progress_type="quantity", planned_quantity=Decimal("9"), planned_percentage=None, notes="B2"),
                            ],
                        ),
                        WorkOrderContractorCreate(
                            contractor_id=int(cids[2].id),
                            scope_notes="Seed: contractor C scope.",
                            items=[
                                WorkOrderItemCreate(part_master_id=int(pm_pairs[2][0].id), progress_type="quantity", planned_quantity=Decimal("6"), planned_percentage=None, notes="C1"),
                                WorkOrderItemCreate(part_master_id=int(pm_pairs[2][1].id), progress_type="quantity", planned_quantity=Decimal("12"), planned_percentage=None, notes="C2"),
                            ],
                        ),
                    ],
                ),
                actor_user_id=int(actor.id),
            )
            created += 1
            svc.submit_for_approval(int(wo.id), actor_user_id=int(actor.id))
            submitted += 1
            print(f"created + submitted: {title} (id={wo.id})")

        # Extra work orders focusing on kg/job units (so those new units show in WO tables).
        for i in range(1, 3):
            title = f"Demo WO — kg-job units #{i}"
            exists = db.scalar(select(WorkOrder.id).where(WorkOrder.title == title))
            if exists is not None:
                print(f"skip (exists): {title}")
                continue
            if pm_kg is None or pm_job is None:
                print("skip: kg/job part masters not found for this plant (run seed_manual_test_rates.py).")
                break
            cids = contractors[:3]
            wo = svc.create(
                WorkOrderCreate(
                    org_unit_id=int(plant.id),
                    title=title,
                    description="Seeded WO focusing on kg + job unit lines.",
                    work_date=date.today(),
                    contractors=[
                        WorkOrderContractorCreate(
                            contractor_id=int(cids[0].id),
                            scope_notes="Seed: kg material billing.",
                            items=[
                                WorkOrderItemCreate(part_master_id=int(pm_kg.id), progress_type="quantity", planned_quantity=Decimal("500"), planned_percentage=None, notes="kg line"),
                            ],
                        ),
                        WorkOrderContractorCreate(
                            contractor_id=int(cids[1].id),
                            scope_notes="Seed: lumpsum job billing.",
                            items=[
                                WorkOrderItemCreate(part_master_id=int(pm_job.id), progress_type="quantity", planned_quantity=Decimal("2"), planned_percentage=None, notes="job line"),
                            ],
                        ),
                        WorkOrderContractorCreate(
                            contractor_id=int(cids[2].id),
                            scope_notes="Seed: mixed lines.",
                            items=[
                                WorkOrderItemCreate(part_master_id=int(pm_kg.id), progress_type="quantity", planned_quantity=Decimal("250"), planned_percentage=None, notes="kg line 2"),
                                WorkOrderItemCreate(part_master_id=int(pm_job.id), progress_type="quantity", planned_quantity=Decimal("1"), planned_percentage=None, notes="job line 2"),
                            ],
                        ),
                    ],
                ),
                actor_user_id=int(actor.id),
            )
            created += 1
            svc.submit_for_approval(int(wo.id), actor_user_id=int(actor.id))
            submitted += 1
            print(f"created + submitted: {title} (id={wo.id})")

        print()
        print(f"Done. New work orders: {created}; submitted: {submitted}.")
        print("Log in as wo.approver1@demo.test or rate.approver@demo.test → Tasks inbox (WO approvals).")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
