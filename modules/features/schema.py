from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class FeatureCreate(BaseModel):
    key: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=10_000)


class FeatureUpdate(BaseModel):
    key: str | None = Field(default=None, min_length=1, max_length=100)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None


class FeaturePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    key: str
    name: str
    description: str | None
    created_at: datetime
