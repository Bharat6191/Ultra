from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, EmailStr, Field


class ContractorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    contact_person: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    address: str | None = None


class ContractorUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    contact_person: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    address: str | None = None
    is_active: bool | None = None


class ContractorPublic(BaseModel):
    id: int
    name: str
    contact_person: str | None
    email: str | None
    phone: str | None
    address: str | None
    is_active: bool
    created_by: int | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ContractorDocumentCreate(BaseModel):
    document_name: str = Field(min_length=1, max_length=255)
    document_type: str = Field(min_length=1, max_length=64)
    file_url: str = Field(min_length=1, max_length=1024)
    issued_date: date | None = None
    expiry_date: date | None = None


class ContractorDocumentPublic(BaseModel):
    id: int
    contractor_id: int
    document_name: str
    document_type: str
    file_url: str
    issued_date: date | None
    expiry_date: date | None
    created_at: datetime

    model_config = {"from_attributes": True}

