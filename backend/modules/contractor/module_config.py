from __future__ import annotations

CONTRACTOR_MODULE_CONFIG = {
    "key": "contractor",
    "title": "Contractor master",
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
