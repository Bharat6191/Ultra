"""Display helpers for invoice lines (unit / rate basis labels from WO snapshots)."""

from __future__ import annotations


def unit_label_from_type(unit_type: str | None) -> str | None:
    u = (unit_type or "").strip().lower()
    if not u:
        return None
    mapping = {
        "hr": "Hours",
        "hour": "Hours",
        "kg": "Kg",
        "day": "Days",
        "pcs": "Pcs",
        "nos": "Nos",
    }
    return mapping.get(u, u.upper())


def rate_basis_label(rate_unit_type: str | None) -> str | None:
    ru = (rate_unit_type or "").strip().lower()
    if not ru:
        return None
    mapping = {
        "per_kg": "per kg",
        "per_piece": "per piece",
        "per_unit": "per unit",
        "per_box": "per box",
        "per_nos": "per nos",
        "per_hr": "per hour",
        "per_day": "per day",
    }
    return mapping.get(ru, ru.replace("_", " "))
