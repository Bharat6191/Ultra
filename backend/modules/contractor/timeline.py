"""Contractor timeline: combines field-level audit logs with approval activity.

Returned events are ordered by timestamp desc and shaped for the frontend timeline UI.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from modules.approvals.model import ApprovalAction, ApprovalRequest, ApprovalTask
from modules.contractor.models import (
    Contractor,
    ContractorAuditLog,
)
from modules.errors import NotFoundError
from modules.org_units.model import OrgUnit
from modules.users.model import User


FIELD_LABELS: dict[str, str] = {
    "action": "Action",
    "address": "Address",
    "alternate_email": "Alternate Email",
    "alternate_phone": "Alternate Phone",
    "approval_request_id": "Approval Request ID",
    "city": "City",
    "cin": "CIN",
    "contact_person": "Contact Person",
    "contact_person_title": "Contact Person Title",
    "contractor_code": "Contractor Code",
    "contractor_type": "Contractor Type",
    "country": "Country",
    "current_step": "Current Step",
    "document_name": "Document",
    "document_type": "Document Type",
    "email": "Email",
    "end_date": "End Date",
    "entity_type": "Entity Type",
    "gst_number": "GST Number",
    "gstin": "GSTIN",
    "is_active": "Active",
    "legal_name": "Legal Name",
    "name": "Contractor Name",
    "notes": "Notes",
    "org_unit_id": "Org Unit ID",
    "org_unit_name": "Plant / Org Unit",
    "pan": "PAN",
    "pan_number": "PAN Number",
    "phone": "Phone",
    "postal_code": "Postal Code",
    "registration_number": "Registration Number",
    "request_id": "Request ID",
    "role": "Role",
    "start_date": "Start Date",
    "state": "State",
    "status": "Status",
    "task_id": "Task ID",
    "trade_name": "Trade Name",
    "website": "Website",
}

WORD_OVERRIDES: dict[str, str] = {
    "cin": "CIN",
    "gstin": "GSTIN",
    "id": "ID",
    "pan": "PAN",
    "po": "PO",
    "uom": "UOM",
    "wo": "WO",
}


def _user_label(db: Session, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    u = db.get(User, int(user_id))
    if u is None:
        return f"User #{user_id}"
    return u.full_name or u.email or u.username or f"User #{user_id}"


def _action_title(action: str) -> str:
    mapping = {
        "CREATED": "Contractor Created",
        "UPDATED": "Profile Updated",
        "STATUS_CHANGED": "Status Changed",
        "DOCUMENT_UPLOADED": "Document Uploaded",
        "DOCUMENT_UPDATED": "Document Updated",
        "DOCUMENT_VERIFIED": "Document Verified",
        "DOCUMENT_REJECTED": "Document Rejected",
        "DOCUMENT_DELETED": "Document Deleted",
        "PLANT_MAPPING_ADDED": "Plant Mapping Added",
        "PLANT_MAPPING_REMOVED": "Plant Mapping Removed",
        "PLANT_MAPPING_UPDATED": "Plant Mapping Updated",
        "COMPLIANCE_FLAGGED": "Compliance State Changed",
    }
    return mapping.get(action, action.replace("_", " ").title())


def _org_unit_label(db: Session, row: ContractorAuditLog) -> str | None:
    meta = row.metadata_json or {}
    for source in (meta, row.new_value or {}, row.old_value or {}):
        name = source.get("org_unit_name")
        if isinstance(name, str) and name.strip():
            return name.strip()

    for source in (meta, row.new_value or {}, row.old_value or {}):
        raw_id = source.get("org_unit_id")
        if raw_id in (None, ""):
            continue
        try:
            org_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        org = db.get(OrgUnit, org_id)
        if org is not None and getattr(org, "name", None):
            return str(org.name)
        return f"Org unit #{org_id}"
    return None


def _field_label(key: str) -> str:
    label = FIELD_LABELS.get(key)
    if label:
        return label
    words = [WORD_OVERRIDES.get(part.lower(), part.capitalize()) for part in key.split("_") if part]
    return " ".join(words) if words else key


class ContractorTimelineService:
    """Build a unified timeline for a single contractor."""

    def __init__(self, db: Session) -> None:
        self._db = db

    def build_timeline(self, contractor_id: int) -> list[dict[str, Any]]:
        contractor = self._db.get(Contractor, int(contractor_id))
        if contractor is None:
            raise NotFoundError("Contractor", contractor_id)

        events: list[dict[str, Any]] = []

        audit_rows = list(
            self._db.scalars(
                select(ContractorAuditLog)
                .where(ContractorAuditLog.contractor_id == int(contractor_id))
                .order_by(ContractorAuditLog.created_at.asc())
            ).all()
        )
        for row in audit_rows:
            actor = _user_label(self._db, row.changed_by)
            events.append(
                {
                    "type": "audit",
                    "action": row.action,
                    "title": _action_title(row.action),
                    "description": _describe_audit(self._db, row),
                    "timestamp": row.created_at,
                    "actor_user_id": row.changed_by,
                    "actor_name": actor,
                    "old_value": row.old_value,
                    "new_value": row.new_value,
                    "metadata": row.metadata_json,
                }
            )

        # Approval activity: fetch every contractor-related approval request and combine with actions.
        approval_reqs = list(
            self._db.scalars(
                select(ApprovalRequest)
                .where(
                    ApprovalRequest.entity_id == int(contractor_id),
                    ApprovalRequest.entity_type.in_(
                        ("contractor_creation", "contractor_update", "contractor_activation")
                    ),
                )
                .order_by(ApprovalRequest.created_at.asc())
                .options(selectinload(ApprovalRequest.tasks).selectinload(ApprovalTask.actions))
            ).all()
        )
        for req in approval_reqs:
            events.append(
                {
                    "type": "approval",
                    "action": "REQUEST_CREATED",
                    "title": _approval_request_title(req),
                    "description": f"Approval request opened (status: {req.status}).",
                    "timestamp": req.created_at,
                    "actor_user_id": req.created_by,
                    "actor_name": _user_label(self._db, req.created_by),
                    "old_value": None,
                    "new_value": {
                        "request_id": int(req.id),
                        "entity_type": req.entity_type,
                        "status": req.status,
                    },
                    "metadata": {"current_step": int(req.current_step)},
                }
            )
            for task in req.tasks or []:
                for act in task.actions or []:
                    events.append(
                        {
                            "type": "approval",
                            "action": str(act.action).upper(),
                            "title": (
                                "Approval granted"
                                if str(act.action).lower() == "approve"
                                else "Approval rejected"
                            ),
                            "description": act.comment,
                            "timestamp": act.created_at,
                            "actor_user_id": act.user_id,
                            "actor_name": _user_label(self._db, act.user_id),
                            "old_value": None,
                            "new_value": {
                                "request_id": int(req.id),
                                "task_id": int(task.id),
                                "step_id": int(task.step_id) if task.step_id else None,
                                "action": str(act.action).lower(),
                            },
                            "metadata": None,
                        }
                    )

        # Order desc by timestamp; events with no timestamp sink to the bottom.
        events.sort(key=lambda e: (e["timestamp"] is not None, e["timestamp"]), reverse=True)
        return events


def _approval_request_title(req: ApprovalRequest) -> str:
    label = {
        "contractor_creation": "Approval — contractor creation",
        "contractor_update": "Approval — contractor update",
        "contractor_activation": "Approval — contractor activation",
    }.get(req.entity_type, f"Approval — {req.entity_type}")
    return label


def _describe_audit(db: Session, row: ContractorAuditLog) -> str | None:
    if row.action == "STATUS_CHANGED":
        new = (row.new_value or {}).get("status")
        old = (row.old_value or {}).get("status")
        if new and old:
            return f"Status changed from {old} to {new}."
        if new:
            return f"Status set to {new}."
    if row.action == "UPDATED" and isinstance(row.new_value, dict):
        labels = [_field_label(key) for key in sorted(row.new_value.keys())]
        if labels:
            return f"Updated fields: {', '.join(labels)}."
    if row.action == "DOCUMENT_UPLOADED" and isinstance(row.new_value, dict):
        name = row.new_value.get("document_name") or row.new_value.get("document_type")
        if name:
            return f"Uploaded document: {name}."
    if row.action == "DOCUMENT_UPDATED" and isinstance(row.new_value, dict):
        labels = [_field_label(key) for key in sorted(row.new_value.keys())]
        if labels:
            return f"Updated document fields: {', '.join(labels)}."
    if row.action.startswith("PLANT_MAPPING_"):
        org_name = _org_unit_label(db, row)
        if org_name:
            return f"Plant mapping ({org_name})."
        return "Plant mapping updated."
    return None
