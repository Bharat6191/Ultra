"""Seed default email templates + mappings for core events.

Revision ID: 022
Revises: 021
Create Date: 2026-04-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "022"
down_revision: str | None = "021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _seed_template(*, name: str, event_code: str, subject: str, body_html: str) -> None:
    # Insert template only if the name doesn't exist (never overwrite user edits).
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

    # If mapping doesn't exist yet, map the event to this template.
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
        name="User created (basic)",
        event_code="USER_CREATED",
        subject="Welcome, {{user_name}}",
        body_html="""
<p>Hello {{user_name}},</p>
<p>Your account has been created and is now active.</p>
<p>You can sign in with your registered email: <strong>{{email}}</strong>.</p>
""".strip(),
    )

    _seed_template(
        name="Forgot password (reset link)",
        event_code="FORGOT_PASSWORD",
        subject="Reset your password",
        body_html="""
<p>Hello {{user_name}},</p>
<p>We received a request to reset your password.</p>
<p><a href="{{reset_link}}">Click here to reset your password</a></p>
<p>If you didn’t request this, you can ignore this email.</p>
""".strip(),
    )

    _seed_template(
        name="Password reset (confirmation)",
        event_code="PASSWORD_RESET",
        subject="Your password was changed",
        body_html="""
<p>Hello {{user_name}},</p>
<p>Your password has been updated successfully.</p>
<p>If you did not make this change, please contact your administrator immediately.</p>
""".strip(),
    )

    _seed_template(
        name="MFA setup required",
        event_code="MFA_SETUP_REQUIRED",
        subject="Action required: Set up MFA",
        body_html="""
<p>Hello {{user_name}},</p>
<p>Your organization requires multi-factor authentication (MFA).</p>
<p><a href="{{setup_link}}">Set up your authenticator app</a></p>
""".strip(),
    )

    _seed_template(
        name="MFA setup reminder",
        event_code="MFA_SETUP_REMINDER",
        subject="Reminder: Set up MFA",
        body_html="""
<p>Hello {{user_name}},</p>
<p>This is a reminder to complete MFA setup.</p>
<p><a href="{{setup_link}}">Set up your authenticator app</a></p>
""".strip(),
    )

    _seed_template(
        name="MFA enabled (confirmation)",
        event_code="MFA_ENABLED",
        subject="MFA enabled",
        body_html="""
<p>Hello {{user_name}},</p>
<p>MFA has been enabled on your account.</p>
""".strip(),
    )


def downgrade() -> None:
    # Be conservative: only remove the specific seeded templates if they still exist by name.
    for name in (
        "User created (basic)",
        "Forgot password (reset link)",
        "Password reset (confirmation)",
        "MFA setup required",
        "MFA setup reminder",
        "MFA enabled (confirmation)",
    ):
        op.execute(sa.text("DELETE FROM email_templates WHERE name = :name").bindparams(name=name))
