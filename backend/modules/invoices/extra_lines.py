"""Resolve ex-VAT amount for invoice extra charge rows."""

from __future__ import annotations

from decimal import Decimal

from modules.errors import ConflictError
from modules.invoices.schema import InvoiceExtraLineCreate


def _dec(v: Decimal | int | float | str | None) -> Decimal:
    if v is None:
        return Decimal("0")
    return Decimal(str(v))


def _q2(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"))


def resolve_extra_line_amount_ex_vat(line: InvoiceExtraLineCreate) -> Decimal:
    desc = (line.description or "").strip()
    if not desc:
        raise ConflictError("Extra charge description is required.")

    qty = line.quantity
    price = line.unit_price
    has_qty = qty is not None and _dec(qty) > Decimal("0")
    has_price = price is not None and _dec(price) >= Decimal("0")

    if has_qty and has_price:
        return _q2(_dec(qty) * _dec(price))

    if line.amount_ex_vat is not None:
        amt = _q2(_dec(line.amount_ex_vat))
        if amt < Decimal("0"):
            raise ConflictError("Extra charge taxable amount cannot be negative.")
        if amt == Decimal("0") and not has_qty:
            raise ConflictError("Extra charge taxable amount must be greater than zero.")
        return amt

    if has_qty or (price is not None and _dec(price) > Decimal("0")):
        raise ConflictError("Enter both quantity and unit price, or enter taxable amount directly.")

    raise ConflictError("Extra charge needs quantity × unit price or a taxable amount.")


def sum_extra_lines_ex_vat(lines: list[InvoiceExtraLineCreate]) -> Decimal:
    total = Decimal("0")
    for row in lines:
        desc = (row.description or "").strip()
        if not desc:
            continue
        total += resolve_extra_line_amount_ex_vat(row)
    return _q2(total)
