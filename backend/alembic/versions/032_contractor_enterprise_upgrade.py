"""Contractor enterprise upgrade.

Adds:
- Contractor lifecycle: legal_name, trade_name, pan, gstin, cin, contractor_type,
  status, updated_by
- Documents: file_path, issue_date, verification_status, verified_by, verified_at,
  remarks, current_version
- ``contractor_document_versions`` (immutable per-version history)
- ``contractor_plants`` (M2M contractor <-> org_unit with role + dates)
- ``contractor_audit_logs`` (field-level audit trail)
- ``contractor_compliance_configs`` (config-driven critical doc list)

Revision ID: 032
Revises: 031
Create Date: 2026-05-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "032"
down_revision: str | None = "031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


CRITICAL_DOC_TYPES_DEFAULT: list[tuple[str, str, int]] = [
    ("kyc_address_proof", "KYC / Address Proof", 30),
    ("insurance_certificate", "Insurance Certificate", 30),
    ("safety_training_record", "Safety Training Record", 30),
    ("work_agreement", "Work Agreement", 30),
    ("pf_registration", "PF Registration", 30),
    ("esic_registration", "ESIC Registration", 30),
    ("labour_license", "Labour License", 30),
    ("gst_certificate", "GST Certificate", 30),
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    contractor_cols = {c["name"] for c in inspector.get_columns("contractors")}

    if "legal_name" not in contractor_cols:
        op.add_column("contractors", sa.Column("legal_name", sa.String(length=255), nullable=True))
    if "trade_name" not in contractor_cols:
        op.add_column("contractors", sa.Column("trade_name", sa.String(length=255), nullable=True))
    if "pan" not in contractor_cols:
        op.add_column("contractors", sa.Column("pan", sa.String(length=16), nullable=True))
    if "gstin" not in contractor_cols:
        op.add_column("contractors", sa.Column("gstin", sa.String(length=32), nullable=True))
    if "cin" not in contractor_cols:
        op.add_column("contractors", sa.Column("cin", sa.String(length=32), nullable=True))
    if "contractor_type" not in contractor_cols:
        op.add_column("contractors", sa.Column("contractor_type", sa.String(length=32), nullable=True))
    if "status" not in contractor_cols:
        op.add_column(
            "contractors",
            sa.Column(
                "status",
                sa.String(length=32),
                nullable=False,
                server_default="draft",
            ),
        )
    if "updated_by" not in contractor_cols:
        op.add_column(
            "contractors",
            sa.Column(
                "updated_by",
                sa.Integer(),
                sa.ForeignKey("users.id"),
                nullable=True,
            ),
        )

    # Lightweight indexes (only if missing).
    existing_idx = {ix["name"] for ix in inspector.get_indexes("contractors")}
    if "ix_contractors_status" not in existing_idx:
        op.create_index("ix_contractors_status", "contractors", ["status"], unique=False)
    if "ix_contractors_pan" not in existing_idx:
        op.create_index("ix_contractors_pan", "contractors", ["pan"], unique=False)
    if "ix_contractors_gstin" not in existing_idx:
        op.create_index("ix_contractors_gstin", "contractors", ["gstin"], unique=False)
    if "ix_contractors_contractor_type" not in existing_idx:
        op.create_index(
            "ix_contractors_contractor_type", "contractors", ["contractor_type"], unique=False
        )

    # Backfill: existing rows go to 'active' if is_active=true else 'suspended'.
    op.execute(
        sa.text(
            """
            UPDATE contractors
            SET status = CASE WHEN is_active = TRUE THEN 'active' ELSE 'suspended' END
            WHERE status = 'draft' OR status IS NULL
            """
        )
    )
    # Backfill: keep gst/pan canonical short fields aligned with legacy columns.
    op.execute(
        sa.text(
            "UPDATE contractors SET pan = COALESCE(pan, pan_number) WHERE pan_number IS NOT NULL"
        )
    )
    op.execute(
        sa.text(
            "UPDATE contractors SET gstin = COALESCE(gstin, gst_number) WHERE gst_number IS NOT NULL"
        )
    )

    # contractor_documents: add new columns if missing.
    doc_cols = {c["name"] for c in inspector.get_columns("contractor_documents")}
    if "file_path" not in doc_cols:
        op.add_column(
            "contractor_documents",
            sa.Column("file_path", sa.String(length=1024), nullable=True),
        )
        # Backfill file_path from the legacy file_url.
        op.execute(sa.text("UPDATE contractor_documents SET file_path = file_url"))
        # Now make NOT NULL.
        with op.batch_alter_table("contractor_documents") as batch:
            batch.alter_column("file_path", existing_type=sa.String(length=1024), nullable=False)
    if "issue_date" not in doc_cols:
        op.add_column(
            "contractor_documents",
            sa.Column("issue_date", sa.Date(), nullable=True),
        )
        op.execute(sa.text("UPDATE contractor_documents SET issue_date = issued_date"))
    if "verification_status" not in doc_cols:
        op.add_column(
            "contractor_documents",
            sa.Column(
                "verification_status",
                sa.String(length=16),
                nullable=False,
                server_default="pending",
            ),
        )
    if "verified_by" not in doc_cols:
        op.add_column(
            "contractor_documents",
            sa.Column(
                "verified_by",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
    if "verified_at" not in doc_cols:
        op.add_column(
            "contractor_documents",
            sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        )
    if "remarks" not in doc_cols:
        op.add_column("contractor_documents", sa.Column("remarks", sa.Text(), nullable=True))
    if "current_version" not in doc_cols:
        op.add_column(
            "contractor_documents",
            sa.Column("current_version", sa.Integer(), nullable=False, server_default="1"),
        )
    if "created_by" not in doc_cols:
        op.add_column(
            "contractor_documents",
            sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        )
    if "updated_at" not in doc_cols:
        op.add_column(
            "contractor_documents",
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
        )

    existing_doc_idx = {ix["name"] for ix in inspector.get_indexes("contractor_documents")}
    if "ix_contractor_documents_document_type" not in existing_doc_idx:
        op.create_index(
            "ix_contractor_documents_document_type",
            "contractor_documents",
            ["document_type"],
            unique=False,
        )
    if "ix_contractor_documents_verification_status" not in existing_doc_idx:
        op.create_index(
            "ix_contractor_documents_verification_status",
            "contractor_documents",
            ["verification_status"],
            unique=False,
        )

    if "contractor_document_versions" not in inspector.get_table_names():
        op.create_table(
            "contractor_document_versions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "document_id",
                sa.Integer(),
                sa.ForeignKey("contractor_documents.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("version_number", sa.Integer(), nullable=False),
            sa.Column("file_path", sa.String(length=1024), nullable=False),
            sa.Column("issue_date", sa.Date(), nullable=True),
            sa.Column("expiry_date", sa.Date(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column(
                "uploaded_by",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.UniqueConstraint(
                "document_id",
                "version_number",
                name="uq_contractor_document_versions_doc_version",
            ),
        )
        op.create_index(
            "ix_contractor_document_versions_document_id",
            "contractor_document_versions",
            ["document_id"],
            unique=False,
        )
        # Seed v1 from existing documents (best-effort; only when both present).
        op.execute(
            sa.text(
                """
                INSERT INTO contractor_document_versions (
                    document_id, version_number, file_path, issue_date, expiry_date,
                    remarks, uploaded_by, created_at
                )
                SELECT
                    d.id,
                    1,
                    COALESCE(d.file_path, d.file_url),
                    COALESCE(d.issue_date, d.issued_date),
                    d.expiry_date,
                    d.remarks,
                    d.created_by,
                    d.created_at
                FROM contractor_documents d
                WHERE COALESCE(d.file_path, d.file_url) IS NOT NULL
                """
            )
        )

    if "contractor_plants" not in inspector.get_table_names():
        op.create_table(
            "contractor_plants",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "contractor_id",
                sa.Integer(),
                sa.ForeignKey("contractors.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "org_unit_id",
                sa.Integer(),
                sa.ForeignKey("org_units.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "role",
                sa.String(length=32),
                server_default="approved_vendor",
                nullable=False,
            ),
            sa.Column("start_date", sa.Date(), nullable=True),
            sa.Column("end_date", sa.Date(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column(
                "created_by",
                sa.Integer(),
                sa.ForeignKey("users.id"),
                nullable=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.UniqueConstraint(
                "contractor_id",
                "org_unit_id",
                "role",
                name="uq_contractor_plants_contractor_org_role",
            ),
        )
        op.create_index(
            "ix_contractor_plants_contractor_id",
            "contractor_plants",
            ["contractor_id"],
            unique=False,
        )
        op.create_index(
            "ix_contractor_plants_org_unit_id",
            "contractor_plants",
            ["org_unit_id"],
            unique=False,
        )
        op.create_index(
            "ix_contractor_plants_end_date",
            "contractor_plants",
            ["end_date"],
            unique=False,
        )

    if "contractor_audit_logs" not in inspector.get_table_names():
        op.create_table(
            "contractor_audit_logs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "contractor_id",
                sa.Integer(),
                sa.ForeignKey("contractors.id", ondelete="CASCADE"),
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
                server_default=sa.text("now()"),
                nullable=False,
            ),
        )
        op.create_index(
            "ix_contractor_audit_logs_contractor_id",
            "contractor_audit_logs",
            ["contractor_id"],
            unique=False,
        )
        op.create_index(
            "ix_contractor_audit_logs_action",
            "contractor_audit_logs",
            ["action"],
            unique=False,
        )
        op.create_index(
            "ix_contractor_audit_logs_created_at",
            "contractor_audit_logs",
            ["created_at"],
            unique=False,
        )

    if "contractor_compliance_configs" not in inspector.get_table_names():
        op.create_table(
            "contractor_compliance_configs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("document_type", sa.String(length=64), nullable=False, unique=True),
            sa.Column("label", sa.String(length=255), nullable=True),
            sa.Column(
                "is_critical",
                sa.Boolean(),
                server_default=sa.text("true"),
                nullable=False,
            ),
            sa.Column("warn_days", sa.Integer(), server_default="7", nullable=False),
            sa.Column(
                "is_active",
                sa.Boolean(),
                server_default=sa.text("true"),
                nullable=False,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
        )
        # Seed default critical doc types.
        for code, label, warn in CRITICAL_DOC_TYPES_DEFAULT:
            op.execute(
                sa.text(
                    """
                    INSERT INTO contractor_compliance_configs
                        (document_type, label, is_critical, warn_days, is_active, created_at, updated_at)
                    VALUES (:c, :l, TRUE, :w, TRUE, now(), now())
                    """
                ).bindparams(c=code, l=label, w=warn)
            )

    # Seed RBAC permissions for the expanded contractor module so existing roles can be
    # granted these new permissions immediately. The sync script is the source of truth,
    # but seeding here makes upgrades atomic.
    op.execute(
        sa.text(
            """
            INSERT INTO permissions (feature_id, action, code, description, created_at)
            SELECT f.id, 'verify_documents', 'contractor.verify_documents',
                   'Verify or reject contractor documents', now()
            FROM features f
            WHERE f.key = 'contractor'
              AND NOT EXISTS (
                SELECT 1 FROM permissions p
                WHERE p.feature_id = f.id AND p.code = 'contractor.verify_documents'
              )
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO permissions (feature_id, action, code, description, created_at)
            SELECT f.id, 'manage_plants', 'contractor.manage_plants',
                   'Add/remove contractor <-> plant mappings', now()
            FROM features f
            WHERE f.key = 'contractor'
              AND NOT EXISTS (
                SELECT 1 FROM permissions p
                WHERE p.feature_id = f.id AND p.code = 'contractor.manage_plants'
              )
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO permissions (feature_id, action, code, description, created_at)
            SELECT f.id, 'activate', 'contractor.activate',
                   'Activate or change lifecycle status of a contractor', now()
            FROM features f
            WHERE f.key = 'contractor'
              AND NOT EXISTS (
                SELECT 1 FROM permissions p
                WHERE p.feature_id = f.id AND p.code = 'contractor.activate'
              )
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "contractor_compliance_configs" in inspector.get_table_names():
        op.drop_table("contractor_compliance_configs")

    if "contractor_audit_logs" in inspector.get_table_names():
        op.drop_index("ix_contractor_audit_logs_created_at", table_name="contractor_audit_logs")
        op.drop_index("ix_contractor_audit_logs_action", table_name="contractor_audit_logs")
        op.drop_index(
            "ix_contractor_audit_logs_contractor_id", table_name="contractor_audit_logs"
        )
        op.drop_table("contractor_audit_logs")

    if "contractor_plants" in inspector.get_table_names():
        op.drop_index("ix_contractor_plants_end_date", table_name="contractor_plants")
        op.drop_index("ix_contractor_plants_org_unit_id", table_name="contractor_plants")
        op.drop_index("ix_contractor_plants_contractor_id", table_name="contractor_plants")
        op.drop_table("contractor_plants")

    if "contractor_document_versions" in inspector.get_table_names():
        op.drop_index(
            "ix_contractor_document_versions_document_id",
            table_name="contractor_document_versions",
        )
        op.drop_table("contractor_document_versions")

    # Drop new contractors columns + indexes.
    existing_idx = {ix["name"] for ix in inspector.get_indexes("contractors")}
    for ix in (
        "ix_contractors_contractor_type",
        "ix_contractors_gstin",
        "ix_contractors_pan",
        "ix_contractors_status",
    ):
        if ix in existing_idx:
            op.drop_index(ix, table_name="contractors")

    contractor_cols = {c["name"] for c in inspector.get_columns("contractors")}
    for col in (
        "updated_by",
        "status",
        "contractor_type",
        "cin",
        "gstin",
        "pan",
        "trade_name",
        "legal_name",
    ):
        if col in contractor_cols:
            op.drop_column("contractors", col)

    doc_cols = {c["name"] for c in inspector.get_columns("contractor_documents")}
    for col in (
        "current_version",
        "remarks",
        "verified_at",
        "verified_by",
        "verification_status",
        "issue_date",
        "file_path",
        "created_by",
        "updated_at",
    ):
        if col in doc_cols:
            op.drop_column("contractor_documents", col)

    op.execute(sa.text("DELETE FROM permissions WHERE code IN ('contractor.verify_documents','contractor.manage_plants','contractor.activate')"))
