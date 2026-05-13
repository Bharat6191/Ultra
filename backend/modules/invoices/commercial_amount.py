"""Ex-VAT invoice line amounts tied to Part Master / work order commercial rules."""

from __future__ import annotations

from decimal import Decimal

from modules.part_master.pricing import amount_from_snapshot, pricing_snapshot_for_item
from modules.work_orders.models import WorkOrderItem
from modules.work_orders.service import WorkOrderService


def invoice_line_ex_vat_amount(
    *,
    item: WorkOrderItem,
    invoice_quantity: Decimal,
    resolved_rate: Decimal,
) -> Decimal:
    """Compute stored ex-VAT line amount.

    For **weight_based** + **per_kg** parts, uses the explicit commercial rule
    ``taxable = invoice_qty × weight_per_unit × rate_per_kg`` (weight from the
    work order line snapshot). Other lines use the work order frozen taxable
    proration (same as :meth:`WorkOrderService.ex_tax_for_invoice_qty`).
    """
    snap = pricing_snapshot_for_item(item)
    pm = str(snap.get("pricing_method") or "").strip().lower()
    ru = str(snap.get("rate_unit_type") or "").strip().lower()
    if pm == "weight_based" and ru == "per_kg":
        return amount_from_snapshot(
            quantity=invoice_quantity,
            resolved_rate=resolved_rate,
            snapshot=snap,
        )
    return WorkOrderService.ex_tax_for_invoice_qty(item=item, invoice_quantity=invoice_quantity)
