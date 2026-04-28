from __future__ import annotations

import hashlib
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pyotp
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from core.mfa_crypto import decrypt_secret, encrypt_secret
from modules.mfa.model import MfaChallenge, MfaSetupToken, UserMfa
from modules.users.model import User


def _h(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _issuer_name() -> str:
    return (os.environ.get("MFA_ISSUER_NAME") or "TiM Enterprise").strip() or "TiM Enterprise"


@dataclass(frozen=True, slots=True)
class MfaSetupInitResult:
    otpauth_url: str
    account_name: str


class MfaService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def create_setup_token(self, user_id: int) -> str:
        raw = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        exp_min = int((os.environ.get("MFA_SETUP_TOKEN_EXPIRE_MINUTES") or "10080").strip() or "10080")
        if exp_min < 15:
            exp_min = 15
        row = MfaSetupToken(
            user_id=int(user_id),
            token_hash=_h(raw),
            expires_at=now + timedelta(minutes=exp_min),
        )
        self._db.add(row)
        self._db.commit()
        return raw

    def get_or_create_user_mfa(self, user_id: int) -> UserMfa:
        row = self._db.scalar(select(UserMfa).where(UserMfa.user_id == int(user_id)))
        if row is not None:
            return row
        row = UserMfa(user_id=int(user_id), secret_encrypted="", setup_completed=False, is_enabled=True)
        self._db.add(row)
        self._db.commit()
        self._db.refresh(row)
        return row

    def create_login_challenge(self, user_id: int) -> str:
        raw = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        exp_m = 10
        row = MfaChallenge(
            user_id=int(user_id),
            token_hash=_h(raw),
            expires_at=now + timedelta(minutes=exp_m),
        )
        self._db.add(row)
        self._db.commit()
        return raw

    def verify_login_challenge(self, raw_token: str) -> MfaChallenge | None:
        token_hash = _h((raw_token or "").strip())
        now = datetime.now(timezone.utc)
        row = self._db.scalar(
            select(MfaChallenge).where(
                MfaChallenge.token_hash == token_hash,
                MfaChallenge.used_at.is_(None),
                MfaChallenge.expires_at > now,
            )
        )
        return row

    def mark_challenge_used(self, ch: MfaChallenge) -> None:
        ch.used_at = datetime.now(timezone.utc)
        self._db.commit()

    def verify_totp_for_user(self, user_id: int, otp: str) -> bool:
        row = self._db.scalar(
            select(UserMfa).where(UserMfa.user_id == int(user_id), UserMfa.setup_completed.is_(True))
        )
        if row is None or not row.secret_encrypted:
            return False
        try:
            secret = decrypt_secret(row.secret_encrypted)
        except Exception:
            return False
        totp = pyotp.TOTP(secret)
        return bool(totp.verify((otp or "").strip(), valid_window=1))

    def init_enrollment(self, user_id: int) -> MfaSetupInitResult:
        """Generate a new TOTP secret and store encrypted (replaces any incomplete enrollment)."""
        row = self.get_or_create_user_mfa(int(user_id))
        secret = pyotp.random_base32()
        row.secret_encrypted = encrypt_secret(secret)
        row.setup_completed = False
        self._db.commit()
        u = self._db.get(User, int(user_id))
        label = (u.email or u.phone or str(u.id)) if u else str(user_id)
        totp = pyotp.TOTP(secret)
        uri = totp.provisioning_uri(name=label, issuer_name=_issuer_name())
        return MfaSetupInitResult(otpauth_url=uri, account_name=label)

    def complete_enrollment(self, user_id: int, otp: str) -> bool:
        row = self._db.scalar(select(UserMfa).where(UserMfa.user_id == int(user_id)))
        if row is None or not row.secret_encrypted:
            return False
        secret = decrypt_secret(row.secret_encrypted)
        totp = pyotp.TOTP(secret)
        if not totp.verify((otp or "").strip(), valid_window=1):
            return False
        row.setup_completed = True
        row.is_enabled = True
        self._db.commit()
        return True

    def find_valid_setup_token(self, raw: str) -> MfaSetupToken | None:
        th = _h((raw or "").strip())
        now = datetime.now(timezone.utc)
        return self._db.scalar(
            select(MfaSetupToken).where(
                MfaSetupToken.token_hash == th,
                MfaSetupToken.used_at.is_(None),
                MfaSetupToken.expires_at > now,
            )
        )

    def mark_setup_token_used(self, row: MfaSetupToken) -> None:
        row.used_at = datetime.now(timezone.utc)
        self._db.commit()

    def get_user_for_setup(self, user_id: int) -> User | None:
        return self._db.scalar(
            select(User)
            .where(User.id == int(user_id))
            .options(selectinload(User.mfa_record))
        )
