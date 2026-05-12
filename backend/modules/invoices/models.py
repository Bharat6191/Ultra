"""Invoice + validation models.

Invoices are contractor-submitted (or ops-entered) and validated against:
  - approved work orders and their completed quantities/percentages
  - resolved rates (negotiated/master) and governance overrides
  - tolerance rules and cumulative invoicing caps
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

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


INVOICE_STATUSES: tuple[str, ...] = (
    "draft",
    "submitted",
    "blocked",
    "pending_exception_approval",
    "approved",
    "rejected",
    "paid",
    "cancelled",
)

VALIDATION_SEVERITIES: tuple[str, ...] = ("info", "warning", "error", "blocker")


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contractor_id: Mapped[int] = mapped_column(
        ForeignKey("contractors.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    org_unit_id: Mapped[int] = mapped_column(
        ForeignKey("org_units.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    invoice_number: Mapped[str] = mapped_column(String(64), nullable=False)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)

    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default="draft", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=true())

    currency: Mapped[str] = mapped_column(String(8), nullable=False, server_default="INR")
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, server_default="0")

    # Validation summary (denormalised for dashboards).
    last_validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    validation_status: Mapped[str | None] = mapped_column(String(16), nullable=True)  # pass|warn|fail|blocked
    validation_score: Mapped[Decimal | None] = mapped_column(Numeric(7, 2), nullable=True)  # 0..100

    # Approval workflow for exceptions (created when violations require escalation).
    approval_request_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    submitted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    lines = relationship(
        "InvoiceLine",
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="InvoiceLine.id.asc()",
        lazy="selectin",
    )
    issues = relationship(
        "InvoiceValidationIssue",
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="InvoiceValidationIssue.id.asc()",
        lazy="selectin",
    )
    audit_logs = relationship(
        "InvoiceAuditLog",
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="InvoiceAuditLog.created_at.asc()",
        lazy="select",
    )
    attachments = relationship(
        "InvoiceAttachment",
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="InvoiceAttachment.id.asc()",
        lazy="selectin",
    )

    __table_args__ = (
        UniqueConstraint(
            "contractor_id",
            "org_unit_id",
            "invoice_number",
            name="uq_invoices_contractor_org_invoice_number",
        ),
    )


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    work_order_item_id: Mapped[int] = mapped_column(
        ForeignKey("work_order_items.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    tax_pct: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)

    # Validation context snapshots for traceability
    rate_source: Mapped[str | None] = mapped_column(String(16), nullable=True)  # negotiated|master|override
    resolved_contractor_rate_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    resolved_part_master_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    invoice = relationship("Invoice", back_populates="lines")


class InvoiceValidationIssue(Base):
    __tablename__ = "invoice_validation_issues"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    line_id: Mapped[int | None] = mapped_column(
        ForeignKey("invoice_lines.id", ondelete="SET NULL"), nullable=True, index=True
    )

    code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, server_default="warning", index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)

    # Numeric deltas for analytics
    allowed_value: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    actual_value: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    allowed_qty: Mapped[Decimal | None] = mapped_column(Numeric(14, 3), nullable=True)
    actual_qty: Mapped[Decimal | None] = mapped_column(Numeric(14, 3), nullable=True)
    tolerance_pct: Mapped[Decimal | None] = mapped_column(Numeric(7, 2), nullable=True)

    requires_justification: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    requires_attachments: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    justification: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    invoice = relationship("Invoice", back_populates="issues")


class InvoiceAttachment(Base):
    __tablename__ = "invoice_attachments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    file_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    invoice = relationship("Invoice", back_populates="attachments")


class InvoiceAuditLog(Base):
    __tablename__ = "invoice_audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    changed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    old_value: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    new_value: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    invoice = relationship("Invoice", back_populates="audit_logs")


class ContractorInvoiceCompliance(Base):
    """Contractor-level compliance intelligence (rolling aggregates)."""

    __tablename__ = "contractor_invoice_compliance"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contractor_id: Mapped[int] = mapped_column(
        ForeignKey("contractors.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )

    invoices_total: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    invoices_blocked: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    tolerance_breaches: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    exception_approvals: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    overbilling_attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    # 0..100 (derived). Stored for fast dashboards.
    compliance_score: Mapped[Decimal] = mapped_column(Numeric(7, 2), nullable=False, server_default="100")
    last_computed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

