"""Add username to users (unique, required).

Revision ID: 025
Revises: 024
Create Date: 2026-04-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "025"
down_revision: str | None = "024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = {c["name"] for c in insp.get_columns("users")}
    if "username" not in cols:
        op.add_column("users", sa.Column("username", sa.String(length=64), nullable=True))
        op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_users_username ON users (username)"))
        op.execute(sa.text("ALTER TABLE users ADD CONSTRAINT uq_users_username UNIQUE (username)"))

    # Backfill usernames for existing rows (prefer email local-part, else phone, else user{id}).
    # Ensure uniqueness by appending _{id} when collisions occur.
    op.execute(
        sa.text(
            """
            UPDATE users
               SET username = CASE
                   WHEN email IS NOT NULL AND position('@' in email) > 1
                     THEN regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]+', '', 'g')
                   WHEN phone IS NOT NULL
                     THEN regexp_replace(phone, '[^0-9+]+', '', 'g')
                   ELSE 'user' || id::text
                 END
             WHERE username IS NULL OR username = ''
            """
        )
    )
    # Resolve any duplicates by suffixing id.
    op.execute(
        sa.text(
            """
            WITH d AS (
              SELECT username
              FROM users
              WHERE username IS NOT NULL AND username <> ''
              GROUP BY username
              HAVING count(*) > 1
            )
            UPDATE users u
               SET username = u.username || '_' || u.id::text
              FROM d
             WHERE u.username = d.username
            """
        )
    )

    # Enforce not-null after backfill.
    op.execute(sa.text("ALTER TABLE users ALTER COLUMN username SET NOT NULL"))


def downgrade() -> None:
    # Drop constraint/index then column
    op.execute(sa.text("ALTER TABLE users DROP CONSTRAINT IF EXISTS uq_users_username"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_users_username"))
    op.drop_column("users", "username")

