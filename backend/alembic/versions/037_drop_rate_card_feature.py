"""Remove standalone ``rate_card`` RBAC — comparisons use ``rate_master.view``.

The Rate master UI and ``GET /rate-card`` are one product surface; a separate
``rate_card.view`` permission duplicated the admin Permissions screen.

Revision ID: 037
Revises: 036
Create Date: 2026-05-05
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "037"
down_revision: str | None = "036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "role_permissions" not in inspector.get_table_names():
        return
    op.execute(
        sa.text(
            """
            DELETE FROM role_permissions
            WHERE permission_id IN (
                SELECT id FROM permissions WHERE code = 'rate_card.view'
            )
            """
        )
    )
    op.execute(sa.text("DELETE FROM permissions WHERE code = 'rate_card.view'"))
    op.execute(sa.text("DELETE FROM features WHERE key = 'rate_card'"))


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            INSERT INTO features (key, name, created_at)
            SELECT 'rate_card', 'Rate card', now()
            WHERE NOT EXISTS (SELECT 1 FROM features WHERE key = 'rate_card')
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO permissions (feature_id, action, code, description, created_at)
            SELECT f.id, 'view', 'rate_card.view',
                   'View unified Rate Card (plant + contractor + benchmark)', now()
            FROM features f
            WHERE f.key = 'rate_card'
              AND NOT EXISTS (
                SELECT 1 FROM permissions p WHERE p.feature_id = f.id AND p.code = 'rate_card.view'
              )
            """
        )
    )
