"""Encrypt TOTP shared secrets at rest (Fernet with key from JWT secret)."""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet

from core.config import get_settings


def _fernet() -> Fernet:
    s = get_settings()
    key = base64.urlsafe_b64encode(hashlib.sha256(s.jwt_secret_key.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_secret(plain: str) -> str:
    return _fernet().encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt_secret(encrypted: str) -> str:
    return _fernet().decrypt(encrypted.encode("utf-8")).decode("utf-8")
