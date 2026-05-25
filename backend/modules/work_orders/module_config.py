"""RBAC catalog for Work Orders + operational execution layer.

Work Orders are the operational bridge between:
  * negotiated contractor rates (procurement)
  * completion tracking (operations)
  * contractor invoicing (finance)

Approval engine integration is action-code driven. The primary action for the
workflow mapping is ``work_orders.create`` (submit for approval).
"""

from __future__ import annotations

WORK_ORDERS_MODULE_CONFIG = {
    "key": "work_orders",
    "title": "Work Orders",
    "tabs": [
        {
            "key": "work_orders",
            "title": "Work Orders",
            "actions": [
                "view",
                "create",
                "update",
                "delete",
                "approve",
                "manage_completion",
                # Backward compatible alias (older DBs / seeded roles).
                "track_completion",
                "override_rate",
            ],
        },
    ],
}

