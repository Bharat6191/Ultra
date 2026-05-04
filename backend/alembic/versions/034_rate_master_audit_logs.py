"""Rate master audit log table.

Adds:
  * ``rate_master_audit_logs`` — captures CREATED / UPDATED / ACTIVATED /
    DEACTIVATED / SUPERSEDED actions on ``rate_master`` rows.

Revision ID: 034
Revises: 033
Create Date: 2026-05-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "034"
down_revision: str | None = "033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _now_default() -> sa.sql.elements.TextClause:
    return sa.text("now()")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names())

    if "rate_master_audit_logs" not in existing:
        op.create_table(
            "rate_master_audit_logs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "rate_master_id",
                sa.Integer(),
                sa.ForeignKey("rate_master.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("action", sa.String(length=64), nullable=False),
            sa.Column(
                "changed_by",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("old_value", sa.JSON(), nullable=True),
            sa.Column("new_value", sa.JSON(), nullable=True),
            sa.Column("metadata_json", sa.JSON(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=_now_default(),
                nullable=False,
            ),
        )
        op.create_index(
            "ix_rate_master_audit_logs_rate_master_id",
            "rate_master_audit_logs",
            ["rate_master_id"],
            unique=False,
        )
        op.create_index(
            "ix_rate_master_audit_logs_action",
            "rate_master_audit_logs",
            ["action"],
            unique=False,
        )
        op.create_index(
            "ix_rate_master_audit_logs_created_at",
            "rate_master_audit_logs",
            ["created_at"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names())

    if "rate_master_audit_logs" in existing:
        op.drop_index(
            "ix_rate_master_audit_logs_created_at",
            table_name="rate_master_audit_logs",
        )
        op.drop_index(
            "ix_rate_master_audit_logs_action",
            table_name="rate_master_audit_logs",
        )
        op.drop_index(
            "ix_rate_master_audit_logs_rate_master_id",
            table_name="rate_master_audit_logs",
        )
        op.drop_table("rate_master_audit_logs")
