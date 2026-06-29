from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


ApprovalEntityType = Literal["user_creation"]
ApprovalRequestStatus = Literal["pending", "approved", "rejected", "in_rework"]
ApprovalTaskStatus = Literal["pending", "approved", "rejected", "open", "closed"]
ApprovalActionType = Literal["approve", "reject"]


class ApprovalWorkflowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    entity_type: str = Field(min_length=1, max_length=64)
    is_active: bool = False


class ApprovalWorkflowPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    entity_type: str
    is_active: bool
    created_by: int | None
    created_at: datetime


class ApprovalStepCreate(BaseModel):
    step_order: int = Field(ge=1)
    approver_role_id: int = Field(ge=1)
    required_approvals: int = Field(default=1, ge=1)


class ApprovalStepPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workflow_id: int
    step_order: int
    approver_role_id: int
    required_approvals: int


class ApprovalWorkflowDetail(ApprovalWorkflowPublic):
    steps: list[ApprovalStepPublic] = Field(default_factory=list)


class ApprovalRequestPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workflow_id: int
    entity_type: str
    entity_id: int
    status: str
    current_step: int
    payload: dict[str, Any]
    created_by: int | None
    created_at: datetime


class ResubmitRejectedResponse(BaseModel):
    """Same approval request id; a new first-step approver task id after resubmit."""

    request_id: int
    new_task_id: int
    status: str = "pending"


class ApprovalTaskPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    request_id: int
    step_id: int
    assigned_user_id: int | None
    status: str
    acted_at: datetime | None


class ApprovalTaskActionRequest(BaseModel):
    action: ApprovalActionType
    comment: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10_000)]


class WorkflowMappingCreate(BaseModel):
    action_code: str = Field(min_length=1, max_length=128)
    workflow_id: int = Field(ge=1)


class WorkflowMappingPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    action_code: str
    workflow_id: int
    workflow_name: str | None = None
    is_active: bool
    created_at: datetime


class PermissionActionOption(BaseModel):
    code: str
    feature_key: str
    feature_name: str


class MyApprovalTaskItem(BaseModel):
    """Enriched inbox row for ``GET /approvals/my-tasks``."""

    task_id: int
    request_id: int
    entity_type: str
    entity_id: int
    action_code: str
    action_label: str | None = None
    current_step: int
    total_steps: int
    step_order: int
    step_name: str | None = None
    created_by: int | None = None
    created_by_name: str | None = None
    created_at: datetime
    payload_preview: dict[str, Any] = Field(default_factory=dict)
    status: str


class ApprovalRequestStatusPublic(BaseModel):
    request_id: int
    request_status: str
    current_step: int
    total_steps: int
    pending_approvers: list[str] = Field(default_factory=list)
    approved_count: int
    required_approvals: int


class ApprovalRequestStatusStepPublic(BaseModel):
    step_order: int
    role_name: str | None = None
    required_approvals: int
    approved_by: list[str] = Field(default_factory=list)
    pending: list[str] = Field(default_factory=list)


class ApprovalRequestStatusDetailPublic(ApprovalRequestStatusPublic):
    steps: list[ApprovalRequestStatusStepPublic] = Field(default_factory=list)


class ApprovalTaskCommentRequest(BaseModel):
    comment: str = Field(min_length=1, max_length=10_000)
