"""Unified tasks module (manual + approval tasks).

Revision ID: 016
Revises: 015
Create Date: 2026-04-24
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "016"
down_revision: str | None = "015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Extend approval_tasks to serve as a generic tasks table.
    # For manual tasks, approval linkage is absent.
    op.alter_column("approval_tasks", "request_id", existing_type=sa.Integer(), nullable=True)
    op.alter_column("approval_tasks", "step_id", existing_type=sa.Integer(), nullable=True)

    op.add_column(
        "approval_tasks",
        sa.Column(
            "task_type",
            sa.String(length=16),
            nullable=False,
            server_default="approval",
        ),
    )
    op.add_column("approval_tasks", sa.Column("title", sa.String(length=255), nullable=True))
    op.add_column("approval_tasks", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("approval_tasks", sa.Column("entity_type", sa.String(length=64), nullable=True))
    op.add_column("approval_tasks", sa.Column("entity_id", sa.Integer(), nullable=True))
    op.add_column("approval_tasks", sa.Column("form_schema", sa.JSON(), nullable=True))
    op.add_column("approval_tasks", sa.Column("form_data", sa.JSON(), nullable=True))
    op.add_column(
        "approval_tasks",
        sa.Column(
            "priority",
            sa.String(length=16),
            nullable=False,
            server_default="medium",
        ),
    )
    op.add_column("approval_tasks", sa.Column("due_date", sa.DateTime(timezone=True), nullable=True))
    op.add_column("approval_tasks", sa.Column("created_by", sa.Integer(), nullable=True))
    op.add_column("approval_tasks", sa.Column("assigned_to_user_id", sa.Integer(), nullable=True))
    op.add_column("approval_tasks", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True))

    op.create_foreign_key(
        "fk_approval_tasks_created_by_users",
        "approval_tasks",
        "users",
        ["created_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_approval_tasks_assigned_to_user_id_users",
        "approval_tasks",
        "users",
        ["assigned_to_user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_index("ix_approval_tasks_task_type", "approval_tasks", ["task_type"])
    op.create_index("ix_approval_tasks_priority", "approval_tasks", ["priority"])
    op.create_index("ix_approval_tasks_due_date", "approval_tasks", ["due_date"])
    op.create_index(
        "ix_approval_tasks_assignee_status",
        "approval_tasks",
        ["assigned_to_user_id", "status"],
    )

    # Comments for all task types.
    op.create_table(
        "task_comments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
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
    op.create_index("ix_task_comments_task_id", "task_comments", ["task_id"])
    op.create_index("ix_task_comments_user_id", "task_comments", ["user_id"])

    # Audit log for tasks (assignment, status, approvals, comments, form updates).
    op.create_table(
        "task_audit_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("old_value", sa.JSON(), nullable=True),
        sa.Column("new_value", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["task_id"], ["approval_tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_task_audit_logs_task_id", "task_audit_logs", ["task_id"])
    op.create_index("ix_task_audit_logs_actor_user_id", "task_audit_logs", ["actor_user_id"])

    # Drop server defaults now that existing rows are backfilled.
    op.alter_column("approval_tasks", "task_type", server_default=None)
    op.alter_column("approval_tasks", "priority", server_default=None)


def downgrade() -> None:
    # Restore approval linkage as required.
    op.alter_column("approval_tasks", "step_id", existing_type=sa.Integer(), nullable=False)
    op.alter_column("approval_tasks", "request_id", existing_type=sa.Integer(), nullable=False)

    op.drop_index("ix_task_audit_logs_actor_user_id", table_name="task_audit_logs")
    op.drop_index("ix_task_audit_logs_task_id", table_name="task_audit_logs")
    op.drop_table("task_audit_logs")

    op.drop_index("ix_task_comments_user_id", table_name="task_comments")
    op.drop_index("ix_task_comments_task_id", table_name="task_comments")
    op.drop_table("task_comments")

    op.drop_index("ix_approval_tasks_assignee_status", table_name="approval_tasks")
    op.drop_index("ix_approval_tasks_due_date", table_name="approval_tasks")
    op.drop_index("ix_approval_tasks_priority", table_name="approval_tasks")
    op.drop_index("ix_approval_tasks_task_type", table_name="approval_tasks")

    op.drop_constraint("fk_approval_tasks_assigned_to_user_id_users", "approval_tasks", type_="foreignkey")
    op.drop_constraint("fk_approval_tasks_created_by_users", "approval_tasks", type_="foreignkey")

    op.drop_column("approval_tasks", "closed_at")
    op.drop_column("approval_tasks", "assigned_to_user_id")
    op.drop_column("approval_tasks", "created_by")
    op.drop_column("approval_tasks", "due_date")
    op.drop_column("approval_tasks", "priority")
    op.drop_column("approval_tasks", "form_data")
    op.drop_column("approval_tasks", "form_schema")
    op.drop_column("approval_tasks", "entity_id")
    op.drop_column("approval_tasks", "entity_type")
    op.drop_column("approval_tasks", "description")
    op.drop_column("approval_tasks", "title")
    op.drop_column("approval_tasks", "task_type")

