from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from modules.emails.constants import EVENT_CODES


class EmailTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    event_code: str = Field(min_length=1, max_length=64)
    subject: str = Field(min_length=1, max_length=50_000)
    body_html: str = Field(min_length=1, max_length=200_000)
    body_text: str | None = Field(default=None, max_length=200_000)
    is_active: bool = True


class EmailTemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    event_code: str | None = Field(default=None, min_length=1, max_length=64)
    subject: str | None = Field(default=None, min_length=1, max_length=50_000)
    body_html: str | None = Field(default=None, min_length=1, max_length=200_000)
    body_text: str | None = Field(default=None, max_length=200_000)
    is_active: bool | None = None


class EmailTemplatePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    event_code: str
    subject: str
    body_html: str
    body_text: str | None
    is_active: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None


class EmailTemplateMappingCreate(BaseModel):
    event_code: str = Field(min_length=1, max_length=64)
    template_id: int = Field(ge=1)
    is_enabled: bool = True


class EmailTemplateMappingUpdate(BaseModel):
    template_id: int | None = Field(default=None, ge=1)
    is_enabled: bool | None = None


class EmailTemplateMappingPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_code: str
    template_id: int
    is_enabled: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None


class EmailPreviewRequest(BaseModel):
    subject: str = Field(min_length=1, max_length=50_000)
    body_html: str = Field(min_length=1, max_length=200_000)
    payload: dict[str, Any] = Field(default_factory=dict)


class EmailPreviewResponse(BaseModel):
    subject: str
    body_html: str
    missing_variables: list[str] = Field(default_factory=list)


class EmailVariablesResponse(BaseModel):
    event_code: str
    variables: list[str]
    allowed_event_codes: list[str] = Field(default_factory=lambda: list(EVENT_CODES))

