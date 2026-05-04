from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, computed_field


class RoleSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class OrgUnitSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: str


class UserCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)
    username: str = Field(min_length=3, max_length=64)
    phone: str = Field(min_length=3, max_length=32)
    email: EmailStr
    employee_code: str | None = Field(default=None, max_length=64)
    department: str | None = Field(default=None, max_length=128)
    designation: str | None = Field(default=None, max_length=128)
    address: str | None = None
    role_id: int = Field(ge=1)
    org_unit_id: int = Field(ge=1)


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    username: str | None = Field(default=None, min_length=3, max_length=64)
    phone: str | None = Field(default=None, min_length=3, max_length=32)
    email: EmailStr | None = None
    employee_code: str | None = Field(default=None, max_length=64)
    department: str | None = Field(default=None, max_length=128)
    designation: str | None = Field(default=None, max_length=128)
    address: str | None = None
    role_id: int | None = Field(default=None, ge=1)
    org_unit_id: int | None = Field(default=None, ge=1)
    is_active: bool | None = None


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    username: str
    phone: str | None
    email: str | None
    employee_code: str | None = None
    department: str | None = None
    designation: str | None = None
    address: str | None = None
    is_active: bool
    is_superuser: bool
    created_at: datetime
    updated_at: datetime

    # Loaded from SQLAlchemy relationship; excluded to keep wire schema stable.
    mfa_record: object | None = Field(default=None, exclude=True)

    # Loaded from SQLAlchemy relationships. Excluded so the API stays stable while
    # computed fields expose a single primary role/org unit.
    roles: list[RoleSummary] = Field(default_factory=list, exclude=True)
    org_units: list[OrgUnitSummary] = Field(default_factory=list, exclude=True)

    @computed_field  # type: ignore[misc]
    @property
    def mfa_setup_completed(self) -> bool:
        """
        True if the user has completed MFA enrollment (TOTP).
        When the relationship isn't loaded, defaults to False.
        """
        m = self.mfa_record
        try:
            return bool(getattr(m, "setup_completed"))
        except Exception:
            return False

    @computed_field  # type: ignore[misc]
    @property
    def role(self) -> RoleSummary | None:
        if not self.roles:
            return None
        return self.roles[0]

    @computed_field  # type: ignore[misc]
    @property
    def org_unit(self) -> OrgUnitSummary | None:
        if not self.org_units:
            return None
        return self.org_units[0]
