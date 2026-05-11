"""Audit helpers for Invoices."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from modules.invoices.models import InvoiceAuditLog


ACTION_CREATED = "CREATED"
ACTION_UPDATED = "UPDATED"
ACTION_SUBMITTED = "SUBMITTED"
ACTION_VALIDATED = "VALIDATED"
ACTION_BLOCKED = "BLOCKED"
ACTION_EXCEPTION_APPROVAL_REQUESTED = "EXCEPTION_APPROVAL_REQUESTED"
ACTION_APPROVED = "APPROVED"
ACTION_REJECTED = "REJECTED"


def write_audit(
    db: Session,
    *,
    invoice_id: int,
    action: str,
    actor_user_id: int | None,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> InvoiceAuditLog:
    row = InvoiceAuditLog(
        invoice_id=int(invoice_id),
        action=str(action),
        changed_by=actor_user_id,
        old_value=old_value or None,
        new_value=new_value or None,
        metadata_json=metadata or None,
    )
    db.add(row)
    db.flush()
    return row

