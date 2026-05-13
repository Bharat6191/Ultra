"""Work-order–centric invoice governance (status gating and billing basis labels).

Operational work orders use ``status == "active"`` after approval; draft / pending /
rejected / cancelled rows must never feed invoice creation or preflight billables.
"""

from __future__ import annotations

from typing import Any

INVOICEABLE_WORK_ORDER_STATUS: str = "active"


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
