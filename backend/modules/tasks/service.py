from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from modules.approvals.inbox_service import (
    dedupe_approval_inbox_rows,
    effective_request_status,
    should_show_approval_in_inbox,
)
from modules.approvals.model import (
    ApprovalAction,
    ApprovalRequest,
    ApprovalTask,
    ApprovalWorkflow,
    TaskAuditLog,
    TaskComment,
)
from modules.errors import NotFoundError
from modules.org_units.model import OrgUnit
from modules.rbac_association import user_role
from modules.roles.model import Role
from modules.users.model import User
from modules.tasks.schema import (
    TaskApprovalActionLinePublic,
    TaskApprovalContextPublic,
    TaskApprovalStepLinePublic,
    TaskAuditLogPublic,
    TaskDetailPublic,
    TaskCommentPublic,
    WorkflowStepPhase,
)


class TaskService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def _acted_role_task_ids_for_viewer(self, *, viewer_id: int, tasks: list[ApprovalTask]) -> set[int]:
        task_ids = [
            int(t.id)
            for t in tasks
            if str(t.task_type) == "approval"
            and t.assigned_role_id is not None
            and str(t.status) == "pending"
        ]
        if not task_ids:
            return set()
        stmt = select(ApprovalAction.task_id).where(
            ApprovalAction.user_id == viewer_id,
            ApprovalAction.task_id.in_(task_ids),
        )
        return {int(task_id) for task_id in self._db.scalars(stmt).all()}

    def my_tasks(
        self,
        *,
        viewer_id: int,
        status: str | None = None,
        task_type: str | None = None,
        due_before: datetime | None = None,
        limit: int = 100,
        inbox: str = "active",
    ) -> list[ApprovalTask]:
        """
        ``inbox=active`` (default): one logical row per *open* approval (current step) + open manual work.
        ``inbox=done``: completed / closed / final approval / rejected tasks you were involved in
        (no ``should_show_approval_in_inbox`` filter — otherwise finished work would disappear).
        """
        role_ids = {
            int(rid)
            for rid in self._db.execute(
                select(user_role.c.role_id).where(user_role.c.user_id == viewer_id)
            ).scalars().all()
        }
        role_filter = False
        if role_ids:
            role_filter = (ApprovalTask.assigned_role_id.is_not(None)) & (ApprovalTask.assigned_role_id.in_(role_ids))

        done_mode = (inbox or "active").lower() == "done"

        stmt = select(ApprovalTask).where(
            (ApprovalTask.assigned_to_user_id == viewer_id)
            | (ApprovalTask.assigned_user_id == viewer_id)
            | (ApprovalTask.created_by == viewer_id)
            | role_filter
        ).options(selectinload(ApprovalTask.request), selectinload(ApprovalTask.step))
        if done_mode:
            stmt = stmt.where(ApprovalTask.status.in_(("approved", "rejected", "completed", "closed")))
        if status:
            stmt = stmt.where(ApprovalTask.status == status)
        if task_type:
            stmt = stmt.where(ApprovalTask.task_type == task_type)
        if due_before is not None:
            stmt = stmt.where(ApprovalTask.due_date.is_not(None), ApprovalTask.due_date <= due_before)
        if done_mode:
            buf = max(100, int(limit) * 2)
            stmt = stmt.order_by(ApprovalTask.id.desc())
        else:
            # Fetch a buffer: post-filter keeps only the "current" approval task per open request.
            buf = max(100, int(limit) * 5) if not status else max(100, int(limit) * 2)
            stmt = stmt.order_by(ApprovalTask.id.desc())
        stmt = stmt.limit(buf)
        raw = list(self._db.scalars(stmt).all())
        if done_mode:
            out = dedupe_approval_inbox_rows(raw)
            return out[: int(limit)]
        acted_role_task_ids = self._acted_role_task_ids_for_viewer(viewer_id=viewer_id, tasks=raw)
        filtered = [t for t in raw if should_show_approval_in_inbox(t)]
        if acted_role_task_ids:
            filtered = [t for t in filtered if int(t.id) not in acted_role_task_ids]
        out = dedupe_approval_inbox_rows(filtered)
        return out[: int(limit)]

    def get_task(self, *, task_id: int) -> ApprovalTask:
        task = self._db.scalar(
            select(ApprovalTask)
            .where(ApprovalTask.id == task_id)
            .options(
                selectinload(ApprovalTask.comments),
                selectinload(ApprovalTask.audit_logs),
                selectinload(ApprovalTask.request)
                .options(
                    selectinload(ApprovalRequest.workflow).selectinload(ApprovalWorkflow.steps),
                    selectinload(ApprovalRequest.tasks).options(
                        selectinload(ApprovalTask.step),
                        selectinload(ApprovalTask.actions),
                    ),
                ),
                selectinload(ApprovalTask.step),
            )
        )
        if task is None:
            raise NotFoundError("Task", task_id)
        return task

    def viewer_can_access_task(self, *, task: ApprovalTask, viewer_id: int) -> bool:
        u = self._db.get(User, viewer_id)
        if u is not None and bool(u.is_superuser):
            return True

        if task.assigned_to_user_id == viewer_id:
            return True
        if task.assigned_user_id == viewer_id:
            return True

        role_ids = {
            int(rid)
            for rid in self._db.execute(
                select(user_role.c.role_id).where(user_role.c.user_id == viewer_id)
            ).scalars().all()
        }
        if task.assigned_role_id is not None and int(task.assigned_role_id) in role_ids:
            return True

        if str(task.task_type) == "manual" and task.created_by == viewer_id:
            return True

        if str(task.task_type) == "approval" and task.request is not None and task.request.created_by == viewer_id:
            return True

        if str(task.task_type) == "rework" and task.request is not None and task.request.created_by == viewer_id:
            return True

        return False

    def create_manual_task(
        self,
        *,
        actor_user_id: int,
        title: str,
        description: str | None,
        assigned_to_user_id: int,
        due_date: datetime | None,
        entity_type: str | None,
        entity_id: int | None,
        form_schema: dict[str, Any] | None,
        form_data: dict[str, Any] | None,
    ) -> ApprovalTask:
        task = ApprovalTask(
            task_type="manual",
            title=title,
            description=description,
            due_date=due_date,
            created_by=actor_user_id,
            assigned_to_user_id=assigned_to_user_id,
            entity_type=entity_type,
            entity_id=entity_id,
            form_schema=form_schema,
            form_data=form_data,
            status="open",
            # approval fields not used for manual tasks:
            request_id=None,
            step_id=None,
        )
        self._db.add(task)
        self._db.flush()
        self._log_audit(task_id=int(task.id), actor_user_id=actor_user_id, action="created", new_value={"title": title})
        self._db.commit()
        self._db.refresh(task)
        return task

    def assign(self, *, task_id: int, actor_user_id: int, assigned_to_user_id: int) -> ApprovalTask:
        task = self.get_task(task_id=task_id)
        old = {"assigned_to_user_id": task.assigned_to_user_id}
        task.assigned_to_user_id = assigned_to_user_id
        self._log_audit(task_id=task_id, actor_user_id=actor_user_id, action="assigned", old_value=old, new_value={"assigned_to_user_id": assigned_to_user_id})
        self._db.commit()
        self._db.refresh(task)
        return task

    def start(self, *, task_id: int, actor_user_id: int) -> ApprovalTask:
        task = self.get_task(task_id=task_id)
        old = {"status": task.status}
        task.status = "in_progress"
        self._log_audit(task_id=task_id, actor_user_id=actor_user_id, action="started", old_value=old, new_value={"status": "in_progress"})
        self._db.commit()
        self._db.refresh(task)
        return task

    def complete(self, *, task_id: int, actor_user_id: int) -> ApprovalTask:
        task = self.get_task(task_id=task_id)
        old = {"status": task.status}
        task.status = "completed"
        self._log_audit(task_id=task_id, actor_user_id=actor_user_id, action="completed", old_value=old, new_value={"status": "completed"})
        self._db.commit()
        self._db.refresh(task)
        return task

    def close(self, *, task_id: int, actor_user_id: int) -> ApprovalTask:
        task = self.get_task(task_id=task_id)
        old = {"status": task.status}
        task.status = "closed"
        task.closed_at = datetime.utcnow()
        self._log_audit(task_id=task_id, actor_user_id=actor_user_id, action="closed", old_value=old, new_value={"status": "closed"})
        self._db.commit()
        self._db.refresh(task)
        return task

    def add_comment(self, *, task_id: int, actor_user_id: int, comment: str) -> TaskComment:
        _ = self.get_task(task_id=task_id)
        row = TaskComment(task_id=task_id, user_id=actor_user_id, comment=comment)
        self._db.add(row)
        self._db.flush()
        self._log_audit(task_id=task_id, actor_user_id=actor_user_id, action="commented", new_value={"comment_id": int(row.id)})
        self._db.commit()
        self._db.refresh(row)
        return row

    def _log_audit(
        self,
        *,
        task_id: int,
        actor_user_id: int | None,
        action: str,
        old_value: dict[str, Any] | None = None,
        new_value: dict[str, Any] | None = None,
    ) -> None:
        self._db.add(
            TaskAuditLog(
                task_id=task_id,
                action=action,
                actor_user_id=actor_user_id,
                old_value=old_value,
                new_value=new_value,
            )
        )


def _audit_ts(log: TaskAuditLogPublic) -> float:
    c = log.created_at
    if c is None:
        return 0.0
    return c.timestamp()


def _user_display_name(db: Session, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    u = db.get(User, int(user_id))
    if u is None:
        return f"User #{user_id}"
    return u.full_name or u.email or f"User #{u.id}"


def _audit_row_public(db: Session, row: TaskAuditLog) -> TaskAuditLogPublic:
    base = TaskAuditLogPublic.model_validate(row)
    return base.model_copy(update={"actor_display_name": _user_display_name(db, row.actor_user_id)})


def _action_sort_ts(a: ApprovalAction) -> datetime:
    t = a.created_at
    if t is not None:
        return t
    return datetime(1970, 1, 1, tzinfo=timezone.utc)


_POOL_NAME_CAP = 24


def _role_pool_summary(db: Session, role_id: int) -> tuple[int, list[str]]:
    """Active users in ``role_id`` (ordered for display); names list is capped for API size."""
    stmt = (
        select(User)
        .select_from(user_role)
        .join(User, User.id == user_role.c.user_id)
        .where(user_role.c.role_id == int(role_id), User.is_active.is_(True))
        .order_by(User.full_name.asc(), User.id.asc())
    )
    users = list(db.scalars(stmt).all())
    count = len(users)
    names: list[str] = []
    for u in users[:_POOL_NAME_CAP]:
        names.append(u.full_name or u.email or f"User #{u.id}")
    return count, names


def _build_workflow_steps_for_request(db: Session, req: ApprovalRequest) -> list[TaskApprovalStepLinePublic]:
    """Map workflow steps + request tasks/actions into a fixed list for the UI timeline."""
    wf = req.workflow
    if wf is None or not wf.steps:
        return []

    steps_sorted = sorted(wf.steps, key=lambda s: int(s.step_order))
    total_steps = len(steps_sorted)
    req_status = effective_request_status(req)
    current = int(req.current_step)

    reject_step_order: int | None = None
    if req_status in ("rejected", "in_rework"):
        for t in req.tasks or []:
            if t.step is not None and str(t.status).lower() == "rejected":
                reject_step_order = int(t.step.step_order)
                break

    out: list[TaskApprovalStepLinePublic] = []
    for step in steps_sorted:
        s_order = int(step.step_order)
        r = db.get(Role, int(step.approver_role_id))
        approver_role_name = r.name if r is not None else "Approvers"
        required = int(step.required_approvals)
        pool_size, pool_member_names = _role_pool_summary(db, int(step.approver_role_id))

        step_tasks = [x for x in (req.tasks or []) if x.step_id is not None and int(x.step_id) == int(step.id)]
        all_actions: list[ApprovalAction] = []
        for st in step_tasks:
            for a in st.actions or []:
                all_actions.append(a)
        all_actions.sort(key=_action_sort_ts)

        approve_user_ids: set[int] = set()
        for a in all_actions:
            if str(a.action).lower() in ("approve", "approved"):
                approve_user_ids.add(int(a.user_id))
        approved_count = len(approve_user_ids)

        if req_status == "approved":
            phase: WorkflowStepPhase = "completed"
        elif req_status in ("rejected", "in_rework") and reject_step_order is not None:
            if s_order < reject_step_order:
                phase = "completed"
            elif s_order == reject_step_order:
                phase = "rejected"
            else:
                phase = "upcoming"
        elif req_status == "pending":
            if s_order < current:
                phase = "completed"
            elif s_order == current:
                phase = "current"
            else:
                phase = "upcoming"
        else:
            phase = "upcoming"

        action_rows: list[TaskApprovalActionLinePublic] = []
        if phase != "upcoming":
            for a in all_actions:
                action_rows.append(
                    TaskApprovalActionLinePublic(
                        actor_user_id=int(a.user_id),
                        actor_display_name=_user_display_name(db, int(a.user_id)) or f"User #{a.user_id}",
                        action=str(a.action).lower(),
                        comment=a.comment,
                        created_at=a.created_at,
                    )
                )

        if phase == "current":
            status_label = f"Waiting — {approved_count} of {required} required approval(s) on this step"
        elif phase == "completed":
            status_label = (
                f"Step complete — {approved_count} approval(s)"
                + (f" (required {required} for this step)" if required > 1 else "")
            )
        elif phase == "rejected":
            status_label = f"Stopped here — {approver_role_name}"
        else:
            status_label = f"Not reached yet — {required} approval(s) will be required when the request arrives here"

        out.append(
            TaskApprovalStepLinePublic(
                step_order=s_order,
                approver_role_name=approver_role_name,
                required_approvals=required,
                total_steps=total_steps,
                phase=phase,
                approved_count=approved_count,
                actions=action_rows,
                status_label=status_label,
                pool_size=pool_size,
                pool_member_names=pool_member_names,
            )
        )
    return out


def build_task_detail_public(db: Session, t: ApprovalTask) -> TaskDetailPublic:
    """
    Map ORM task → API detail, including approval request context and a merged audit timeline.
    """
    req = t.request
    step = t.step
    approval: TaskApprovalContextPublic | None = None
    if req is not None:
        payload: dict[str, Any] = dict(req.payload) if req.payload else {}
        req_status = effective_request_status(req)
        if req.entity_type == "user_creation":
            rid = payload.get("role_id")
            oid = payload.get("org_unit_id")
            if rid is not None:
                r = db.get(Role, int(rid))
                if r is not None:
                    payload["role_name"] = r.name
            if oid is not None:
                o = db.get(OrgUnit, int(oid))
                if o is not None:
                    payload["org_unit_name"] = o.name
        step_order: int | None = None
        required: int | None = None
        approver_role_id: int | None = None
        approver_role_name: str | None = None
        if step is not None:
            step_order = int(step.step_order)
            required = int(step.required_approvals)
            approver_role_id = int(step.approver_role_id)
            r = db.get(Role, step.approver_role_id)
            if r is not None:
                approver_role_name = r.name
        approval = TaskApprovalContextPublic(
            request_id=int(req.id),
            entity_type=str(req.entity_type),
            entity_id=int(req.entity_id),
            status=req_status,
            current_step=int(req.current_step),
            created_by=req.created_by,
            payload=payload,
            step_order=step_order,
            approver_role_id=approver_role_id,
            approver_role_name=approver_role_name,
            required_approvals=required,
            created_by_display_name=_user_display_name(db, req.created_by),
            workflow_steps=_build_workflow_steps_for_request(db, req),
        )

    form_data = t.form_data
    if form_data is None and req is not None and req.payload is not None:
        form_data = dict(req.payload)

    audit_rows: list[TaskAuditLogPublic] = [_audit_row_public(db, x) for x in t.audit_logs]

    # Always merge approval_actions into the timeline for approval tasks (even if audit logs exist),
    # because approval_actions capture who approved/rejected and when.
    if str(t.task_type) == "approval":
        stmt = (
            select(ApprovalAction)
            .where(ApprovalAction.task_id == t.id)
            .order_by(ApprovalAction.created_at.asc())
        )
        for a in db.scalars(stmt).all():
            raw = str(a.action).strip().lower()
            if raw in ("approve", "approved"):
                ev_action = "approved"
            elif raw in ("reject", "rejected"):
                ev_action = "rejected"
            else:
                ev_action = raw
            audit_rows.append(
                TaskAuditLogPublic(
                    id=1_000_000_000 + int(a.id),
                    action=ev_action,
                    actor_user_id=int(a.user_id),
                    actor_display_name=_user_display_name(db, int(a.user_id)),
                    old_value=None,
                    new_value={"comment": a.comment, "action": a.action} if a.comment else {"action": a.action},
                    created_at=a.created_at,
                )
            )
    audit_rows.sort(key=_audit_ts, reverse=True)

    comments: list[TaskCommentPublic] = []
    for c in t.comments:
        cp = TaskCommentPublic.model_validate(c)
        comments.append(
            cp.model_copy(update={"user_display_name": _user_display_name(db, int(c.user_id))})
        )

    return TaskDetailPublic(
        id=int(t.id),
        task_type=str(t.task_type),
        title=t.title,
        description=t.description,
        status=t.status,
        due_date=t.due_date,
        created_by=t.created_by,
        assigned_to_user_id=t.assigned_to_user_id,
        entity_type=t.entity_type,
        entity_id=t.entity_id,
        form_schema=t.form_schema,
        form_data=form_data,
        request_id=t.request_id,
        step_id=t.step_id,
        approval=approval,
        comments=comments,
        audit_logs=audit_rows,
    )
