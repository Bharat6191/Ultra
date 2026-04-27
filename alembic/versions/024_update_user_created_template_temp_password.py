"""Update seeded USER_CREATED template to include temp_password.

Revision ID: 024
Revises: 023
Create Date: 2026-04-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "024"
down_revision: str | None = "023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Only patch the seeded template by name, and only if it doesn't already mention the variable.
    op.execute(
        sa.text(
            """
            UPDATE email_templates
               SET body_html = body_html || E'\\n<p><strong>Temporary password:</strong> {{temp_password}}</p>\\n<p>Please change your password after you sign in.</p>',
                   updated_at = CURRENT_TIMESTAMP
             WHERE name = 'User created (basic)'
               AND event_code = 'USER_CREATED'
               AND body_html NOT LIKE '%{{temp_password}}%'
            """
        )
    )


def downgrade() -> None:
    # No-op: do not attempt to remove content that may have been edited by admins.
    return

