#!/usr/bin/env python3
"""Create five invoices on a single work order; the fifth is validation-blocked.

Usage (repo root, DATABASE_URL in .env)::

    ./venv/bin/python scripts/seed_five_invoices_one_wo.py
    ./venv/bin/python scripts/seed_five_invoices_one_wo.py --work-order-id 129
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
from modules.invoices.commercial_amount import invoice_line_ex_vat_amount
from modules.invoices.models import Invoice, InvoiceLine
from modules.invoices.schema import InvoiceCreate, InvoiceLineCreate
from modules.invoices.service import InvoiceService
from modules.invoices.validation import InvoiceValidationEngine
from modules.users.model import User
from modules.work_orders.models import WorkOrder, WorkOrderItem
from modules.work_orders.service import WorkOrderService
from modules.errors import ConflictError


def _user(db: Session) -> User | None:
    u = db.scalar(select(User).where(User.username == "all_access"))
    return u or db.scalar(select(User).order_by(User.id.asc()).limit(1))


def _pick_work_order(db: Session, work_order_id: int | None) -> WorkOrder:
    if work_order_id is not None:
        wo = db.get(WorkOrder, int(work_order_id))
        if wo is None:
            raise SystemExit(f"error: work order {work_order_id} not found")
        return wo
    wo = db.scalars(
        select(WorkOrder)
        .where(WorkOrder.status == "active", WorkOrder.is_active.is_(True))
        .order_by(WorkOrder.id.desc())
        .limit(1)
    ).first()
    if wo is None:
        raise SystemExit("error: no active work order found")
    return wo


def _first_item(wo: WorkOrder) -> WorkOrderItem:
    items = list(wo.items or [])
    if not items:
        raise SystemExit(f"error: work order {wo.id} has no line items")
    return items[0]


def _create_blocked_invoice(
    db: Session,
    inv_svc: InvoiceService,
    *,
    wo: WorkOrder,
    item: WorkOrderItem,
    quantity: Decimal,
    invoice_number: str,
    actor_user_id: int,
) -> Invoice:
    """Persist an over-cap invoice and run validation so status becomes blocked."""
    rate = Decimal(str(item.resolved_rate))
    amount = invoice_line_ex_vat_amount(item=item, invoice_quantity=quantity, resolved_rate=rate)
    tax_pct = Decimal("18.0")
    gross = (amount * (Decimal("1") + tax_pct / Decimal("100"))).quantize(Decimal("0.01"))

    inv = Invoice(
        contractor_id=int(wo.contractor_id),
        org_unit_id=int(wo.org_unit_id),
        invoice_number=invoice_number.strip(),
        invoice_date=date.today(),
        status="draft",
        currency="INR",
        total_amount=gross,
        created_by=actor_user_id,
        extra_amount_ex_vat=Decimal("0.00"),
    )
    db.add(inv)
    db.flush()

    row = InvoiceLine(
        invoice_id=int(inv.id),
        work_order_item_id=int(item.id),
        quantity=quantity,
        rate=rate.quantize(Decimal("0.01")),
        amount=amount,
        tax_pct=tax_pct,
        rate_source=item.rate_source,
        resolved_contractor_rate_id=int(item.contractor_rate_id) if item.contractor_rate_id else None,
        resolved_part_master_id=int(item.part_master_id),
        notes="[seed] fifth invoice — exceeds WO cap (blocked)",
    )
    db.add(row)
    db.flush()

    inv.status = "submitted"
    inv.submitted_by = actor_user_id
    engine = InvoiceValidationEngine(db)
    result = engine.validate_and_persist(inv)
    inv_svc._apply_validation_outcome(inv, result, actor_user_id=actor_user_id, auto_approve_when_clean=True)
    db.commit()
    db.refresh(inv)
    return inv


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-order-id", type=int, default=None)
    args = parser.parse_args()

    db = SessionLocal()
    try:
        actor = _user(db)
        if actor is None:
            print("error: no users in database", file=sys.stderr)
            return 1

        wo = _pick_work_order(db, args.work_order_id)
        if str(wo.status) != "active":
            print(f"error: work order {wo.id} is not active (status={wo.status})", file=sys.stderr)
            return 2

        item = _first_item(wo)
        inv_svc = InvoiceService(db)
        wo_svc = WorkOrderService(db)
        cap = Decimal(str(wo.approved_value_total or 0))

        # Four invoices at 20% of planned qty each (≈20% of line taxable per invoice).
        qty_each = (Decimal(str(item.planned_quantity or 1)) * Decimal("0.2")).quantize(Decimal("0.001"))
        if qty_each <= 0:
            qty_each = Decimal("0.2")

        created: list[Invoice] = []
        for i in range(4):
            inv_no = inv_svc.suggest_next_invoice_number(
                contractor_id=int(wo.contractor_id),
                org_unit_id=int(wo.org_unit_id),
            )
            inv = inv_svc.create(
                InvoiceCreate(
                    contractor_id=int(wo.contractor_id),
                    org_unit_id=int(wo.org_unit_id),
                    invoice_number=inv_no,
                    invoice_date=date.today(),
                    lines=[
                        InvoiceLineCreate(
                            work_order_item_id=int(item.id),
                            quantity=qty_each,
                            tax_pct=Decimal("18.0"),
                            notes=f"[seed] invoice {i + 1}/5 on {wo.work_order_number}",
                        )
                    ],
                ),
                actor_user_id=int(actor.id),
            )
            created.append(inv)

        # Fifth: amount over remaining WO cap — API create rejects; seed blocked row via validation.
        inv_no_5 = inv_svc.suggest_next_invoice_number(
            contractor_id=int(wo.contractor_id),
            org_unit_id=int(wo.org_unit_id),
        )
        # Over the remaining WO cap after four partial invoices (~80% of line qty).
        qty_blocked = (Decimal(str(item.planned_quantity or 1)) * Decimal("0.45")).quantize(Decimal("0.001"))
        try:
            inv_svc.create(
                InvoiceCreate(
                    contractor_id=int(wo.contractor_id),
                    org_unit_id=int(wo.org_unit_id),
                    invoice_number=inv_no_5,
                    invoice_date=date.today(),
                    lines=[
                        InvoiceLineCreate(
                            work_order_item_id=int(item.id),
                            quantity=qty_blocked,
                            tax_pct=Decimal("18.0"),
                            notes="[seed] fifth invoice — should block",
                        )
                    ],
                ),
                actor_user_id=int(actor.id),
            )
            print("warning: fifth invoice was created without block (WO may have extra headroom)", file=sys.stderr)
        except ConflictError:
            db.rollback()
            inv_no_5 = inv_svc.suggest_next_invoice_number(
                contractor_id=int(wo.contractor_id),
                org_unit_id=int(wo.org_unit_id),
            )
            blocked = _create_blocked_invoice(
                db,
                inv_svc,
                wo=wo,
                item=item,
                quantity=qty_blocked,
                invoice_number=inv_no_5,
                actor_user_id=int(actor.id),
            )
            created.append(blocked)

        wo_ref = wo_svc.get(int(wo.id))
        print()
        print("=" * 72)
        print(f"Five invoices on work order {wo_ref.work_order_number} (id={wo_ref.id})")
        print("=" * 72)
        print(f"Approved value (ex-VAT cap): {cap}")
        passed_ex = sum(
            (ln.amount for inv in created if str(inv.validation_status) in ("pass", "warn") for ln in inv.lines or []),
            Decimal("0"),
        )
        print(f"Passed validation (ex-VAT):  {passed_ex}")
        print(f"Last invoice ex-VAT line:      {created[-1].lines[0].amount if created[-1].lines else '—'}")
        print()
        for inv in created:
            print(
                f"  {inv.invoice_number:16}  status={inv.status:10}  "
                f"validation={inv.validation_status or '-':8}  total={inv.total_amount}"
            )
        last = created[-1]
        if str(last.status) != "blocked":
            print()
            print("error: last invoice is not blocked — adjust quantities or pick another WO", file=sys.stderr)
            return 3
        print()
        print("Done. Open the work order Invoices tab or /invoices to review.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
