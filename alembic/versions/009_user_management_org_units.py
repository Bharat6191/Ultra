"""user management fields + org units + user org mapping

Revision ID: 009
Revises: 008
Create Date: 2026-04-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "009"
down_revision: str | None = "008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "org_units",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("parent_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["parent_id"], ["org_units.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "user_org_units",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("org_unit_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_unit_id"], ["org_units.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_user_org_units_user_id"),
    )
    op.create_index("ix_user_org_units_org_unit_id", "user_org_units", ["org_unit_id"], unique=False)

    op.add_column("users", sa.Column("full_name", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("phone", sa.String(length=32), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # Backfill display names for existing users (email remains the primary login identifier).
    op.execute("UPDATE users SET full_name = split_part(email, '@', 1) WHERE full_name IS NULL")
    op.alter_column("users", "full_name", existing_type=sa.String(length=255), nullable=False)

    # Make email optional for phone-first users (existing rows keep their email).
    op.drop_constraint("uq_users_email", "users", type_="unique")
    op.alter_column("users", "email", existing_type=sa.String(length=255), nullable=True)

    op.create_index("ix_users_phone", "users", ["phone"], unique=True)

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "CREATE UNIQUE INDEX uq_users_email_not_null ON users (email) WHERE email IS NOT NULL"
        )
    else:
        # Best-effort for non-postgres dev DBs.
        op.create_index("uq_users_email_not_null", "users", ["email"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS uq_users_email_not_null")
    else:
        op.drop_index("uq_users_email_not_null", table_name="users")

    op.drop_index("ix_users_phone", table_name="users")

    op.alter_column("users", "email", existing_type=sa.String(length=255), nullable=False)
    op.create_unique_constraint("uq_users_email", "users", ["email"])

    op.drop_column("users", "updated_at")
    op.drop_column("users", "is_active")
    op.drop_column("users", "phone")
    op.drop_column("users", "full_name")

    op.drop_index("ix_user_org_units_org_unit_id", table_name="user_org_units")
    op.drop_table("user_org_units")
    op.drop_table("org_units")
