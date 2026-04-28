from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from modules.org_units.schema import OrgUnitPublic
from modules.permissions.schema import PermissionPublic


class RoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=10_000)
    permission_ids: list[int] = Field(default_factory=list)
    org_unit_ids: list[int] = Field(
        default_factory=list,
        description="Plants (org units) this role applies to; empty means all plants.",
    )


class RoleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None
    permission_ids: list[int] | None = None
    org_unit_ids: list[int] | None = Field(
        default=None,
        description="When set, replaces linked plants; empty list = all plants.",
    )


class RoleListItem(BaseModel):
    """Built explicitly in the roles router (includes ``org_unit_ids`` from the association)."""

    id: int
    name: str
    description: str | None
    created_at: datetime
    org_unit_ids: list[int] = Field(default_factory=list)


class RoleDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    created_at: datetime
    permissions: list[PermissionPublic]
    org_units: list[OrgUnitPublic]
