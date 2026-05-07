"""Rate Master & Benchmark Control (3.4): versioning + strict validity.

Adds:

* ``rate_master_versions``        – immutable snapshots per ``rate_master`` mutation
* ``contractor_rate_versions``    – immutable snapshots per ``contractor_rate`` mutation
* ``rate_card`` feature + ``rate_card.view`` permission

Also seeds **initial v1 snapshots** for every existing rate_master /
contractor_rate row so the version history UI shows a baseline immediately.

The unified Rate Card view itself is derived (no new table) and is implemented
in the service layer.

Revision ID: 036
Revises: 035
Create Date: 2026-05-05
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "036"
down_revision: str | None = "035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _now_default() -> sa.sql.elements.TextClause:
    return sa.text("now()")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names())

    # ---------- rate_master_versions ----------
    if "rate_master_versions" not in existing:
        op.create_table(
            "rate_master_versions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "rate_master_id",
                sa.Integer(),
                sa.ForeignKey("rate_master.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("version_number", sa.Integer(), nullable=False),
            sa.Column("snapshot_json", sa.JSON(), nullable=False),
            sa.Column("change_reason", sa.String(length=64), nullable=True),
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
                "rate_master_id",
                "version_number",
                name="uq_rate_master_versions_parent_version",
            ),
        )
        op.create_index(
            "ix_rate_master_versions_rate_master_id",
            "rate_master_versions",
            ["rate_master_id"],
            unique=False,
        )
        op.create_index(
            "ix_rate_master_versions_created_at",
            "rate_master_versions",
            ["created_at"],
            unique=False,
        )

    # ---------- contractor_rate_versions ----------
    if "contractor_rate_versions" not in existing:
        op.create_table(
            "contractor_rate_versions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "contractor_rate_id",
                sa.Integer(),
                sa.ForeignKey("contractor_rates.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("version_number", sa.Integer(), nullable=False),
            sa.Column("snapshot_json", sa.JSON(), nullable=False),
            sa.Column("change_reason", sa.String(length=64), nullable=True),
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
                "version_number",
                name="uq_contractor_rate_versions_parent_version",
            ),
        )
        op.create_index(
            "ix_contractor_rate_versions_contractor_rate_id",
            "contractor_rate_versions",
            ["contractor_rate_id"],
            unique=False,
        )
        op.create_index(
            "ix_contractor_rate_versions_created_at",
            "contractor_rate_versions",
            ["created_at"],
            unique=False,
        )

    # ---------- Seed v1 snapshots for existing rows ----------
    # Postgres-only JSON construction. ``json_build_object`` keeps the snapshot
    # readable and future-proof against column additions.
    op.execute(
        sa.text(
            """
            INSERT INTO rate_master_versions
                (rate_master_id, version_number, snapshot_json, change_reason, created_by, created_at)
            SELECT
                rm.id,
                1,
                json_build_object(
                    'id', rm.id,
                    'job_type', rm.job_type,
                    'skill_type', rm.skill_type,
                    'unit', rm.unit,
                    'base_rate', rm.base_rate::text,
                    'org_unit_id', rm.org_unit_id,
                    'effective_from', rm.effective_from,
                    'effective_to', rm.effective_to,
                    'is_active', rm.is_active,
                    'notes', rm.notes
                ),
                'BACKFILL',
                rm.created_by,
                rm.created_at
            FROM rate_master rm
            WHERE NOT EXISTS (
                SELECT 1 FROM rate_master_versions v WHERE v.rate_master_id = rm.id
            )
            """
        )
    )

    op.execute(
        sa.text(
            """
            INSERT INTO contractor_rate_versions
                (contractor_rate_id, version_number, snapshot_json, change_reason, created_by, created_at)
            SELECT
                cr.id,
                1,
                json_build_object(
                    'id', cr.id,
                    'contractor_id', cr.contractor_id,
                    'rate_master_id', cr.rate_master_id,
                    'negotiated_rate', cr.negotiated_rate::text,
                    'initial_rate', cr.initial_rate::text,
                    'previous_rate', cr.previous_rate::text,
                    'savings_amount', cr.savings_amount::text,
                    'savings_percentage', cr.savings_percentage::text,
                    'effective_from', cr.effective_from,
                    'effective_to', cr.effective_to,
                    'status', cr.status,
                    'remarks', cr.remarks
                ),
                'BACKFILL',
                cr.created_by,
                cr.created_at
            FROM contractor_rates cr
            WHERE NOT EXISTS (
                SELECT 1 FROM contractor_rate_versions v WHERE v.contractor_rate_id = cr.id
            )
            """
        )
    )

    # ---------- rate_card feature + permission ----------
    op.execute(
        sa.text(
            """
            INSERT INTO features (key, name, created_at)
            SELECT 'rate_card', 'Rate card', now()
            WHERE NOT EXISTS (SELECT 1 FROM features WHERE key = 'rate_card')
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO permissions (feature_id, action, code, description, created_at)
            SELECT f.id, 'view', 'rate_card.view',
                   'View unified Rate Card (plant + contractor + benchmark)', now()
            FROM features f
            WHERE f.key = 'rate_card'
              AND NOT EXISTS (
                SELECT 1 FROM permissions p WHERE p.feature_id = f.id AND p.code = 'rate_card.view'
              )
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names())

    if "contractor_rate_versions" in existing:
        op.drop_index(
            "ix_contractor_rate_versions_created_at",
            table_name="contractor_rate_versions",
        )
        op.drop_index(
            "ix_contractor_rate_versions_contractor_rate_id",
            table_name="contractor_rate_versions",
        )
        op.drop_table("contractor_rate_versions")

    if "rate_master_versions" in existing:
        op.drop_index(
            "ix_rate_master_versions_created_at", table_name="rate_master_versions"
        )
        op.drop_index(
            "ix_rate_master_versions_rate_master_id", table_name="rate_master_versions"
        )
        op.drop_table("rate_master_versions")

    op.execute(sa.text("DELETE FROM permissions WHERE code = 'rate_card.view'"))
    op.execute(sa.text("DELETE FROM features WHERE key = 'rate_card'"))
