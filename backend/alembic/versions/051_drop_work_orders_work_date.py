"""Drop work_orders.work_date — use created_at and approved_at instead."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "051"
down_revision: str | None = "050"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("work_orders", "work_date")


def downgrade() -> None:
    op.add_column("work_orders", sa.Column("work_date", sa.Date(), nullable=True))
    op.execute(sa.text("UPDATE work_orders SET work_date = date(created_at) WHERE work_date IS NULL"))
    op.alter_column("work_orders", "work_date", nullable=False, server_default=sa.text("CURRENT_DATE"))
