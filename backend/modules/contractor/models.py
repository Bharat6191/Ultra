"""Contractor master + plant mapping + document versioning + audit log models.

This module models a fully enterprise contractor master, designed to support:
  * Lifecycle status (draft / pending / active / suspended / blacklisted / expired / non_compliant)
  * Many-to-many contractor <-> plant (org_unit) mapping with effective dates and a role
  * Document compliance (issue/expiry, verification, versioning, criticality)
  * Field-level audit trail (CREATED / UPDATED / STATUS_CHANGED / DOCUMENT_* / PLANT_MAPPING_*)

The model is intentionally additive: existing rows continue to work, new columns default
to safe values. Critical-doc list is configured via ``contractor_compliance_configs``.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


# Canonical contractor lifecycle statuses.
CONTRACTOR_STATUSES: tuple[str, ...] = (
    "draft",
    "pending",
    "active",
    "suspended",
    "blacklisted",
    "expired",
    "non_compliant",
)

# Canonical contractor types.
CONTRACTOR_TYPES: tuple[str, ...] = ("vendor", "labour", "service", "epc")

# Canonical plant-mapping roles.
CONTRACTOR_PLANT_ROLES: tuple[str, ...] = (
    "approved_vendor",
    "temporary",
    "restricted",
)

# Canonical document verification statuses.
DOCUMENT_VERIFICATION_STATUSES: tuple[str, ...] = ("pending", "verified", "rejected")


class Contractor(Base):
    __tablename__ = "contractors"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contractor_code: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)

    # Identity
    name: Mapped[str] = mapped_column(String(255), nullable=False)  # legacy/display
    legal_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    trade_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Statutory IDs (canonical short fields used across compliance + reporting).
    pan: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    gstin: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    cin: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)

    # Classification
    contractor_type: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)

    # Lifecycle status (free-form for migration; service layer enforces CONTRACTOR_STATUSES).
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default="draft", index=True
    )

    # Existing/legacy contact fields, retained for backward compatibility.
    contact_person: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_person_title: Mapped[str | None] = mapped_column(String(128), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    alternate_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    alternate_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    city: Mapped[str | None] = mapped_column(String(128), nullable=True)
    state: Mapped[str | None] = mapped_column(String(128), nullable=True)
    country: Mapped[str | None] = mapped_column(String(128), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # Legacy column kept (mirrors ``gstin`` / ``pan``); service layer keeps them in sync.
    gst_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    pan_number: Mapped[str | None] = mapped_column(String(16), nullable=True)

    registration_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    website: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Operational
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=true())

    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    documents = relationship(
        "ContractorDocument",
        back_populates="contractor",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    plants = relationship(
        "ContractorPlant",
        back_populates="contractor",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    audit_logs = relationship(
        "ContractorAuditLog",
        back_populates="contractor",
        cascade="all, delete-orphan",
        order_by="ContractorAuditLog.created_at.asc()",
    )


class ContractorPlant(Base):
    """Many-to-many mapping of contractors to plants (``org_units``).

    A contractor may operate at multiple plants, with different roles and effective dates.
    A null ``end_date`` means open-ended. Compliance logic flags expired mappings.
    """

    __tablename__ = "contractor_plants"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contractor_id: Mapped[int] = mapped_column(
        ForeignKey("contractors.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    org_unit_id: Mapped[int] = mapped_column(
        ForeignKey("org_units.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default="approved_vendor"
    )
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    contractor = relationship("Contractor", back_populates="plants")

    __table_args__ = (
        UniqueConstraint(
            "contractor_id",
            "org_unit_id",
            "role",
            name="uq_contractor_plants_contractor_org_role",
        ),
    )


class ContractorDocument(Base):
    """A contractor document. Latest verified version is denormalized here for fast filters."""

    __tablename__ = "contractor_documents"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contractor_id: Mapped[int] = mapped_column(
        ForeignKey("contractors.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    document_name: Mapped[str] = mapped_column(String(255), nullable=False)
    document_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # Latest version metadata (mirrored from contractor_document_versions for query speed).
    file_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    # Backward compat alias retained for older clients/migrations.
    file_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    issue_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    issued_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)

    verification_status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="pending", index=True
    )
    verified_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    current_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")

    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    contractor = relationship("Contractor", back_populates="documents")
    versions = relationship(
        "ContractorDocumentVersion",
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="ContractorDocumentVersion.version_number.desc()",
        lazy="selectin",
    )


class ContractorDocumentVersion(Base):
    """Immutable per-version record of a contractor document upload."""

    __tablename__ = "contractor_document_versions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("contractor_documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    file_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    issue_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    uploaded_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    document = relationship("ContractorDocument", back_populates="versions")

    __table_args__ = (
        UniqueConstraint(
            "document_id",
            "version_number",
            name="uq_contractor_document_versions_doc_version",
        ),
    )


class ContractorAuditLog(Base):
    """Field-level audit trail for contractors.

    ``action`` examples:
      * CREATED
      * UPDATED  (old_value/new_value contain only changed fields)
      * STATUS_CHANGED
      * DOCUMENT_UPLOADED / DOCUMENT_VERIFIED / DOCUMENT_REJECTED
      * PLANT_MAPPING_ADDED / PLANT_MAPPING_REMOVED / PLANT_MAPPING_UPDATED
    """

    __tablename__ = "contractor_audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contractor_id: Mapped[int] = mapped_column(
        ForeignKey("contractors.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    changed_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    old_value: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    new_value: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        index=True,
    )

    contractor = relationship("Contractor", back_populates="audit_logs")


class ContractorComplianceConfig(Base):
    """Config-driven critical document policy.

    A document_type marked ``is_critical=true`` (and active) means: an expired or missing
    instance of this type causes the contractor to be flagged ``non_compliant``.
    """

    __tablename__ = "contractor_compliance_configs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    document_type: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_critical: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=true())
    warn_days: Mapped[int] = mapped_column(Integer, nullable=False, server_default="7")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=true())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
