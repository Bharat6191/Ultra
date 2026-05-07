"""Expand user master fields (employee and org metadata).

Revision ID: 031
Revises: 030
Create Date: 2026-04-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "031"
down_revision: str | None = "030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("employee_code", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("department", sa.String(length=128), nullable=True))
    op.add_column("users", sa.Column("designation", sa.String(length=128), nullable=True))
    op.add_column("users", sa.Column("address", sa.Text(), nullable=True))

    op.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_employee_code ON users (employee_code) WHERE employee_code IS NOT NULL"))


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS ix_users_employee_code"))
    op.drop_column("users", "address")
    op.drop_column("users", "designation")
    op.drop_column("users", "department")
    op.drop_column("users", "employee_code")

