"""Declarative RBAC modules: each module has tabs; each tab lists action-level permissions.

Permission codes are dotted: ``module.tab.action``, collapsing to ``module.action`` when
``tab.key == module.key`` (primary tab).
"""

from __future__ import annotations

from typing import TypedDict

from modules.contractor.module_config import CONTRACTOR_MODULE_CONFIG

class TabConfigDict(TypedDict):
    key: str
    title: str
    actions: list[str]


class ModuleConfigDict(TypedDict):
    key: str
    title: str
    tabs: list[TabConfigDict]


# Standard CRUD-style actions stored in ``permissions.action`` (``edit`` maps to ``update``).
DEFAULT_TAB_ACTIONS: tuple[str, ...] = ("view", "create", "update", "delete")

MODULE_CONFIG: list[ModuleConfigDict] = [
    {
        "key": "users",
        "title": "User management",
        "tabs": [
            {
                "key": "users",
                "title": "Users",
                "actions": list(DEFAULT_TAB_ACTIONS),
            },
        ],
    },
    {
        "key": "org_units",
        "title": "Plants (org units)",
        "tabs": [
            {
                "key": "org_units",
                "title": "Plants",
                "actions": list(DEFAULT_TAB_ACTIONS),
            },
        ],
    },
    {
        "key": "roles",
        "title": "Roles",
        "tabs": [
            {
                "key": "roles",
                "title": "Roles",
                "actions": list(DEFAULT_TAB_ACTIONS),
            },
        ],
    },
    {
        "key": "permissions",
        "title": "Permissions",
        "tabs": [
            {
                "key": "permissions",
                "title": "Permissions",
                "actions": list(DEFAULT_TAB_ACTIONS),
            },
        ],
    },
    {
        "key": "settings",
        "title": "Settings",
        "tabs": [
            {
                "key": "settings",
                "title": "Settings",
                "actions": list(DEFAULT_TAB_ACTIONS),
            },
        ],
    },
    {
        "key": "features",
        "title": "Features",
        "tabs": [
            {
                "key": "features",
                "title": "Features",
                "actions": list(DEFAULT_TAB_ACTIONS),
            },
        ],
    },
    {
        "key": "approval",
        "title": "Approvals",
        "tabs": [
            {
                "key": "approval",
                "title": "Approvals",
                "actions": ["view", "act", "manage"],
            },
        ],
    },
    {
        "key": "task",
        "title": "Tasks",
        "tabs": [
            {
                "key": "task",
                "title": "Tasks",
                "actions": ["view", "create", "assign", "act", "close"],
            },
        ],
    },
    {
        "key": "notification_settings",
        "title": "Notification settings",
        "tabs": [
            {
                "key": "notification_settings",
                "title": "Notification settings",
                "actions": ["manage"],
            },
        ],
    },
    {
        "key": "email_templates",
        "title": "Email templates",
        "tabs": [
            {
                "key": "email_templates",
                "title": "Email templates",
                "actions": ["manage"],
            },
        ],
    },
    CONTRACTOR_MODULE_CONFIG,
]


def flatten_config_actions() -> frozenset[str]:
    """All action strings referenced by MODULE_CONFIG (normalized storage names)."""
    out: set[str] = set()
    for mod in MODULE_CONFIG:
        for tab in mod["tabs"]:
            for a in tab["actions"]:
                out.add(_normalize_action_token(a))
    return frozenset(out)


def _normalize_action_token(raw: str) -> str:
    s = raw.strip().lower()
    if s == "edit":
        return "update"
    return s
