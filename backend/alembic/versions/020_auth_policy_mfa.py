"""Auth policy, MFA, challenges, and setup tokens.

Revision ID: 020
Revises: 019
Create Date: 2026-04-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "020"
down_revision: str | None = "019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if not insp.has_table("auth_policies"):
        op.create_table(
            "auth_policies",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("company_id", sa.Integer(), nullable=False),
            sa.Column("password_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("mfa_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("captcha_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("mfa_enforced", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=True,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=True,
            ),
            sa.ForeignKeyConstraint(["company_id"], ["org_units.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("company_id", name="uq_auth_policies_company_id"),
        )
        op.create_index("ix_auth_policies_company_id", "auth_policies", ["company_id"])

    if not insp.has_table("user_mfa"):
        op.create_table(
            "user_mfa",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("secret_encrypted", sa.Text(), nullable=False, server_default=sa.text("''")),
            sa.Column("setup_completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=True,
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", name="uq_user_mfa_user_id"),
        )
        op.create_index("ix_user_mfa_user_id", "user_mfa", ["user_id"])

    if not insp.has_table("mfa_challenges"):
        op.create_table(
            "mfa_challenges",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False, unique=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=True,
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_mfa_challenges_user_id", "mfa_challenges", ["user_id"])
        op.create_index("ix_mfa_challenges_expires_at", "mfa_challenges", ["expires_at"])

    if not insp.has_table("mfa_setup_tokens"):
        op.create_table(
            "mfa_setup_tokens",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False, unique=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=True,
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_mfa_setup_tokens_user_id", "mfa_setup_tokens", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_mfa_setup_tokens_user_id", table_name="mfa_setup_tokens", if_exists=True)
    op.drop_table("mfa_setup_tokens", if_exists=True)
    op.drop_index("ix_mfa_challenges_expires_at", table_name="mfa_challenges", if_exists=True)
    op.drop_index("ix_mfa_challenges_user_id", table_name="mfa_challenges", if_exists=True)
    op.drop_table("mfa_challenges", if_exists=True)
    op.drop_index("ix_user_mfa_user_id", table_name="user_mfa", if_exists=True)
    op.drop_table("user_mfa", if_exists=True)
    op.drop_index("ix_auth_policies_company_id", table_name="auth_policies", if_exists=True)
    op.drop_table("auth_policies", if_exists=True)
