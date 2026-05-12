from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class WorkOrderItemCreate(BaseModel):
    part_master_id: int
    progress_type: str = Field(default="quantity", pattern="^(quantity|percentage)$")
    planned_quantity: Decimal | None = None
    planned_percentage: Decimal | None = None
    notes: str | None = None


class WorkOrderContractorCreate(BaseModel):
    contractor_id: int
    scope_notes: str | None = None
    items: list[WorkOrderItemCreate] = Field(default_factory=list)


class WorkOrderCreate(BaseModel):
    org_unit_id: int
    title: str
    description: str | None = None
    work_date: date
    contractors: list[WorkOrderContractorCreate] = Field(default_factory=list)


class WorkOrderDraftUpdate(BaseModel):
    """Partial update for draft / rejected work orders (header and/or full line replacement)."""

    title: str | None = None
    description: str | None = None
    work_date: date | None = None
    org_unit_id: int | None = None
    contractors: list[WorkOrderContractorCreate] | None = None


class WorkOrderItemProgressCreate(BaseModel):
    """Send **at least one** of quantity or %; the service derives the other from the approved baseline."""

    completed_quantity: Decimal | None = None
    completed_percentage: Decimal | None = None
    remarks: str | None = None


class WorkOrderLineCompletionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    progress_type: str
    unit_type: str
    approved_quantity: float | None = None
    approved_percentage: float | None = None
    completed_quantity: float | None = None
    completed_percentage: float | None = None
    remaining_quantity: float | None = None
    last_updated_at: str | None = None
    last_updated_by: int | None = None
    last_updated_by_name: str | None = None


class WorkOrderProgressUpsertResponse(BaseModel):
    ok: bool = True
    id: int
    completed_quantity: float | None = None
    completed_percentage: float


class WorkOrderItemProgressHistoryEntry(BaseModel):
    id: int
    completed_quantity: float | None = None
    completed_percentage: float | None = None
    remarks: str | None = None
    updated_by: int | None = None
    updated_by_name: str | None = None
    updated_at: str | None = None
    previous_completed_quantity: float | None = None
    previous_completed_percentage: float | None = None


class WorkOrderItemPublic(BaseModel):
    id: int
    part_master_id: int
    part_code: str | None = None
    part_name: str | None = None
    unit_type: str | None = None
    pricing_method: str | None = None
    rate_unit_type: str | None = None
    pricing_snapshot: dict[str, Any] | None = None
    progress_type: str
    planned_quantity: Decimal | None
    planned_percentage: Decimal | None
    resolved_rate: Decimal
    rate_source: str
    contractor_rate_id: int | None
    override_rate: Decimal | None
    override_reason: str | None
    override_status: str | None
    notes: str | None
    completion: WorkOrderLineCompletionSummary | None = None


class WorkOrderContractorPublic(BaseModel):
    id: int
    contractor_id: int
    scope_notes: str | None
    items: list[WorkOrderItemPublic]


class WorkOrderPublic(BaseModel):
    id: int
    work_order_number: str
    org_unit_id: int
    title: str
    description: str | None
    work_date: date
    status: str
    approval_request_id: int | None
    created_by: int | None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    contractors: list[WorkOrderContractorPublic]


class WorkOrderAuditEntry(BaseModel):
    id: int
    work_order_id: int
    action: str
    changed_by: int | None
    actor_name: str | None = None
    old_value: dict[str, Any] | None
    new_value: dict[str, Any] | None
    metadata: dict[str, Any] | None
    created_at: datetime | None = None


class WorkOrderRateOverrideRequest(BaseModel):
    override_rate: Decimal
    override_reason: str

