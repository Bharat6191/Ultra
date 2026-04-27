"""Seed email_templates feature + permissions for RBAC.

Revision ID: 018
Revises: 017
Create Date: 2026-04-25
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "018"
down_revision: str | None = "017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            INSERT INTO features (key, name, description, created_at)
            SELECT 'email_templates', 'Email templates', NULL, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (SELECT 1 FROM features WHERE key = 'email_templates')
            """
        )
    )
    for action, code in (
        ("view", "email_templates.view"),
        ("create", "email_templates.create"),
        ("update", "email_templates.update"),
        ("delete", "email_templates.delete"),
    ):
        op.execute(
            sa.text(
                """
                INSERT INTO permissions (feature_id, action, code, description, created_at)
                SELECT f.id, :action, :code, NULL, CURRENT_TIMESTAMP
                FROM features f
                WHERE f.key = 'email_templates'
                  AND NOT EXISTS (SELECT 1 FROM permissions WHERE code = :code)
                """
            ).bindparams(action=action, code=code)
        )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM permissions WHERE code LIKE 'email_templates.%'"))
    op.execute(sa.text("DELETE FROM features WHERE key = 'email_templates'"))

