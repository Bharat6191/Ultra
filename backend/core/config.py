import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_REPO_ROOT / ".env")


@dataclass(frozen=True, slots=True)
class Settings:
    jwt_secret_key: str
    jwt_algorithm: str
    access_token_expire_minutes: int
    refresh_token_expire_days: int
    enforce_superuser_on_admin: bool


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    secret = os.environ.get("JWT_SECRET_KEY", "").strip()
    if not secret:
        raise RuntimeError(
            "JWT_SECRET_KEY is required. Set it in .env at the project root or in the environment."
        )
    algorithm = os.environ.get("JWT_ALGORITHM", "HS256").strip() or "HS256"
    raw_minutes = os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", "30").strip()
    try:
        minutes = int(raw_minutes)
    except ValueError as exc:
        raise RuntimeError("ACCESS_TOKEN_EXPIRE_MINUTES must be an integer.") from exc
    if minutes < 1:
        raise RuntimeError("ACCESS_TOKEN_EXPIRE_MINUTES must be at least 1.")
    raw_days = os.environ.get("REFRESH_TOKEN_EXPIRE_DAYS", "7").strip()
    try:
        days = int(raw_days)
    except ValueError as exc:
        raise RuntimeError("REFRESH_TOKEN_EXPIRE_DAYS must be an integer.") from exc
    if days < 1:
        raise RuntimeError("REFRESH_TOKEN_EXPIRE_DAYS must be at least 1.")
    enforce_admin = os.environ.get("ENFORCE_SUPERUSER_ON_ADMIN", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    return Settings(
        jwt_secret_key=secret,
        jwt_algorithm=algorithm,
        access_token_expire_minutes=minutes,
        refresh_token_expire_days=days,
        enforce_superuser_on_admin=enforce_admin,
    )
