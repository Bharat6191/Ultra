"""Pydantic request/response shapes for the contractor rate negotiation module."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from modules.contractor_rates.models import (
    CONTRACTOR_RATE_STATUSES,
    RATE_UNITS,
    SKILL_TYPES,
)


# ----- Rate master -----


class RateMasterCreate(BaseModel):
    job_type: str = Field(min_length=1, max_length=64)
    skill_type: str = Field(min_length=1, max_length=32)
    unit: str = Field(min_length=1, max_length=16)
    base_rate: Decimal = Field(gt=Decimal("0"))
    org_unit_id: int = Field(ge=1)
    effective_from: date
    effective_to: date | None = None
    is_active: bool = True
    notes: str | None = None

    @field_validator("skill_type")
    @classmethod
    def _normalize_skill(cls, v: str) -> str:
        s = v.strip().lower().replace("-", "_").replace(" ", "_")
        # Allow any free-form skill, but warn-strict for the canonical three.
        return s

    @field_validator("unit")
    @classmethod
    def _normalize_unit(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("job_type")
    @classmethod
    def _strip_job(cls, v: str) -> str:
        return v.strip()


class RateMasterUpdate(BaseModel):
    base_rate: Decimal | None = Field(default=None, gt=Decimal("0"))
    effective_from: date | None = None
    effective_to: date | None = None
    is_active: bool | None = None
    notes: str | None = None


class RateMasterPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_type: str
    skill_type: str
    unit: str
    base_rate: Decimal
    org_unit_id: int
    org_unit_name: str | None = None
    effective_from: date
    effective_to: date | None = None
    is_active: bool
    notes: str | None = None
    created_by: int | None = None
    created_at: datetime
    updated_at: datetime


class RateMasterAuditEntry(BaseModel):
    """One row of the rate master audit log."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    rate_master_id: int
    action: str
    changed_by: int | None = None
    changed_by_name: str | None = None
    old_value: dict[str, Any] | None = None
    new_value: dict[str, Any] | None = None
    metadata_json: dict[str, Any] | None = None
    created_at: datetime


# ----- Contractor rate (negotiation) -----


class ContractorRateCreate(BaseModel):
    contractor_id: int = Field(ge=1)
    rate_master_id: int = Field(ge=1)
    negotiated_rate: Decimal = Field(gt=Decimal("0"))
    initial_rate: Decimal | None = Field(
        default=None,
        gt=Decimal("0"),
        description=(
            "Optional override for the contractor's opening ask. When omitted, "
            "the first ``negotiated_rate`` is treated as the opening ask. "
            "Round 1 may still lift this if the proposed_rate is higher."
        ),
    )
    effective_from: date
    effective_to: date | None = None
    remarks: str | None = None


class ContractorRateUpdate(BaseModel):
    negotiated_rate: Decimal | None = Field(default=None, gt=Decimal("0"))
    effective_from: date | None = None
    effective_to: date | None = None
    remarks: str | None = None


class NegotiationRoundCreate(BaseModel):
    proposed_rate: Decimal | None = Field(default=None, gt=Decimal("0"))
    counter_rate: Decimal | None = Field(default=None, gt=Decimal("0"))
    remarks: str | None = None
    apply_to_negotiated_rate: bool = Field(
        default=True,
        description=(
            "If true, the round's counter_rate (or proposed_rate) becomes the new "
            "negotiated_rate on the parent contractor_rate row. Set false to record "
            "discussion only."
        ),
    )


class NegotiationRoundPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    contractor_rate_id: int
    round_number: int
    proposed_rate: Decimal | None = None
    counter_rate: Decimal | None = None
    remarks: str | None = None
    created_by: int | None = None
    created_by_name: str | None = None
    created_at: datetime


class ContractorRateAuditEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    contractor_rate_id: int
    action: str
    changed_by: int | None = None
    changed_by_name: str | None = None
    old_value: dict[str, Any] | None = None
    new_value: dict[str, Any] | None = None
    metadata_json: dict[str, Any] | None = None
    created_at: datetime


class ContractorRatePublic(BaseModel):
    """Read shape returned by list/detail endpoints."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    contractor_id: int
    contractor_name: str | None = None
    rate_master_id: int
    job_type: str | None = None
    skill_type: str | None = None
    unit: str | None = None
    org_unit_id: int | None = None
    org_unit_name: str | None = None
    base_rate: Decimal | None = None

    negotiated_rate: Decimal
    initial_rate: Decimal | None = None
    previous_rate: Decimal | None = None
    # Negotiation savings — anchored on ``initial_rate`` (always >= 0).
    savings_amount: Decimal | None = None
    savings_percentage: Decimal | None = None
    # Vs-base metrics — signed (positive => paying above procurement baseline).
    vs_base_amount: Decimal | None = None
    vs_base_percentage: Decimal | None = None

    effective_from: date
    effective_to: date | None = None

    status: str
    current_round: int
    remarks: str | None = None
    approval_request_id: int | None = None
    approved_by: int | None = None
    approved_at: datetime | None = None
    rejected_by: int | None = None
    rejected_at: datetime | None = None

    created_by: int | None = None
    created_by_name: str | None = None
    created_at: datetime
    updated_at: datetime

    rounds: list[NegotiationRoundPublic] = Field(default_factory=list)


class RateVersionEntry(BaseModel):
    """One immutable snapshot of a rate (base rate or contractor rate)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    parent_id: int = Field(description="rate_master_id or contractor_rate_id")
    version_number: int
    snapshot_json: dict[str, Any]
    change_reason: str | None = None
    created_by: int | None = None
    created_by_name: str | None = None
    created_at: datetime
    # Derived: the standardised diff vs. the previous version (None for v1).
    diff: list[dict[str, Any]] | None = None


class RateCardRowPublic(BaseModel):
    """One row in the unified Rate Card view."""

    model_config = ConfigDict(from_attributes=True)

    rate_master_id: int
    job_type: str
    skill_type: str
    unit: str
    org_unit_id: int
    org_unit_name: str | None = None

    base_rate: Decimal
    base_rate_status: str
    base_rate_is_active: bool
    base_rate_effective_from: date
    base_rate_effective_to: date | None = None
    notes: str | None = None

    contractor_id: int | None = None
    contractor_name: str | None = None
    contractor_rate_id: int | None = None
    contractor_rate: Decimal | None = None
    previous_rate: Decimal | None = None
    contractor_rate_status: str | None = None
    contractor_rate_effective_from: date | None = None
    contractor_rate_effective_to: date | None = None

    vs_base_amount: Decimal | None = None
    vs_base_percentage: Decimal | None = None
    vs_previous_amount: Decimal | None = None
    vs_previous_percentage: Decimal | None = None


class RateCardBenchmark(BaseModel):
    total_rates: int
    active: int
    upcoming: int
    expired: int
    above_base: int
    below_base: int
    at_base: int
    total_premium_above_base: Decimal
    total_savings_below_base: Decimal
    rates_with_previous: int
    net_vs_previous: Decimal
    net_vs_base: Decimal


class ContractorRateTimelineEvent(BaseModel):
    """Unified timeline entry combining audit, rounds, and approval activity."""

    occurred_at: datetime
    kind: str  # "audit" | "negotiation" | "approval"
    action: str
    actor_user_id: int | None = None
    actor_name: str | None = None
    title: str
    description: str | None = None
    payload: dict[str, Any] | None = None


__all__ = [
    "RateMasterCreate",
    "RateMasterUpdate",
    "RateMasterPublic",
    "RateMasterAuditEntry",
    "ContractorRateCreate",
    "ContractorRateUpdate",
    "NegotiationRoundCreate",
    "NegotiationRoundPublic",
    "ContractorRateAuditEntry",
    "ContractorRatePublic",
    "ContractorRateTimelineEvent",
    "RateVersionEntry",
    "RateCardRowPublic",
    "RateCardBenchmark",
    "CONTRACTOR_RATE_STATUSES",
    "RATE_UNITS",
    "SKILL_TYPES",
]
