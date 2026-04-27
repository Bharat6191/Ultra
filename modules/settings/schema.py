from pydantic import BaseModel, Field


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
