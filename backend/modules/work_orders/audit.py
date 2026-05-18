"""Audit helpers for Work Orders.

Mirrors contractor / contractor_rates audit patterns: service layer calls these helpers,
helpers never commit.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterable

from sqlalchemy.orm import Session

from modules.work_orders.models import WorkOrderAuditLog


ACTION_CREATED = "CREATED"
ACTION_UPDATED = "UPDATED"
ACTION_SENT_FOR_APPROVAL = "SENT_FOR_APPROVAL"
ACTION_APPROVED = "APPROVED"
ACTION_REJECTED = "REJECTED"
ACTION_CANCELLED = "CANCELLED"
ACTION_ACTIVATED = "ACTIVATED"
ACTION_CLOSED = "CLOSED"
ACTION_COMPLETION_UPDATED = "COMPLETION_UPDATED"
ACTION_RATE_OVERRIDE_REQUESTED = "RATE_OVERRIDE_REQUESTED"
ACTION_RATE_OVERRIDE_APPROVED = "RATE_OVERRIDE_APPROVED"
ACTION_RATE_OVERRIDE_REJECTED = "RATE_OVERRIDE_REJECTED"


HEADER_FIELDS: tuple[str, ...] = (
    "work_order_number",
    "org_unit_id",
    "contractor_id",
    "title",
    "description",
    "status",
    "created_at",
    "approved_at",
    "approval_request_id",
)


def _sanitize_audit_scalar(v: Any) -> Any:
    """Normalize ORM/header values so JSON-backed audit rows persist on all DBs."""
    if v is None:
        return None
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


def snapshot_work_order(wo: Any, fields: Iterable[str] = HEADER_FIELDS) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for f in fields:
        out[f] = _sanitize_audit_scalar(getattr(wo, f, None))
    return out


def diff_dicts(before: dict[str, Any], after: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    old: dict[str, Any] = {}
    new: dict[str, Any] = {}
    for k in set(before.keys()) | set(after.keys()):
        if before.get(k) != after.get(k):
            old[k] = before.get(k)
            new[k] = after.get(k)
    return old, new


def write_audit(
    db: Session,
    *,
    work_order_id: int,
    action: str,
    actor_user_id: int | None,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> WorkOrderAuditLog:
    row = WorkOrderAuditLog(
        work_order_id=int(work_order_id),
        action=str(action),
        actor_user_id=actor_user_id,
        old_value=old_value or None,
        new_value=new_value or None,
        metadata_json=metadata or None,
    )
    db.add(row)
    db.flush()
    return row

