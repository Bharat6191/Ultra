#!/usr/bin/env python3
"""
Seed completion snapshots (20/30/50/70/90/100%) on work order line items and
create a few demo invoices that merge multiple work orders per contractor.
"""

from __future__ import annotations

import sys
import uuid
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
from modules.org_units.model import OrgUnit
from modules.users.model import User
from modules.work_orders.models import WorkOrder
from modules.work_orders.schema import WorkOrderItemProgressCreate
from modules.work_orders.service import WorkOrderService
from modules.invoices.schema import InvoiceCreate, InvoiceLineCreate
from modules.invoices.service import InvoiceService


PCTS: list[Decimal] = [
    Decimal("20"),
    Decimal("30"),
    Decimal("50"),
    Decimal("70"),
    Decimal("90"),
    Decimal("100"),
]


def _user(db: Session) -> User | None:
    # Prefer all-access demo user if present.
    u = db.scalar(select(User).where(User.username == "all_access"))
    if u is not None:
        return u
    return db.scalar(select(User).order_by(User.id.asc()).limit(1))


def _first_plant(db: Session) -> OrgUnit | None:
    return db.scalars(select(OrgUnit).where(OrgUnit.type == "PLANT").order_by(OrgUnit.id.asc())).first()


def _work_orders_in_plant(db: Session, plant_id: int, *, limit: int = 20) -> list[WorkOrder]:
    return list(
        db.scalars(
            select(WorkOrder)
            .where(WorkOrder.org_unit_id == int(plant_id))
            .where(WorkOrder.is_active.is_(True))
            .order_by(WorkOrder.id.desc())
            .limit(int(limit))
        ).all()
    )


def _ensure_active(db: Session, wo_svc: WorkOrderService, wo: WorkOrder, *, approver_user_id: int) -> None:
    # If already active, ok.
    if str(wo.status) == "active":
        return
    if str(wo.status) == "pending_approval":
        wo_svc.finalize_approval(int(wo.id), approver_user_id=approver_user_id, approval_request_id=wo.approval_request_id)
        return
    # For any other status, force to active for demo data (best-effort).
    wo.status = "active"
    db.commit()
    db.refresh(wo)


def _seed_completion(db: Session, wo_svc: WorkOrderService, wo: WorkOrder, *, actor_user_id: int) -> int:
    wo = wo_svc.get(int(wo.id))
    updated = 0
    idx = 0
    for it in wo.items or []:
        pct = PCTS[idx % len(PCTS)]
        idx += 1
        try:
            wo_svc.add_progress(
                int(it.id),
                WorkOrderItemProgressCreate(
                    completed_percentage=pct,
                    completed_quantity=None,
                    remarks=f"[seed] completion set to {pct}%",
                ),
                actor_user_id=int(actor_user_id),
            )
            updated += 1
        except Exception:
            # Keep seeding resilient.
            continue
    return updated


def _seed_invoices(db: Session, inv_svc: InvoiceService, *, plant_id: int, actor_user_id: int) -> int:
    created = 0
    contractors = list(db.scalars(select(Contractor).where(Contractor.is_active.is_(True)).order_by(Contractor.id.asc())).all())
    for c in contractors[:3]:
        pre = inv_svc.preflight_billables(contractor_id=int(c.id), org_unit_id=int(plant_id), work_order_ids=None)
        lines = list(pre.get("lines") or [])
        if not lines:
            continue

        # Group by work_order_id and pick a few lines across multiple WOs.
        picked: list[dict] = []
        seen_wos: set[int] = set()
        for ln in lines:
            wid = int(ln["work_order_id"])
            if len(seen_wos) >= 3 and wid not in seen_wos:
                continue
            seen_wos.add(wid)
            picked.append(ln)
            if len(picked) >= 5:
                break

        if len({int(x["work_order_id"]) for x in picked}) < 2:
            continue  # want merged multi-WO invoices

        inv_no = f"INV-DEMO-{c.id}-{uuid.uuid4().hex[:8]}"
        payload_lines: list[InvoiceLineCreate] = []
        for ln in picked:
            rem = ln.get("remaining_invoiceable_qty_hint")
            if rem is None:
                continue
            try:
                rem_dec = Decimal(str(rem))
            except Exception:
                continue
            if rem_dec <= 0:
                continue
            qty = (rem_dec * Decimal("0.6")).quantize(Decimal("0.001"))
            if qty <= 0:
                continue
            payload_lines.append(
                InvoiceLineCreate(
                    work_order_item_id=int(ln["work_order_item_id"]),
                    quantity=qty,
                    tax_pct=Decimal("18.0"),
                    notes=f"[seed] merged invoice for {ln.get('work_order_number')}",
                )
            )

        if len(payload_lines) < 2:
            continue

        try:
            inv_svc.create(
                InvoiceCreate(
                    contractor_id=int(c.id),
                    org_unit_id=int(plant_id),
                    invoice_number=inv_no,
                    invoice_date=date.today(),
                    lines=payload_lines,
                ),
                actor_user_id=int(actor_user_id),
            )
            created += 1
        except Exception:
            continue

    return created


def main() -> int:
    db = SessionLocal()
    try:
        actor = _user(db)
        if actor is None:
            print("error: no users found (seed users first).", file=sys.stderr)
            return 3
        plant = _first_plant(db)
        if plant is None:
            print("error: no PLANT org unit found.", file=sys.stderr)
            return 4

        wo_svc = WorkOrderService(db)
        inv_svc = InvoiceService(db)

        wos = _work_orders_in_plant(db, int(plant.id), limit=25)
        if not wos:
            print("error: no work orders found. Run scripts/seed_demo_work_orders.py first.", file=sys.stderr)
            return 5

        # Activate then seed completions.
        activated = 0
        completed_updates = 0
        for wo in wos:
            before = str(wo.status)
            _ensure_active(db, wo_svc, wo, approver_user_id=int(actor.id))
            if before != "active" and str(wo.status) == "active":
                activated += 1
            completed_updates += _seed_completion(db, wo_svc, wo, actor_user_id=int(actor.id))

        inv_created = _seed_invoices(db, inv_svc, plant_id=int(plant.id), actor_user_id=int(actor.id))

        print()
        print("=" * 72)
        print("Completion + invoices seed complete")
        print("=" * 72)
        print(f"Plant: {plant.name} (id={plant.id})")
        print(f"Work orders activated: {activated}")
        print(f"Completion snapshots created: {completed_updates}")
        print(f"Invoices created: {inv_created}")
        print()
        print("Tip: open Work Orders and Invoices dashboards to see mixed completion and merged invoices.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())

