"""role ↔ org unit (plant) association

Revision ID: 010
Revises: 009
Create Date: 2026-04-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "010"
down_revision: str | None = "009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "role_org_units",
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.Column("org_unit_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["org_unit_id"], ["org_units.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("role_id", "org_unit_id"),
    )


def downgrade() -> None:
    op.drop_table("role_org_units")
