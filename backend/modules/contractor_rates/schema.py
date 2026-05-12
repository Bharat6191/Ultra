"""Pydantic request/response shapes for the contractor rate negotiation module."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from modules.contractor_rates.models import CONTRACTOR_RATE_STATUSES


# ----- Contractor rate (negotiation) -----


class ContractorRateCreate(BaseModel):
    contractor_id: int = Field(ge=1)
    part_master_id: int = Field(ge=1)
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
    round_summary: str | None = Field(default=None, max_length=255)
    apply_to_negotiated_rate: bool = Field(
        default=True,
        description=(
            "If true, the round's counter_rate (or proposed_rate) becomes the new "
            "negotiated_rate on the parent contractor_rate row. Set false to record "
            "discussion only."
        ),
    )


class NegotiationAttachmentPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    file_path: str
    file_name: str | None = None
    content_type: str | None = None
    uploaded_by: int | None = None
    uploaded_at: datetime


class OpeningEvidenceUploadResult(BaseModel):
    """Response after seeding round 1 (opening evidence) and storing files."""

    negotiation_log_id: int
    attachments: list[NegotiationAttachmentPublic]


class NegotiationRoundPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    contractor_rate_id: int
    round_number: int
    proposed_rate: Decimal | None = None
    counter_rate: Decimal | None = None
    remarks: str | None = None
    round_summary: str | None = None
    created_by: int | None = None
    created_by_name: str | None = None
    created_at: datetime
    attachments: list[NegotiationAttachmentPublic] = Field(default_factory=list)


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
    part_master_id: int
    part_code: str | None = None
    part_name: str | None = None
    unit_type: str | None = None
    pricing_method: str | None = None
    rate_unit_type: str | None = None
    weight_per_piece: Decimal | None = None
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
    parent_id: int = Field(description="part_master_id or contractor_rate_id")
    version_number: int
    snapshot_json: dict[str, Any]
    change_reason: str | None = None
    created_by: int | None = None
    created_by_name: str | None = None
    created_at: datetime
    # Derived: the standardised diff vs. the previous version (None for v1).
    diff: list[dict[str, Any]] | None = None


class RateCardNegotiationPublic(BaseModel):
    """One contractor line item when the rate card is built without ``contractor_id``."""

    contractor_id: int
    contractor_name: str
    contractor_rate_id: int
    negotiated_rate: Decimal
    previous_rate: Decimal | None = None
    contractor_rate_status: str | None = None
    contractor_rate_effective_from: date | None = None
    contractor_rate_effective_to: date | None = None
    vs_base_amount: Decimal | None = None
    vs_base_percentage: Decimal | None = None
    vs_previous_amount: Decimal | None = None
    vs_previous_percentage: Decimal | None = None


class RateCardRowPublic(BaseModel):
    """One row in the unified Rate Card view."""

    model_config = ConfigDict(from_attributes=True)

    part_master_id: int
    part_code: str
    part_name: str
    unit_type: str
    pricing_method: str
    rate_unit_type: str
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

    negotiations: list[RateCardNegotiationPublic] = Field(default_factory=list)


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
    "ContractorRateCreate",
    "ContractorRateUpdate",
    "NegotiationRoundCreate",
    "NegotiationAttachmentPublic",
    "OpeningEvidenceUploadResult",
    "NegotiationRoundPublic",
    "ContractorRateAuditEntry",
    "ContractorRatePublic",
    "ContractorRateTimelineEvent",
    "RateVersionEntry",
    "RateCardNegotiationPublic",
    "RateCardRowPublic",
    "RateCardBenchmark",
    "CONTRACTOR_RATE_STATUSES",
]
