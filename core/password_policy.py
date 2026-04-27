from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from modules.settings import get_setting
from modules.users.model import User


class PasswordPolicyError(Exception):
    """Raised when a password does not satisfy configured policy."""

    def __init__(self, error: str) -> None:
        self.error = error
        super().__init__(error)


def _truthy(raw: str | None) -> bool:
    if raw is None:
        return False
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int_setting(key: str, default: int) -> int:
    raw = get_setting(key)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw.strip())
    except ValueError:
        return default


def validate_password(password: str) -> None:
    """
    Enforce password rules from the ``settings`` table (lazy-loaded / cached).

    Keys (all optional; sensible defaults apply when unset):

    - ``password.min_length`` — minimum length (default ``8``).
    - ``password.require_uppercase`` — require ``A-Z``.
    - ``password.require_lowercase`` — require ``a-z``.
    - ``password.require_digit`` — require a digit.
    - ``password.require_special`` — require a non-alphanumeric character.
    """
    min_len = _int_setting("password.min_length", 8)
    if min_len < 1:
        min_len = 8
    if len(password) < min_len:
        raise PasswordPolicyError("password_too_short")

    if _truthy(get_setting("password.require_uppercase")):
        if not re.search(r"[A-Z]", password):
            raise PasswordPolicyError("password_missing_uppercase")
    if _truthy(get_setting("password.require_lowercase")):
        if not re.search(r"[a-z]", password):
            raise PasswordPolicyError("password_missing_lowercase")
    if _truthy(get_setting("password.require_digit")):
        if not re.search(r"\d", password):
            raise PasswordPolicyError("password_missing_digit")
    if _truthy(get_setting("password.require_special")):
        if not re.search(r"[^A-Za-z0-9]", password):
            raise PasswordPolicyError("password_missing_special")


def password_max_age_days() -> int | None:
    """
    Maximum password age in days from ``password.max_age_days``.

    Returns ``None`` when expiry is disabled (``0`` or negative).
    Default when unset: ``90`` days.
    """
    raw = get_setting("password.max_age_days")
    if raw is None or not str(raw).strip():
        days = 90
    else:
        try:
            days = int(str(raw).strip())
        except ValueError:
            days = 90
    if days <= 0:
        return None
    return days


def is_password_expired(user: User, *, now: datetime | None = None) -> bool:
    """Return True if the user's password is older than the configured max age."""
    max_days = password_max_age_days()
    if max_days is None:
        return False
    clock = now or datetime.now(timezone.utc)
    changed = user.password_changed_at or user.created_at
    if changed.tzinfo is None:
        changed = changed.replace(tzinfo=timezone.utc)
    return clock - changed >= timedelta(days=max_days)


class PasswordExpiredError(Exception):
    """Raised after successful authentication when the password has expired."""


def password_policy_admin_view() -> dict[str, int | bool]:
    """
    Resolved password policy for admin APIs / UI.

    ``max_age_days`` uses ``0`` when expiry is disabled (matches stored ``"0"``).
    """
    min_len = _int_setting("password.min_length", 8)
    if min_len < 1:
        min_len = 8
    max_days = password_max_age_days()
    return {
        "min_length": min_len,
        "require_uppercase": _truthy(get_setting("password.require_uppercase")),
        "require_lowercase": _truthy(get_setting("password.require_lowercase")),
        "require_digit": _truthy(get_setting("password.require_digit")),
        "require_special": _truthy(get_setting("password.require_special")),
        "max_age_days": 0 if max_days is None else max_days,
    }
