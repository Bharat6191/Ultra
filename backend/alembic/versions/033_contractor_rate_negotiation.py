"""Negotiation workflow module (3.3).

Adds:
  * ``rate_master``                  - reference base rate per (job, skill, unit, plant)
  * ``contractor_rates``             - a contractor's negotiated rate against a base rate
  * ``negotiation_logs``             - per-round trail (proposal / counter / remarks)
  * ``contractor_rate_audit_logs``   - field-level + lifecycle audit history

Also seeds RBAC permissions for ``rate_master.*`` and ``contractor_rates.*`` so
existing roles can immediately be granted the new permissions. The canonical
sync script (``scripts/sync_modules.py``) remains the source of truth.

Revision ID: 033
Revises: 032
Create Date: 2026-05-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "033"
down_revision: str | None = "032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _now_default() -> sa.sql.elements.TextClause:
    return sa.text("now()")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names())

    # ---------- rate_master ----------
    if "rate_master" not in existing:
        op.create_table(
            "rate_master",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("job_type", sa.String(length=64), nullable=False),
            sa.Column("skill_type", sa.String(length=32), nullable=False),
            sa.Column("unit", sa.String(length=16), nullable=False),
            sa.Column("base_rate", sa.Numeric(12, 2), nullable=False),
            sa.Column(
                "org_unit_id",
                sa.Integer(),
                sa.ForeignKey("org_units.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("effective_from", sa.Date(), nullable=False),
            sa.Column("effective_to", sa.Date(), nullable=True),
            sa.Column(
                "is_active",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("true"),
            ),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column(
                "created_by",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=_now_default(),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=_now_default(),
                nullable=False,
            ),
            sa.UniqueConstraint(
                "job_type",
                "skill_type",
                "unit",
                "org_unit_id",
                "effective_from",
                name="uq_rate_master_combo_effective_from",
            ),
        )
        op.create_index(
            "ix_rate_master_job_type", "rate_master", ["job_type"], unique=False
        )
        op.create_index(
            "ix_rate_master_skill_type", "rate_master", ["skill_type"], unique=False
        )
        op.create_index(
            "ix_rate_master_org_unit_id", "rate_master", ["org_unit_id"], unique=False
        )

    # ---------- contractor_rates ----------
    if "contractor_rates" not in existing:
        op.create_table(
            "contractor_rates",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "contractor_id",
                sa.Integer(),
                sa.ForeignKey("contractors.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "rate_master_id",
                sa.Integer(),
                sa.ForeignKey("rate_master.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("negotiated_rate", sa.Numeric(12, 2), nullable=False),
            sa.Column("previous_rate", sa.Numeric(12, 2), nullable=True),
            sa.Column("savings_amount", sa.Numeric(12, 2), nullable=True),
            sa.Column("savings_percentage", sa.Numeric(7, 2), nullable=True),
            sa.Column("effective_from", sa.Date(), nullable=False),
            sa.Column("effective_to", sa.Date(), nullable=True),
            sa.Column(
                "status",
                sa.String(length=32),
                nullable=False,
                server_default=sa.text("'draft'"),
            ),
            sa.Column(
                "current_round", sa.Integer(), nullable=False, server_default=sa.text("0")
            ),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("approval_request_id", sa.Integer(), nullable=True),
            sa.Column(
                "approved_by",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "rejected_by",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_by",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=_now_default(),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=_now_default(),
                nullable=False,
            ),
        )
        op.create_index(
            "ix_contractor_rates_contractor_id",
            "contractor_rates",
            ["contractor_id"],
            unique=False,
        )
        op.create_index(
            "ix_contractor_rates_rate_master_id",
            "contractor_rates",
            ["rate_master_id"],
            unique=False,
        )
        op.create_index(
            "ix_contractor_rates_status", "contractor_rates", ["status"], unique=False
        )
        op.create_index(
            "ix_contractor_rates_approval_request_id",
            "contractor_rates",
            ["approval_request_id"],
            unique=False,
        )

    # ---------- negotiation_logs ----------
    if "negotiation_logs" not in existing:
        op.create_table(
            "negotiation_logs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "contractor_rate_id",
                sa.Integer(),
                sa.ForeignKey("contractor_rates.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("round_number", sa.Integer(), nullable=False),
            sa.Column("proposed_rate", sa.Numeric(12, 2), nullable=True),
            sa.Column("counter_rate", sa.Numeric(12, 2), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column(
                "created_by",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=_now_default(),
                nullable=False,
            ),
            sa.UniqueConstraint(
                "contractor_rate_id",
                "round_number",
                name="uq_negotiation_logs_rate_round",
            ),
        )
        op.create_index(
            "ix_negotiation_logs_contractor_rate_id",
            "negotiation_logs",
            ["contractor_rate_id"],
            unique=False,
        )

    # ---------- contractor_rate_audit_logs ----------
    if "contractor_rate_audit_logs" not in existing:
        op.create_table(
            "contractor_rate_audit_logs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "contractor_rate_id",
                sa.Integer(),
                sa.ForeignKey("contractor_rates.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("action", sa.String(length=64), nullable=False),
            sa.Column(
                "changed_by",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("old_value", sa.JSON(), nullable=True),
            sa.Column("new_value", sa.JSON(), nullable=True),
            sa.Column("metadata_json", sa.JSON(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=_now_default(),
                nullable=False,
            ),
        )
        op.create_index(
            "ix_contractor_rate_audit_logs_contractor_rate_id",
            "contractor_rate_audit_logs",
            ["contractor_rate_id"],
            unique=False,
        )
        op.create_index(
            "ix_contractor_rate_audit_logs_action",
            "contractor_rate_audit_logs",
            ["action"],
            unique=False,
        )
        op.create_index(
            "ix_contractor_rate_audit_logs_created_at",
            "contractor_rate_audit_logs",
            ["created_at"],
            unique=False,
        )

    # ---------- Seed RBAC features + permissions ----------
    # Each module needs a feature row so permissions can attach to it; the
    # canonical sync script (scripts/sync_modules.py) is the source of truth,
    # but seeding here makes upgrades atomic and immediately usable.
    for feature_key, feature_name in (
        ("rate_master", "Rate master"),
        ("contractor_rates", "Contractor negotiated rates"),
    ):
        op.execute(
            sa.text(
                """
                INSERT INTO features (key, name, created_at)
                SELECT :k, :n, now()
                WHERE NOT EXISTS (SELECT 1 FROM features WHERE key = :k)
                """
            ).bindparams(k=feature_key, n=feature_name)
        )

    permission_seed: list[tuple[str, str, str, str]] = [
        # (feature_key, action, code, description)
        ("rate_master", "view", "rate_master.view", "View rate master entries"),
        ("rate_master", "create", "rate_master.create", "Create rate master entries"),
        ("rate_master", "update", "rate_master.update", "Update rate master entries"),
        ("rate_master", "delete", "rate_master.delete", "Delete rate master entries"),
        ("contractor_rates", "view", "contractor_rates.view", "View contractor negotiated rates"),
        (
            "contractor_rates",
            "create",
            "contractor_rates.create",
            "Create contractor negotiated rates",
        ),
        (
            "contractor_rates",
            "update",
            "contractor_rates.update",
            "Update contractor negotiated rates",
        ),
        (
            "contractor_rates",
            "delete",
            "contractor_rates.delete",
            "Delete contractor negotiated rates",
        ),
        (
            "contractor_rates",
            "approve",
            "contractor_rates.approve",
            "Approve contractor negotiated rates",
        ),
    ]
    for feature_key, action, code, description in permission_seed:
        op.execute(
            sa.text(
                """
                INSERT INTO permissions (feature_id, action, code, description, created_at)
                SELECT f.id, :a, :c, :d, now()
                FROM features f
                WHERE f.key = :k
                  AND NOT EXISTS (
                    SELECT 1 FROM permissions p
                    WHERE p.feature_id = f.id AND p.code = :c
                  )
                """
            ).bindparams(k=feature_key, a=action, c=code, d=description)
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names())

    if "contractor_rate_audit_logs" in existing:
        op.drop_index(
            "ix_contractor_rate_audit_logs_created_at",
            table_name="contractor_rate_audit_logs",
        )
        op.drop_index(
            "ix_contractor_rate_audit_logs_action",
            table_name="contractor_rate_audit_logs",
        )
        op.drop_index(
            "ix_contractor_rate_audit_logs_contractor_rate_id",
            table_name="contractor_rate_audit_logs",
        )
        op.drop_table("contractor_rate_audit_logs")

    if "negotiation_logs" in existing:
        op.drop_index(
            "ix_negotiation_logs_contractor_rate_id", table_name="negotiation_logs"
        )
        op.drop_table("negotiation_logs")

    if "contractor_rates" in existing:
        op.drop_index(
            "ix_contractor_rates_approval_request_id", table_name="contractor_rates"
        )
        op.drop_index("ix_contractor_rates_status", table_name="contractor_rates")
        op.drop_index(
            "ix_contractor_rates_rate_master_id", table_name="contractor_rates"
        )
        op.drop_index(
            "ix_contractor_rates_contractor_id", table_name="contractor_rates"
        )
        op.drop_table("contractor_rates")

    if "rate_master" in existing:
        op.drop_index("ix_rate_master_org_unit_id", table_name="rate_master")
        op.drop_index("ix_rate_master_skill_type", table_name="rate_master")
        op.drop_index("ix_rate_master_job_type", table_name="rate_master")
        op.drop_table("rate_master")

    op.execute(
        sa.text(
            """
            DELETE FROM permissions WHERE code IN (
                'rate_master.view',
                'rate_master.create',
                'rate_master.update',
                'rate_master.delete',
                'contractor_rates.view',
                'contractor_rates.create',
                'contractor_rates.update',
                'contractor_rates.delete',
                'contractor_rates.approve'
            )
            """
        )
    )
