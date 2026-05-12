from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field


class InvoiceLineCreate(BaseModel):
    work_order_item_id: int
    quantity: Decimal
    rate: Decimal | None = None
    tax_pct: Decimal | None = Field(default=None, ge=Decimal("0"), le=Decimal("100"))
    notes: str | None = None


class InvoiceCreate(BaseModel):
    contractor_id: int
    org_unit_id: int
    invoice_number: str
    invoice_date: date
    lines: list[InvoiceLineCreate] = Field(default_factory=list)


class InvoiceValidationIssuePublic(BaseModel):
    id: int
    invoice_id: int
    line_id: int | None
    code: str
    severity: str
    message: str
    allowed_value: Decimal | None
    actual_value: Decimal | None
    allowed_qty: Decimal | None
    actual_qty: Decimal | None
    tolerance_pct: Decimal | None
    requires_justification: bool
    requires_attachments: bool
    justification: str | None
    metadata_json: dict[str, Any] | None
    created_at: datetime | None = None


class InvoiceLinePublic(BaseModel):
    id: int
    work_order_item_id: int
    quantity: Decimal
    rate: Decimal
    amount: Decimal
    tax_pct: Decimal | None = None
    amount_including_tax: Decimal | None = None
    variance_pct_hint: float | None = None
    work_order_number: str | None = None
    job_description: str | None = None
    rate_source: str | None
    resolved_contractor_rate_id: int | None
    resolved_part_master_id: int | None
    notes: str | None
    validation_line_status: str | None = None  # pending|blocked|warn|ok heuristic for UI tinting


class InvoiceAttachmentPublic(BaseModel):
    id: int
    file_name: str | None
    file_path: str
    content_type: str | None


class InvoicePublic(BaseModel):
    id: int
    contractor_id: int
    org_unit_id: int
    invoice_number: str
    invoice_date: date
    status: str
    currency: str
    total_amount: Decimal
    validation_status: str | None
    validation_score: Decimal | None
    last_validated_at: datetime | None
    approval_request_id: int | None
    submitted_by: int | None
    submitted_at: datetime | None
    created_by: int | None
    created_at: datetime | None
    updated_at: datetime | None
    lines: list[InvoiceLinePublic]
    issues: list[InvoiceValidationIssuePublic]
    attachments: list[InvoiceAttachmentPublic] = Field(default_factory=list)


class InvoiceIssueJustificationUpdate(BaseModel):
    justification: str


class BillableWOLinePublic(BaseModel):
    work_order_id: int
    work_order_number: str
    work_order_item_id: int
    contractor_id: int
    part_code: str | None = None
    part_name: str | None = None
    unit_type: str | None = None
    pricing_method: str | None = None
    progress_type: str
    approved_quantity: float | None = None
    approved_percentage: float | None = None
    completed_quantity: float | None = None
    completed_percentage: float | None = None
    remaining_quantity: float | None = None
    previously_invoiced_qty: float
    remaining_invoiceable_qty_hint: float | None = None
    approved_rate: float
    planned_contract_value: float
    permissible_value_with_tolerance: float
    previously_invoiced_value: float
    remaining_invoiceable_value: float | None = None
    completion_vs_billing_pct_hint: float | None = None
    near_tolerance_warning: bool = False
    tolerance_pct: float


class InvoicePreflightResponse(BaseModel):
    tolerance_pct: float
    lines: list[BillableWOLinePublic] = Field(default_factory=list)


class InvoiceAuditEntry(BaseModel):
    id: int
    invoice_id: int
    action: str
    changed_by: int | None = None
    actor_name: str | None = None
    old_value: dict[str, Any] | None = None
    new_value: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None

