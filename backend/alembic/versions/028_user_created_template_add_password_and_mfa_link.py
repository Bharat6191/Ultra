"""Ensure USER_CREATED email includes temp password + optional MFA setup link.

Revision ID: 028
Revises: 027
Create Date: 2026-04-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "028"
down_revision: str | None = "027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_APPEND_BLOCK = r"""
{% if temp_password %}
<p><strong>Temporary password:</strong> {{temp_password}}</p>
<p>Please change your password after you sign in.</p>
{% endif %}
{% if setup_link %}
<p><strong>MFA setup:</strong> <a href="{{setup_link}}">Set up your authenticator app</a></p>
{% endif %}
""".strip()


def upgrade() -> None:
    # Patch the seeded template by name (do not overwrite subject/body wholesale).
    # Append blocks only if they aren't present yet.
    op.execute(
        sa.text(
            """
            UPDATE email_templates
               SET body_html = body_html || E'\\n' || :append_block,
                   updated_at = CURRENT_TIMESTAMP
             WHERE name = 'User created (basic)'
               AND event_code = 'USER_CREATED'
               AND body_html NOT LIKE '%temp_password%'
            """
        ).bindparams(append_block=_APPEND_BLOCK)
    )


def downgrade() -> None:
    # No-op: avoid removing content that might have been edited by admins.
    return

