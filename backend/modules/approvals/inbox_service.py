"""Enriched approval inbox + request status (read paths)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from modules.approvals.model import ApprovalRequest, ApprovalStep, ApprovalTask, ApprovalWorkflow
from modules.approvals.service import ApprovalError
from modules.errors import NotFoundError
from modules.rbac_association import user_role
from modules.roles.model import Role
from modules.users.model import User


def safe_payload_preview(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Strip sensitive fields; keep a small preview for UI."""
    if not payload:
        return {}
    out: dict[str, Any] = {}
    for key in ("full_name", "email", "action_code"):
        if key in payload and payload[key] is not None:
            out[key] = payload[key]
    return out


def effective_request_status(req: ApprovalRequest | None) -> str:
    """
    Read-side status normalizer for partially-updated approval requests.

    Older second-step rejection flows could leave ``approval_requests.status`` at
    ``pending`` even though a current-cycle approval task had already been rejected.
    When that happens, treat the request as ``in_rework`` unless it has been
    resubmitted after that rejection.
    """
    if req is None:
        return "pending"
    raw = str(req.status or "").strip().lower()
    if raw != "pending":
        return raw

    latest_rejected_at: datetime | None = None
    for task in req.tasks or []:
        task_type = str(task.task_type or "approval").lower()
        if task_type != "approval":
            continue
        if str(task.status or "").lower() != "rejected":
            continue
        acted_at = task.acted_at or task.closed_at or req.created_at
        if latest_rejected_at is None or acted_at > latest_rejected_at:
            latest_rejected_at = acted_at

    if latest_rejected_at is None:
        return raw

    if req.last_resubmitted_at is not None and latest_rejected_at <= req.last_resubmitted_at:
        return raw

    return "in_rework"


def should_show_approval_in_inbox(t: ApprovalTask) -> bool:
    """
    One inbox row per open approval request: only the task for the *current* workflow step.

    Suppresses earlier-step tasks and tasks whose request is no longer ``pending`` so a
    multi-step approval (or a duplicate row from bad data) does not show two “active”
    items for the same user-creation in My tasks.
    """
    # Rework tasks are only meaningful while the request is in rework/rejected.
    # Once the request is resubmitted (back to pending), hide all rework tasks (even closed ones),
    # otherwise the inbox shows confusing duplicates (e.g. "Pending approval" + "Rework required").
    if str(t.task_type) == "rework":
        req = t.request
        if req is None or req.created_by is None:
            return False
        if effective_request_status(req) not in ("rejected", "in_rework"):
            return False
        return str(t.status) in ("open", "pending")

    if str(t.task_type) == "manual":
        # Manual tasks: "active" inbox should only show work that is still open.
        return str(t.status) in ("open", "in_progress", "pending")
    req = t.request
    if req is None:
        # Defensive: if task is orphaned from its request, treat it like a normal task row.
        return str(t.status) in ("open", "in_progress", "pending")
    req_status = effective_request_status(req)
    if req_status in ("rejected", "in_rework"):
        # Submitter sees a single "rework" task to edit / resubmit.
        if req.created_by is None:
            return False
        # Rework task handling is above; suppress everything else.
        return False
    if req_status != "pending":
        return False
    step = t.step
    if step is None:
        return True
    return int(step.step_order) == int(req.current_step)


def dedupe_approval_inbox_rows(tasks: list[ApprovalTask]) -> list[ApprovalTask]:
    """
    If duplicate ApprovalTask rows exist for the same (request, step), keep the newest.
    """
    seen: set[tuple[int, int]] = set()
    out: list[ApprovalTask] = []
    for t in sorted(tasks, key=lambda x: -int(x.id)):
        if str(t.task_type) == "manual" or t.request_id is None:
            out.append(t)
            continue
        st = t.step
        if st is None:
            out.append(t)
            continue
        k = (int(t.request_id), int(st.id))
        if k in seen:
            continue
        seen.add(k)
        out.append(t)
    return out


def _action_code_from_request(req: ApprovalRequest) -> str:
    raw = req.payload if isinstance(req.payload, dict) else {}
    code = raw.get("action_code")
    if isinstance(code, str) and code.strip():
        return code.strip()
    if req.entity_type == "user_creation":
        return "users.create"
    return "unknown"


def _action_label(action_code: str) -> str:
    if action_code == "users.create":
        return "Create user"
    return action_code.replace(".", " ").replace(":", " ").title()


def _batch_users(db: Session, user_ids: set[int]) -> dict[int, User]:
    if not user_ids:
        return {}
    rows = db.scalars(select(User).where(User.id.in_(user_ids))).all()
    return {u.id: u for u in rows}


def _batch_roles(db: Session, role_ids: set[int]) -> dict[int, Role]:
    if not role_ids:
        return {}
    rows = db.scalars(select(Role).where(Role.id.in_(role_ids))).all()
    return {r.id: r for r in rows}


def _viewer_can_access_request(db: Session, *, request_id: int, viewer_id: int) -> bool:
    viewer = db.get(User, viewer_id)
    if viewer is None:
        return False
    if viewer.is_superuser:
        return True
    req = db.get(ApprovalRequest, request_id)
    if req is None:
        return False
    if req.created_by == viewer_id:
        return True
    role_ids = {
        int(rid)
        for rid in db.execute(
            select(user_role.c.role_id).where(user_role.c.user_id == viewer_id)
        ).scalars().all()
    }
    role_filter = False
    if role_ids:
        role_filter = (ApprovalTask.assigned_role_id.is_not(None)) & (
            ApprovalTask.assigned_role_id.in_(role_ids)
        )
    stmt = select(ApprovalTask.id).where(
        ApprovalTask.request_id == request_id,
        (ApprovalTask.assigned_user_id == viewer_id) | role_filter,
    )
    return db.scalar(stmt) is not None


class ApprovalInboxService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_my_tasks_enriched(self, *, user_id: int) -> list[dict[str, Any]]:
        role_ids = {
            int(rid)
            for rid in self._db.execute(
                select(user_role.c.role_id).where(user_role.c.user_id == user_id)
            ).scalars().all()
        }
        role_filter = False
        if role_ids:
            role_filter = (ApprovalTask.assigned_role_id.is_not(None)) & (
                ApprovalTask.assigned_role_id.in_(role_ids)
            )
        stmt = (
            select(ApprovalTask)
            .where(
                (ApprovalTask.assigned_to_user_id == user_id)
                | (ApprovalTask.assigned_user_id == user_id)
                | (ApprovalTask.created_by == user_id)
                | role_filter
            )
            .options(
                selectinload(ApprovalTask.request).selectinload(ApprovalRequest.workflow).selectinload(
                    ApprovalWorkflow.steps
                ),
                selectinload(ApprovalTask.step),
            )
            .order_by(ApprovalTask.id.desc())
        )
        tasks = list(self._db.scalars(stmt).unique().all())
        tasks = [t for t in tasks if should_show_approval_in_inbox(t)]
        tasks = dedupe_approval_inbox_rows(tasks)

        user_ids: set[int] = set()
        role_ids: set[int] = set()
        for t in tasks:
            req = t.request
            if req and req.created_by is not None:
                user_ids.add(int(req.created_by))
            if t.step is not None:
                role_ids.add(int(t.step.approver_role_id))

        users = _batch_users(self._db, user_ids)
        roles = _batch_roles(self._db, role_ids)

        out: list[dict[str, Any]] = []
        for t in tasks:
            req = t.request
            if req is None:
                continue
            wf = req.workflow
            steps = list(wf.steps) if wf is not None else []
            total = len(steps)
            step = t.step
            step_order = int(step.step_order) if step is not None else 0
            role = roles.get(int(step.approver_role_id)) if step is not None else None
            step_name = f"Level {step_order}: {role.name}" if role is not None else f"Level {step_order}"
            creator = users.get(int(req.created_by)) if req.created_by is not None else None
            creator_label = None
            if creator is not None:
                creator_label = creator.full_name or creator.email or f"User #{creator.id}"

            action_code = _action_code_from_request(req)
            out.append(
                {
                    "task_id": t.id,
                    "request_id": req.id,
                    "entity_type": req.entity_type,
                    "entity_id": req.entity_id,
                    "action_code": action_code,
                    "action_label": _action_label(action_code),
                    "current_step": int(req.current_step),
                    "total_steps": total,
                    "step_order": step_order,
                    "step_name": step_name,
                    "created_by": req.created_by,
                    "created_by_name": creator_label,
                    "created_at": req.created_at,
                    "payload_preview": safe_payload_preview(req.payload if isinstance(req.payload, dict) else None),
                    "status": t.status,
                }
            )
        return out

    def get_request_status(self, *, request_id: int, viewer_id: int) -> dict[str, Any]:
        if not _viewer_can_access_request(self._db, request_id=request_id, viewer_id=viewer_id):
            raise ApprovalError("You cannot view this approval request.")

        req = self._db.scalar(
            select(ApprovalRequest)
            .where(ApprovalRequest.id == request_id)
            .options(
                selectinload(ApprovalRequest.tasks).selectinload(ApprovalTask.step),
                selectinload(ApprovalRequest.workflow).selectinload(ApprovalWorkflow.steps),
            )
        )
        if req is None:
            raise NotFoundError("ApprovalRequest", request_id)

        req_status = effective_request_status(req)
        wf = req.workflow
        steps = sorted(wf.steps, key=lambda s: s.step_order) if wf is not None else []
        total = len(steps)
        step_row = self._db.scalar(
            select(ApprovalStep).where(
                ApprovalStep.workflow_id == req.workflow_id,
                ApprovalStep.step_order == req.current_step,
            )
        )
        if step_row is None and steps:
            step_row = steps[0]
        role_ids: set[int] = set()
        user_ids: set[int] = set()
        for st in steps:
            role_ids.add(int(st.approver_role_id))
        for t in req.tasks:
            if t.assigned_user_id is not None:
                user_ids.add(int(t.assigned_user_id))
            for act in t.actions:
                user_ids.add(int(act.user_id))

        roles = _batch_roles(self._db, role_ids)
        users = _batch_users(self._db, user_ids)

        # Per-step breakdown
        step_rows_by_id = {int(s.id): s for s in steps}
        by_step_order: dict[int, dict[str, Any]] = {}
        for st in steps:
            role = roles.get(int(st.approver_role_id))
            by_step_order[int(st.step_order)] = {
                "step_order": int(st.step_order),
                "role_name": role.name if role is not None else None,
                "required_approvals": int(st.required_approvals),
                "approved_by": [],
                "pending": [],
            }

        for t in req.tasks:
            if t.step_id is None:
                continue
            st = step_rows_by_id.get(int(t.step_id))
            if st is None:
                continue
            bucket = by_step_order.get(int(st.step_order))
            if bucket is None:
                continue

            if t.status == "pending":
                if t.assigned_user_id is not None:
                    u = users.get(int(t.assigned_user_id))
                    bucket["pending"].append(u.full_name or u.email or f"User #{u.id}" if u else "?")
                elif t.assigned_role_id is not None:
                    r = self._db.get(Role, int(t.assigned_role_id))
                    bucket["pending"].append(f"Role: {r.name}" if r else "Role")
            elif t.status in ("approved", "rejected"):
                # Who acted: derive from actions (approve/reject) if present; fallback to assigned user.
                for act in t.actions:
                    if act.action != "approve":
                        continue
                    u = users.get(int(act.user_id))
                    label = u.full_name or u.email or f"User #{act.user_id}" if u else "?"
                    bucket["approved_by"].append(label)

        # Current step summary (kept for backward compatibility)
        required = int(step_row.required_approvals) if step_row is not None else 0
        approved_count = 0
        pending_names: list[str] = []
        if step_row is not None:
            for t in req.tasks:
                if t.step_id != step_row.id:
                    continue
                if t.status == "approved":
                    approved_count += 1
                elif t.status == "pending":
                    if t.assigned_user_id is not None:
                        u = users.get(int(t.assigned_user_id))
                        pending_names.append(u.full_name or u.email or f"User #{u.id}" if u else "?")
                    elif t.assigned_role_id is not None:
                        r = self._db.get(Role, int(t.assigned_role_id))
                        pending_names.append(f"Role: {r.name}" if r else "Role")

        return {
            "request_id": req.id,
            "request_status": req_status,
            "current_step": int(req.current_step),
            "total_steps": total,
            "pending_approvers": pending_names,
            "approved_count": approved_count,
            "required_approvals": required,
            "steps": [by_step_order[k] for k in sorted(by_step_order.keys())],
        }
