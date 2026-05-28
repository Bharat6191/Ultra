"""Ensure ``work_orders.create`` approval routing for demo databases.

Maps the permission (after RBAC sync) to a workflow with one or two steps:

* Step 1: ``approver_role_l1`` (e.g. operations L1 inbox).
* Step 2 (optional): ``approver_role_l2`` (e.g. finance / plant head).

Deactivates other mappings for that action so ``get_workflow_for_action`` resolves
deterministically (demo-only).

Production deployments should configure workflows via Admin; this helper is meant
for ``seed_demo_users.py`` and related demo tooling.
"""

from __future__ import annotations

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session, selectinload

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


def repoint_pending_work_order_approval_tasks(db: Session) -> int:
    """Align open WO approval tasks with each step's configured role (multi-step safe)."""
    tasks = list(
        db.scalars(
            select(ApprovalTask)
            .join(ApprovalRequest, ApprovalRequest.id == ApprovalTask.request_id)
            .options(selectinload(ApprovalTask.step))
            .where(
                ApprovalTask.task_type == "approval",
                ApprovalTask.status.in_(("open", "pending", "in_progress")),
                ApprovalRequest.entity_type == "work_order_approval",
                ApprovalRequest.status == "pending",
            )
        ).all()
    )
    updated = 0
    for t in tasks:
        if t.step is None:
            continue
        rid = int(t.step.approver_role_id)
        if t.assigned_role_id != rid:
            t.assigned_role_id = rid
            updated += 1
    return updated


def ensure_work_orders_create_workflow(
    db: Session,
    *,
    approver_role_l1: Role,
    approver_role_l2: Role | None = None,
    workflow_name: str = "TiM Demo: work_orders.create",
    entity_type: str = "work_order_approval",
) -> bool:
    """
    Upsert demo workflow + active mapping for ``work_orders.create``.

    If ``approver_role_l2`` is set, configures two approval levels (L1 then L2).
    Otherwise a single-step workflow (L1 only).

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
            approver_role_id=int(approver_role_l1.id),
            required_approvals=1,
        )
    )
    if approver_role_l2 is not None:
        db.add(
            ApprovalStep(
                workflow_id=int(wf.id),
                step_order=2,
                approver_role_id=int(approver_role_l2.id),
                required_approvals=1,
            )
        )
    db.flush()

    mappings = list(
        db.scalars(select(ApprovalWorkflowMapping).where(ApprovalWorkflowMapping.action_code == canonical)).all()
    )
    our_id = int(wf.id)
    target_mapping = next((m for m in mappings if int(m.workflow_id) == our_id), None)

    db.execute(
        update(ApprovalWorkflowMapping)
        .where(ApprovalWorkflowMapping.action_code == canonical)
        .values(is_active=False)
    )
    db.flush()

    if target_mapping is None:
        db.add(
            ApprovalWorkflowMapping(action_code=canonical, workflow_id=our_id, is_active=True)
        )
    else:
        target_mapping.is_active = True

    repoint_pending_work_order_approval_tasks(db)
    db.commit()
    return True
