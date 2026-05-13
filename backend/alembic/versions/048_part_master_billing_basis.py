"""Part Master: explicit billing_basis and manual amount override flag.

Revision ID: 048
Revises: 047
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine.reflection import Inspector


revision: str = "048"
down_revision: str | None = "047"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _insp() -> Inspector:
    return sa.inspect(op.get_bind())


def upgrade() -> None:
    insp = _insp()
    if "part_master" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("part_master")}
    if "billing_basis" not in cols:
        op.add_column(
            "part_master",
            sa.Column("billing_basis", sa.String(length=16), nullable=False, server_default="PCS"),
        )
    if "allow_manual_amount_override" not in cols:
        op.add_column(
            "part_master",
            sa.Column("allow_manual_amount_override", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
    op.execute(
        sa.text(
            """
            UPDATE part_master
            SET billing_basis = 'WEIGHT'
            WHERE lower(pricing_method) = 'weight_based'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE part_master
            SET billing_basis = 'PCS'
            WHERE lower(pricing_method) = 'piece_based'
            """
        )
    )


def downgrade() -> None:
    insp = _insp()
    if "part_master" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("part_master")}
    if "allow_manual_amount_override" in cols:
        op.drop_column("part_master", "allow_manual_amount_override")
    if "billing_basis" in cols:
        op.drop_column("part_master", "billing_basis")
