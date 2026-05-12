"""Part Master — central commercial master for negotiations, work orders, and invoices."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base

PRICING_METHODS: tuple[str, ...] = ("weight_based", "piece_based")
RATE_UNIT_TYPES: tuple[str, ...] = ("per_kg", "per_piece", "per_unit", "per_box", "per_nos")
PART_STATUSES: tuple[str, ...] = ("draft", "active", "inactive", "superseded")


class PartMaster(Base):
    __tablename__ = "part_master"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    part_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    part_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    unit_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    pricing_method: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    weight_per_piece: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)

    labour_headcount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    standard_man_hours: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)

    base_rate: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    rate_unit_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)

    org_unit_id: Mapped[int] = mapped_column(
        ForeignKey("org_units.id", ondelete="CASCADE"), nullable=False, index=True
    )
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=true())
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default="active", index=True)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    audit_logs = relationship(
        "PartMasterAuditLog",
        back_populates="part_master",
        cascade="all, delete-orphan",
        order_by="PartMasterAuditLog.created_at.asc()",
        lazy="select",
    )
    versions = relationship(
        "PartMasterVersion",
        back_populates="part_master",
        cascade="all, delete-orphan",
        order_by="PartMasterVersion.version_number.asc()",
        lazy="select",
    )
    attachments = relationship(
        "PartMasterAttachment",
        back_populates="part_master",
        cascade="all, delete-orphan",
        order_by="PartMasterAttachment.uploaded_at.asc()",
        lazy="select",
    )

    __table_args__ = (
        UniqueConstraint(
            "part_code",
            "org_unit_id",
            "effective_from",
            name="uq_part_master_code_org_effective_from",
        ),
    )


class PartMasterAuditLog(Base):
    __tablename__ = "part_master_audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    part_master_id: Mapped[int] = mapped_column(
        ForeignKey("part_master.id", ondelete="CASCADE"), nullable=False, index=True
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    changed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    old_value: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    new_value: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    part_master = relationship("PartMaster", back_populates="audit_logs")


class PartMasterVersion(Base):
    __tablename__ = "part_master_versions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    part_master_id: Mapped[int] = mapped_column(
        ForeignKey("part_master.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    change_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    part_master = relationship("PartMaster", back_populates="versions")

    __table_args__ = (
        UniqueConstraint(
            "part_master_id",
            "version_number",
            name="uq_part_master_versions_parent_version",
        ),
    )


class PartMasterAttachment(Base):
    __tablename__ = "part_master_attachments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    part_master_id: Mapped[int] = mapped_column(
        ForeignKey("part_master.id", ondelete="CASCADE"), nullable=False, index=True
    )
    file_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    part_master = relationship("PartMaster", back_populates="attachments")
