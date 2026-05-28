from datetime import datetime
from typing import Annotated
import re

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, computed_field, model_validator

from modules.users.email_validation import normalize_optional_user_email, normalize_user_email


def _before_user_email(v: object) -> str:
    if not isinstance(v, str):
        raise TypeError("email must be a string")
    return normalize_user_email(v)


def _before_optional_user_email(v: object) -> str | None:
    if v is None:
        return None
    if not isinstance(v, str):
        raise TypeError("email must be a string or null")
    return normalize_optional_user_email(v)


def _before_user_phone(v: object) -> str:
    if not isinstance(v, str):
        raise TypeError("phone must be a string")
    phone = v.strip()
    if not re.fullmatch(r"[6-9]\d{9}", phone):
        raise ValueError("Phone must start with 6, 7, 8, or 9 and be exactly 10 digits")
    return phone


def _before_optional_user_phone(v: object) -> str | None:
    if v is None:
        return None
    if not isinstance(v, str):
        raise TypeError("phone must be a string or null")
    return _before_user_phone(v)


UserEmail = Annotated[str, BeforeValidator(_before_user_email)]
OptionalUserEmail = Annotated[str | None, BeforeValidator(_before_optional_user_email)]
UserPhone = Annotated[str, BeforeValidator(_before_user_phone)]
OptionalUserPhone = Annotated[str | None, BeforeValidator(_before_optional_user_phone)]


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
    phone: UserPhone
    email: UserEmail
    employee_code: str | None = Field(default=None, max_length=64)
    department: str | None = Field(default=None, max_length=128)
    designation: str | None = Field(default=None, max_length=128)
    address: str | None = None
    # Legacy single role, or set ``role_ids`` for multiple (at least one role required overall).
    role_id: int | None = Field(default=None, ge=1)
    role_ids: list[int] | None = Field(default=None, min_length=1)
    org_unit_id: int = Field(ge=1)
    is_active: bool = True

    @model_validator(mode="after")
    def _resolve_role_ids(self) -> "UserCreate":
        if self.role_ids:
            merged = sorted({int(x) for x in self.role_ids if int(x) >= 1})
            if not merged:
                raise ValueError("role_ids must contain at least one valid role id")
            object.__setattr__(self, "role_ids", merged)
        elif self.role_id is not None:
            object.__setattr__(self, "role_ids", [int(self.role_id)])
        else:
            raise ValueError("Provide role_id or role_ids with at least one role")
        return self


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    username: str | None = Field(default=None, min_length=3, max_length=64)
    phone: OptionalUserPhone = None
    email: OptionalUserEmail = None
    employee_code: str | None = Field(default=None, max_length=64)
    department: str | None = Field(default=None, max_length=128)
    designation: str | None = Field(default=None, max_length=128)
    address: str | None = None
    role_id: int | None = Field(default=None, ge=1)
    role_ids: list[int] | None = Field(default=None, min_length=1)
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

    # All assigned roles (serialized). ``role`` below remains the first for backward compatibility.
    roles: list[RoleSummary] = Field(default_factory=list)
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
