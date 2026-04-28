from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


class ApprovalWorkflow(Base):
    __tablename__ = "approval_workflows"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    created_by: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    steps = relationship(
        "ApprovalStep",
        back_populates="workflow",
        cascade="all, delete-orphan",
        order_by="ApprovalStep.step_order.asc()",
        lazy="selectin",
    )
    workflow_mappings = relationship(
        "ApprovalWorkflowMapping",
        back_populates="workflow",
        lazy="selectin",
    )

    __table_args__ = (
        # Enforce unique active workflow per entity_type via service logic (partial unique
        # indexes vary by DB); keep a plain helper index here.
        UniqueConstraint("entity_type", "name", name="uq_approval_workflows_entity_type_name"),
    )


class ApprovalWorkflowMapping(Base):
    """Maps an RBAC permission code (action) to an approval workflow."""

    __tablename__ = "approval_workflow_mappings"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    action_code: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    workflow_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("approval_workflows.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    workflow = relationship("ApprovalWorkflow", back_populates="workflow_mappings")


class ApprovalStep(Base):
    __tablename__ = "approval_steps"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    workflow_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("approval_workflows.id", ondelete="CASCADE"),
        index=True,
    )
    step_order: Mapped[int] = mapped_column(Integer, nullable=False)
    approver_role_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("roles.id", ondelete="RESTRICT"),
        nullable=False,
    )
    required_approvals: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")

    workflow = relationship("ApprovalWorkflow", back_populates="steps")

    __table_args__ = (
        UniqueConstraint("workflow_id", "step_order", name="uq_approval_steps_workflow_step_order"),
    )


class ApprovalRequest(Base):
    __tablename__ = "approval_requests"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    workflow_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("approval_workflows.id", ondelete="RESTRICT"),
        index=True,
    )
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="pending")
    current_step: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_by: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_resubmitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    workflow = relationship("ApprovalWorkflow", lazy="selectin")
    tasks = relationship(
        "ApprovalTask",
        back_populates="request",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    __table_args__ = (
        UniqueConstraint(
            "entity_type",
            "entity_id",
            "status",
            name="uq_approval_requests_entity_status",
        ),
    )


class ApprovalTask(Base):
    __tablename__ = "approval_tasks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # Unified task fields (approval + manual). For legacy approval tasks, these may be null.
    task_type: Mapped[str] = mapped_column(String(16), nullable=False, server_default="approval")
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    entity_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    form_schema: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    form_data: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    priority: Mapped[str] = mapped_column(String(16), nullable=False, server_default="medium")
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # Generic assignment for unified inbox. Approval engine still uses assigned_user_id/assigned_role_id.
    assigned_to_user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    request_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("approval_requests.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    step_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("approval_steps.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    # Assignment can be either user-specific (legacy) or role/group-based (new).
    assigned_user_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    assigned_role_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("roles.id", ondelete="RESTRICT"),
        index=True,
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="pending")
    acted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    request = relationship("ApprovalRequest", back_populates="tasks")
    step = relationship("ApprovalStep", lazy="selectin")
    actions = relationship(
        "ApprovalAction",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    comments = relationship(
        "TaskComment",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    audit_logs = relationship(
        "TaskAuditLog",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class ApprovalAction(Base):
    __tablename__ = "approval_actions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("approval_tasks.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    action: Mapped[str] = mapped_column(String(16), nullable=False)  # approve|reject
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    task = relationship("ApprovalTask", back_populates="actions")


class TaskComment(Base):
    __tablename__ = "task_comments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("approval_tasks.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    task = relationship("ApprovalTask", back_populates="comments")


class TaskAuditLog(Base):
    __tablename__ = "task_audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("approval_tasks.id", ondelete="CASCADE"),
        index=True,
    )
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    old_value: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    new_value: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    task = relationship("ApprovalTask", back_populates="audit_logs")

