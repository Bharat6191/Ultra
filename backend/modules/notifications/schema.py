from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class NotificationSettingUpsert(BaseModel):
    event_code: str = Field(min_length=1, max_length=128)
    notify_roles: list[int] = Field(default_factory=list)
    days_before: int = Field(ge=0, le=365, default=7)
    is_active: bool = True


class NotificationSettingUpdate(BaseModel):
    notify_roles: list[int] | None = None
    days_before: int | None = Field(default=None, ge=0, le=365)
    is_active: bool | None = None


class NotificationSettingPublic(BaseModel):
    id: int
    event_code: str
    notify_roles: list[int]
    days_before: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

