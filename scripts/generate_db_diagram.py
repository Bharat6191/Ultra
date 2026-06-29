#!/usr/bin/env python3
"""Generate Mermaid ER diagrams from the live SQLAlchemy metadata."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
import sys


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
DOC_PATH = ROOT / "docs" / "db-diagram.md"
TIMEZONE = ZoneInfo("Asia/Kolkata")


if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import db.models  # noqa: F401  # Registers models on Base.metadata.
from db.base import Base


DOMAIN_MAP = [
    (
        "Identity and security",
        [
            "users",
            "user_sessions",
            "password_reset_tokens",
            "auth_policies",
            "user_mfa",
            "mfa_challenges",
            "mfa_setup_tokens",
        ],
    ),
    (
        "RBAC and org structure",
        [
            "features",
            "permissions",
            "roles",
            "user_roles",
            "user_org_units",
            "role_permissions",
            "role_org_units",
            "org_units",
            "rbac_audit_logs",
            "rbac_company_permission_versions",
            "rbac_user_permission_versions",
        ],
    ),
    (
        "Approvals and inbox",
        [
            "approval_workflows",
            "approval_workflow_mappings",
            "approval_steps",
            "approval_requests",
            "approval_tasks",
            "approval_actions",
            "task_comments",
            "task_audit_logs",
        ],
    ),
    (
        "Contractor master and compliance",
        [
            "contractors",
            "contractor_plants",
            "contractor_documents",
            "contractor_document_versions",
            "contractor_compliance_configs",
            "contractor_audit_logs",
        ],
    ),
    (
        "Commercial master and negotiations",
        [
            "part_master",
            "part_master_versions",
            "part_master_attachments",
            "part_master_audit_logs",
            "contractor_rates",
            "contractor_rate_versions",
            "contractor_rate_audit_logs",
            "negotiation_logs",
            "negotiation_attachments",
        ],
    ),
    (
        "Operations and billing",
        [
            "work_orders",
            "work_order_items",
            "work_order_item_progress",
            "work_order_audit_logs",
            "invoices",
            "invoice_lines",
            "invoice_extra_lines",
            "invoice_validation_issues",
            "invoice_attachments",
            "invoice_audit_logs",
            "contractor_invoice_compliance",
        ],
    ),
    (
        "Platform support",
        [
            "settings",
            "notification_settings",
            "notification_dedup_keys",
            "audit_logs",
        ],
    ),
]


LOGICAL_LINKS = [
    "contractor_rates.approval_request_id -> approval_requests.id",
    "work_orders.approval_request_id -> approval_requests.id",
    "work_order_items.override_approval_request_id -> approval_requests.id",
    "invoices.approval_request_id -> approval_requests.id",
    "invoice_lines.resolved_contractor_rate_id -> contractor_rates.id",
    "invoice_lines.resolved_part_master_id -> part_master.id",
]


CORE_TABLES = {
    "users",
    "roles",
    "permissions",
    "org_units",
    "contractors",
    "contractor_plants",
    "contractor_documents",
    "part_master",
    "contractor_rates",
    "negotiation_logs",
    "work_orders",
    "work_order_items",
    "invoices",
    "invoice_lines",
    "approval_workflows",
    "approval_steps",
    "approval_requests",
    "approval_tasks",
    "approval_actions",
}


TYPE_ALIASES = {
    "biginteger": "bigint",
    "boolean": "bool",
    "date": "date",
    "datetime": "datetime",
    "float": "float",
    "integer": "int",
    "json": "json",
    "jsonb": "json",
    "numeric": "decimal",
    "string": "string",
    "text": "text",
}


def entity_name(table_name: str) -> str:
    return table_name.upper()


def normalize_type_name(column) -> str:
    raw_name = column.type.__class__.__name__.lower()
    return TYPE_ALIASES.get(raw_name, raw_name.replace("type", "") or "value")


def key_marker(column) -> str:
    if column.primary_key:
        return " PK"
    if column.foreign_keys:
        return " FK"
    if column.unique:
        return " UK"
    return ""


def render_entity(table) -> list[str]:
    lines = [f"    {entity_name(table.name)} {{"]
    for column in table.columns:
        column_type = normalize_type_name(column)
        lines.append(f"        {column_type} {column.name}{key_marker(column)}")
    lines.append("    }")
    return lines


def render_relationships(tables) -> list[str]:
    included = {table.name for table in tables}
    relationships: dict[tuple[str, str, str], str] = {}

    for table in tables:
        for constraint in table.foreign_key_constraints:
            referred = constraint.referred_table
            if referred is None or referred.name not in included:
                continue

            local_cols = ", ".join(column.name for column in constraint.columns)
            remote_cols = ", ".join(element.column.name for element in constraint.elements)
            label = f"{local_cols} -> {remote_cols}"
            key = (referred.name, table.name, label)
            relationships[key] = (
                f"    {entity_name(referred.name)} ||--o{{ {entity_name(table.name)} : "
                f"\"{label}\""
            )

    return [relationships[key] for key in sorted(relationships)]


def render_mermaid(table_names: set[str] | None = None) -> str:
    tables = sorted(Base.metadata.tables.values(), key=lambda table: table.name)
    if table_names is not None:
        tables = [table for table in tables if table.name in table_names]

    entity_lines: list[str] = ["erDiagram"]
    for table in tables:
        entity_lines.extend(render_entity(table))
        entity_lines.append("")

    relationship_lines = render_relationships(tables)
    if entity_lines[-1] == "":
        entity_lines.pop()
    if relationship_lines:
        entity_lines.append("")
        entity_lines.extend(relationship_lines)

    return "\n".join(entity_lines)


def render_domain_map() -> list[str]:
    present_tables = set(Base.metadata.tables)
    lines = []

    for domain_name, table_names in DOMAIN_MAP:
        existing = [f"`{name}`" for name in table_names if name in present_tables]
        if existing:
            lines.append(f"- {domain_name}: {', '.join(existing)}")

    uncategorized = sorted(present_tables - {name for _, names in DOMAIN_MAP for name in names})
    if uncategorized:
        joined = ", ".join(f"`{name}`" for name in uncategorized)
        lines.append(f"- Uncategorized: {joined}")

    return lines


def build_document() -> str:
    generated_at = datetime.now(TIMEZONE).strftime("%Y-%m-%d %H:%M:%S %Z")
    table_count = len(Base.metadata.tables)
    domain_lines = "\n".join(render_domain_map())
    logical_links = "\n".join(f"- `{item}`" for item in LOGICAL_LINKS)
    core_diagram = render_mermaid(CORE_TABLES)
    full_diagram = render_mermaid()

    return f"""# Database Diagram

_This file is generated by `scripts/generate_db_diagram.py`. Do not edit it by hand._

## Snapshot

- Source: SQLAlchemy metadata registered through `backend/db/models/__init__.py`
- Tables: `{table_count}`
- Generated: `{generated_at}`

For full column-by-column details, see `docs/db-field-reference.md`.

## Domain Map

{domain_lines}

## Logical Links Not Enforced As Database Foreign Keys

{logical_links}

## Core Workflow ER Diagram

```mermaid
{core_diagram}
```

## Full Schema ER Diagram

```mermaid
{full_diagram}
```
"""


def main() -> None:
    DOC_PATH.write_text(build_document(), encoding="utf-8")
    print(f"Wrote {DOC_PATH}")


if __name__ == "__main__":
    main()
