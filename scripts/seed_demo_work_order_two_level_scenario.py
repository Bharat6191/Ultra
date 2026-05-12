#!/usr/bin/env python3
"""Clear WO + invoice data, then seed a two-level work order approval story.

Prerequisites::

    scripts/seed_demo_users.py
    scripts/seed_manual_test_contractors.py  (or equivalent plant/contractor data)
    scripts/seed_manual_test_rates.py

Run from repo root (requires DATABASE_URL)::

    ./backend/venv/bin/python scripts/seed_demo_work_order_two_level_scenario.py --yes

What it does:

1. Deletes all work orders and invoices (same scope as ``clear_work_orders_and_invoices.py``).
2. Ensures ``work_orders.create`` maps to a **two-step** workflow (L1 → L2) using demo roles.
3. Creates five small work orders as ``negotiator``, submits each for approval.
4. Drives the approval engine programmatically:

   * **WO #1** — L1 approve → L2 approve → **active**
   * **WO #2** — L1 approve → L2 reject → negotiator re-submits → L1 approve → L2 approve → **active**
   * **WO #3** — L1 reject → **rejected** (stays in draft/rework path)
   * **WO #4** — left at **L1 pending** (open task for ``wo.approver1@demo.test``)
   * **WO #5** — L1 approve → left at **L2 pending** (open task for ``wo.approver2@demo.test``)

Logins: ``negotiator@demo.test``, ``wo.approver1@demo.test`` (L1), ``wo.approver2@demo.test`` (L2).
"""

from __future__ import annotations

import argparse
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
from modules.approvals.model import ApprovalRequest, ApprovalTask
from modules.approvals.service import ApprovalEngineService
from modules.contractor.models import Contractor
from modules.org_units.model import OrgUnit
from modules.part_master.models import PartMaster
from modules.rbac_sync import sync_all_modules_to_db
from modules.roles.model import Role
from modules.users.model import User
from modules.work_orders.schema import WorkOrderCreate, WorkOrderItemCreate
from modules.work_orders.service import WorkOrderService

from clear_work_orders_and_invoices import clear_work_orders_and_invoices
from _work_order_demo_workflow import ensure_work_orders_create_workflow


def _user_by_username(db: Session, username: str) -> User | None:
    return db.scalar(select(User).where(User.username == username))


def _first_plant(db: Session) -> OrgUnit | None:
    return db.scalars(select(OrgUnit).where(OrgUnit.type == "PLANT").order_by(OrgUnit.id.asc())).first()


def _first_contractor(db: Session) -> Contractor | None:
    return db.scalars(select(Contractor).where(Contractor.is_active.is_(True)).order_by(Contractor.id.asc())).first()


def _first_part(db: Session, org_unit_id: int) -> PartMaster | None:
    return db.scalars(
        select(PartMaster)
        .where(PartMaster.org_unit_id == int(org_unit_id), PartMaster.is_active.is_(True))
        .order_by(PartMaster.id.asc())
    ).first()


def _pending_approval_task_for_wo(db: Session, wo_id: int) -> ApprovalTask | None:
    return db.scalars(
        select(ApprovalTask)
        .join(ApprovalRequest, ApprovalRequest.id == ApprovalTask.request_id)
        .where(
            ApprovalRequest.entity_type == "work_order_approval",
            ApprovalRequest.entity_id == int(wo_id),
            ApprovalRequest.status == "pending",
            ApprovalTask.task_type == "approval",
            ApprovalTask.status == "pending",
        )
        .order_by(ApprovalTask.id.desc())
        .limit(1)
    ).first()


def _act(
    db: Session,
    *,
    task_id: int,
    actor_user_id: int,
    action: str,
    comment: str | None = None,
) -> None:
    ApprovalEngineService(db).act_on_task(
        task_id=int(task_id),
        actor_user_id=int(actor_user_id),
        action=action,
        comment=comment,
    )


def _create_minimal_wo(
    db: Session,
    *,
    svc: WorkOrderService,
    actor_id: int,
    plant_id: int,
    contractor_id: int,
    part: PartMaster,
    title: str,
    qty: Decimal,
) -> int:
    wo = svc.create(
        WorkOrderCreate(
            org_unit_id=int(plant_id),
            contractor_id=int(contractor_id),
            title=title,
            description="Two-level approval scenario seed.",
            work_date=date.today(),
            items=[
                WorkOrderItemCreate(
                    part_master_id=int(part.id),
                    progress_type="quantity",
                    planned_quantity=qty,
                    planned_percentage=None,
                    weight_per_piece=Decimal("1"),
                    notes="scenario",
                )
            ],
        ),
        actor_user_id=int(actor_id),
    )
    return int(wo.id)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Confirm wipe of all work orders + invoices and re-seed the scenario.",
    )
    args = parser.parse_args()
    if not args.yes:
        print("Refusing to run without --yes (this deletes all work orders and invoices).", file=sys.stderr)
        return 2

    db = SessionLocal()
    try:
        sync_all_modules_to_db(db)

        role_l1 = db.scalar(select(Role).where(Role.name == "Work Order Approver (L1)"))
        role_l2 = db.scalar(select(Role).where(Role.name == "Work Order Approver (L2)"))
        if role_l1 is None or role_l2 is None:
            print(
                'error: need roles "Work Order Approver (L1)" and "(L2)". Run scripts/seed_demo_users.py first.',
                file=sys.stderr,
            )
            return 3

        negotiator = _user_by_username(db, "negotiator")
        l1_user = _user_by_username(db, "wo_approver1")
        l2_user = _user_by_username(db, "wo_approver2")
        if negotiator is None or l1_user is None or l2_user is None:
            print(
                "error: need users negotiator, wo_approver1, wo_approver2. Run scripts/seed_demo_users.py first.",
                file=sys.stderr,
            )
            return 4

        plant = _first_plant(db)
        ctr = _first_contractor(db)
        if plant is None or ctr is None:
            print("error: need a PLANT org unit and an active contractor.", file=sys.stderr)
            return 5
        part = _first_part(db, int(plant.id))
        if part is None:
            print("error: need an active part master for that plant.", file=sys.stderr)
            return 6

        print("Wiping work orders + invoices…")
        clear_work_orders_and_invoices(db)

        if not ensure_work_orders_create_workflow(db, approver_role_l1=role_l1, approver_role_l2=role_l2):
            print("error: could not attach work_orders.create workflow (sync_modules + permissions?).", file=sys.stderr)
            return 7

        svc = WorkOrderService(db)
        titles = [
            "Demo 2LV — full approve (L1+L2)",
            "Demo 2LV — L2 reject then resubmit",
            "Demo 2LV — L1 reject",
            "Demo 2LV — pending at L1",
            "Demo 2LV — pending at L2 after L1",
        ]
        wo_ids: list[int] = []
        for i, title in enumerate(titles, start=1):
            wid = _create_minimal_wo(
                db,
                svc=svc,
                actor_id=int(negotiator.id),
                plant_id=int(plant.id),
                contractor_id=int(ctr.id),
                part=part,
                title=title,
                qty=Decimal(str(10 + i)),
            )
            svc.submit_for_approval(wid, actor_user_id=int(negotiator.id))
            wo_ids.append(wid)
            print(f"  Created + submitted WO id={wid} — {title}")

        w1, w2, w3, w4, w5 = wo_ids

        # WO1: L1 → L2 approve → active
        t = _pending_approval_task_for_wo(db, w1)
        assert t is not None
        _act(db, task_id=int(t.id), actor_user_id=int(l1_user.id), action="approve", comment="L1 ok")
        t = _pending_approval_task_for_wo(db, w1)
        assert t is not None
        _act(db, task_id=int(t.id), actor_user_id=int(l2_user.id), action="approve", comment="L2 ok")
        print(f"  WO {w1}: approved through L1+L2 → {svc.get(w1).status}")

        # WO2: L1 approve, L2 reject, re-submit, both approve
        t = _pending_approval_task_for_wo(db, w2)
        assert t is not None
        _act(db, task_id=int(t.id), actor_user_id=int(l1_user.id), action="approve")
        t = _pending_approval_task_for_wo(db, w2)
        assert t is not None
        _act(db, task_id=int(t.id), actor_user_id=int(l2_user.id), action="reject", comment="L2 needs revision")
        print(f"  WO {w2}: after L2 reject → {svc.get(w2).status}")

        svc.submit_for_approval(w2, actor_user_id=int(negotiator.id))
        t = _pending_approval_task_for_wo(db, w2)
        assert t is not None
        _act(db, task_id=int(t.id), actor_user_id=int(l1_user.id), action="approve", comment="L1 re-ok")
        t = _pending_approval_task_for_wo(db, w2)
        assert t is not None
        _act(db, task_id=int(t.id), actor_user_id=int(l2_user.id), action="approve", comment="L2 ok on resubmit")
        print(f"  WO {w2}: after resubmit + L1+L2 → {svc.get(w2).status}")

        # WO3: L1 reject
        t = _pending_approval_task_for_wo(db, w3)
        assert t is not None
        _act(db, task_id=int(t.id), actor_user_id=int(l1_user.id), action="reject", comment="L1 reject demo")
        print(f"  WO {w3}: L1 rejected → {svc.get(w3).status}")

        # WO4: untouched (pending L1)
        print(f"  WO {w4}: left pending at L1 → {svc.get(w4).status}")

        # WO5: L1 only
        t = _pending_approval_task_for_wo(db, w5)
        assert t is not None
        _act(db, task_id=int(t.id), actor_user_id=int(l1_user.id), action="approve", comment="L1 pass to L2")
        print(f"  WO {w5}: L1 approved, awaiting L2 → {svc.get(w5).status}")

        print()
        print("Done. Summary:")
        print(f"  Active: WO {w1}, {w2}")
        print(f"  Rejected: WO {w3} (resubmit from negotiator when ready)")
        print(f"  Pending L1 task: WO {w4} — login wo.approver1@demo.test → Tasks")
        print(f"  Pending L2 task: WO {w5} — login wo.approver2@demo.test → Tasks")
        return 0
    except Exception as exc:
        db.rollback()
        print(f"error: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
