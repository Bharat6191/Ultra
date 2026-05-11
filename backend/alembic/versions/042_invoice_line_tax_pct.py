"""Invoice lines: optional tax_pct for taxable value uplift.

Revision ID: 042
Revises: 041
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "042"
down_revision: str | None = "041"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "invoice_lines",
        sa.Column("tax_pct", sa.Numeric(7, 4), nullable=True, server_default="0"),
    )
    op.alter_column("invoice_lines", "tax_pct", server_default=None)


def downgrade() -> None:
    op.drop_column("invoice_lines", "tax_pct")
