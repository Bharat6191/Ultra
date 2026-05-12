from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class OrgUnitCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    type: str = Field(min_length=1, max_length=32)
    parent_id: int | None = None


class OrgUnitPatch(BaseModel):
    """Partial update (omit fields you do not want to change)."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    parent_id: int | None = None


class OrgUnitPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: str
    parent_id: int | None
    created_at: datetime
    updated_at: datetime
