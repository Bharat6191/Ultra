from dataclasses import dataclass
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError

from core.security import decode_access_token

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class CurrentUser:
    """Identity derived from the access token only (no database lookup)."""

    subject: str
    permissions: frozenset[str]
    claims: dict[str, Any]


def _permissions_from_payload(payload: dict[str, Any]) -> frozenset[str]:
    raw = payload.get("permissions")
    if raw is None:
        return frozenset()
    if isinstance(raw, str):
        return frozenset(p.strip() for p in raw.split() if p.strip())
    if isinstance(raw, list):
        return frozenset(str(p) for p in raw if p is not None)
    return frozenset()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> CurrentUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_access_token(credentials.credentials)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None
    sub = payload.get("sub")
    if sub is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject",
            headers={"WWW-Authenticate": "Bearer"},
        )
    subject = sub if isinstance(sub, str) else str(sub)
    return CurrentUser(
        subject=subject,
        permissions=_permissions_from_payload(payload),
        claims=payload,
    )
