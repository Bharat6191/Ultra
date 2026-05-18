"""Resync part_master id sequence after 043 copied explicit ids from rate_master.

Revision ID: 045
Revises: 044
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text


revision: str = "045"
down_revision: str | None = "044"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    bind.execute(
        text(
            """
            WITH part_master_ids AS (
                SELECT MAX(id) AS max_id
                FROM part_master
            )
            SELECT setval(
                pg_get_serial_sequence('part_master', 'id'),
                COALESCE((SELECT max_id FROM part_master_ids), 1),
                COALESCE((SELECT max_id IS NOT NULL FROM part_master_ids), false)
            )
            """
        )
    )


def downgrade() -> None:
    pass
