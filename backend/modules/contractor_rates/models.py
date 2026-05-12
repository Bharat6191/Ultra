"""Negotiation workflow tables (contractor rates) + negotiation round attachments.

Commercial baselines live in ``part_master`` (see :mod:`modules.part_master.models`).
"""

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

CONTRACTOR_RATE_STATUSES: tuple[str, ...] = (
    "draft",
    "pending_approval",
    "approved",
    "rejected",
    "expired",
    "cancelled",
)


class ContractorRate(Base):
    """A contractor's negotiated rate against a ``PartMaster`` row."""

    __tablename__ = "contractor_rates"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contractor_id: Mapped[int] = mapped_column(
        ForeignKey("contractors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    part_master_id: Mapped[int] = mapped_column(
        ForeignKey("part_master.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    negotiated_rate: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    initial_rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    previous_rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    savings_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    savings_percentage: Mapped[Decimal | None] = mapped_column(Numeric(7, 2), nullable=True)

    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)

    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default="draft", index=True)
    current_round: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    approval_request_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    negotiation_logs = relationship(
        "NegotiationLog",
        back_populates="contractor_rate",
        cascade="all, delete-orphan",
        order_by="NegotiationLog.round_number.asc()",
        lazy="selectin",
    )
    audit_logs = relationship(
        "ContractorRateAuditLog",
        back_populates="contractor_rate",
        cascade="all, delete-orphan",
        order_by="ContractorRateAuditLog.created_at.asc()",
        lazy="select",
    )
    versions = relationship(
        "ContractorRateVersion",
        back_populates="contractor_rate",
        cascade="all, delete-orphan",
        order_by="ContractorRateVersion.version_number.asc()",
        lazy="select",
    )


class NegotiationLog(Base):
    __tablename__ = "negotiation_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contractor_rate_id: Mapped[int] = mapped_column(
        ForeignKey("contractor_rates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    round_number: Mapped[int] = mapped_column(Integer, nullable=False)
    proposed_rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    counter_rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    round_summary: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    contractor_rate = relationship("ContractorRate", back_populates="negotiation_logs")
    attachments = relationship(
        "NegotiationAttachment",
        back_populates="negotiation_log",
        cascade="all, delete-orphan",
        order_by="NegotiationAttachment.uploaded_at.asc()",
        lazy="selectin",
    )

    __table_args__ = (
        UniqueConstraint("contractor_rate_id", "round_number", name="uq_negotiation_logs_rate_round"),
    )


class NegotiationAttachment(Base):
    __tablename__ = "negotiation_attachments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    negotiation_log_id: Mapped[int] = mapped_column(
        ForeignKey("negotiation_logs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    file_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    negotiation_log = relationship("NegotiationLog", back_populates="attachments")


class ContractorRateAuditLog(Base):
    __tablename__ = "contractor_rate_audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contractor_rate_id: Mapped[int] = mapped_column(
        ForeignKey("contractor_rates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    changed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    old_value: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    new_value: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    contractor_rate = relationship("ContractorRate", back_populates="audit_logs")


class ContractorRateVersion(Base):
    __tablename__ = "contractor_rate_versions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contractor_rate_id: Mapped[int] = mapped_column(
        ForeignKey("contractor_rates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    change_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    contractor_rate = relationship("ContractorRate", back_populates="versions")

    __table_args__ = (
        UniqueConstraint(
            "contractor_rate_id",
            "version_number",
            name="uq_contractor_rate_versions_parent_version",
        ),
    )
