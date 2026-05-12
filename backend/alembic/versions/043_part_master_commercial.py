"""Part Master replaces Rate Master; commercial snapshots on work order lines.

Revision ID: 043
Revises: 042
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text


revision: str = "043"
down_revision: str | None = "042"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _now_default() -> sa.sql.elements.TextClause:
    return sa.text("now()")


def _drop_fk_to_table(table: str, referred: str) -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    for fk in insp.get_foreign_keys(table):
        if fk.get("referred_table") == referred and fk.get("name"):
            op.drop_constraint(fk["name"], table, type_="foreignkey")


def _drop_all_foreign_keys_to_rate_master(bind) -> None:
    """Remove every FK that still targets ``rate_master`` (e.g. legacy ``work_order_lines``).

    Known paths above already drop FKs on ``contractor_rates`` / ``work_order_items``;
    this catches renamed or forked tables so ``DROP TABLE rate_master`` can succeed.
    """
    while True:
        insp = sa.inspect(bind)
        if "rate_master" not in insp.get_table_names():
            return
        to_drop: list[tuple[str, str]] = []
        for table_name in sorted(insp.get_table_names()):
            for fk in insp.get_foreign_keys(table_name):
                if fk.get("referred_table") != "rate_master":
                    continue
                cname = fk.get("name")
                if cname:
                    to_drop.append((table_name, str(cname)))
        if not to_drop:
            return
        for table_name, cname in to_drop:
            op.drop_constraint(cname, table_name, type_="foreignkey")


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = set(insp.get_table_names())
    dialect = bind.dialect.name

    # ---------- part_master ----------
    if "part_master" not in existing:
        op.create_table(
            "part_master",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("part_code", sa.String(length=64), nullable=False),
            sa.Column("part_name", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("unit_type", sa.String(length=32), nullable=False),
            sa.Column("pricing_method", sa.String(length=32), nullable=False),
            sa.Column("weight_per_piece", sa.Numeric(14, 6), nullable=True),
            sa.Column("base_rate", sa.Numeric(12, 2), nullable=False),
            sa.Column("rate_unit_type", sa.String(length=32), nullable=False),
            sa.Column("org_unit_id", sa.Integer(), sa.ForeignKey("org_units.id", ondelete="CASCADE"), nullable=False),
            sa.Column("effective_from", sa.Date(), nullable=False),
            sa.Column("effective_to", sa.Date(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=_now_default(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_now_default(), nullable=False),
            sa.UniqueConstraint("part_code", "org_unit_id", "effective_from", name="uq_part_master_code_org_effective_from"),
        )
        op.create_index("ix_part_master_part_code", "part_master", ["part_code"], unique=False)
        op.create_index("ix_part_master_org_unit_id", "part_master", ["org_unit_id"], unique=False)
        op.create_index("ix_part_master_unit_type", "part_master", ["unit_type"], unique=False)
        op.create_index("ix_part_master_pricing_method", "part_master", ["pricing_method"], unique=False)
        op.create_index("ix_part_master_rate_unit_type", "part_master", ["rate_unit_type"], unique=False)
        op.create_index("ix_part_master_status", "part_master", ["status"], unique=False)

    if "rate_master" in existing:
        cols = {c["name"] for c in insp.get_columns("rate_master")}
        if "part_code" not in cols:
            # Legacy table shape: widen into part_master via INSERT..SELECT (preserve ids).
            if dialect == "sqlite":
                bind.execute(
                    text(
                        """
                        INSERT INTO part_master (
                          id, part_code, part_name, description, unit_type, pricing_method, weight_per_piece,
                          base_rate, rate_unit_type, org_unit_id, effective_from, effective_to, is_active, status,
                          notes, created_by, created_at, updated_at
                        )
                        SELECT
                          id,
                          'P-' || printf('%04d', id),
                          job_type,
                          skill_type || ' / ' || job_type,
                          upper(unit),
                          CASE lower(unit) WHEN 'kg' THEN 'weight_based' ELSE 'piece_based' END,
                          NULL,
                          base_rate,
                          CASE lower(unit) WHEN 'kg' THEN 'per_kg' ELSE 'per_piece' END,
                          org_unit_id,
                          effective_from,
                          effective_to,
                          is_active,
                          CASE WHEN is_active THEN 'active' ELSE 'inactive' END,
                          notes,
                          created_by,
                          created_at,
                          updated_at
                        FROM rate_master
                        WHERE NOT EXISTS (SELECT 1 FROM part_master pm WHERE pm.id = rate_master.id)
                        """
                    )
                )
            else:
                bind.execute(
                    text(
                        """
                        INSERT INTO part_master (
                          id, part_code, part_name, description, unit_type, pricing_method, weight_per_piece,
                          base_rate, rate_unit_type, org_unit_id, effective_from, effective_to, is_active, status,
                          notes, created_by, created_at, updated_at
                        )
                        SELECT
                          rm.id,
                          'P-' || lpad(rm.id::text, 4, '0'),
                          rm.job_type,
                          rm.skill_type || ' / ' || rm.job_type,
                          upper(rm.unit),
                          CASE lower(rm.unit) WHEN 'kg' THEN 'weight_based' ELSE 'piece_based' END,
                          NULL,
                          rm.base_rate,
                          CASE lower(rm.unit) WHEN 'kg' THEN 'per_kg' ELSE 'per_piece' END,
                          rm.org_unit_id,
                          rm.effective_from,
                          rm.effective_to,
                          rm.is_active,
                          CASE WHEN rm.is_active THEN 'active' ELSE 'inactive' END,
                          rm.notes,
                          rm.created_by,
                          rm.created_at,
                          rm.updated_at
                        FROM rate_master rm
                        WHERE NOT EXISTS (SELECT 1 FROM part_master pm WHERE pm.id = rm.id)
                        """
                    )
                )

    # ---------- contractor_rates.part_master_id ----------
    if "contractor_rates" in existing:
        cr_cols = {c["name"] for c in insp.get_columns("contractor_rates")}
        if "part_master_id" not in cr_cols and "rate_master_id" in cr_cols:
            with op.batch_alter_table("contractor_rates") as batch:
                batch.add_column(sa.Column("part_master_id", sa.Integer(), nullable=True))
            bind.execute(text("UPDATE contractor_rates SET part_master_id = rate_master_id"))
            _drop_fk_to_table("contractor_rates", "rate_master")
            with op.batch_alter_table("contractor_rates") as batch:
                batch.drop_column("rate_master_id")
                batch.alter_column("part_master_id", existing_type=sa.Integer(), nullable=False)
                batch.create_foreign_key(
                    "fk_contractor_rates_part_master",
                    "part_master",
                    ["part_master_id"],
                    ["id"],
                    ondelete="RESTRICT",
                )

    # ---------- work_order_items ----------
    if "work_order_items" in existing:
        woi_cols = {c["name"] for c in insp.get_columns("work_order_items")}
        if "pricing_snapshot" not in woi_cols:
            with op.batch_alter_table("work_order_items") as batch:
                batch.add_column(sa.Column("pricing_snapshot", sa.JSON(), nullable=True))
                batch.add_column(sa.Column("part_master_id", sa.Integer(), nullable=True))
        if "rate_master_id" in woi_cols:
            if dialect == "sqlite":
                bind.execute(
                    text(
                        """
                        UPDATE work_order_items
                        SET part_master_id = rate_master_id,
                            pricing_snapshot = (
                              SELECT json_object(
                                'part_master_id', pm.id,
                                'part_code', pm.part_code,
                                'part_name', pm.part_name,
                                'pricing_method', pm.pricing_method,
                                'rate_unit_type', pm.rate_unit_type,
                                'weight_per_piece', pm.weight_per_piece,
                                'unit_type', pm.unit_type
                              )
                              FROM part_master pm WHERE pm.id = work_order_items.rate_master_id
                            )
                        """
                    )
                )
            else:
                bind.execute(
                    text(
                        """
                        UPDATE work_order_items woi
                        SET part_master_id = woi.rate_master_id,
                            pricing_snapshot = to_jsonb(json_build_object(
                                'part_master_id', pm.id,
                                'part_code', pm.part_code,
                                'part_name', pm.part_name,
                                'pricing_method', pm.pricing_method,
                                'rate_unit_type', pm.rate_unit_type,
                                'weight_per_piece', pm.weight_per_piece,
                                'unit_type', pm.unit_type
                            ))
                        FROM part_master pm
                        WHERE pm.id = woi.rate_master_id
                        """
                    )
                )
            _drop_fk_to_table("work_order_items", "rate_master")
            with op.batch_alter_table("work_order_items") as batch:
                batch.drop_column("rate_master_id")
                batch.alter_column("part_master_id", existing_type=sa.Integer(), nullable=False)
                batch.create_foreign_key(
                    "fk_work_order_items_part_master",
                    "part_master",
                    ["part_master_id"],
                    ["id"],
                    ondelete="RESTRICT",
                )
                for legacy in ("job_type", "skill_type", "unit"):
                    if legacy in woi_cols:
                        batch.drop_column(legacy)
                batch.alter_column("pricing_snapshot", existing_type=sa.JSON(), nullable=False)

    # ---------- invoice_lines ----------
    if "invoice_lines" in existing:
        il_cols = {c["name"] for c in insp.get_columns("invoice_lines")}
        if "resolved_part_master_id" not in il_cols and "resolved_rate_master_id" in il_cols:
            with op.batch_alter_table("invoice_lines") as batch:
                batch.add_column(sa.Column("resolved_part_master_id", sa.Integer(), nullable=True))
            bind.execute(text("UPDATE invoice_lines SET resolved_part_master_id = resolved_rate_master_id"))
            with op.batch_alter_table("invoice_lines") as batch:
                batch.drop_column("resolved_rate_master_id")

    # ---------- negotiation_logs.round_summary + attachments ----------
    if "negotiation_logs" in existing:
        nl_cols = {c["name"] for c in insp.get_columns("negotiation_logs")}
        if "round_summary" not in nl_cols:
            with op.batch_alter_table("negotiation_logs") as batch:
                batch.add_column(sa.Column("round_summary", sa.String(length=255), nullable=True))

    if "negotiation_attachments" not in existing:
        op.create_table(
            "negotiation_attachments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "negotiation_log_id",
                sa.Integer(),
                sa.ForeignKey("negotiation_logs.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("file_path", sa.String(length=1024), nullable=False),
            sa.Column("file_name", sa.String(length=255), nullable=True),
            sa.Column("content_type", sa.String(length=128), nullable=True),
            sa.Column("uploaded_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=_now_default(), nullable=False),
        )
        op.create_index(
            "ix_negotiation_attachments_negotiation_log_id",
            "negotiation_attachments",
            ["negotiation_log_id"],
            unique=False,
        )

    if "part_master_attachments" not in existing:
        op.create_table(
            "part_master_attachments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "part_master_id",
                sa.Integer(),
                sa.ForeignKey("part_master.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("file_path", sa.String(length=1024), nullable=False),
            sa.Column("file_name", sa.String(length=255), nullable=True),
            sa.Column("content_type", sa.String(length=128), nullable=True),
            sa.Column("uploaded_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=_now_default(), nullable=False),
        )
        op.create_index(
            "ix_part_master_attachments_part_master_id",
            "part_master_attachments",
            ["part_master_id"],
            unique=False,
        )

    # ---------- Rename audit / version tables ----------
    if "rate_master_audit_logs" in existing and "part_master_audit_logs" not in existing:
        _drop_fk_to_table("rate_master_audit_logs", "rate_master")
        op.rename_table("rate_master_audit_logs", "part_master_audit_logs")
        with op.batch_alter_table("part_master_audit_logs") as batch:
            batch.alter_column(
                "rate_master_id",
                new_column_name="part_master_id",
                existing_type=sa.Integer(),
                existing_nullable=False,
            )
            batch.create_foreign_key(
                "fk_part_master_audit_logs_part_master",
                "part_master",
                ["part_master_id"],
                ["id"],
                ondelete="CASCADE",
            )

    if "rate_master_versions" in existing and "part_master_versions" not in existing:
        _drop_fk_to_table("rate_master_versions", "rate_master")
        op.rename_table("rate_master_versions", "part_master_versions")
        with op.batch_alter_table("part_master_versions") as batch:
            batch.alter_column(
                "rate_master_id",
                new_column_name="part_master_id",
                existing_type=sa.Integer(),
                existing_nullable=False,
            )
            batch.create_foreign_key(
                "fk_part_master_versions_part_master",
                "part_master",
                ["part_master_id"],
                ["id"],
                ondelete="CASCADE",
            )

    if "rate_master" in existing:
        _drop_all_foreign_keys_to_rate_master(bind)
        op.drop_table("rate_master")

    # ---------- RBAC: rename rate_master.* permissions + feature key ----------
    if "features" in existing:
        res_rm = bind.execute(text("SELECT id FROM features WHERE key = 'rate_master' LIMIT 1")).first()
        res_pm = bind.execute(text("SELECT id FROM features WHERE key = 'part_master' LIMIT 1")).first()
        if res_rm is not None and res_pm is None:
            bind.execute(text("UPDATE features SET key = 'part_master', name = 'Part master' WHERE key = 'rate_master'"))
        elif res_rm is not None and res_pm is not None:
            # ``sync_modules`` (or a prior run) already created ``part_master``; cannot rename
            # ``rate_master`` in place without violating ``uq_features_key``. Repoint role rows
            # to the canonical ``part_master`` permissions (same ``action``), then drop legacy.
            rm_id = int(res_rm[0])
            pm_id = int(res_pm[0])
            bind.execute(
                text(
                    """
                    UPDATE role_permissions AS rp
                    SET permission_id = np.id
                    FROM permissions AS op
                    INNER JOIN permissions AS np
                      ON np.feature_id = :pm_id AND np.action = op.action
                    WHERE rp.permission_id = op.id
                      AND op.feature_id = :rm_id
                      AND NOT EXISTS (
                        SELECT 1 FROM role_permissions x
                        WHERE x.role_id = rp.role_id AND x.permission_id = np.id
                      )
                    """
                ),
                {"rm_id": rm_id, "pm_id": pm_id},
            )
            bind.execute(
                text(
                    "DELETE FROM role_permissions WHERE permission_id IN "
                    "(SELECT id FROM permissions WHERE feature_id = :rm_id)"
                ),
                {"rm_id": rm_id},
            )
            bind.execute(text("DELETE FROM permissions WHERE feature_id = :rm_id"), {"rm_id": rm_id})
            bind.execute(text("DELETE FROM features WHERE id = :rm_id"), {"rm_id": rm_id})
    if "permissions" in existing:
        for old, new in (
            ("rate_master.view", "part_master.view"),
            ("rate_master.create", "part_master.create"),
            ("rate_master.update", "part_master.update"),
            ("rate_master.delete", "part_master.delete"),
        ):
            bind.execute(
                text(
                    "UPDATE permissions SET code = :new WHERE code = :old "
                    "AND NOT EXISTS (SELECT 1 FROM permissions x WHERE x.code = :new)"
                ),
                {"old": old, "new": new},
            )


def downgrade() -> None:
    raise NotImplementedError("Downgrade not supported for Part Master migration.")
