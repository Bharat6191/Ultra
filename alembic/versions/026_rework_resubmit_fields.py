"""Add in_rework + last_resubmitted_at and support rework tasks.

Revision ID: 026
Revises: 025
Create Date: 2026-04-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "026"
down_revision: str | None = "025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    cols = {c["name"] for c in insp.get_columns("approval_requests")}
    if "last_resubmitted_at" not in cols:
        op.add_column("approval_requests", sa.Column("last_resubmitted_at", sa.DateTime(timezone=True), nullable=True))
        op.create_index("ix_approval_requests_last_resubmitted_at", "approval_requests", ["last_resubmitted_at"])

    # approval_tasks.task_type already exists; we just rely on new value "rework".


def downgrade() -> None:
    op.drop_index("ix_approval_requests_last_resubmitted_at", table_name="approval_requests", if_exists=True)
    op.drop_column("approval_requests", "last_resubmitted_at")

