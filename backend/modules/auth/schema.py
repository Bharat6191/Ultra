from datetime import datetime
from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator


class LoginRequest(BaseModel):
    """Login accepts a real email or a phone; clients often send one identifier in ``email``."""

    email: str | None = Field(
        default=None,
        max_length=255,
        validation_alias=AliasChoices("email", "username"),
    )
    username: str | None = Field(default=None, max_length=64)
    phone: str | None = Field(default=None, max_length=32)
    password: str = Field(min_length=1, max_length=128)
    captcha_token: str | None = Field(default=None, max_length=4096)

    @model_validator(mode="after")
    def _normalize_identifier(self) -> "LoginRequest":
        email = (self.email or "").strip() or None
        username = (self.username or "").strip() or None
        phone = (self.phone or "").strip() or None
        if email and "@" not in email and phone is None and username is None:
            # Identifier without @ can be phone OR username.
            raw = email
            normalized = raw.replace(" ", "")
            is_phone_like = all(c.isdigit() or c == "+" for c in normalized) and any(c.isdigit() for c in normalized)
            if is_phone_like:
                phone = raw
            else:
                username = raw
            email = None
        if email and "@" in email:
            email = email.lower()
        if phone and len(phone) < 3:
            raise ValueError("Phone must be at least 3 characters")
        if not email and not phone and not username:
            raise ValueError("Either email, phone, or username is required")
        self.email = email
        self.username = username
        self.phone = phone
        return self


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)


class ForgotPasswordResponse(BaseModel):
    ok: bool = True


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=10, max_length=512)
    new_password: str = Field(min_length=8, max_length=128)


class ResetPasswordResponse(BaseModel):
    ok: bool = True


class UserMe(BaseModel):
    """Profile + RBAC snapshot for the authenticated user (JWT ``sub``)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    email: str | None
    phone: str | None
    created_at: datetime
    is_superuser: bool
    is_active: bool
    role: str | None = None
    org_unit: str | None = None
    permissions: list[str]
