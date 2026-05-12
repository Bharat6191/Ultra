"""Work Order operational execution models.

Design goals:
- Portable across SQLite/Postgres (use JSON not JSONB).
- Auditability: dedicated audit log table with old/new/metadata.
- Approval gating: ``approval_request_id`` stored on the WorkOrder header.
- **One work order → one contractor**; line items reference Part Master parts.
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
    func,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


WORK_ORDER_STATUSES: tuple[str, ...] = (
    "draft",
    "pending_approval",
    "approved",
    "rejected",
    "cancelled",
    "active",
    "closed",
)

WORK_ORDER_ITEM_PROGRESS_TYPES: tuple[str, ...] = ("percentage", "quantity")


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    work_order_number: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)

    org_unit_id: Mapped[int] = mapped_column(
        ForeignKey("org_units.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    contractor_id: Mapped[int] = mapped_column(
        ForeignKey("contractors.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    work_date: Mapped[date] = mapped_column(Date, nullable=False)

    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default="draft", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=true())

    approval_request_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Sum of line taxable_value at activation; governs cumulative invoice ex-VAT amounts (with tolerance).
    approved_value_total: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)

    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    items = relationship(
        "WorkOrderItem",
        back_populates="work_order",
        cascade="all, delete-orphan",
        order_by="WorkOrderItem.id.asc()",
        lazy="selectin",
    )
    audit_logs = relationship(
        "WorkOrderAuditLog",
        back_populates="work_order",
        cascade="all, delete-orphan",
        order_by="WorkOrderAuditLog.created_at.asc()",
        lazy="select",
    )


class WorkOrderItem(Base):
    __tablename__ = "work_order_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    work_order_id: Mapped[int] = mapped_column(
        ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )

    part_master_id: Mapped[int] = mapped_column(
        ForeignKey("part_master.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    pricing_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)

    progress_type: Mapped[str] = mapped_column(String(16), nullable=False, server_default="quantity")
    planned_quantity: Mapped[Decimal | None] = mapped_column(Numeric(14, 3), nullable=True)
    planned_percentage: Mapped[Decimal | None] = mapped_column(Numeric(7, 2), nullable=True)

    resolved_rate: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    rate_source: Mapped[str] = mapped_column(String(16), nullable=False, server_default="master")  # negotiated|master|override
    contractor_rate_id: Mapped[int | None] = mapped_column(
        ForeignKey("contractor_rates.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Snapshot of kg-per-piece (or similar) used for commercial math at WO creation; required for weight_based per_kg.
    weight_per_piece_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)
    # quantity × (weight × rate or rate) at creation / repricing — preserved for audit and invoice caps.
    taxable_value: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, server_default="0")

    # Governance: if an override was requested, it is stored separately and only takes effect once approved.
    override_rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    override_approval_request_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    override_status: Mapped[str | None] = mapped_column(String(16), nullable=True)  # pending|approved|rejected

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    work_order = relationship("WorkOrder", back_populates="items")
    progress = relationship(
        "WorkOrderItemProgress",
        back_populates="item",
        cascade="all, delete-orphan",
        order_by="WorkOrderItemProgress.created_at.asc()",
        lazy="selectin",
    )


class WorkOrderItemProgress(Base):
    __tablename__ = "work_order_item_progress"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    work_order_item_id: Mapped[int] = mapped_column(
        ForeignKey("work_order_items.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Either quantity or percent can be used. Service layer enforces consistency with item.progress_type.
    completed_quantity: Mapped[Decimal | None] = mapped_column(Numeric(14, 3), nullable=True)
    completed_percentage: Mapped[Decimal | None] = mapped_column(Numeric(7, 2), nullable=True)

    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    item = relationship("WorkOrderItem", back_populates="progress")


class WorkOrderAuditLog(Base):
    __tablename__ = "work_order_audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    work_order_id: Mapped[int] = mapped_column(
        ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # NOTE: legacy DBs store this as `actor_user_id` (unified audit naming).
    actor_user_id: Mapped[int | None] = mapped_column(
        "actor_user_id",
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    old_value: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    new_value: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    work_order = relationship("WorkOrder", back_populates="audit_logs")
