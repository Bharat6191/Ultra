"""Commercial line calculations driven by Part Master configuration.

``resolved_rate`` on work order / invoice lines is always expressed in **rate unit**
terms (for example INR per kg or INR per piece), never a blended all-in number unless
``pricing_method`` is configured that way.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Mapping

def q2(v: Decimal) -> Decimal:
    return Decimal(v).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _dec(x: Any) -> Decimal:
    if isinstance(x, Decimal):
        return x
    return Decimal(str(x))


def commercial_line_amount(
    *,
    quantity: Decimal,
    resolved_rate: Decimal,
    pricing_method: str,
    rate_unit_type: str,
    weight_per_piece: Decimal | None,
) -> Decimal:
    """Return taxable/commercial line amount before tax.

    * **weight_based** — ``quantity`` is interpreted as a **piece count**. Amount is
      ``quantity × weight_per_piece × rate`` when ``rate_unit_type`` is ``per_kg``.
      If ``weight_per_piece`` is missing, ``quantity`` is treated as **kilograms**
      (legacy / plant-entered mass) and amount is ``quantity × rate``.
    * **piece_based** — amount is ``quantity × rate`` for ``per_piece`` (and
      ``per_unit`` treated like per piece).
    """
    q = _dec(quantity)
    r = _dec(resolved_rate)
    pm = (pricing_method or "").strip().lower()
    ru = (rate_unit_type or "").strip().lower()
    w = _dec(weight_per_piece) if weight_per_piece is not None else None

    if pm == "weight_based" and ru == "per_kg":
        if w is None or w <= 0:
            raise ValueError(
                "Weight per piece is required for weight-based parts billed per kg "
                "(commercial amount = quantity × weight per piece × rate per kg)."
            )
        return q2(q * w * r)

    if pm in ("piece_based", "weight_based") and ru in ("per_piece", "per_unit", "per_box", "per_nos"):
        return q2(q * r)

    # Safe default: proportional to quantity (lump extensions can add methods later).
    return q2(q * r)


def commercial_snapshot_from_part_row(row: Any) -> dict[str, Any]:
    """JSON-friendly pricing snapshot for work order / invoice lines."""
    return {
        "part_master_id": int(row.id),
        "part_code": str(row.part_code),
        "part_name": str(row.part_name),
        "pricing_method": str(row.pricing_method),
        "rate_unit_type": str(row.rate_unit_type),
        "weight_per_piece": str(row.weight_per_piece) if row.weight_per_piece is not None else None,
        "unit_type": str(row.unit_type),
    }


def snapshot_from_mapping(m: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "part_master_id": int(m["part_master_id"]),
        "part_code": str(m.get("part_code") or ""),
        "part_name": str(m.get("part_name") or ""),
        "pricing_method": str(m.get("pricing_method") or "piece_based"),
        "rate_unit_type": str(m.get("rate_unit_type") or "per_piece"),
        "weight_per_piece": m.get("weight_per_piece"),
        "unit_type": str(m.get("unit_type") or ""),
    }


def amount_from_snapshot(*, quantity: Decimal, resolved_rate: Decimal, snapshot: Mapping[str, Any] | None) -> Decimal:
    if not snapshot:
        return q2(_dec(quantity) * _dec(resolved_rate))
    w_raw = snapshot.get("weight_per_piece")
    w = _dec(w_raw) if w_raw not in (None, "") else None
    try:
        return commercial_line_amount(
            quantity=_dec(quantity),
            resolved_rate=_dec(resolved_rate),
            pricing_method=str(snapshot.get("pricing_method") or "piece_based"),
            rate_unit_type=str(snapshot.get("rate_unit_type") or "per_piece"),
            weight_per_piece=w,
        )
    except ValueError as exc:
        # Preserve message for API / validation layers.
        raise ValueError(str(exc)) from exc
