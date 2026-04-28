"""RBAC audit logs + permission cache version rows.

Revision ID: 012
Revises: 011
Create Date: 2026-04-21
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "012"
down_revision: str | None = "011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "rbac_audit_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("target_type", sa.String(length=32), nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("old_value", sa.JSON(), nullable=True),
        sa.Column("new_value", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "rbac_company_permission_versions",
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("company_id"),
    )
    op.create_table(
        "rbac_user_permission_versions",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.execute(
        sa.text(
            "INSERT INTO rbac_company_permission_versions (company_id, version) "
            "SELECT 1, 0 WHERE NOT EXISTS (SELECT 1 FROM rbac_company_permission_versions WHERE company_id = 1)"
        )
    )


def downgrade() -> None:
    op.drop_table("rbac_user_permission_versions")
    op.drop_table("rbac_company_permission_versions")
    op.drop_table("rbac_audit_logs")
