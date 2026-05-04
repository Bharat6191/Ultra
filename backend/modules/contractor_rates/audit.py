"""Field-level audit log helpers for the contractor rate negotiation module.

Mirrors the contractor module's pattern: actions are canonical strings, and the
session lifecycle (commit) is owned by the caller — this module never commits.

Two audit destinations:

  * :class:`ContractorRateAuditLog` for negotiation rows (``write_audit``).
  * :class:`RateMasterAuditLog` for base rate rows (``write_rate_master_audit``).
"""

from __future__ import annotations

from typing import Any, Iterable

from sqlalchemy.orm import Session

from modules.contractor_rates.models import (
    ContractorRate,
    ContractorRateAuditLog,
    RateMaster,
    RateMasterAuditLog,
)


# Canonical action codes for the rate audit log.
ACTION_CREATED = "CREATED"
ACTION_UPDATED = "UPDATED"
ACTION_NEGOTIATION_ADDED = "NEGOTIATION_ADDED"
ACTION_SENT_FOR_APPROVAL = "SENT_FOR_APPROVAL"
ACTION_APPROVED = "APPROVED"
ACTION_REJECTED = "REJECTED"
ACTION_RATE_ACTIVATED = "RATE_ACTIVATED"
ACTION_RATE_DEACTIVATED = "RATE_DEACTIVATED"
ACTION_CANCELLED = "CANCELLED"
ACTION_EXPIRED = "EXPIRED"

# Canonical action codes for the rate master audit log.
RM_ACTION_CREATED = "CREATED"
RM_ACTION_UPDATED = "UPDATED"
RM_ACTION_ACTIVATED = "ACTIVATED"
RM_ACTION_DEACTIVATED = "DEACTIVATED"
RM_ACTION_SUPERSEDED = "SUPERSEDED"  # an older active row was replaced by a newer one


# Snapshot fields for diff-style audits (CREATED / UPDATED).
TRACKED_FIELDS: tuple[str, ...] = (
    "contractor_id",
    "rate_master_id",
    "negotiated_rate",
    "initial_rate",
    "previous_rate",
    "savings_amount",
    "savings_percentage",
    "effective_from",
    "effective_to",
    "status",
    "remarks",
)


def snapshot_rate(rate: ContractorRate, fields: Iterable[str] = TRACKED_FIELDS) -> dict[str, Any]:
    """Return a JSON-friendly snapshot of the rate row for audit storage.

    Decimals are stringified to keep ``JSON`` columns portable across drivers
    (SQLite ``JSON1``/``psycopg2``).
    """
    out: dict[str, Any] = {}
    for f in fields:
        v = getattr(rate, f, None)
        if v is None:
            out[f] = None
        elif hasattr(v, "isoformat"):
            out[f] = v.isoformat()
        else:
            out[f] = str(v) if isinstance(v, (int, float)) is False and not isinstance(v, str) else v
    return out


def diff_dicts(
    before: dict[str, Any], after: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return ``(old_changed, new_changed)`` containing only fields whose value differs."""
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
    contractor_rate_id: int,
    action: str,
    actor_user_id: int | None,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> ContractorRateAuditLog:
    """Append a ``ContractorRateAuditLog`` row. Caller is expected to commit."""
    row = ContractorRateAuditLog(
        contractor_rate_id=int(contractor_rate_id),
        action=str(action),
        changed_by=actor_user_id,
        old_value=old_value or None,
        new_value=new_value or None,
        metadata_json=metadata or None,
    )
    db.add(row)
    db.flush()
    return row


# --- Rate master audit ---

RATE_MASTER_TRACKED_FIELDS: tuple[str, ...] = (
    "job_type",
    "skill_type",
    "unit",
    "base_rate",
    "org_unit_id",
    "effective_from",
    "effective_to",
    "is_active",
    "notes",
)


def snapshot_rate_master(
    rate: RateMaster, fields: Iterable[str] = RATE_MASTER_TRACKED_FIELDS
) -> dict[str, Any]:
    """JSON-friendly snapshot of a ``RateMaster`` row for audit storage."""
    out: dict[str, Any] = {}
    for f in fields:
        v = getattr(rate, f, None)
        if v is None:
            out[f] = None
        elif hasattr(v, "isoformat"):
            out[f] = v.isoformat()
        elif isinstance(v, bool):
            out[f] = bool(v)
        elif isinstance(v, (int, float, str)):
            out[f] = v
        else:
            out[f] = str(v)
    return out


def write_rate_master_audit(
    db: Session,
    *,
    rate_master_id: int,
    action: str,
    actor_user_id: int | None,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> RateMasterAuditLog:
    """Append a ``RateMasterAuditLog`` row. Caller is expected to commit."""
    row = RateMasterAuditLog(
        rate_master_id=int(rate_master_id),
        action=str(action),
        changed_by=actor_user_id,
        old_value=old_value or None,
        new_value=new_value or None,
        metadata_json=metadata or None,
    )
    db.add(row)
    db.flush()
    return row
