"""Expand contractor master fields.

Revision ID: 030
Revises: 029
Create Date: 2026-04-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "030"
down_revision: str | None = "029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("contractors", sa.Column("contractor_code", sa.String(length=64), nullable=True))
    op.add_column("contractors", sa.Column("contact_person_title", sa.String(length=128), nullable=True))
    op.add_column("contractors", sa.Column("alternate_email", sa.String(length=255), nullable=True))
    op.add_column("contractors", sa.Column("alternate_phone", sa.String(length=32), nullable=True))
    op.add_column("contractors", sa.Column("city", sa.String(length=128), nullable=True))
    op.add_column("contractors", sa.Column("state", sa.String(length=128), nullable=True))
    op.add_column("contractors", sa.Column("country", sa.String(length=128), nullable=True))
    op.add_column("contractors", sa.Column("postal_code", sa.String(length=32), nullable=True))
    op.add_column("contractors", sa.Column("gst_number", sa.String(length=32), nullable=True))
    op.add_column("contractors", sa.Column("pan_number", sa.String(length=16), nullable=True))
    op.add_column("contractors", sa.Column("registration_number", sa.String(length=64), nullable=True))
    op.add_column("contractors", sa.Column("website", sa.String(length=255), nullable=True))
    op.add_column("contractors", sa.Column("notes", sa.Text(), nullable=True))

    op.create_index("ix_contractors_contractor_code", "contractors", ["contractor_code"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_contractors_contractor_code", table_name="contractors")
    op.drop_column("contractors", "notes")
    op.drop_column("contractors", "website")
    op.drop_column("contractors", "registration_number")
    op.drop_column("contractors", "pan_number")
    op.drop_column("contractors", "gst_number")
    op.drop_column("contractors", "postal_code")
    op.drop_column("contractors", "country")
    op.drop_column("contractors", "state")
    op.drop_column("contractors", "city")
    op.drop_column("contractors", "alternate_phone")
    op.drop_column("contractors", "alternate_email")
    op.drop_column("contractors", "contact_person_title")
    op.drop_column("contractors", "contractor_code")

