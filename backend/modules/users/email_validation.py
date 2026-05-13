"""Email normalization for user records.

``pydantic.EmailStr`` / ``email_validator`` reject several syntactically valid addresses
that are common in self-hosted or lab setups (e.g. ``*.local``, ``*.invalid``). We try
strict validation first, then accept a small conservative subset so admins can store
internal addresses without turning off validation entirely.
"""

from __future__ import annotations

import re

from email_validator import EmailNotValidError, validate_email

_MAX_LEN = 255
# Local part: practical ASCII subset; domain: labels with dots, allow single-label (intranet).
_LOOSE_RE = re.compile(
    r"^[\w.!#$%&'*+/=?^`{|}~-]{1,64}@[\w.-]{1,253}$",
    re.ASCII,
)


def normalize_user_email(value: str) -> str:
    s = value.strip()
    if not s:
        raise ValueError("email must not be empty")
    if len(s) > _MAX_LEN:
        raise ValueError(f"email must be at most {_MAX_LEN} characters")
    try:
        return validate_email(s, check_deliverability=False).normalized
    except EmailNotValidError:
        pass
    if not _LOOSE_RE.fullmatch(s):
        raise ValueError("value is not a valid email address")
    if s.count("@") != 1:
        raise ValueError("value is not a valid email address")
    local, domain = s.split("@", 1)
    if not local or not domain or ".." in domain:
        raise ValueError("value is not a valid email address")
    return f"{local}@{domain}".lower()


def normalize_optional_user_email(value: str | None) -> str | None:
    if value is None:
        return None
    s = value.strip()
    if not s:
        return None
    return normalize_user_email(s)
