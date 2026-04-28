from __future__ import annotations

from dataclasses import dataclass

from modules.auth.schema import TokenPair


@dataclass(frozen=True, slots=True)
class LoginOutcomeTokens:
    tokens: TokenPair


@dataclass(frozen=True, slots=True)
class LoginOutcomeMfaSetup:
    """Password verified; org requires MFA and user has not completed enrollment."""

    setup_token: str
    expires_in_seconds: int


@dataclass(frozen=True, slots=True)
class LoginOutcomeMfaOtp:
    """Password verified; user must provide TOTP (second step)."""

    challenge_token: str
    expires_in_seconds: int


LoginOutcome = LoginOutcomeTokens | LoginOutcomeMfaSetup | LoginOutcomeMfaOtp


class PasswordLoginDisabledError(Exception):
    """Company policy turned off password sign-in."""


class CaptchaInvalidError(Exception):
    """Captcha required by policy and missing/invalid."""
