from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

WorkflowStepPhase = Literal["completed", "current", "upcoming", "rejected"]


TaskType = Literal["approval", "manual", "rework"]
TaskPriority = Literal["low", "medium", "high"]
TaskStatus = Literal["open", "in_progress", "completed", "rejected", "closed", "pending", "approved"]


class TaskInboxItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_type: TaskType
    title: str | None = None
    priority: str | None = None
    status: str
    assigned_to_user_id: int | None = None
    due_date: datetime | None = None

    # Context for approvals (optional)
    request_id: int | None = None
    step_id: int | None = None
    entity_type: str | None = None
    entity_id: int | None = None


class TaskCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=50_000)
    assigned_to: int = Field(ge=1)
    priority: TaskPriority = "medium"
    due_date: datetime | None = None
    entity_type: str | None = Field(default=None, max_length=64)
    entity_id: int | None = Field(default=None, ge=1)
    form_schema: dict[str, Any] | None = None
    form_data: dict[str, Any] | None = None


class TaskAssignRequest(BaseModel):
    assigned_to: int = Field(ge=1)


class TaskCommentCreateRequest(BaseModel):
    comment: str = Field(min_length=1, max_length=10_000)


class TaskAuditLogPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    action: str
    actor_user_id: int | None = None
    actor_display_name: str | None = None
    old_value: dict[str, Any] | None = None
    new_value: dict[str, Any] | None = None
    created_at: datetime | None = None


class TaskCommentPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    user_display_name: str | None = None
    comment: str
    created_at: datetime | None = None


class TaskApprovalActionLinePublic(BaseModel):
    """One approver action on a workflow step (approve / reject with optional note)."""

    actor_user_id: int
    actor_display_name: str
    action: str
    comment: str | None = None
    created_at: datetime | None = None


class TaskApprovalStepLinePublic(BaseModel):
    """One row in the visual approval workflow (per configured step)."""

    step_order: int
    approver_role_name: str
    required_approvals: int
    total_steps: int
    phase: WorkflowStepPhase
    approved_count: int
    actions: list[TaskApprovalActionLinePublic] = Field(default_factory=list)
    # Short label for the left column, e.g. "Awaiting IT · 1/2"
    status_label: str
    # Active users who can approve this step (members of approver_role_id).
    pool_size: int = 0
    # First N names from that pool (when pool_size > len, UI may show "+ more").
    pool_member_names: list[str] = Field(default_factory=list)


class TaskApprovalContextPublic(BaseModel):
    """Enriched view of the backing approval request + current step (approval tasks only)."""

    request_id: int
    entity_type: str
    entity_id: int
    status: str
    current_step: int
    created_by: int | None
    payload: dict[str, Any] = Field(default_factory=dict)
    step_order: int | None = None
    approver_role_id: int | None = None
    approver_role_name: str | None = None
    required_approvals: int | None = None
    created_by_display_name: str | None = None
    # Full workflow, for vertical timeline UI (all steps, phases, and per-step actions).
    workflow_steps: list[TaskApprovalStepLinePublic] = Field(default_factory=list)


class TaskDetailPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_type: str
    title: str | None = None
    description: str | None = None
    priority: str | None = None
    status: str
    due_date: datetime | None = None
    created_by: int | None = None
    assigned_to_user_id: int | None = None

    entity_type: str | None = None
    entity_id: int | None = None
    form_schema: dict[str, Any] | None = None
    form_data: dict[str, Any] | None = None

    request_id: int | None = None
    step_id: int | None = None

    # Present when task_type == "approval" and the request is loaded.
    approval: TaskApprovalContextPublic | None = None

    comments: list[TaskCommentPublic] = Field(default_factory=list)
    audit_logs: list[TaskAuditLogPublic] = Field(default_factory=list)

