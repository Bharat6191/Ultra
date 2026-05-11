"""Drop priority column from approval_tasks.

Revision ID: 041
Revises: 040
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "041"
down_revision: str | None = "040"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_approval_tasks_priority", table_name="approval_tasks")
    op.drop_column("approval_tasks", "priority")


def downgrade() -> None:
    op.add_column(
        "approval_tasks",
        sa.Column("priority", sa.String(length=16), nullable=False, server_default="medium"),
    )
    op.create_index("ix_approval_tasks_priority", "approval_tasks", ["priority"])
    op.alter_column("approval_tasks", "priority", server_default=None)
