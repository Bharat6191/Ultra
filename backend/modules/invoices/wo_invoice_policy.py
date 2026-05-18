"""Work-order–centric invoice governance (status gating and billing basis labels).

Operational work orders use ``status == "active"`` after approval; draft / pending /
rejected / cancelled rows must never feed invoice creation or preflight billables.
"""

from __future__ import annotations

from typing import Any

INVOICEABLE_WORK_ORDER_STATUS: str = "active"

SINGLE_WORK_ORDER_PER_INVOICE_MSG: str = (
    "An invoice must include line items from exactly one work order. "
    "Create a separate invoice for each work order."
)


def assert_single_work_order_for_invoice(*, work_order_ids: set[int]) -> int:
    """Return the sole work order id; raise if zero or multiple."""
    from modules.errors import ConflictError

    ids = {int(x) for x in work_order_ids if int(x) > 0}
    if len(ids) != 1:
        raise ConflictError(SINGLE_WORK_ORDER_PER_INVOICE_MSG)
    return next(iter(ids))


def is_work_order_invoiceable(*, status: str | None, is_active: bool | None = True) -> bool:
    s = (status or "").strip().lower()
    return bool(is_active) and s == INVOICEABLE_WORK_ORDER_STATUS


def effective_billing_basis(
    *,
    pricing_method: str | None,
    billing_basis: str | None,
) -> str:
    """Normalize billing basis for API/UI; prefers explicit column when present."""
    bb = (billing_basis or "").strip().upper()
    if bb in ("WEIGHT", "PCS", "MANUAL"):
        return bb
    pm = (pricing_method or "").strip().lower()
    if pm == "weight_based":
        return "WEIGHT"
    if pm == "piece_based":
        return "PCS"
    return "PCS"


def allow_manual_amount_override_from_snapshot(snap: dict[str, Any] | None) -> bool:
    if not snap:
        return False
    raw = snap.get("allow_manual_amount_override")
    if raw is True:
        return True
    if isinstance(raw, str) and raw.strip().lower() in ("1", "true", "yes"):
        return True
    return False
