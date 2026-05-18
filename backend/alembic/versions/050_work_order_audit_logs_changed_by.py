"""Rename work_order_audit_logs.actor_user_id to changed_by.

Legacy environments created the table with ``actor_user_id`` before migrations
standardized on ``changed_by`` (see 038/040). The ORM maps ``actor_user_id`` to
column ``changed_by``.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine.reflection import Inspector


revision: str = "050"
down_revision: str | None = "049"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _insp() -> Inspector:
    return sa.inspect(op.get_bind())


def _cols(name: str) -> set[str]:
    return {c["name"] for c in _insp().get_columns(name)}


def _fk_names(table: str, column: str) -> list[str]:
    out: list[str] = []
    for fk in _insp().get_foreign_keys(table):
        if column in fk.get("constrained_columns", []):
            name = fk.get("name")
            if name:
                out.append(name)
    return out


def upgrade() -> None:
    if "work_order_audit_logs" not in _insp().get_table_names():
        return

    cols = _cols("work_order_audit_logs")
    if "changed_by" in cols or "actor_user_id" not in cols:
        return

    for fk_name in _fk_names("work_order_audit_logs", "actor_user_id"):
        op.drop_constraint(fk_name, "work_order_audit_logs", type_="foreignkey")

    op.alter_column(
        "work_order_audit_logs",
        "actor_user_id",
        new_column_name="changed_by",
        existing_type=sa.Integer(),
        existing_nullable=True,
    )

    op.create_foreign_key(
        "fk_work_order_audit_logs_changed_by_users",
        "work_order_audit_logs",
        "users",
        ["changed_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    if "work_order_audit_logs" not in _insp().get_table_names():
        return

    cols = _cols("work_order_audit_logs")
    if "actor_user_id" in cols or "changed_by" not in cols:
        return

    for fk_name in _fk_names("work_order_audit_logs", "changed_by"):
        op.drop_constraint(fk_name, "work_order_audit_logs", type_="foreignkey")

    op.alter_column(
        "work_order_audit_logs",
        "changed_by",
        new_column_name="actor_user_id",
        existing_type=sa.Integer(),
        existing_nullable=True,
    )

    op.create_foreign_key(
        "work_order_audit_logs_actor_user_id_fkey",
        "work_order_audit_logs",
        "users",
        ["actor_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
