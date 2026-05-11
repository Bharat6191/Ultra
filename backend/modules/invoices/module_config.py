"""RBAC catalog for Contractor Invoices + invoice validation governance."""

from __future__ import annotations

INVOICES_MODULE_CONFIG = {
    "key": "invoices",
    "title": "Invoices",
    "tabs": [
        {
            "key": "invoices",
            "title": "Invoices",
            "actions": [
                "view",
                "create",
                "update",
                "delete",
                "submit",
                "validate",
                "approve_exceptions",
            ],
        },
    ],
}

