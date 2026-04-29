from __future__ import annotations

from datetime import datetime, timedelta, timezone
import secrets
from typing import Any

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.orm import Session, selectinload

from modules.approvals.model import (
    ApprovalAction,
    ApprovalRequest,
    ApprovalStep,
    ApprovalTask,
    ApprovalWorkflow,
    TaskAuditLog,
    TaskComment,
)
from modules.errors import ConflictError, NotFoundError
from modules.rbac_association import user_role
from modules.roles.model import Role
from modules.users.model import User
import os

from modules.emails.service import EmailNotificationService
from modules.mfa.policy_hooks import maybe_send_mfa_setup_for_user
from modules.mfa.notify import create_mfa_setup_link
from modules.auth_policy.service import get_global_policy


class ApprovalError(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


class ApprovalWorkflowService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def list_workflows(self) -> list[ApprovalWorkflow]:
        stmt = select(ApprovalWorkflow).options(selectinload(ApprovalWorkflow.steps)).order_by(
            ApprovalWorkflow.created_at.desc()
        )
        return list(self._db.scalars(stmt).unique().all())

    def get_workflow(self, workflow_id: int) -> ApprovalWorkflow:
        wf = self._db.scalar(
            select(ApprovalWorkflow)
            .where(ApprovalWorkflow.id == workflow_id)
            .options(selectinload(ApprovalWorkflow.steps))
        )
        if wf is None:
            raise NotFoundError("ApprovalWorkflow", workflow_id)
        return wf

    def create_workflow(
        self,
        *,
        name: str,
        entity_type: str,
        created_by: int | None,
        is_active: bool = False,
    ) -> ApprovalWorkflow:
        if is_active:
            existing = self._db.scalar(
                select(ApprovalWorkflow.id).where(
                    ApprovalWorkflow.entity_type == entity_type,
                    ApprovalWorkflow.is_active.is_(True),
                )
            )
            if existing is not None:
                raise ConflictError("Only one active workflow is allowed per entity_type.")
        wf = ApprovalWorkflow(
            name=name.strip(),
            entity_type=entity_type.strip(),
            is_active=bool(is_active),
            created_by=created_by,
        )
        self._db.add(wf)
        self._db.commit()
        return self.get_workflow(wf.id)

    def add_step(
        self,
        *,
        workflow_id: int,
        step_order: int,
        approver_role_id: int,
        required_approvals: int,
    ) -> ApprovalStep:
        wf = self.get_workflow(workflow_id)
        role = self._db.get(Role, approver_role_id)
        if role is None:
            raise NotFoundError("Role", approver_role_id)
        if step_order < 1:
            raise ConflictError("step_order must be >= 1.")
        if required_approvals < 1:
            raise ConflictError("required_approvals must be >= 1.")
        existing_orders = [s.step_order for s in wf.steps]
        if existing_orders and step_order <= max(existing_orders):
            raise ConflictError("Steps must have increasing step_order.")
        step = ApprovalStep(
            workflow_id=workflow_id,
            step_order=step_order,
            approver_role_id=approver_role_id,
            required_approvals=required_approvals,
        )
        self._db.add(step)
        self._db.commit()
        return step

    def activate_workflow(self, workflow_id: int, *, actor_user_id: int | None) -> ApprovalWorkflow:
        wf = self.get_workflow(workflow_id)
        if not wf.steps:
            raise ConflictError("Cannot activate a workflow with no steps.")
        self._db.execute(
            ApprovalWorkflow.__table__.update()
            .where(
                ApprovalWorkflow.entity_type == wf.entity_type,
                ApprovalWorkflow.id != wf.id,
            )
            .values(is_active=False)
        )
        wf.is_active = True
        self._db.commit()
        return self.get_workflow(wf.id)

    def get_active_workflow_for_entity(self, entity_type: str) -> ApprovalWorkflow | None:
        return self._db.scalar(
            select(ApprovalWorkflow)
            .where(
                ApprovalWorkflow.entity_type == entity_type,
                ApprovalWorkflow.is_active.is_(True),
            )
            .options(selectinload(ApprovalWorkflow.steps))
        )


class PasswordSetupTokenService:
    """
    Backward compatibility token generator.

    The email engine now owns notifications; this helper remains for older scripts/tests.
    """

    @staticmethod
    def generate_token() -> str:
        return secrets.token_urlsafe(32)

    @staticmethod
    def expires_at(*, minutes: int = 60 * 24) -> datetime:
        return _now_utc() + timedelta(minutes=minutes)


class ApprovalEngineService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def create_request_for_entity(
        self,
        *,
        workflow: ApprovalWorkflow,
        entity_type: str,
        entity_id: int,
        payload: dict,
        created_by: int | None,
    ) -> ApprovalRequest:
        if not workflow.steps:
            raise ConflictError("Active workflow has no steps configured.")
        req = ApprovalRequest(
            workflow_id=workflow.id,
            entity_type=entity_type,
            entity_id=entity_id,
            status="pending",
            current_step=workflow.steps[0].step_order,
            payload=payload,
            created_by=created_by,
        )
        self._db.add(req)
        self._db.flush()
        self._create_tasks_for_step(req, workflow.steps[0])
        return req

    def _users_for_role(self, role_id: int) -> list[User]:
        stmt = (
            select(User)
            .select_from(user_role)
            .join(User, User.id == user_role.c.user_id)
            .where(user_role.c.role_id == role_id, User.is_active.is_(True))
            .order_by(User.id.asc())
        )
        return list(self._db.scalars(stmt).all())

    def _role_ids_for_user(self, user_id: int) -> set[int]:
        stmt = select(user_role.c.role_id).where(user_role.c.user_id == user_id)
        return {int(rid) for rid in self._db.execute(stmt).scalars().all()}

    def _create_tasks_for_step(self, req: ApprovalRequest, step: ApprovalStep) -> None:
        # Create a single group/role-assigned task. Any user in that role can act on it.
        role = self._db.get(Role, step.approver_role_id)
        if role is None:
            raise NotFoundError("Role", step.approver_role_id)
        # Keep a guardrail: if there are zero active users in the role, fail fast (same as legacy).
        if not self._users_for_role(step.approver_role_id):
            raise ConflictError("No active approvers found for the configured approver role.")
        task = ApprovalTask(
            request_id=req.id,
            step_id=step.id,
            assigned_user_id=None,
            assigned_role_id=step.approver_role_id,
            task_type="approval",
            title=f"Approval: {req.entity_type}",
            priority="medium",
            status="pending",
            acted_at=None,
            entity_type=req.entity_type,
            entity_id=req.entity_id,
            created_by=req.created_by,
            form_data=dict(req.payload) if req.payload is not None else None,
        )
        self._db.add(task)
        self._db.flush()
        # Unified task inbox audit + /tasks detail timeline.
        self._db.add(
            TaskAuditLog(
                task_id=int(task.id),
                action="created",
                actor_user_id=req.created_by,
                new_value={
                    "request_id": req.id,
                    "entity_type": req.entity_type,
                    "entity_id": req.entity_id,
                },
            )
        )

    def list_my_tasks(self, *, user_id: int) -> list[ApprovalTask]:
        role_ids = self._role_ids_for_user(user_id)
        stmt = select(ApprovalTask).where(
            or_(
                ApprovalTask.assigned_user_id == user_id,
                and_(ApprovalTask.assigned_role_id.is_not(None), ApprovalTask.assigned_role_id.in_(role_ids)),
            )
        ).order_by(ApprovalTask.id.desc())
        return list(self._db.scalars(stmt).all())

    def get_request(self, request_id: int) -> ApprovalRequest:
        req = self._db.scalar(
            select(ApprovalRequest)
            .where(ApprovalRequest.id == request_id)
            .options(selectinload(ApprovalRequest.tasks))
        )
        if req is None:
            raise NotFoundError("ApprovalRequest", request_id)
        return req

    def get_task(self, task_id: int) -> ApprovalTask:
        task = self._db.scalar(
            select(ApprovalTask)
            .where(ApprovalTask.id == task_id)
            .options(selectinload(ApprovalTask.step), selectinload(ApprovalTask.request))
        )
        if task is None:
            raise NotFoundError("ApprovalTask", task_id)
        return task

    def resubmit_rejected_request(self, *, request_id: int, actor_user_id: int) -> tuple[ApprovalRequest, int]:
        """
        After a reject, the submitter may edit the underlying entity and send the same approval
        request back through the workflow. Old tasks for this request are removed; step 1 restarts
        with a fresh approver task (same request id, new task id).
        """
        req = self._db.scalar(
            select(ApprovalRequest)
            .where(ApprovalRequest.id == request_id)
            .options(selectinload(ApprovalRequest.workflow).selectinload(ApprovalWorkflow.steps))
        )
        if req is None:
            raise NotFoundError("ApprovalRequest", request_id)
        if str(req.status) not in ("rejected", "in_rework"):
            raise ApprovalError("Only a rejected request can be resubmitted for approval.")

        actor = self._db.get(User, actor_user_id)
        if actor is None:
            raise NotFoundError("User", actor_user_id)
        if req.created_by != actor_user_id and not bool(actor.is_superuser):
            raise ApprovalError("Only the person who submitted this request can resubmit it.")

        if str(req.entity_type) != "user_creation":
            raise ApprovalError("Resubmit is only implemented for user-creation approvals.")

        user = self._db.scalar(
            select(User)
            .where(User.id == int(req.entity_id))
            .options(selectinload(User.roles), selectinload(User.org_units))
        )
        if user is None:
            raise NotFoundError("User", int(req.entity_id))

        # Preserve original temporary password across resubmits so the final "USER_CREATED"
        # email can still include the initial credential if the template requires it.
        prev_temp_password: str | None = None
        if isinstance(req.payload, dict):
            raw_prev = req.payload.get("temp_password")
            if isinstance(raw_prev, str) and raw_prev.strip():
                prev_temp_password = raw_prev

        req.payload = self._build_user_creation_payload(user)
        if prev_temp_password and isinstance(req.payload, dict) and not req.payload.get("temp_password"):
            req.payload["temp_password"] = prev_temp_password

        now = _now_utc()
        # Close any existing open rework tasks (and log resubmitted on them).
        open_rework = self._db.scalars(
            select(ApprovalTask).where(
                ApprovalTask.request_id == req.id,
                ApprovalTask.task_type == "rework",
                ApprovalTask.status.in_(("open", "pending")),
            )
        ).all()
        for t in open_rework:
            self._db.add(
                TaskAuditLog(
                    task_id=int(t.id),
                    action="resubmitted",
                    actor_user_id=actor_user_id,
                    new_value={"request_id": int(req.id)},
                )
            )
            t.status = "closed"
            t.closed_at = now

        # Close any leftover pending approval tasks from previous runs.
        pending_approvals = self._db.scalars(
            select(ApprovalTask).where(
                ApprovalTask.request_id == req.id,
                ApprovalTask.task_type == "approval",
                ApprovalTask.status == "pending",
            )
        ).all()
        for t in pending_approvals:
            t.status = "closed"
            t.closed_at = now

        self._db.flush()

        wf = req.workflow
        if wf is None or not wf.steps:
            raise ApprovalError("Workflow is missing for this request.")
        steps_sorted = sorted(wf.steps, key=lambda s: int(s.step_order))
        first = steps_sorted[0]
        req.status = "pending"
        req.current_step = int(first.step_order)
        req.last_resubmitted_at = now
        self._create_tasks_for_step(req, first)
        self._db.flush()
        new_task = self._db.scalar(
            select(ApprovalTask)
            .where(ApprovalTask.request_id == req.id)
            .order_by(ApprovalTask.id.desc())
            .limit(1)
        )
        if new_task is None:
            raise ApprovalError("Could not create a new approval task after resubmit.")
        self._db.add(
            TaskAuditLog(
                task_id=int(new_task.id),
                action="resubmitted",
                actor_user_id=actor_user_id,
                new_value={"request_id": int(req.id)},
            )
        )
        # Notify creator + peers (same role) that the request was resubmitted.
        try:
            self._notify_creator_and_peers(
                creator_user_id=int(req.created_by) if req.created_by is not None else actor_user_id,
                event_code="TASK_RESUBMITTED",
                payload={
                    "entity_name": self._entity_name_for_request(req),
                    "task_link": self._task_link(int(new_task.id)),
                },
            )
        except Exception:
            # Email notifications must not block resubmission.
            pass
        self._db.commit()
        reloaded = self.get_request(int(req.id))
        return reloaded, int(new_task.id)

    @staticmethod
    def _task_link(task_id: int) -> str:
        base = (os.environ.get("FRONTEND_APP_URL") or os.environ.get("FRONTEND_ORIGIN") or "http://localhost:5173").rstrip("/")
        return f"{base}/dashboard/tasks/{int(task_id)}"

    @staticmethod
    def _entity_name_for_request(req: ApprovalRequest) -> str:
        if isinstance(req.payload, dict):
            if req.entity_type == "user_creation":
                nm = req.payload.get("full_name")
                if isinstance(nm, str) and nm.strip():
                    return nm.strip()
        return f"{req.entity_type}:{req.entity_id}"

    def _notify_creator_and_peers(self, *, creator_user_id: int, event_code: str, payload: dict[str, Any]) -> None:
        """
        Send the same email to:
        - creator (mandatory)
        - all active users that share at least one RBAC role with creator
        """
        creator = self._db.get(User, int(creator_user_id))
        if creator is None:
            return

        # Find creator role ids.
        role_ids = {
            int(rid)
            for rid in self._db.execute(
                select(user_role.c.role_id).where(user_role.c.user_id == int(creator_user_id))
            ).scalars().all()
        }
        user_ids: set[int] = {int(creator_user_id)}
        if role_ids:
            peer_ids = self._db.execute(
                select(user_role.c.user_id).where(user_role.c.role_id.in_(role_ids))
            ).scalars().all()
            user_ids |= {int(uid) for uid in peer_ids if uid is not None}

        # Load active users with email.
        rows = self._db.scalars(
            select(User).where(User.id.in_(user_ids), User.is_active.is_(True))
        ).all()
        for u in rows:
            if not u.email:
                continue
            EmailNotificationService(self._db).trigger_event(
                event_code=event_code,
                payload={
                    "user_name": u.full_name,
                    "email": u.email,
                    **payload,
                },
            )

    @staticmethod
    def _build_user_creation_payload(user: User) -> dict[str, Any]:
        role = user.roles[0] if user.roles else None
        org = user.org_units[0] if user.org_units else None
        return {
            "action_code": "users.create",
            "full_name": user.full_name,
            "phone": user.phone,
            "email": user.email,
            "role_id": int(role.id) if role is not None else None,
            "org_unit_id": int(org.id) if org is not None else None,
        }

    def act_on_task(
        self,
        *,
        task_id: int,
        actor_user_id: int,
        action: str,
        comment: str | None,
    ) -> ApprovalRequest:
        task = self.get_task(task_id)
        role_ids = self._role_ids_for_user(actor_user_id)
        is_user_task = task.assigned_user_id is not None
        is_role_task = task.assigned_role_id is not None
        if is_user_task:
            if task.assigned_user_id != actor_user_id:
                raise ApprovalError("This task is not assigned to you.")
            if task.status != "pending":
                raise ApprovalError("This task has already been acted on.")
        elif is_role_task:
            if int(task.assigned_role_id) not in role_ids:
                raise ApprovalError("This task is not assigned to your role.")
            # For role/group tasks we allow multiple actors until the step threshold is met,
            # but we prevent duplicate actions from the same user.
            existing = self._db.scalar(
                select(ApprovalAction.id).where(
                    ApprovalAction.task_id == task.id,
                    ApprovalAction.user_id == actor_user_id,
                )
            )
            if existing is not None:
                raise ApprovalError("You have already acted on this task.")
            if task.status != "pending":
                raise ApprovalError("This task has already been completed.")
        else:
            raise ApprovalError("Task assignment is invalid (no assignee).")
        req = self.get_request(task.request_id)
        if req.status != "pending":
            raise ApprovalError("This approval request is no longer pending.")

        act = action.strip().lower()
        if act not in ("approve", "reject"):
            raise ConflictError("action must be one of: approve, reject.")

        # Persist the action record first; then update task/request status depending on task type.
        self._db.add(
            ApprovalAction(
                task_id=task.id,
                user_id=actor_user_id,
                action=act,
                comment=comment,
            )
        )
        # Unified task audit/comments (additive; does not affect approval engine logic).
        self._db.add(
            TaskAuditLog(
                task_id=int(task.id),
                action="rejected" if act == "reject" else "approved",
                actor_user_id=actor_user_id,
                new_value={"action": act},
            )
        )
        if comment:
            self._db.add(TaskComment(task_id=int(task.id), user_id=actor_user_id, comment=comment))
            self._db.add(
                TaskAuditLog(
                    task_id=int(task.id),
                    action="commented",
                    actor_user_id=actor_user_id,
                    new_value={"comment": comment},
                )
            )
        self._db.flush()

        if act == "reject":
            now = _now_utc()
            task.status = "rejected"
            task.acted_at = now

            # Move request into rework state (do not keep it "pending").
            req.status = "in_rework"

            # Close all still-pending approval tasks for this request (avoid multiple active items).
            pending = self._db.scalars(
                select(ApprovalTask).where(
                    ApprovalTask.request_id == req.id,
                    ApprovalTask.status == "pending",
                    ApprovalTask.id != task.id,
                )
            ).all()
            for t in pending:
                t.status = "closed"
                t.closed_at = now

            # Ensure only one open rework task exists.
            existing_rework = self._db.scalar(
                select(ApprovalTask.id).where(
                    ApprovalTask.request_id == req.id,
                    ApprovalTask.task_type == "rework",
                    ApprovalTask.status.in_(("open", "pending")),
                )
            )
            if existing_rework is None and req.created_by is not None:
                rework_task = ApprovalTask(
                    task_type="rework",
                    title="Rework required",
                    description=comment,
                    priority="medium",
                    entity_type=req.entity_type,
                    entity_id=req.entity_id,
                    created_by=req.created_by,
                    assigned_to_user_id=req.created_by,
                    assigned_user_id=req.created_by,
                    assigned_role_id=None,
                    status="open",
                    request_id=req.id,
                    step_id=None,
                )
                self._db.add(rework_task)
                self._db.flush()
                self._db.add(
                    TaskAuditLog(
                        task_id=int(rework_task.id),
                        action="created",
                        actor_user_id=req.created_by,
                        new_value={
                            "request_id": req.id,
                            "entity_type": req.entity_type,
                            "entity_id": req.entity_id,
                            "task_type": "rework",
                        },
                    )
                )
                self._db.add(
                    TaskAuditLog(
                        task_id=int(rework_task.id),
                        action="rework_started",
                        actor_user_id=actor_user_id,
                        new_value={"request_id": int(req.id)},
                    )
                )
                # Email creator + same-role peers.
                try:
                    self._notify_creator_and_peers(
                        creator_user_id=int(req.created_by),
                        event_code="TASK_REWORK_REQUIRED",
                        payload={
                            "entity_name": self._entity_name_for_request(req),
                            "rejection_reason": comment or "Rejected",
                            "task_link": self._task_link(int(rework_task.id)),
                        },
                    )
                except Exception:
                    pass

            self._db.commit()
            return self.get_request(req.id)

        # Approved: check whether the step has enough approvals.
        step = task.step
        assert step is not None
        if is_user_task:
            task.status = "approved"
            task.acted_at = _now_utc()
            approved_count = int(
                self._db.scalar(
                    select(func.count())
                    .select_from(ApprovalTask)
                    .where(
                        ApprovalTask.request_id == req.id,
                        ApprovalTask.step_id == step.id,
                        ApprovalTask.status == "approved",
                    )
                )
                or 0
            )
        else:
            # Role/group task: approvals are counted by distinct approval_actions on this task.
            approved_count = int(
                self._db.scalar(
                    select(func.count(func.distinct(ApprovalAction.user_id)))
                    .select_from(ApprovalAction)
                    .where(
                        ApprovalAction.task_id == task.id,
                        ApprovalAction.action == "approve",
                    )
                )
                or 0
            )
            if approved_count >= int(step.required_approvals):
                task.status = "approved"
                task.acted_at = _now_utc()
        if approved_count < int(step.required_approvals):
            self._db.commit()
            return self.get_request(req.id)

        wf = self._db.scalar(
            select(ApprovalWorkflow)
            .where(ApprovalWorkflow.id == req.workflow_id)
            .options(selectinload(ApprovalWorkflow.steps))
        )
        if wf is None:
            raise ApprovalError("Workflow not found for request.")

        steps_sorted = sorted(wf.steps, key=lambda s: s.step_order)
        idx = next((i for i, s in enumerate(steps_sorted) if s.id == step.id), None)
        if idx is None:
            raise ApprovalError("Step not found in workflow.")

        if idx == len(steps_sorted) - 1:
            # Final approval
            req.status = "approved"
            self._finalize_request(req)
            self._db.commit()
            return self.get_request(req.id)

        # Move to next step.
        next_step = steps_sorted[idx + 1]
        req.current_step = next_step.step_order
        self._create_tasks_for_step(req, next_step)
        self._db.commit()
        return self.get_request(req.id)

    def _finalize_request(self, req: ApprovalRequest) -> None:
        if req.entity_type == "user_creation":
            user = self._db.get(User, req.entity_id)
            if user is None:
                raise ApprovalError("Target user not found for approval request.")
            user.is_active = True
            # Trigger configurable email notification (template-driven).
            if user.email:
                payload: dict[str, Any] = {
                    "user_name": user.full_name,
                    "username": user.username,
                    "email": user.email,
                    "company_name": "Ultra Workspace",
                    # Always include keys used by templates; values may be blank.
                    "temp_password": "",
                    "setup_link": "",
                }
                # If the user was created with an auto-generated password, it is stored in the approval payload.
                try:
                    if isinstance(req.payload, dict) and req.payload.get("temp_password"):
                        payload["temp_password"] = str(req.payload.get("temp_password") or "")
                except Exception:
                    pass

                # If MFA is enabled by policy (and not completed), include setup link in the same email.
                try:
                    pol = get_global_policy(self._db)
                    if bool(pol.mfa_enabled):
                        # Reload for mfa_record if needed.
                        u2 = self._db.scalar(
                            select(User)
                            .where(User.id == int(user.id))
                            .options(selectinload(User.mfa_record))
                        )
                        if u2 is not None and (u2.mfa_record is None or not bool(u2.mfa_record.setup_completed)):
                            link = create_mfa_setup_link(self._db, user=u2)
                            if link:
                                payload["setup_link"] = link
                except Exception:
                    pass

                EmailNotificationService(self._db).trigger_event(
                    event_code="USER_CREATED",
                    payload=payload,
                )
            # Avoid sending a second MFA email when the setup link was already included above.
            if not (isinstance(payload, dict) and payload.get("setup_link")):
                maybe_send_mfa_setup_for_user(self._db, user)
            return

        if req.entity_type == "contractor_creation":
            from modules.contractor.models import Contractor

            contractor = self._db.get(Contractor, int(req.entity_id))
            if contractor is None:
                raise ApprovalError("Target contractor not found for approval request.")
            contractor.is_active = True
            return

