"""Work orders: frozen approved_value_total for invoice caps.

Revision ID: 047
Revises: 046
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine.reflection import Inspector


revision: str = "047"
down_revision: str | None = "046"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _insp() -> Inspector:
    return sa.inspect(op.get_bind())


def upgrade() -> None:
    insp = _insp()
    if "work_orders" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("work_orders")}
    if "approved_value_total" in cols:
        return
    op.add_column(
        "work_orders",
        sa.Column("approved_value_total", sa.Numeric(14, 2), nullable=True),
    )
    op.execute(
        sa.text(
            """
            UPDATE work_orders
            SET approved_value_total = (
                SELECT COALESCE(SUM(taxable_value), 0)
                FROM work_order_items
                WHERE work_order_items.work_order_id = work_orders.id
            )
            WHERE status IN ('active', 'closed', 'approved')
            """
        )
    )


def downgrade() -> None:
    insp = _insp()
    if "work_orders" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("work_orders")}
    if "approved_value_total" not in cols:
        return
    op.drop_column("work_orders", "approved_value_total")
