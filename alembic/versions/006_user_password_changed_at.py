"""users.password_changed_at for password expiry

Revision ID: 006
Revises: 005
Create Date: 2026-04-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "006"
down_revision: str | None = "005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        sa.text("UPDATE users SET password_changed_at = created_at WHERE password_changed_at IS NULL")
    )
    op.alter_column(
        "users",
        "password_changed_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
    )


def downgrade() -> None:
    op.drop_column("users", "password_changed_at")
