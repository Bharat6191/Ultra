from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt

from core.config import get_settings

TOKEN_TYPE_ACCESS = "access"
TOKEN_TYPE_REFRESH = "refresh"


def hash_password(plain_password: str) -> str:
    return bcrypt.hashpw(
        plain_password.encode("utf-8"),
        bcrypt.gensalt(),
    ).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(
        plain_password.encode("utf-8"),
        hashed_password.encode("utf-8"),
    )


def create_access_token(
    claims: dict[str, Any],
    *,
    expires_delta: timedelta | None = None,
) -> str:
    settings = get_settings()
    to_encode = claims.copy()
    now = datetime.now(timezone.utc)
    expire = now + (
        expires_delta
        if expires_delta is not None
        else timedelta(minutes=settings.access_token_expire_minutes)
    )
    to_encode.setdefault("iat", now)
    to_encode["exp"] = expire
    to_encode["typ"] = TOKEN_TYPE_ACCESS
    return jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_refresh_token(
    *,
    subject: str,
    jti: str,
    expires_delta: timedelta | None = None,
) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expire = now + (
        expires_delta
        if expires_delta is not None
        else timedelta(days=settings.refresh_token_expire_days)
    )
    claims: dict[str, Any] = {
        "sub": subject,
        "jti": jti,
        "typ": TOKEN_TYPE_REFRESH,
        "iat": now,
        "exp": expire,
    }
    return jwt.encode(claims, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    payload: dict[str, Any] = jwt.decode(
        token,
        settings.jwt_secret_key,
        algorithms=[settings.jwt_algorithm],
    )
    if payload.get("typ") == TOKEN_TYPE_REFRESH:
        raise JWTError("Token is not an access token")
    return payload


def decode_refresh_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    payload: dict[str, Any] = jwt.decode(
        token,
        settings.jwt_secret_key,
        algorithms=[settings.jwt_algorithm],
    )
    if payload.get("typ") != TOKEN_TYPE_REFRESH:
        raise JWTError("Token is not a refresh token")
    return payload
