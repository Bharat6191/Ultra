from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field

from modules.contractor.models import (
    CONTRACTOR_PLANT_ROLES,
    CONTRACTOR_STATUSES,
    CONTRACTOR_TYPES,
    DOCUMENT_VERIFICATION_STATUSES,
)


# ---------- Contractor ----------


class ContractorCreate(BaseModel):
    contractor_code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    legal_name: str | None = Field(default=None, max_length=255)
    trade_name: str | None = Field(default=None, max_length=255)
    pan: str | None = Field(default=None, max_length=16)
    gstin: str | None = Field(default=None, max_length=32)
    cin: str | None = Field(default=None, max_length=32)
    contractor_type: str | None = Field(default=None, max_length=32)

    contact_person: str | None = Field(default=None, max_length=255)
    contact_person_title: str | None = Field(default=None, max_length=128)
    email: EmailStr | None = None
    alternate_email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    alternate_phone: str | None = Field(default=None, max_length=32)
    address: str | None = None
    city: str | None = Field(default=None, max_length=128)
    state: str | None = Field(default=None, max_length=128)
    country: str | None = Field(default=None, max_length=128)
    postal_code: str | None = Field(default=None, max_length=32)

    # Legacy aliases — service layer keeps gst_number/pan_number in sync with gstin/pan.
    gst_number: str | None = Field(default=None, max_length=32)
    pan_number: str | None = Field(default=None, max_length=16)

    registration_number: str | None = Field(default=None, max_length=64)
    website: str | None = Field(default=None, max_length=255)
    notes: str | None = None


class ContractorUpdate(BaseModel):
    contractor_code: str | None = Field(default=None, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    legal_name: str | None = Field(default=None, max_length=255)
    trade_name: str | None = Field(default=None, max_length=255)
    pan: str | None = Field(default=None, max_length=16)
    gstin: str | None = Field(default=None, max_length=32)
    cin: str | None = Field(default=None, max_length=32)
    contractor_type: str | None = Field(default=None, max_length=32)

    contact_person: str | None = Field(default=None, max_length=255)
    contact_person_title: str | None = Field(default=None, max_length=128)
    email: EmailStr | None = None
    alternate_email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    alternate_phone: str | None = Field(default=None, max_length=32)
    address: str | None = None
    city: str | None = Field(default=None, max_length=128)
    state: str | None = Field(default=None, max_length=128)
    country: str | None = Field(default=None, max_length=128)
    postal_code: str | None = Field(default=None, max_length=32)
    gst_number: str | None = Field(default=None, max_length=32)
    pan_number: str | None = Field(default=None, max_length=16)
    registration_number: str | None = Field(default=None, max_length=64)
    website: str | None = Field(default=None, max_length=255)
    notes: str | None = None
    is_active: bool | None = None


class ContractorStatusChange(BaseModel):
    status: str = Field(min_length=1, max_length=32)
    reason: str | None = None


class ContractorComplianceSummary(BaseModel):
    state: Literal["compliant", "warning", "non_compliant", "no_data"]
    expired_documents: int
    expiring_soon: int
    pending_verification: int
    missing_critical_types: list[str]
    next_expiry: date | None = None


class ContractorInvoiceAnalyticsPublic(BaseModel):
    """Rolling invoice validation KPIs for contractor risk / performance dashboards."""

    tolerance_pct_config: float = 5.0
    invoices_total: int = 0
    invoices_blocked: int = 0
    pending_variance_approvals: int = 0
    variance_issues_tracked: int = 0
    average_variance_pct: float | None = None
    overbilling_invoice_count: int = 0
    invoice_accuracy_score: float | None = None
    approval_dependency_rate: float | None = None
    tolerance_usage_pressure_pct: float | None = None


class ContractorPublic(BaseModel):
    id: int
    contractor_code: str | None
    name: str
    legal_name: str | None
    trade_name: str | None
    pan: str | None
    gstin: str | None
    cin: str | None
    contractor_type: str | None
    status: str

    contact_person: str | None
    contact_person_title: str | None
    email: str | None
    alternate_email: str | None
    phone: str | None
    alternate_phone: str | None
    address: str | None
    city: str | None
    state: str | None
    country: str | None
    postal_code: str | None
    gst_number: str | None
    pan_number: str | None
    registration_number: str | None
    website: str | None
    notes: str | None
    is_active: bool

    plant_count: int = 0
    compliance: ContractorComplianceSummary | None = None
    invoice_compliance_score: float | None = None
    invoice_analytics: ContractorInvoiceAnalyticsPublic | None = None

    created_by: int | None
    updated_by: int | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------- Documents ----------


class ContractorDocumentCreate(BaseModel):
    document_name: str = Field(min_length=1, max_length=255)
    document_type: str = Field(min_length=1, max_length=64)
    file_url: str = Field(min_length=1, max_length=1024)
    issued_date: date | None = None
    issue_date: date | None = None
    expiry_date: date | None = None
    remarks: str | None = None


class ContractorDocumentVersionPublic(BaseModel):
    id: int
    version_number: int
    file_path: str
    issue_date: date | None
    expiry_date: date | None
    remarks: str | None
    uploaded_by: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ContractorDocumentPublic(BaseModel):
    id: int
    contractor_id: int
    document_name: str
    document_type: str
    file_path: str
    file_url: str | None
    issued_date: date | None
    issue_date: date | None
    expiry_date: date | None
    verification_status: str
    verified_by: int | None
    verified_at: datetime | None
    remarks: str | None
    current_version: int
    created_at: datetime
    updated_at: datetime
    versions: list[ContractorDocumentVersionPublic] = []

    model_config = {"from_attributes": True}


class ContractorDocumentVerifyRequest(BaseModel):
    decision: Literal["verified", "rejected"]
    remarks: str | None = None


class ContractorDocumentUpdate(BaseModel):
    """PATCH-style update for document metadata.

    Lets the uploader correct the descriptive fields (name, issue/expiry dates, remarks)
    without uploading a new file. To replace the file content, POST a new upload — the
    server creates a versioned record automatically.
    """

    document_name: str | None = Field(default=None, min_length=1, max_length=255)
    issue_date: date | None = None
    issued_date: date | None = None
    expiry_date: date | None = None
    remarks: str | None = None


# ---------- Plant mapping ----------


class ContractorPlantCreate(BaseModel):
    org_unit_id: int
    role: str = Field(default="approved_vendor", max_length=32)
    start_date: date | None = None
    end_date: date | None = None
    notes: str | None = None


class ContractorPlantUpdate(BaseModel):
    role: str | None = Field(default=None, max_length=32)
    start_date: date | None = None
    end_date: date | None = None
    notes: str | None = None


class ContractorPlantPublic(BaseModel):
    id: int
    contractor_id: int
    org_unit_id: int
    org_unit_name: str | None = None
    role: str
    start_date: date | None
    end_date: date | None
    notes: str | None
    is_expired: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------- Audit / Timeline ----------


class ContractorAuditEntry(BaseModel):
    id: int
    contractor_id: int
    action: str
    changed_by: int | None
    actor_name: str | None = None
    old_value: dict[str, Any] | None
    new_value: dict[str, Any] | None
    metadata: dict[str, Any] | None = None
    created_at: datetime


class ContractorTimelineEvent(BaseModel):
    """Unified timeline entry combining audit logs + approval events + system events."""

    type: str
    action: str
    timestamp: datetime | None
    actor_user_id: int | None = None
    actor_name: str | None = None
    title: str
    description: str | None = None
    old_value: dict[str, Any] | None = None
    new_value: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


# ---------- Compliance config ----------


class ComplianceConfigCreate(BaseModel):
    document_type: str = Field(min_length=1, max_length=64)
    label: str | None = Field(default=None, max_length=255)
    is_critical: bool = True
    warn_days: int = Field(default=7, ge=0, le=365)
    is_active: bool = True


class ComplianceConfigUpdate(BaseModel):
    label: str | None = Field(default=None, max_length=255)
    is_critical: bool | None = None
    warn_days: int | None = Field(default=None, ge=0, le=365)
    is_active: bool | None = None


class ComplianceConfigPublic(BaseModel):
    id: int
    document_type: str
    label: str | None
    is_critical: bool
    warn_days: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# Re-exports used by routes for OpenAPI documentation.
__all__ = [
    "CONTRACTOR_STATUSES",
    "CONTRACTOR_TYPES",
    "CONTRACTOR_PLANT_ROLES",
    "DOCUMENT_VERIFICATION_STATUSES",
    "ContractorCreate",
    "ContractorUpdate",
    "ContractorStatusChange",
    "ContractorPublic",
    "ContractorComplianceSummary",
    "ContractorDocumentCreate",
    "ContractorDocumentPublic",
    "ContractorDocumentUpdate",
    "ContractorDocumentVersionPublic",
    "ContractorDocumentVerifyRequest",
    "ContractorPlantCreate",
    "ContractorPlantUpdate",
    "ContractorPlantPublic",
    "ContractorAuditEntry",
    "ContractorTimelineEvent",
    "ComplianceConfigCreate",
    "ComplianceConfigUpdate",
    "ComplianceConfigPublic",
]
