"""RBAC catalog for the contractor rate negotiation module.

Permissions emitted (collapsed since each module's primary tab uses the module key):

  * ``rate_master.view`` / ``.create`` / ``.update`` / ``.delete`` — base rates and the
    unified comparison grid (same screen; ``rate_card.view`` is not used).
  * ``contractor_rates.view`` / ``.create`` / ``.update`` / ``.delete`` / ``.approve``
"""

from __future__ import annotations

RATE_MASTER_MODULE_CONFIG = {
    "key": "rate_master",
    "title": "Rate master",
    "tabs": [
        {
            "key": "rate_master",
            # Single surface: base-rate CRUD + unified comparison grid (/rate-card API).
            "title": "Base rates & comparisons",
            "actions": ["view", "create", "update", "delete"],
        },
    ],
}


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
