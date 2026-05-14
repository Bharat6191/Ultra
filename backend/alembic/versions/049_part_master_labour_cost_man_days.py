"""Part Master: commercial labour cost and man-days for rate-per-kg derivation.

Revision ID: 049
Revises: 048
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine.reflection import Inspector


revision: str = "049"
down_revision: str | None = "048"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _insp() -> Inspector:
    return sa.inspect(op.get_bind())


def upgrade() -> None:
    insp = _insp()
    if "part_master" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("part_master")}
    if "labour_cost" not in cols:
        op.add_column(
            "part_master",
            sa.Column("labour_cost", sa.Numeric(14, 2), nullable=True),
        )
    if "man_days" not in cols:
        op.add_column(
            "part_master",
            sa.Column("man_days", sa.Numeric(14, 4), nullable=True),
        )


def downgrade() -> None:
    insp = _insp()
    if "part_master" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("part_master")}
    if "man_days" in cols:
        op.drop_column("part_master", "man_days")
    if "labour_cost" in cols:
        op.drop_column("part_master", "labour_cost")
