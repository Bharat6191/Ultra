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
    ContractorRateVersion,
    RateMaster,
    RateMasterAuditLog,
    RateMasterVersion,
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
# 3.4 standardised action codes (apply to both rate master + contractor rate logs).
ACTION_VERSION_CREATED = "VERSION_CREATED"
ACTION_VALIDITY_CHANGED = "VALIDITY_CHANGED"
ACTION_RATE_REPLACED = "RATE_REPLACED"

# Canonical action codes for the rate master audit log.
RM_ACTION_CREATED = "CREATED"
RM_ACTION_UPDATED = "UPDATED"
RM_ACTION_ACTIVATED = "ACTIVATED"
RM_ACTION_DEACTIVATED = "DEACTIVATED"
RM_ACTION_SUPERSEDED = "SUPERSEDED"  # an older active row was replaced by a newer one
RM_ACTION_VERSION_CREATED = ACTION_VERSION_CREATED
RM_ACTION_VALIDITY_CHANGED = ACTION_VALIDITY_CHANGED
RM_ACTION_RATE_REPLACED = ACTION_RATE_REPLACED


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


# ---------------------------------------------------------------------------
# 3.4 — Standardised diff format + version snapshots
# ---------------------------------------------------------------------------


def standard_diff(
    before: dict[str, Any], after: dict[str, Any]
) -> list[dict[str, Any]]:
    """Return the canonical diff list defined in the 3.4 spec::

        [{"field": "base_rate", "old": 500, "new": 550}, ...]

    Audit ``old_value`` / ``new_value`` JSON columns continue to store the
    field-keyed dicts; ``standard_diff`` is the wire shape we expose to the UI
    via the version history endpoint.
    """
    out: list[dict[str, Any]] = []
    for key in sorted(set(before.keys()) | set(after.keys())):
        ov = before.get(key)
        nv = after.get(key)
        if ov != nv:
            out.append({"field": key, "old": ov, "new": nv})
    return out


def write_rate_master_version(
    db: Session,
    *,
    rate: RateMaster,
    actor_user_id: int | None,
    change_reason: str | None = None,
) -> RateMasterVersion:
    """Append an immutable ``rate_master_versions`` snapshot. Never overwrites."""
    from sqlalchemy import func, select

    next_no = (
        db.scalar(
            select(func.coalesce(func.max(RateMasterVersion.version_number), 0)).where(
                RateMasterVersion.rate_master_id == int(rate.id)
            )
        )
        or 0
    ) + 1
    row = RateMasterVersion(
        rate_master_id=int(rate.id),
        version_number=int(next_no),
        snapshot_json=snapshot_rate_master(rate),
        change_reason=change_reason,
        created_by=actor_user_id,
    )
    db.add(row)
    db.flush()
    return row


def write_contractor_rate_version(
    db: Session,
    *,
    rate: ContractorRate,
    actor_user_id: int | None,
    change_reason: str | None = None,
) -> ContractorRateVersion:
    """Append an immutable ``contractor_rate_versions`` snapshot. Never overwrites."""
    from sqlalchemy import func, select

    next_no = (
        db.scalar(
            select(
                func.coalesce(func.max(ContractorRateVersion.version_number), 0)
            ).where(ContractorRateVersion.contractor_rate_id == int(rate.id))
        )
        or 0
    ) + 1
    row = ContractorRateVersion(
        contractor_rate_id=int(rate.id),
        version_number=int(next_no),
        snapshot_json=snapshot_rate(
            rate,
            fields=TRACKED_FIELDS
            + ("approved_at", "rejected_at", "approval_request_id", "current_round"),
        ),
        change_reason=change_reason,
        created_by=actor_user_id,
    )
    db.add(row)
    db.flush()
    return row
