"""RBAC catalog for contractor rate negotiation + Part Master comparisons."""

from __future__ import annotations

CONTRACTOR_RATES_MODULE_CONFIG = {
    "key": "contractor_rates",
    "title": "Contractor negotiated rates",
    "tabs": [
        {
            "key": "contractor_rates",
            "title": "Negotiations",
            "actions": ["view", "create", "update", "delete", "approve"],
        },
    ],
}
