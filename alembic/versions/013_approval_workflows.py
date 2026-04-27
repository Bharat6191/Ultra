"""Approval workflows engine tables.

Revision ID: 013
Revises: 012
Create Date: 2026-04-21
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "013"
down_revision: str | None = "012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "approval_workflows",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("entity_type", "name", name="uq_approval_workflows_entity_type_name"),
    )
    op.create_index("ix_approval_workflows_entity_type", "approval_workflows", ["entity_type"])

    op.create_table(
        "approval_steps",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("workflow_id", sa.Integer(), nullable=False),
        sa.Column("step_order", sa.Integer(), nullable=False),
        sa.Column("approver_role_id", sa.Integer(), nullable=False),
        sa.Column("required_approvals", sa.Integer(), server_default="1", nullable=False),
        sa.ForeignKeyConstraint(["workflow_id"], ["approval_workflows.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["approver_role_id"], ["roles.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workflow_id", "step_order", name="uq_approval_steps_workflow_step_order"
        ),
    )
    op.create_index("ix_approval_steps_workflow_id", "approval_steps", ["workflow_id"])

    op.create_table(
        "approval_requests",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("workflow_id", sa.Integer(), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("current_step", sa.Integer(), server_default="1", nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["workflow_id"], ["approval_workflows.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "entity_type",
            "entity_id",
            "status",
            name="uq_approval_requests_entity_status",
        ),
    )
    op.create_index("ix_approval_requests_workflow_id", "approval_requests", ["workflow_id"])
    op.create_index("ix_approval_requests_entity_type", "approval_requests", ["entity_type"])
    op.create_index("ix_approval_requests_entity_id", "approval_requests", ["entity_id"])

    op.create_table(
        "approval_tasks",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("request_id", sa.Integer(), nullable=False),
        sa.Column("step_id", sa.Integer(), nullable=False),
        sa.Column("assigned_user_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("acted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["request_id"], ["approval_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["step_id"], ["approval_steps.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assigned_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_approval_tasks_request_id", "approval_tasks", ["request_id"])
    op.create_index("ix_approval_tasks_step_id", "approval_tasks", ["step_id"])
    op.create_index("ix_approval_tasks_assigned_user_id", "approval_tasks", ["assigned_user_id"])

    op.create_table(
        "approval_actions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["task_id"], ["approval_tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_approval_actions_task_id", "approval_actions", ["task_id"])
    op.create_index("ix_approval_actions_user_id", "approval_actions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_approval_actions_user_id", table_name="approval_actions")
    op.drop_index("ix_approval_actions_task_id", table_name="approval_actions")
    op.drop_table("approval_actions")

    op.drop_index("ix_approval_tasks_assigned_user_id", table_name="approval_tasks")
    op.drop_index("ix_approval_tasks_step_id", table_name="approval_tasks")
    op.drop_index("ix_approval_tasks_request_id", table_name="approval_tasks")
    op.drop_table("approval_tasks")

    op.drop_index("ix_approval_requests_entity_id", table_name="approval_requests")
    op.drop_index("ix_approval_requests_entity_type", table_name="approval_requests")
    op.drop_index("ix_approval_requests_workflow_id", table_name="approval_requests")
    op.drop_table("approval_requests")

    op.drop_index("ix_approval_steps_workflow_id", table_name="approval_steps")
    op.drop_table("approval_steps")

    op.drop_index("ix_approval_workflows_entity_type", table_name="approval_workflows")
    op.drop_table("approval_workflows")

