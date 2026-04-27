"""RBAC for auth policy and MFA management.

Revision ID: 021
Revises: 020
Create Date: 2026-04-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "021"
down_revision: str | None = "020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            INSERT INTO features (key, name, description, created_at)
            SELECT 'auth_policy', 'Authentication policy', NULL, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (SELECT 1 FROM features WHERE key = 'auth_policy')
            """
        )
    )
    for action, code in (("view", "auth_policy.view"), ("update", "auth_policy.update")):
        op.execute(
            sa.text(
                """
                INSERT INTO permissions (feature_id, action, code, description, created_at)
                SELECT f.id, :action, :code, NULL, CURRENT_TIMESTAMP
                FROM features f
                WHERE f.key = 'auth_policy'
                  AND NOT EXISTS (SELECT 1 FROM permissions WHERE code = :code)
                """
            ).bindparams(action=action, code=code)
        )
    op.execute(
        sa.text(
            """
            INSERT INTO features (key, name, description, created_at)
            SELECT 'mfa', 'Multi-factor authentication', NULL, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (SELECT 1 FROM features WHERE key = 'mfa')
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO permissions (feature_id, action, code, description, created_at)
            SELECT f.id, 'manage', 'mfa.manage', NULL, CURRENT_TIMESTAMP
            FROM features f
            WHERE f.key = 'mfa'
              AND NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'mfa.manage')
            """
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM permissions WHERE code IN ('auth_policy.view','auth_policy.update','mfa.manage')"))
    op.execute(sa.text("DELETE FROM features WHERE key IN ('auth_policy','mfa')"))
