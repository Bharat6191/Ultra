"""Work orders: one contractor per header; line items link to work_order_id.

Revision ID: 046
Revises: 045
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine.reflection import Inspector


revision: str = "046"
down_revision: str | None = "045"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _insp() -> Inspector:
    return sa.inspect(op.get_bind())


def upgrade() -> None:
    bind = op.get_bind()
    insp = _insp()
    if "work_orders" not in insp.get_table_names() or "work_order_items" not in insp.get_table_names():
        return

    wo_cols = {c["name"] for c in insp.get_columns("work_orders")}
    item_cols = {c["name"] for c in insp.get_columns("work_order_items")}

    if "work_order_id" in item_cols and "contractor_id" in wo_cols:
        return

    has_woc = "work_order_contractors" in insp.get_table_names()

    # --- Header: contractor_id ---
    if "contractor_id" not in wo_cols:
        op.add_column("work_orders", sa.Column("contractor_id", sa.Integer(), nullable=True))
        op.create_foreign_key(
            "fk_work_orders_contractor_id_contractors",
            "work_orders",
            "contractors",
            ["contractor_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        op.create_index("ix_work_orders_contractor_id", "work_orders", ["contractor_id"])

    if has_woc:
        # Legacy data may have multiple contractors per work order. The product model allows only one.
        # Keep the earliest work_order_contractors row (lowest id) per work order and move all items there.
        bind.execute(
            sa.text(
                """
                UPDATE work_order_items wi
                SET work_order_contractor_id = (
                    SELECT MIN(w2.id)
                    FROM work_order_contractors w2
                    WHERE w2.work_order_id = (
                        SELECT w3.work_order_id
                        FROM work_order_contractors w3
                        WHERE w3.id = wi.work_order_contractor_id
                    )
                )
                WHERE wi.work_order_contractor_id IS NOT NULL
                """
            )
        )
        bind.execute(
            sa.text(
                """
                DELETE FROM work_order_contractors w
                WHERE w.id NOT IN (
                    SELECT MIN(id) FROM work_order_contractors GROUP BY work_order_id
                )
                """
            )
        )

        multi = bind.execute(
            sa.text(
                """
                SELECT work_order_id FROM work_order_contractors
                GROUP BY work_order_id
                HAVING COUNT(*) > 1
                LIMIT 1
                """
            )
        ).fetchone()
        if multi is not None:
            raise RuntimeError(
                "Migration 046 aborted: a work order still has multiple contractor rows. "
                "Fix data (one contractor per work order), then re-run alembic upgrade."
            )

        bind.execute(
            sa.text(
                """
                UPDATE work_orders
                SET contractor_id = (
                    SELECT contractor_id FROM work_order_contractors w
                    WHERE w.work_order_id = work_orders.id
                    ORDER BY w.id ASC
                    LIMIT 1
                )
                WHERE contractor_id IS NULL
                  AND EXISTS (
                      SELECT 1 FROM work_order_contractors w2
                      WHERE w2.work_order_id = work_orders.id
                  )
                """
            )
        )

        null_ctr = bind.execute(sa.text("SELECT COUNT(*) FROM work_orders WHERE contractor_id IS NULL")).scalar()
        if int(null_ctr or 0) > 0:
            raise RuntimeError(
                "Migration 046 aborted: some work_orders rows have no contractor_id after backfill. "
                "Assign contractors manually, then re-run upgrade."
            )

    # --- Items: work_order_id ---
    if "work_order_id" not in item_cols:
        op.add_column("work_order_items", sa.Column("work_order_id", sa.Integer(), nullable=True))
        op.create_index("ix_work_order_items_work_order_id", "work_order_items", ["work_order_id"])

    if has_woc and "work_order_contractor_id" in item_cols:
        bind.execute(
            sa.text(
                """
                UPDATE work_order_items
                SET work_order_id = (
                    SELECT wc.work_order_id
                    FROM work_order_contractors wc
                    WHERE wc.id = work_order_items.work_order_contractor_id
                )
                WHERE work_order_contractor_id IS NOT NULL
                """
            )
        )

    null_items = bind.execute(
        sa.text("SELECT COUNT(*) FROM work_order_items WHERE work_order_id IS NULL")
    ).scalar()
    if int(null_items or 0) > 0:
        raise RuntimeError(
            "Migration 046 aborted: some work_order_items could not be linked to a work_order_id."
        )

    if "taxable_value" not in item_cols:
        op.add_column(
            "work_order_items",
            sa.Column("taxable_value", sa.Numeric(14, 2), nullable=False, server_default="0"),
        )
    if "weight_per_piece_snapshot" not in item_cols:
        op.add_column(
            "work_order_items",
            sa.Column("weight_per_piece_snapshot", sa.Numeric(14, 6), nullable=True),
        )

    bind.execute(
        sa.text(
            """
            UPDATE work_order_items
            SET taxable_value = ROUND(COALESCE(planned_quantity, 0) * resolved_rate, 2)
            WHERE planned_quantity IS NOT NULL
            """
        )
    )

    insp = _insp()
    item_cols2 = {c["name"] for c in insp.get_columns("work_order_items")}
    if "work_order_contractor_id" in item_cols2:
        for fk in insp.get_foreign_keys("work_order_items"):
            if fk.get("referred_table") == "work_order_contractors":
                op.drop_constraint(fk["name"], "work_order_items", type_="foreignkey")
        try:
            op.drop_index("ix_work_order_items_work_order_contractor_id", table_name="work_order_items")
        except Exception:
            pass
        op.drop_column("work_order_items", "work_order_contractor_id")

    op.alter_column("work_order_items", "work_order_id", nullable=False)
    try:
        op.create_foreign_key(
            "fk_work_order_items_work_order_id_work_orders",
            "work_order_items",
            "work_orders",
            ["work_order_id"],
            ["id"],
            ondelete="CASCADE",
        )
    except Exception:
        pass

    if "work_order_contractors" in _insp().get_table_names():
        op.drop_table("work_order_contractors")

    op.alter_column("work_orders", "contractor_id", nullable=False)

    try:
        op.alter_column("work_order_items", "taxable_value", server_default=None)
    except Exception:
        pass


def downgrade() -> None:
    raise RuntimeError("046 downgrade is not supported (destructive schema change).")
