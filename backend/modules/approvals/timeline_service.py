"""Unified read-only approval timeline for an entity (e.g. user)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from modules.approvals.inbox_service import _viewer_can_access_request, safe_payload_preview
from modules.approvals.model import ApprovalAction, ApprovalRequest, ApprovalStep, ApprovalTask, TaskAuditLog
from modules.approvals.service import ApprovalError
from modules.rbac_audit.model import RbacAuditLog
from modules.roles.model import Role
from modules.users.model import User


def _rbac_timeline_events_for_user(db: Session, user_id: int) -> list[dict[str, Any]]:
    """RBAC audit rows for ``target_type=user`` (create/assign/update from admin services)."""
    rows = db.scalars(
        select(RbacAuditLog)
        .where(RbacAuditLog.target_type == "user", RbacAuditLog.target_id == int(user_id))
        .order_by(RbacAuditLog.created_at.asc())
    ).all()
    out: list[dict[str, Any]] = []
    for row in rows:
        actor = db.get(User, int(row.actor_user_id)) if row.actor_user_id is not None else None
        actor_name = actor.full_name or actor.email or f"User #{row.actor_user_id}" if actor else None
        out.append(
            {
                "type": "rbac_audit",
                "action": row.action,
                "user": actor_name,
                "timestamp": row.created_at,
                "details": {
                    "old_value": row.old_value,
                    "new_value": row.new_value,
                },
            }
        )
    return out


def _user_timeline_path(path_entity_type: str) -> bool:
    low = (path_entity_type or "").strip().lower()
    return low in ("user", "user_creation")


def resolve_db_entity(
    db: Session, *, path_entity_type: str, entity_id: int
) -> tuple[str, int] | None:
    """
    Map URL segment to persisted ``approval_requests`` (entity_type, entity_id).

    Supported:
    - ``user`` → ``user_creation`` + ``entity_id`` (user primary key)
    - Or any ``entity_type`` that matches an existing approval request for that entity id
      (case-insensitive; stored casing is returned).
    """
    raw = (path_entity_type or "").strip()
    low = raw.lower()
    if low == "user":
        return ("user_creation", entity_id)
    if low == "user_creation":
        return ("user_creation", entity_id)
    row = db.execute(
        select(ApprovalRequest.entity_type, ApprovalRequest.entity_id)
        .where(
            ApprovalRequest.entity_id == entity_id,
            func.lower(ApprovalRequest.entity_type) == low,
        )
        .limit(1)
    ).first()
    if row is not None:
        return (str(row[0]), int(row[1]))
    return None


class ApprovalTimelineService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_entity_timeline(
        self,
        *,
        path_entity_type: str,
        entity_id: int,
        viewer_id: int,
    ) -> list[dict[str, Any]]:
        resolved = resolve_db_entity(self._db, path_entity_type=path_entity_type, entity_id=entity_id)
        if resolved is None:
            raise ApprovalError("Unsupported entity type for timeline.")
        db_entity_type, db_entity_id = resolved

        req = self._db.scalar(
            select(ApprovalRequest)
            .where(
                ApprovalRequest.entity_type == db_entity_type,
                ApprovalRequest.entity_id == db_entity_id,
            )
            .order_by(ApprovalRequest.id.desc())
            .options(
                selectinload(ApprovalRequest.tasks).selectinload(ApprovalTask.step),
                selectinload(ApprovalRequest.tasks).selectinload(ApprovalTask.actions),
            )
        )

        events: list[dict[str, Any]] = []

        if req is not None:
            if not _viewer_can_access_request(self._db, request_id=req.id, viewer_id=viewer_id):
                raise ApprovalError("You cannot view this timeline.")

            creator = self._db.get(User, int(req.created_by)) if req.created_by is not None else None
            creator_name = None
            if creator is not None:
                creator_name = creator.full_name or creator.email or f"User #{creator.id}"

            events.append(
                {
                    "type": "created",
                    "user": creator_name,
                    "timestamp": req.created_at,
                    "details": {
                        "request_id": req.id,
                        "status": req.status,
                        "preview": safe_payload_preview(req.payload if isinstance(req.payload, dict) else None),
                    },
                }
            )

            actions = self._db.scalars(
                select(ApprovalAction)
                .join(ApprovalTask, ApprovalTask.id == ApprovalAction.task_id)
                .where(ApprovalTask.request_id == req.id)
                .options(
                    selectinload(ApprovalAction.task).selectinload(ApprovalTask.step),
                )
                .order_by(ApprovalAction.created_at.asc())
            ).all()

            for act in actions:
                task = act.task
                step_order = int(task.step.step_order) if task and task.step else None
                actor = self._db.get(User, int(act.user_id))
                actor_name = actor.full_name or actor.email or f"User #{act.user_id}" if actor else None
                events.append(
                    {
                        "type": "approval_step",
                        "step": step_order,
                        "action": act.action,
                        "user": actor_name,
                        "timestamp": act.created_at,
                        "details": {"task_id": task.id if task else None, "comment": act.comment},
                    }
                )

            # Rework / resubmit audit trail (captures "what changed" and resubmission moments).
            rework_logs = self._db.scalars(
                select(TaskAuditLog)
                .join(ApprovalTask, ApprovalTask.id == TaskAuditLog.task_id)
                .where(
                    ApprovalTask.request_id == req.id,
                    ApprovalTask.task_type == "rework",
                    TaskAuditLog.action.in_(("created", "rework_started", "entity_updated", "resubmitted")),
                )
                .order_by(TaskAuditLog.created_at.asc())
            ).all()

            for lg in rework_logs:
                actor = self._db.get(User, int(lg.actor_user_id)) if lg.actor_user_id is not None else None
                actor_name = actor.full_name or actor.email or f"User #{lg.actor_user_id}" if actor else None
                details: dict[str, Any] = {}
                if isinstance(lg.new_value, dict):
                    details.update(lg.new_value)
                if lg.action == "entity_updated":
                    before = lg.old_value if isinstance(lg.old_value, dict) else {}
                    after = lg.new_value if isinstance(lg.new_value, dict) else {}
                    changes: dict[str, Any] = {}
                    for k in sorted(set(before.keys()) | set(after.keys())):
                        if before.get(k) != after.get(k):
                            changes[k] = {"from": before.get(k), "to": after.get(k)}
                    details = {"changes": changes, "before": before, "after": after}
                events.append(
                    {
                        "type": str(lg.action),
                        "user": actor_name,
                        "timestamp": lg.created_at,
                        "details": details or None,
                    }
                )

            if req.status == "pending":
                step_row = self._db.scalar(
                    select(ApprovalStep).where(
                        ApprovalStep.workflow_id == req.workflow_id,
                        ApprovalStep.step_order == req.current_step,
                    )
                )
                assigned: list[str] = []
                if step_row is not None:
                    role = self._db.get(Role, int(step_row.approver_role_id))
                    role_name = role.name if role is not None else "Approvers"
                    for t in req.tasks:
                        if t.step_id != step_row.id or t.status != "pending":
                            continue
                        if t.assigned_user_id is not None:
                            u = self._db.get(User, int(t.assigned_user_id))
                            assigned.append(u.full_name or u.email or f"User #{t.assigned_user_id}" if u else "?")
                        elif t.assigned_role_id is not None:
                            r = self._db.get(Role, int(t.assigned_role_id))
                            assigned.append(f"Role: {r.name}" if r else "Role")
                    events.append(
                        {
                            "type": "approval_step",
                            "step": int(req.current_step),
                            "action": "pending",
                            "assigned_to": assigned,
                            "timestamp": None,
                            "details": {"role": role_name, "required_approvals": int(step_row.required_approvals)},
                        }
                    )

        if _user_timeline_path(path_entity_type):
            events.extend(_rbac_timeline_events_for_user(self._db, int(entity_id)))

        return events
