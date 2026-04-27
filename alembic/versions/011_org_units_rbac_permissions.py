"""Seed org_units (Plants) feature + permissions for RBAC.

Revision ID: 011
Revises: 010
Create Date: 2026-04-21
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "011"
down_revision: str | None = "010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text("""
            INSERT INTO features (key, name, description, created_at)
            SELECT 'org_units', 'Plants (org units)', NULL, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (SELECT 1 FROM features WHERE key = 'org_units')
        """)
    )
    for action, code in (
        ("view", "org_units.view"),
        ("create", "org_units.create"),
        ("update", "org_units.update"),
        ("delete", "org_units.delete"),
    ):
        op.execute(
            sa.text("""
                INSERT INTO permissions (feature_id, action, code, description, created_at)
                SELECT f.id, :action, :code, NULL, CURRENT_TIMESTAMP
                FROM features f
                WHERE f.key = 'org_units'
                  AND NOT EXISTS (SELECT 1 FROM permissions WHERE code = :code)
            """).bindparams(action=action, code=code)
        )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM permissions WHERE code LIKE 'org_units.%'"))
    op.execute(sa.text("DELETE FROM features WHERE key = 'org_units'"))
