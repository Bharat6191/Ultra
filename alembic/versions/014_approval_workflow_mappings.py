"""approval_workflow_mappings: action_code -> workflow

Revision ID: 014
Revises: 013
Create Date: 2026-04-21
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "014"
down_revision: str | None = "013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "approval_workflow_mappings",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("action_code", sa.String(length=128), nullable=False),
        sa.Column("workflow_id", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["workflow_id"], ["approval_workflows.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_approval_workflow_mappings_action_code", "approval_workflow_mappings", ["action_code"])
    op.create_index("ix_approval_workflow_mappings_workflow_id", "approval_workflow_mappings", ["workflow_id"])
    op.create_index(
        "uq_approval_workflow_mappings_active_action",
        "approval_workflow_mappings",
        ["action_code"],
        unique=True,
        postgresql_where=sa.text("is_active IS TRUE"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_approval_workflow_mappings_active_action",
        table_name="approval_workflow_mappings",
    )
    op.drop_index("ix_approval_workflow_mappings_workflow_id", table_name="approval_workflow_mappings")
    op.drop_index("ix_approval_workflow_mappings_action_code", table_name="approval_workflow_mappings")
    op.drop_table("approval_workflow_mappings")
