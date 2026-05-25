from __future__ import annotations

CONTRACTOR_MODULE_CONFIG = {
    "key": "contractor",
    "title": "Contractor Master",
    "tabs": [
        {
            "key": "contractor",
            "title": "Contractors",
            "actions": [
                "view",
                "create",
                "update",
                "delete",
                "activate",
                "verify_documents",
                "manage_plants",
            ],
        },
        {
            "key": "document",
            "title": "Contractor documents",
            "actions": ["upload"],
        },
    ],
}
