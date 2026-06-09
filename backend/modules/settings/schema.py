import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

DEFAULT_PAGE_BACKGROUND_COLOR = "#f9fafb"
_HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def normalize_hex_color(value: str) -> str:
    raw = value.strip()
    if not _HEX_COLOR_RE.fullmatch(raw):
        raise ValueError("Use a valid hex color like #f9fafb.")
    hex_value = raw[1:]
    if len(hex_value) == 3:
        hex_value = "".join(ch * 2 for ch in hex_value)
    return f"#{hex_value.lower()}"


class PasswordPolicyPublic(BaseModel):
    min_length: int = Field(ge=1, le=256, default=8)
    require_uppercase: bool = False
    require_lowercase: bool = False
    require_digit: bool = False
    require_special: bool = False
    max_age_days: int = Field(
        default=90,
        ge=0,
        le=36_500,
        description="0 disables password expiry.",
    )


class AuthPolicyPublic(BaseModel):
    password_enabled: bool = True
    mfa_enabled: bool = False
    captcha_enabled: bool = False
    mfa_enforced: bool = False
    session_timeout_mode: Literal["token_expiry", "idle_timeout"] = "token_expiry"
    idle_timeout_minutes: int = Field(default=10, ge=1, le=1440)


class AppearanceSettingsPublic(BaseModel):
    page_background_color: str = Field(
        default=DEFAULT_PAGE_BACKGROUND_COLOR,
        description="Hex color applied to the main page background.",
    )

    @field_validator("page_background_color")
    @classmethod
    def validate_page_background_color(cls, value: str) -> str:
        return normalize_hex_color(value)
