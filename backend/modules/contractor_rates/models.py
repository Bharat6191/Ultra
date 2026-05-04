"""Negotiation workflow tables.

Three transactional tables and two audit tables:

* ``rate_master``                  - reference base rate per (job, skill, unit, plant)
* ``contractor_rates``             - a contractor's negotiated rate against a base rate
* ``negotiation_logs``             - per-round trail (proposal / counter / remarks)
* ``rate_master_audit_logs``       - audit history for base rate changes
* ``contractor_rate_audit_logs``   - field-level + lifecycle audit history

The model is intentionally portable (uses ``JSON`` rather than Postgres-only ``JSONB``
so the test fixtures can run against in-memory SQLite).
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


# --- Canonical enums (kept as plain strings for portability) ---

CONTRACTOR_RATE_STATUSES: tuple[str, ...] = (
    "draft",
    "pending_approval",
    "approved",
    "rejected",
    "expired",
    "cancelled",
)

# Free-form "unit of work" — kept open for plant-specific extensions.
RATE_UNITS: tuple[str, ...] = ("hour", "day", "shift", "job", "month")

SKILL_TYPES: tuple[str, ...] = ("skilled", "semi_skilled", "unskilled")


class RateMaster(Base):
    """Reference base rate for a (job, skill, unit, plant) combination.

    Multiple ``effective_from`` rows are allowed for the same combo (price history),
    but only **one** ``is_active=True`` row is permitted at any time per combo
    (enforced in the service layer; the DB has a uniqueness on ``effective_from``).
    """

    __tablename__ = "rate_master"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    job_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    skill_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    unit: Mapped[str] = mapped_column(String(16), nullable=False)
    base_rate: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    org_unit_id: Mapped[int] = mapped_column(
        ForeignKey("org_units.id", ondelete="CASCADE"), nullable=False, index=True
    )
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=true())
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    contractor_rates = relationship(
        "ContractorRate",
        back_populates="rate_master",
        lazy="select",
    )
    audit_logs = relationship(
        "RateMasterAuditLog",
        back_populates="rate_master",
        cascade="all, delete-orphan",
        order_by="RateMasterAuditLog.created_at.asc()",
        lazy="select",
    )

    __table_args__ = (
        UniqueConstraint(
            "job_type",
            "skill_type",
            "unit",
            "org_unit_id",
            "effective_from",
            name="uq_rate_master_combo_effective_from",
        ),
    )


class ContractorRate(Base):
    """A contractor's negotiated rate against a ``RateMaster`` row.

    Lifecycle:
      draft -> pending_approval -> approved -> (eventually expired)
                              \-> rejected
                              \-> cancelled
    """

    __tablename__ = "contractor_rates"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contractor_id: Mapped[int] = mapped_column(
        ForeignKey("contractors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    rate_master_id: Mapped[int] = mapped_column(
        ForeignKey("rate_master.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    negotiated_rate: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # ``initial_rate`` is the contractor's opening ask. It is captured on
    # ``create_rate`` and never mutated by negotiation rounds; savings is
    # computed against this anchor (clamped at 0) so the figure is always a
    # real "negotiated down by X" number — even when the final agreed rate
    # ends up above the procurement baseline (``rate_master.base_rate``).
    initial_rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    previous_rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    savings_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    savings_percentage: Mapped[Decimal | None] = mapped_column(Numeric(7, 2), nullable=True)

    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)

    status: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default="draft", index=True
    )
    current_round: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    approval_request_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    approved_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    rate_master = relationship("RateMaster", back_populates="contractor_rates")
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


class NegotiationLog(Base):
    """One round of the negotiation discussion (proposal/counter)."""

    __tablename__ = "negotiation_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contractor_rate_id: Mapped[int] = mapped_column(
        ForeignKey("contractor_rates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    round_number: Mapped[int] = mapped_column(Integer, nullable=False)
    proposed_rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    counter_rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    contractor_rate = relationship("ContractorRate", back_populates="negotiation_logs")

    __table_args__ = (
        UniqueConstraint(
            "contractor_rate_id", "round_number", name="uq_negotiation_logs_rate_round"
        ),
    )


class ContractorRateAuditLog(Base):
    """Field-level + lifecycle audit trail for a contractor's negotiated rate."""

    __tablename__ = "contractor_rate_audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contractor_rate_id: Mapped[int] = mapped_column(
        ForeignKey("contractor_rates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    changed_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    old_value: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    new_value: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    contractor_rate = relationship("ContractorRate", back_populates="audit_logs")


class RateMasterAuditLog(Base):
    """Audit trail for ``rate_master`` rows.

    Mirrors the ``contractor_rate_audit_logs`` shape so the timeline UI can render
    base-rate history with the same component as negotiation history.
    """

    __tablename__ = "rate_master_audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    rate_master_id: Mapped[int] = mapped_column(
        ForeignKey("rate_master.id", ondelete="CASCADE"), nullable=False, index=True
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    changed_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    old_value: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    new_value: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    rate_master = relationship("RateMaster", back_populates="audit_logs")
