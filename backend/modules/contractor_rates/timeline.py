"""Unified timeline for a single contractor rate.

Combines three sources into a single chronological feed:
  * ``contractor_rate_audit_logs`` (CREATED / UPDATED / SENT_FOR_APPROVAL / APPROVED ...)
  * ``negotiation_logs``           (per-round proposals/counters)
  * ``approval_requests`` + ``approval_actions`` for the rate's approval request
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from modules.approvals.model import ApprovalAction, ApprovalRequest
from modules.contractor_rates.models import (
    ContractorRate,
    ContractorRateAuditLog,
    NegotiationLog,
)
from modules.errors import NotFoundError
from modules.users.model import User


_AUDIT_TITLE: dict[str, str] = {
    "CREATED": "Negotiation created",
    "UPDATED": "Updated",
    "NEGOTIATION_ADDED": "Round added",
    "SENT_FOR_APPROVAL": "Sent for approval",
    "APPROVED": "Approved",
    "REJECTED": "Rejected",
    "RATE_ACTIVATED": "Rate activated",
    "RATE_DEACTIVATED": "Rate deactivated",
    "CANCELLED": "Cancelled",
    "EXPIRED": "Expired",
}


class ContractorRateTimelineService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def _user_name(self, user_id: int | None) -> str | None:
        if user_id is None:
            return None
        u = self._db.get(User, int(user_id))
        return u.full_name if u else None

    def get_timeline(self, contractor_rate_id: int) -> list[dict[str, Any]]:
        rate = self._db.get(ContractorRate, int(contractor_rate_id))
        if rate is None:
            raise NotFoundError("ContractorRate", contractor_rate_id)

        events: list[dict[str, Any]] = []

        # 1. Audit rows.
        audit_rows = self._db.scalars(
            select(ContractorRateAuditLog)
            .where(ContractorRateAuditLog.contractor_rate_id == int(contractor_rate_id))
            .order_by(ContractorRateAuditLog.created_at.asc(), ContractorRateAuditLog.id.asc())
        ).all()
        for a in audit_rows:
            events.append(
                {
                    "occurred_at": a.created_at,
                    "kind": "audit",
                    "action": a.action,
                    "actor_user_id": a.changed_by,
                    "actor_name": self._user_name(a.changed_by),
                    "title": _AUDIT_TITLE.get(a.action, a.action.replace("_", " ").title()),
                    "description": _describe_audit(a),
                    "payload": {
                        "old_value": a.old_value,
                        "new_value": a.new_value,
                        "metadata": a.metadata_json,
                    },
                }
            )

        # 2. Negotiation rounds.
        round_rows = self._db.scalars(
            select(NegotiationLog)
            .where(NegotiationLog.contractor_rate_id == int(contractor_rate_id))
            .order_by(NegotiationLog.round_number.asc())
        ).all()
        for r in round_rows:
            label_bits = []
            if r.proposed_rate is not None:
                label_bits.append(f"proposed ₹{r.proposed_rate}")
            if r.counter_rate is not None:
                label_bits.append(f"counter ₹{r.counter_rate}")
            description = "; ".join(label_bits) if label_bits else "Discussion"
            if r.remarks:
                description = f"{description} — {r.remarks}"
            events.append(
                {
                    "occurred_at": r.created_at,
                    "kind": "negotiation",
                    "action": "ROUND",
                    "actor_user_id": r.created_by,
                    "actor_name": self._user_name(r.created_by),
                    "title": f"Round {r.round_number}",
                    "description": description,
                    "payload": {
                        "round_number": int(r.round_number),
                        "proposed_rate": str(r.proposed_rate) if r.proposed_rate else None,
                        "counter_rate": str(r.counter_rate) if r.counter_rate else None,
                        "remarks": r.remarks,
                    },
                }
            )

        # 3. Approval activity (request + actions) when an approval was used.
        if rate.approval_request_id is not None:
            req = self._db.scalar(
                select(ApprovalRequest)
                .where(ApprovalRequest.id == int(rate.approval_request_id))
                .options(selectinload(ApprovalRequest.tasks))
            )
            if req is not None:
                actions = self._db.scalars(
                    select(ApprovalAction)
                    .where(ApprovalAction.task_id.in_([int(t.id) for t in (req.tasks or [])]))
                    .order_by(ApprovalAction.created_at.asc())
                ).all()
                for act in actions:
                    events.append(
                        {
                            "occurred_at": act.created_at,
                            "kind": "approval",
                            "action": str(act.action).upper(),
                            "actor_user_id": act.user_id,
                            "actor_name": self._user_name(act.user_id),
                            "title": (
                                "Approver approved"
                                if str(act.action).lower() == "approve"
                                else "Approver rejected"
                            ),
                            "description": act.comment or None,
                            "payload": {"task_id": int(act.task_id)},
                        }
                    )

        events.sort(key=lambda e: (e["occurred_at"] or 0, e.get("title", "")))
        return events


def _describe_audit(a: ContractorRateAuditLog) -> str | None:
    """Human-readable summary for an audit row."""
    new_value = a.new_value or {}
    old_value = a.old_value or {}

    if a.action == "CREATED":
        meta = a.metadata_json or {}
        bits: list[str] = []
        if (new_value or {}).get("negotiated_rate"):
            bits.append(f"negotiated ₹{new_value['negotiated_rate']}")
        if meta.get("base_rate"):
            bits.append(f"base ₹{meta['base_rate']}")
        if meta.get("previous_rate"):
            bits.append(f"previous ₹{meta['previous_rate']}")
        return ", ".join(bits) or None

    if a.action == "UPDATED":
        meta = a.metadata_json or {}
        fields = (meta or {}).get("fields") or sorted((old_value or {}).keys())
        if fields:
            return f"Updated: {', '.join(fields)}"
        return None

    if a.action == "SENT_FOR_APPROVAL":
        meta = a.metadata_json or {}
        ar = meta.get("approval_request_id")
        return f"Approval request #{ar}" if ar else "Submitted for approval"

    if a.action in ("APPROVED", "REJECTED", "CANCELLED", "EXPIRED", "RATE_ACTIVATED", "RATE_DEACTIVATED"):
        meta = a.metadata_json or {}
        bits = []
        if "approval_request_id" in meta and meta["approval_request_id"] is not None:
            bits.append(f"request #{meta['approval_request_id']}")
        if meta.get("via"):
            bits.append(str(meta["via"]))
        if meta.get("comment"):
            bits.append(str(meta["comment"]))
        return " · ".join(bits) or None

    if a.action == "NEGOTIATION_ADDED":
        n = new_value or {}
        bits = []
        if n.get("round_number") is not None:
            bits.append(f"round {n['round_number']}")
        if n.get("proposed_rate"):
            bits.append(f"proposed ₹{n['proposed_rate']}")
        if n.get("counter_rate"):
            bits.append(f"counter ₹{n['counter_rate']}")
        if n.get("remarks"):
            bits.append(str(n["remarks"]))
        return ", ".join(bits) or None

    return None
