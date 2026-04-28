"""Email notification engine (templates + mappings + logs).

Revision ID: 017
Revises: 016
Create Date: 2026-04-25
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "017"
down_revision: str | None = "016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table("email_templates"):
        op.create_table(
            "email_templates",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("event_code", sa.String(length=64), nullable=False),
            sa.Column("subject", sa.Text(), nullable=False),
            sa.Column("body_html", sa.Text(), nullable=False),
            sa.Column("body_text", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
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
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("name", name="uq_email_templates_name"),
        )

    existing = {i.get("name") for i in insp.get_indexes("email_templates")} if insp.has_table("email_templates") else set()
    if "ix_email_templates_event_code" not in existing:
        op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_email_templates_event_code ON email_templates (event_code)"))

    if not insp.has_table("email_template_mappings"):
        op.create_table(
            "email_template_mappings",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("event_code", sa.String(length=64), nullable=False),
            sa.Column("template_id", sa.Integer(), nullable=False),
            sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
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
            sa.ForeignKeyConstraint(["template_id"], ["email_templates.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("event_code", name="uq_email_template_mappings_event_code"),
        )

    existing = {i.get("name") for i in insp.get_indexes("email_template_mappings")} if insp.has_table("email_template_mappings") else set()
    if "ix_email_template_mappings_event_code" not in existing:
        op.execute(
            sa.text("CREATE INDEX IF NOT EXISTS ix_email_template_mappings_event_code ON email_template_mappings (event_code)")
        )
    if "ix_email_template_mappings_template_id" not in existing:
        op.execute(
            sa.text("CREATE INDEX IF NOT EXISTS ix_email_template_mappings_template_id ON email_template_mappings (template_id)")
        )

    if not insp.has_table("email_logs"):
        op.create_table(
            "email_logs",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("event_code", sa.String(length=64), nullable=False),
            sa.Column("to_email", sa.String(length=255), nullable=False),
            sa.Column("subject", sa.Text(), nullable=False),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=16), nullable=False),  # sent|failed|skipped
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=True,
            ),
            sa.PrimaryKeyConstraint("id"),
        )

    existing = {i.get("name") for i in insp.get_indexes("email_logs")} if insp.has_table("email_logs") else set()
    if "ix_email_logs_event_code" not in existing:
        op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_email_logs_event_code ON email_logs (event_code)"))
    if "ix_email_logs_to_email" not in existing:
        op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_email_logs_to_email ON email_logs (to_email)"))


def downgrade() -> None:
    op.drop_index("ix_email_logs_to_email", table_name="email_logs")
    op.drop_index("ix_email_logs_event_code", table_name="email_logs")
    op.drop_table("email_logs")

    op.drop_index("ix_email_template_mappings_template_id", table_name="email_template_mappings")
    op.drop_index("ix_email_template_mappings_event_code", table_name="email_template_mappings")
    op.drop_table("email_template_mappings")

    op.drop_index("ix_email_templates_event_code", table_name="email_templates")
    op.drop_table("email_templates")

