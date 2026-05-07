"""Contractor master module + document expiry notification settings.

Revision ID: 029
Revises: 028
Create Date: 2026-04-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "029"
down_revision: str | None = "028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "contractors",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("contact_person", sa.String(length=255), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    op.create_table(
        "contractor_documents",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "contractor_id",
            sa.Integer(),
            sa.ForeignKey("contractors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("document_name", sa.String(length=255), nullable=False),
        sa.Column("document_type", sa.String(length=64), nullable=False),
        sa.Column("file_url", sa.String(length=1024), nullable=False),
        sa.Column("issued_date", sa.Date(), nullable=True),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index(
        "ix_contractor_documents_expiry_date",
        "contractor_documents",
        ["expiry_date"],
        unique=False,
    )
    op.create_index(
        "ix_contractor_documents_contractor_id",
        "contractor_documents",
        ["contractor_id"],
        unique=False,
    )

    op.create_table(
        "notification_settings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("event_code", sa.String(length=128), nullable=False),
        sa.Column("notify_roles", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("days_before", sa.Integer(), server_default="7", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_notification_settings_event_code",
        "notification_settings",
        ["event_code"],
        unique=True,
    )

    op.create_table(
        "notification_dedup_keys",
        sa.Column("key", sa.String(length=255), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )

    # Seed a default email template + mapping for contractor document expiry alerts.
    # Admins can edit/disable it later via /admin/email-templates.
    op.execute(
        sa.text(
            """
            INSERT INTO email_templates (name, event_code, subject, body_html, body_text, is_active, created_at, updated_at)
            SELECT
              'Contractor document expiry alert (basic)' AS name,
              'CONTRACTOR_DOC_EXPIRY' AS event_code,
              'Document Expiry Alert - {{document_name}}' AS subject,
              '<p>Hello {{user_name}},</p>
               <p>This is a reminder that a contractor document is nearing expiry (or has expired).</p>
               <ul>
                 <li><strong>Contractor:</strong> {{contractor_name}}</li>
                 <li><strong>Document:</strong> {{document_name}} ({{document_type}})</li>
                 <li><strong>Expiry date:</strong> {{expiry_date}}</li>
                 <li><strong>Days left:</strong> {{days_left}}</li>
               </ul>' AS body_html,
              NULL AS body_text,
              TRUE AS is_active,
              CURRENT_TIMESTAMP AS created_at,
              CURRENT_TIMESTAMP AS updated_at
            WHERE NOT EXISTS (
              SELECT 1 FROM email_templates WHERE name = 'Contractor document expiry alert (basic)'
            );
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO email_template_mappings (event_code, template_id, is_enabled, created_at, updated_at)
            SELECT
              'CONTRACTOR_DOC_EXPIRY' AS event_code,
              t.id AS template_id,
              TRUE AS is_enabled,
              CURRENT_TIMESTAMP AS created_at,
              CURRENT_TIMESTAMP AS updated_at
            FROM email_templates t
            WHERE t.name = 'Contractor document expiry alert (basic)'
              AND NOT EXISTS (
                SELECT 1 FROM email_template_mappings m WHERE m.event_code = 'CONTRACTOR_DOC_EXPIRY'
              );
            """
        )
    )


def downgrade() -> None:
    op.drop_table("notification_dedup_keys")
    op.drop_index("ix_notification_settings_event_code", table_name="notification_settings")
    op.drop_table("notification_settings")
    op.drop_index("ix_contractor_documents_contractor_id", table_name="contractor_documents")
    op.drop_index("ix_contractor_documents_expiry_date", table_name="contractor_documents")
    op.drop_table("contractor_documents")
    op.drop_table("contractors")

