"""Ensure ``work_orders.create`` approval routing for demo databases.

Maps the permission (after RBAC sync) to a single-step workflow whose step-1 role
matches the provided ``approver_role``. Deactivates other mappings for that
action so ``get_workflow_for_action`` resolves deterministically (demo-only).

Production deployments should configure workflows via Admin; this helper is meant
for ``seed_demo_users.py`` and related demo tooling.
"""

from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

import db.models  # noqa: F401 — register models
from modules.approvals.assignment_service import resolve_registered_action_code
from modules.approvals.model import (
    ApprovalRequest,
    ApprovalStep,
    ApprovalTask,
    ApprovalWorkflow,
    ApprovalWorkflowMapping,
)
from modules.roles.model import Role


def repoint_pending_work_order_approval_tasks(db: Session, *, approver_role_id: int) -> int:
    """Fix inbox drift after changing workflow step roles (demo / local DB)."""
    tasks = list(
        db.scalars(
            select(ApprovalTask)
            .join(ApprovalRequest, ApprovalRequest.id == ApprovalTask.request_id)
            .where(
                ApprovalTask.task_type == "approval",
                ApprovalTask.status.in_(("open", "pending", "in_progress")),
                ApprovalRequest.entity_type == "work_order_approval",
                ApprovalRequest.status == "pending",
            )
        ).all()
    )
    rid = int(approver_role_id)
    updated = 0
    for t in tasks:
        if t.assigned_role_id != rid:
            t.assigned_role_id = rid
            updated += 1
    return updated


def ensure_work_orders_create_workflow(
    db: Session,
    *,
    approver_role: Role,
    workflow_name: str = "TiM Demo: work_orders.create",
    entity_type: str = "work_order_approval",
) -> bool:
    """
    Upsert demo workflow + active mapping for ``work_orders.create``.

    Returns ``False`` if the permission catalog has no ``work_orders.create`` row yet.
    """
    canonical = resolve_registered_action_code(db, "work_orders.create")
    if canonical is None:
        return False

    wf = db.scalar(
        select(ApprovalWorkflow).where(
            ApprovalWorkflow.entity_type == entity_type,
            ApprovalWorkflow.name == workflow_name,
        )
    )
    if wf is None:
        wf = ApprovalWorkflow(
            name=workflow_name,
            entity_type=entity_type,
            is_active=True,
            created_by=None,
        )
        db.add(wf)
        db.flush()

    wf.is_active = True
    db.execute(delete(ApprovalStep).where(ApprovalStep.workflow_id == int(wf.id)))
    db.add(
        ApprovalStep(
            workflow_id=int(wf.id),
            step_order=1,
            approver_role_id=int(approver_role.id),
            required_approvals=1,
        )
    )
    db.flush()

    mappings = list(
        db.scalars(select(ApprovalWorkflowMapping).where(ApprovalWorkflowMapping.action_code == canonical)).all()
    )
    our_id = int(wf.id)
    activated = False
    for m in mappings:
        m.is_active = int(m.workflow_id) == our_id
        if m.is_active:
            activated = True
    if not activated:
        db.add(
            ApprovalWorkflowMapping(action_code=canonical, workflow_id=our_id, is_active=True)
        )

    repoint_pending_work_order_approval_tasks(db, approver_role_id=int(approver_role.id))
    db.commit()
    return True
