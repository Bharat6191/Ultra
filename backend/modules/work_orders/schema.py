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
    """For weight_based + per_kg parts, overrides Part Master weight when set."""
    weight_per_piece: Decimal | None = Field(default=None, gt=Decimal("0"))
    notes: str | None = None


class WorkOrderCreate(BaseModel):
    org_unit_id: int
    contractor_id: int
    title: str
    description: str | None = None
    items: list[WorkOrderItemCreate] = Field(default_factory=list)


class WorkOrderDraftUpdate(BaseModel):
    """Partial update for draft / rejected work orders (header and/or full line replacement)."""

    title: str | None = None
    description: str | None = None
    org_unit_id: int | None = None
    contractor_id: int | None = None
    items: list[WorkOrderItemCreate] | None = None


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
    weight_per_piece_snapshot: Decimal | None = None
    taxable_value: Decimal
    resolved_rate: Decimal
    rate_source: str
    contractor_rate_id: int | None
    override_rate: Decimal | None
    override_reason: str | None
    override_status: str | None
    notes: str | None
    completion: WorkOrderLineCompletionSummary | None = None


class WorkOrderPublic(BaseModel):
    id: int
    work_order_number: str
    org_unit_id: int
    contractor_id: int
    contractor_name: str | None = None
    title: str
    description: str | None
    status: str
    approval_request_id: int | None
    approved_value_total: Decimal | None = None
    approved_by: int | None = None
    approved_at: datetime | None = None
    rejected_by: int | None = None
    rejected_at: datetime | None = None
    invoiced_ex_tax_total: Decimal | None = None
    """Ex-VAT total on approved/paid invoices (passed)."""
    committed_invoiced_ex_tax_total: Decimal | None = None
    """Ex-VAT reserved by all invoices counting toward the WO cap (incl. drafts)."""
    remaining_invoiceable_value: Decimal | None = None
    created_by: int | None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    items: list[WorkOrderItemPublic]


class WorkOrderLinkedInvoice(BaseModel):
    """Invoice header summary when listing invoices tied to a work order."""

    id: int
    invoice_number: str
    invoice_date: date
    status: str
    validation_status: str | None = None
    total_amount: Decimal
    lines_subtotal_ex_vat: Decimal | None = None
    extra_amount_ex_vat: Decimal | None = None


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
