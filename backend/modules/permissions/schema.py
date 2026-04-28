from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PermissionCreate(BaseModel):
    feature_id: int
    action: str = Field(min_length=1, max_length=32)
    description: str | None = Field(default=None, max_length=10_000)


class PermissionUpdate(BaseModel):
    description: str | None = None


class PermissionPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    feature_id: int
    action: str
    code: str
    description: str | None
    created_at: datetime


class CatalogPermissionItem(BaseModel):
    """One configured action; ``id`` is set when the row exists in the database."""

    id: int | None = None
    action: str
    code: str
    description: str | None = None


class CatalogTabItem(BaseModel):
    key: str
    title: str
    actions: list[str]
    permissions: list[CatalogPermissionItem]


class CatalogModuleItem(BaseModel):
    key: str
    title: str
    tabs: list[CatalogTabItem]


class PermissionCatalogPublic(BaseModel):
    modules: list[CatalogModuleItem]
