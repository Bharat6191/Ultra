"""Helpers for writing field-level audit log rows for contractors.

Always called by the service layer when a mutation occurs. Caller controls the
session lifecycle (commit). This module never commits.
"""

from __future__ import annotations

from typing import Any, Iterable

from sqlalchemy.orm import Session

from modules.contractor.models import ContractorAuditLog


# Canonical action codes used in the audit log.
ACTION_CREATED = "CREATED"
ACTION_UPDATED = "UPDATED"
ACTION_STATUS_CHANGED = "STATUS_CHANGED"
ACTION_DOCUMENT_UPLOADED = "DOCUMENT_UPLOADED"
ACTION_DOCUMENT_UPDATED = "DOCUMENT_UPDATED"
ACTION_DOCUMENT_VERIFIED = "DOCUMENT_VERIFIED"
ACTION_DOCUMENT_REJECTED = "DOCUMENT_REJECTED"
ACTION_DOCUMENT_DELETED = "DOCUMENT_DELETED"
ACTION_PLANT_MAPPING_ADDED = "PLANT_MAPPING_ADDED"
ACTION_PLANT_MAPPING_REMOVED = "PLANT_MAPPING_REMOVED"
ACTION_PLANT_MAPPING_UPDATED = "PLANT_MAPPING_UPDATED"
ACTION_COMPLIANCE_FLAGGED = "COMPLIANCE_FLAGGED"


# Snapshot fields used for diffs. Excludes timestamps + foreign-key cosmetics.
TRACKED_FIELDS: tuple[str, ...] = (
    "contractor_code",
    "name",
    "legal_name",
    "trade_name",
    "pan",
    "gstin",
    "cin",
    "contractor_type",
    "status",
    "contact_person",
    "contact_person_title",
    "email",
    "alternate_email",
    "phone",
    "alternate_phone",
    "address",
    "city",
    "state",
    "country",
    "postal_code",
    "registration_number",
    "website",
    "notes",
    "is_active",
)


def snapshot_contractor(contractor: Any, fields: Iterable[str] = TRACKED_FIELDS) -> dict[str, Any]:
    return {f: getattr(contractor, f, None) for f in fields}


def diff_dicts(before: dict[str, Any], after: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return (old_changed, new_changed) containing only fields whose value differs."""
    old: dict[str, Any] = {}
    new: dict[str, Any] = {}
    for key in set(before.keys()) | set(after.keys()):
        if before.get(key) != after.get(key):
            old[key] = before.get(key)
            new[key] = after.get(key)
    return old, new


def write_audit(
    db: Session,
    *,
    contractor_id: int,
    action: str,
    actor_user_id: int | None,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> ContractorAuditLog:
    row = ContractorAuditLog(
        contractor_id=int(contractor_id),
        action=str(action),
        changed_by=actor_user_id,
        old_value=old_value or None,
        new_value=new_value or None,
        metadata_json=metadata or None,
    )
    db.add(row)
    db.flush()
    return row
