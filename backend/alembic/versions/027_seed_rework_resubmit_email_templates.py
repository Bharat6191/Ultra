"""Seed email templates for rework/resubmit flow.

Revision ID: 027
Revises: 026
Create Date: 2026-04-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "027"
down_revision: str | None = "026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _seed_template(*, name: str, event_code: str, subject: str, body_html: str) -> None:
    op.execute(
        sa.text(
            """
            INSERT INTO email_templates (name, event_code, subject, body_html, body_text, is_active, created_at, updated_at)
            SELECT :name, :event_code, :subject, :body_html, NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = :name)
            """
        ).bindparams(
            name=name,
            event_code=event_code,
            subject=subject,
            body_html=body_html,
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO email_template_mappings (event_code, template_id, is_enabled, created_at, updated_at)
            SELECT :event_code, t.id, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM email_templates t
            WHERE t.name = :name
              AND NOT EXISTS (SELECT 1 FROM email_template_mappings m WHERE m.event_code = :event_code)
            """
        ).bindparams(name=name, event_code=event_code)
    )


def upgrade() -> None:
    _seed_template(
        name="Task rework required",
        event_code="TASK_REWORK_REQUIRED",
        subject="Rework required: {{entity_name}}",
        body_html="""
<p>Hello {{user_name}},</p>
<p>Your request requires rework.</p>
<p><strong>Reason:</strong> {{rejection_reason}}</p>
<p><a href="{{task_link}}">Open task</a></p>
""".strip(),
    )
    _seed_template(
        name="Task resubmitted",
        event_code="TASK_RESUBMITTED",
        subject="Resubmitted: {{entity_name}}",
        body_html="""
<p>Hello {{user_name}},</p>
<p>The request has been resubmitted for approval.</p>
<p><a href="{{task_link}}">Open request</a></p>
""".strip(),
    )


def downgrade() -> None:
    for name in ("Task rework required", "Task resubmitted"):
        op.execute(sa.text("DELETE FROM email_templates WHERE name = :name").bindparams(name=name))

