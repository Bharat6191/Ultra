"""Reconcile existing `work_orders` schema with new Work Order module.

Some environments already had a legacy `work_orders` table (reference_code, notes, updated_by, etc).
This migration is defensive:
- If the new columns/tables already exist, it does nothing.
- If the legacy columns exist, it backfills and keeps compatibility.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine.reflection import Inspector


revision: str = "040"
down_revision: str | None = "039"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _insp() -> Inspector:
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return name in _insp().get_table_names()


def _cols(name: str) -> set[str]:
    return {c["name"] for c in _insp().get_columns(name)}


def upgrade() -> None:
    # ---- work_orders header ----
    if _has_table("work_orders"):
        cols = _cols("work_orders")

        # Ensure new numbering column exists and is populated.
        if "work_order_number" not in cols:
            op.add_column("work_orders", sa.Column("work_order_number", sa.String(length=64), nullable=True))
            # Backfill from legacy reference_code when present.
            if "reference_code" in cols:
                op.execute(
                    sa.text(
                        "update work_orders set work_order_number = reference_code where work_order_number is null"
                    )
                )
            # If still null, backfill a readable fallback.
            op.execute(
                sa.text(
                    "update work_orders set work_order_number = concat('WO-', id::text) where work_order_number is null"
                )
            )
            # De-duplicate any collisions before adding UNIQUE constraint (legacy systems may reuse reference codes).
            op.execute(
                sa.text(
                    """
                    with d as (
                        select
                            id,
                            work_order_number,
                            row_number() over (partition by work_order_number order by id) as rn
                        from work_orders
                    )
                    update work_orders w
                    set work_order_number = concat(d.work_order_number, '-', w.id::text)
                    from d
                    where w.id = d.id and d.rn > 1
                    """
                )
            )
            op.alter_column("work_orders", "work_order_number", nullable=False)
            op.create_unique_constraint("uq_work_orders_number", "work_orders", ["work_order_number"])
            op.create_index("ix_work_orders_work_order_number", "work_orders", ["work_order_number"])

        # Legacy notes -> new description (keep both if notes exists).
        cols = _cols("work_orders")
        if "description" not in cols:
            op.add_column("work_orders", sa.Column("description", sa.Text(), nullable=True))
            if "notes" in cols:
                op.execute(sa.text("update work_orders set description = notes where description is null"))

        if "work_date" not in cols:
            op.add_column("work_orders", sa.Column("work_date", sa.Date(), nullable=True))
            # best-effort: use created_at date
            if "created_at" in cols:
                op.execute(sa.text("update work_orders set work_date = date(created_at) where work_date is null"))
            op.alter_column("work_orders", "work_date", nullable=False, server_default=sa.text("current_date"))

        if "is_active" not in cols:
            op.add_column("work_orders", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))

        for col_name, col in [
            ("approved_by", sa.Column("approved_by", sa.Integer(), nullable=True)),
            ("approved_at", sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True)),
            ("rejected_by", sa.Column("rejected_by", sa.Integer(), nullable=True)),
            ("rejected_at", sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True)),
        ]:
            if col_name not in cols:
                op.add_column("work_orders", col)

        # Foreign keys (best-effort; ignore if already present).
        cols = _cols("work_orders")
        if "approved_by" in cols:
            try:
                op.create_foreign_key(
                    "fk_work_orders_approved_by_users",
                    "work_orders",
                    "users",
                    ["approved_by"],
                    ["id"],
                    ondelete="SET NULL",
                )
            except Exception:
                pass
        if "rejected_by" in cols:
            try:
                op.create_foreign_key(
                    "fk_work_orders_rejected_by_users",
                    "work_orders",
                    "users",
                    ["rejected_by"],
                    ["id"],
                    ondelete="SET NULL",
                )
            except Exception:
                pass

    # ---- create missing child tables if needed ----
    if not _has_table("work_order_contractors"):
        op.create_table(
            "work_order_contractors",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("work_order_id", sa.Integer(), nullable=False),
            sa.Column("contractor_id", sa.Integer(), nullable=False),
            sa.Column("scope_notes", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["work_order_id"], ["work_orders.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["contractor_id"], ["contractors.id"], ondelete="RESTRICT"),
            sa.UniqueConstraint("work_order_id", "contractor_id", name="uq_work_order_contractors_wo_contractor"),
        )
        op.create_index("ix_work_order_contractors_work_order_id", "work_order_contractors", ["work_order_id"])
        op.create_index("ix_work_order_contractors_contractor_id", "work_order_contractors", ["contractor_id"])

    if not _has_table("work_order_items"):
        op.create_table(
            "work_order_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("work_order_contractor_id", sa.Integer(), nullable=False),
            sa.Column("rate_master_id", sa.Integer(), nullable=False),
            sa.Column("job_type", sa.String(length=64), nullable=False),
            sa.Column("skill_type", sa.String(length=32), nullable=False),
            sa.Column("unit", sa.String(length=16), nullable=False),
            sa.Column("progress_type", sa.String(length=16), nullable=False, server_default="quantity"),
            sa.Column("planned_quantity", sa.Numeric(14, 3), nullable=True),
            sa.Column("planned_percentage", sa.Numeric(7, 2), nullable=True),
            sa.Column("resolved_rate", sa.Numeric(12, 2), nullable=False),
            sa.Column("rate_source", sa.String(length=16), nullable=False, server_default="master"),
            sa.Column("contractor_rate_id", sa.Integer(), nullable=True),
            sa.Column("override_rate", sa.Numeric(12, 2), nullable=True),
            sa.Column("override_reason", sa.Text(), nullable=True),
            sa.Column("override_approval_request_id", sa.Integer(), nullable=True),
            sa.Column("override_status", sa.String(length=16), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(["work_order_contractor_id"], ["work_order_contractors.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["rate_master_id"], ["rate_master.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["contractor_rate_id"], ["contractor_rates.id"], ondelete="SET NULL"),
        )
        op.create_index("ix_work_order_items_work_order_contractor_id", "work_order_items", ["work_order_contractor_id"])
        op.create_index("ix_work_order_items_rate_master_id", "work_order_items", ["rate_master_id"])

    if not _has_table("work_order_item_progress"):
        op.create_table(
            "work_order_item_progress",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("work_order_item_id", sa.Integer(), nullable=False),
            sa.Column("completed_quantity", sa.Numeric(14, 3), nullable=True),
            sa.Column("completed_percentage", sa.Numeric(7, 2), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["work_order_item_id"], ["work_order_items.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        )
        op.create_index("ix_work_order_item_progress_work_order_item_id", "work_order_item_progress", ["work_order_item_id"])

    if not _has_table("work_order_audit_logs"):
        op.create_table(
            "work_order_audit_logs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("work_order_id", sa.Integer(), nullable=False),
            sa.Column("action", sa.String(length=64), nullable=False),
            sa.Column("changed_by", sa.Integer(), nullable=True),
            sa.Column("old_value", sa.JSON(), nullable=True),
            sa.Column("new_value", sa.JSON(), nullable=True),
            sa.Column("metadata_json", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["work_order_id"], ["work_orders.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["changed_by"], ["users.id"], ondelete="SET NULL"),
        )
        op.create_index("ix_work_order_audit_logs_work_order_id", "work_order_audit_logs", ["work_order_id"])

    # ---- invoices and compliance tables (create if missing) ----
    if not _has_table("invoices"):
        op.create_table(
            "invoices",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("contractor_id", sa.Integer(), nullable=False),
            sa.Column("org_unit_id", sa.Integer(), nullable=False),
            sa.Column("invoice_number", sa.String(length=64), nullable=False),
            sa.Column("invoice_date", sa.Date(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("currency", sa.String(length=8), nullable=False, server_default="INR"),
            sa.Column("total_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
            sa.Column("last_validated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("validation_status", sa.String(length=16), nullable=True),
            sa.Column("validation_score", sa.Numeric(7, 2), nullable=True),
            sa.Column("approval_request_id", sa.Integer(), nullable=True),
            sa.Column("approved_by", sa.Integer(), nullable=True),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("rejected_by", sa.Integer(), nullable=True),
            sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("submitted_by", sa.Integer(), nullable=True),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["contractor_id"], ["contractors.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["org_unit_id"], ["org_units.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["approved_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["rejected_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["submitted_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.UniqueConstraint("contractor_id", "org_unit_id", "invoice_number", name="uq_invoices_contractor_org_invoice_number"),
        )
        op.create_index("ix_invoices_contractor_id", "invoices", ["contractor_id"])
        op.create_index("ix_invoices_org_unit_id", "invoices", ["org_unit_id"])
        op.create_index("ix_invoices_status", "invoices", ["status"])

    if not _has_table("invoice_lines"):
        op.create_table(
            "invoice_lines",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("invoice_id", sa.Integer(), nullable=False),
            sa.Column("work_order_item_id", sa.Integer(), nullable=False),
            sa.Column("quantity", sa.Numeric(14, 3), nullable=False),
            sa.Column("rate", sa.Numeric(12, 2), nullable=False),
            sa.Column("amount", sa.Numeric(14, 2), nullable=False),
            sa.Column("rate_source", sa.String(length=16), nullable=True),
            sa.Column("resolved_contractor_rate_id", sa.Integer(), nullable=True),
            sa.Column("resolved_rate_master_id", sa.Integer(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["work_order_item_id"], ["work_order_items.id"], ondelete="RESTRICT"),
        )
        op.create_index("ix_invoice_lines_invoice_id", "invoice_lines", ["invoice_id"])

    if not _has_table("invoice_validation_issues"):
        op.create_table(
            "invoice_validation_issues",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("invoice_id", sa.Integer(), nullable=False),
            sa.Column("line_id", sa.Integer(), nullable=True),
            sa.Column("code", sa.String(length=64), nullable=False),
            sa.Column("severity", sa.String(length=16), nullable=False, server_default="warning"),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column("allowed_value", sa.Numeric(14, 2), nullable=True),
            sa.Column("actual_value", sa.Numeric(14, 2), nullable=True),
            sa.Column("allowed_qty", sa.Numeric(14, 3), nullable=True),
            sa.Column("actual_qty", sa.Numeric(14, 3), nullable=True),
            sa.Column("tolerance_pct", sa.Numeric(7, 2), nullable=True),
            sa.Column("requires_justification", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("requires_attachments", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("justification", sa.Text(), nullable=True),
            sa.Column("metadata_json", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["line_id"], ["invoice_lines.id"], ondelete="SET NULL"),
        )
        op.create_index("ix_invoice_validation_issues_invoice_id", "invoice_validation_issues", ["invoice_id"])

    if not _has_table("invoice_attachments"):
        op.create_table(
            "invoice_attachments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("invoice_id", sa.Integer(), nullable=False),
            sa.Column("file_path", sa.String(length=1024), nullable=False),
            sa.Column("file_name", sa.String(length=255), nullable=True),
            sa.Column("content_type", sa.String(length=128), nullable=True),
            sa.Column("uploaded_by", sa.Integer(), nullable=True),
            sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], ondelete="SET NULL"),
        )

    if not _has_table("invoice_audit_logs"):
        op.create_table(
            "invoice_audit_logs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("invoice_id", sa.Integer(), nullable=False),
            sa.Column("action", sa.String(length=64), nullable=False),
            sa.Column("changed_by", sa.Integer(), nullable=True),
            sa.Column("old_value", sa.JSON(), nullable=True),
            sa.Column("new_value", sa.JSON(), nullable=True),
            sa.Column("metadata_json", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["changed_by"], ["users.id"], ondelete="SET NULL"),
        )

    if not _has_table("contractor_invoice_compliance"):
        op.create_table(
            "contractor_invoice_compliance",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("contractor_id", sa.Integer(), nullable=False),
            sa.Column("invoices_total", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("invoices_blocked", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("tolerance_breaches", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("exception_approvals", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("overbilling_attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("compliance_score", sa.Numeric(7, 2), nullable=False, server_default="100"),
            sa.Column("last_computed_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["contractor_id"], ["contractors.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("contractor_id", name="uq_contractor_invoice_compliance_contractor"),
        )


def downgrade() -> None:
    # Keep downgrade minimal (schema reconcile is not cleanly reversible).
    pass

