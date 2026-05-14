from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from modules.part_master.models import BILLING_BASIS, PART_STATUSES, PRICING_METHODS, RATE_UNIT_TYPES


class PartMasterCreate(BaseModel):
    part_code: str = Field(min_length=1, max_length=64)
    part_name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    unit_type: str = Field(min_length=1, max_length=32)
    pricing_method: str = Field(min_length=1, max_length=32)
    billing_basis: str | None = Field(
        default=None,
        max_length=16,
        description="WEIGHT | PCS | MANUAL; defaults from pricing_method when omitted.",
    )
    allow_manual_amount_override: bool = False
    weight_per_piece: Decimal | None = Field(default=None, ge=Decimal("0"))
    labour_cost: Decimal | None = Field(default=None, ge=Decimal("0"))
    man_days: Decimal | None = Field(default=None, ge=Decimal("0"))
    labour_headcount: int | None = Field(default=None, ge=0)
    standard_man_hours: Decimal | None = Field(default=None, ge=Decimal("0"))
    base_rate: Decimal = Field(gt=Decimal("0"))
    rate_unit_type: str = Field(min_length=1, max_length=32)
    org_unit_id: int = Field(ge=1)
    effective_from: date
    effective_to: date | None = None
    is_active: bool = True
    status: str = Field(default="active", max_length=32)
    notes: str | None = None

    @field_validator("part_code")
    @classmethod
    def _strip_code(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("unit_type", "pricing_method", "rate_unit_type", "status")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("part_name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        return v.strip()

    @field_validator("pricing_method")
    @classmethod
    def _pm(cls, v: str) -> str:
        s = v.strip().lower()
        if s not in PRICING_METHODS:
            raise ValueError(f"pricing_method must be one of {PRICING_METHODS}")
        return s

    @field_validator("rate_unit_type")
    @classmethod
    def _ru(cls, v: str) -> str:
        s = v.strip().lower()
        if s not in RATE_UNIT_TYPES:
            raise ValueError(f"rate_unit_type must be one of {RATE_UNIT_TYPES}")
        return s

    @field_validator("status")
    @classmethod
    def _st(cls, v: str) -> str:
        s = v.strip().lower()
        if s not in PART_STATUSES:
            raise ValueError(f"status must be one of {PART_STATUSES}")
        return s

    @field_validator("billing_basis")
    @classmethod
    def _bb(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip().upper()
        if s not in BILLING_BASIS:
            raise ValueError(f"billing_basis must be one of {BILLING_BASIS}")
        return s

    @model_validator(mode="after")
    def _commercial_consistency(self) -> PartMasterCreate:
        if self.pricing_method == "weight_based" and self.rate_unit_type != "per_kg":
            raise ValueError("weight_based parts must use rate_unit_type=per_kg (rate per kg).")
        if self.pricing_method == "piece_based" and self.rate_unit_type == "per_kg":
            raise ValueError("piece_based parts cannot use rate_unit_type=per_kg; use per_piece or another unit.")
        bb = self.billing_basis
        if bb == "WEIGHT" and self.pricing_method != "weight_based":
            raise ValueError("billing_basis WEIGHT requires pricing_method weight_based.")
        if bb == "PCS" and self.pricing_method != "piece_based":
            raise ValueError("billing_basis PCS requires pricing_method piece_based.")
        if bb == "MANUAL" and self.pricing_method != "piece_based":
            raise ValueError("billing_basis MANUAL requires pricing_method piece_based.")
        return self


class PartMasterUpdate(BaseModel):
    part_code: str | None = Field(default=None, min_length=1, max_length=64)
    part_name: str | None = Field(default=None, min_length=1, max_length=255)
    org_unit_id: int | None = Field(default=None, ge=1)
    description: str | None = None
    unit_type: str | None = Field(default=None, min_length=1, max_length=32)
    pricing_method: str | None = None
    billing_basis: str | None = Field(default=None, max_length=16)
    allow_manual_amount_override: bool | None = None
    weight_per_piece: Decimal | None = None
    labour_cost: Decimal | None = Field(default=None, ge=Decimal("0"))
    man_days: Decimal | None = Field(default=None, ge=Decimal("0"))
    labour_headcount: int | None = Field(default=None, ge=0)
    standard_man_hours: Decimal | None = Field(default=None, ge=Decimal("0"))
    base_rate: Decimal | None = Field(default=None, gt=Decimal("0"))
    rate_unit_type: str | None = None
    effective_from: date | None = None
    effective_to: date | None = None
    is_active: bool | None = None
    status: str | None = Field(default=None, max_length=32)
    notes: str | None = None

    @field_validator("part_code")
    @classmethod
    def _strip_code_u(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return v.strip().upper()

    @field_validator("part_name")
    @classmethod
    def _strip_name_u(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return v.strip()

    @field_validator("unit_type")
    @classmethod
    def _lower_ut_u(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return v.strip().lower()

    @field_validator("pricing_method")
    @classmethod
    def _pm_u(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip().lower()
        if s not in PRICING_METHODS:
            raise ValueError(f"pricing_method must be one of {PRICING_METHODS}")
        return s

    @field_validator("rate_unit_type")
    @classmethod
    def _ru_u(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip().lower()
        if s not in RATE_UNIT_TYPES:
            raise ValueError(f"rate_unit_type must be one of {RATE_UNIT_TYPES}")
        return s

    @field_validator("status")
    @classmethod
    def _st_u(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip().lower()
        if s not in PART_STATUSES:
            raise ValueError(f"status must be one of {PART_STATUSES}")
        return s

    @field_validator("billing_basis")
    @classmethod
    def _bb_u(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip().upper()
        if s not in BILLING_BASIS:
            raise ValueError(f"billing_basis must be one of {BILLING_BASIS}")
        return s

    @model_validator(mode="after")
    def _commercial_consistency_u(self) -> PartMasterUpdate:
        d = self.model_dump(exclude_unset=True)
        pm = d.get("pricing_method")
        ru = d.get("rate_unit_type")
        if pm is not None and ru is not None:
            if pm == "weight_based" and ru != "per_kg":
                raise ValueError("weight_based parts must use rate_unit_type=per_kg (rate per kg).")
            if pm == "piece_based" and ru == "per_kg":
                raise ValueError("piece_based parts cannot use rate_unit_type=per_kg; use per_piece or another unit.")
        bb = d.get("billing_basis")
        if bb is not None and pm is not None:
            if bb == "WEIGHT" and pm != "weight_based":
                raise ValueError("billing_basis WEIGHT requires pricing_method weight_based.")
            if bb == "PCS" and pm != "piece_based":
                raise ValueError("billing_basis PCS requires pricing_method piece_based.")
            if bb == "MANUAL" and pm != "piece_based":
                raise ValueError("billing_basis MANUAL requires pricing_method piece_based.")
        return self


class PartMasterPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    part_code: str
    part_name: str
    description: str | None = None
    unit_type: str
    pricing_method: str
    billing_basis: str
    allow_manual_amount_override: bool
    weight_per_piece: Decimal | None = None
    labour_cost: Decimal | None = None
    man_days: Decimal | None = None
    labour_headcount: int | None = None
    standard_man_hours: Decimal | None = None
    base_rate: Decimal
    rate_unit_type: str
    org_unit_id: int
    org_unit_name: str | None = None
    effective_from: date
    effective_to: date | None = None
    is_active: bool
    status: str
    notes: str | None = None
    created_by: int | None = None
    created_at: datetime
    updated_at: datetime


class PartMasterAuditEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    part_master_id: int
    action: str
    changed_by: int | None = None
    changed_by_name: str | None = None
    old_value: dict[str, Any] | None = None
    new_value: dict[str, Any] | None = None
    metadata_json: dict[str, Any] | None = None
    created_at: datetime


class PartMasterAttachmentPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    part_master_id: int
    file_path: str
    file_name: str | None = None
    content_type: str | None = None
    uploaded_by: int | None = None
    uploaded_at: datetime
