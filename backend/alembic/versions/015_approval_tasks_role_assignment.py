"""approval_tasks: support role/group assignment

Revision ID: 015
Revises: 014
Create Date: 2026-04-22
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "015"
down_revision: str | None = "014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Allow role/group tasks by making assigned_user_id optional and adding assigned_role_id.
    op.alter_column("approval_tasks", "assigned_user_id", existing_type=sa.Integer(), nullable=True)
    op.add_column("approval_tasks", sa.Column("assigned_role_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_approval_tasks_assigned_role_id_roles",
        "approval_tasks",
        "roles",
        ["assigned_role_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_approval_tasks_assigned_role_id",
        "approval_tasks",
        ["assigned_role_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_approval_tasks_assigned_role_id", table_name="approval_tasks")
    op.drop_constraint(
        "fk_approval_tasks_assigned_role_id_roles",
        "approval_tasks",
        type_="foreignkey",
    )
    op.drop_column("approval_tasks", "assigned_role_id")
    op.alter_column("approval_tasks", "assigned_user_id", existing_type=sa.Integer(), nullable=False)

