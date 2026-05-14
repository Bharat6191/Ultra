"""Audit + immutable version snapshots for Part Master."""

from __future__ import annotations

from typing import Any, Iterable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from modules.part_master.models import PartMaster, PartMasterAuditLog, PartMasterVersion


PM_ACTION_CREATED = "CREATED"
PM_ACTION_UPDATED = "UPDATED"
PM_ACTION_ACTIVATED = "ACTIVATED"
PM_ACTION_DEACTIVATED = "DEACTIVATED"
PM_ACTION_SUPERSEDED = "SUPERSEDED"
ACTION_VERSION_CREATED = "VERSION_CREATED"
ACTION_VALIDITY_CHANGED = "VALIDITY_CHANGED"
ACTION_RATE_REPLACED = "RATE_REPLACED"

PART_MASTER_TRACKED_FIELDS: tuple[str, ...] = (
    "part_code",
    "part_name",
    "description",
    "unit_type",
    "pricing_method",
    "billing_basis",
    "allow_manual_amount_override",
    "weight_per_piece",
    "labour_cost",
    "man_days",
    "labour_headcount",
    "standard_man_hours",
    "base_rate",
    "rate_unit_type",
    "org_unit_id",
    "effective_from",
    "effective_to",
    "is_active",
    "status",
    "notes",
)


def standard_diff(before: dict[str, Any], after: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for key in sorted(set(before.keys()) | set(after.keys())):
        ov = before.get(key)
        nv = after.get(key)
        if ov != nv:
            out.append({"field": key, "old": ov, "new": nv})
    return out


def diff_dicts(before: dict[str, Any], after: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    old: dict[str, Any] = {}
    new: dict[str, Any] = {}
    for key in set(before.keys()) | set(after.keys()):
        if before.get(key) != after.get(key):
            old[key] = before.get(key)
            new[key] = after.get(key)
    return old, new


def snapshot_part_master(part: PartMaster, fields: Iterable[str] = PART_MASTER_TRACKED_FIELDS) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for f in fields:
        v = getattr(part, f, None)
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


def write_part_master_audit(
    db: Session,
    *,
    part_master_id: int,
    action: str,
    actor_user_id: int | None,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> PartMasterAuditLog:
    row = PartMasterAuditLog(
        part_master_id=int(part_master_id),
        action=str(action),
        changed_by=actor_user_id,
        old_value=old_value or None,
        new_value=new_value or None,
        metadata_json=metadata or None,
    )
    db.add(row)
    db.flush()
    return row


def write_part_master_version(
    db: Session,
    *,
    part: PartMaster,
    actor_user_id: int | None,
    change_reason: str | None = None,
) -> PartMasterVersion:
    next_no = (
        db.scalar(
            select(func.coalesce(func.max(PartMasterVersion.version_number), 0)).where(
                PartMasterVersion.part_master_id == int(part.id)
            )
        )
        or 0
    ) + 1
    row = PartMasterVersion(
        part_master_id=int(part.id),
        version_number=int(next_no),
        snapshot_json=snapshot_part_master(part),
        change_reason=change_reason,
        created_by=actor_user_id,
    )
    db.add(row)
    db.flush()
    return row
