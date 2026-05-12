"""Part master: labour headcount and standard man-hours.

Revision ID: 044
Revises: 043
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "044"
down_revision: str | None = "043"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("part_master", sa.Column("labour_headcount", sa.Integer(), nullable=True))
    op.add_column(
        "part_master",
        sa.Column("standard_man_hours", sa.Numeric(10, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("part_master", "standard_man_hours")
    op.drop_column("part_master", "labour_headcount")
