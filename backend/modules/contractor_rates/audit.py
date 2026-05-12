"""Field-level audit log helpers for contractor rate negotiations."""

from __future__ import annotations

from typing import Any, Iterable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from modules.contractor_rates.models import ContractorRate, ContractorRateAuditLog, ContractorRateVersion


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
ACTION_VERSION_CREATED = "VERSION_CREATED"
ACTION_VALIDITY_CHANGED = "VALIDITY_CHANGED"
ACTION_RATE_REPLACED = "RATE_REPLACED"

TRACKED_FIELDS: tuple[str, ...] = (
    "contractor_id",
    "part_master_id",
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


def diff_dicts(before: dict[str, Any], after: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
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


def standard_diff(before: dict[str, Any], after: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for key in sorted(set(before.keys()) | set(after.keys())):
        ov = before.get(key)
        nv = after.get(key)
        if ov != nv:
            out.append({"field": key, "old": ov, "new": nv})
    return out


def write_contractor_rate_version(
    db: Session,
    *,
    rate: ContractorRate,
    actor_user_id: int | None,
    change_reason: str | None = None,
) -> ContractorRateVersion:
    next_no = (
        db.scalar(
            select(func.coalesce(func.max(ContractorRateVersion.version_number), 0)).where(
                ContractorRateVersion.contractor_rate_id == int(rate.id)
            )
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
