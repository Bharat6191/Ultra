import uuid
from datetime import datetime, timedelta, timezone
import hashlib
import os
import secrets
from urllib.parse import quote

from jose import JWTError
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from core.captcha import captcha_is_valid
from core.config import get_settings
from core.password_policy import PasswordExpiredError, is_password_expired
from core.password_policy import validate_password
from core.security import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    hash_password,
    verify_password,
)
from modules.auth.model import PasswordResetToken, UserSession
from core.permissions import get_flat_permission_codes_for_user
from modules.auth.login_result import (
    CaptchaInvalidError,
    LoginOutcome,
    LoginOutcomeMfaOtp,
    LoginOutcomeMfaSetup,
    LoginOutcomeTokens,
    PasswordLoginDisabledError,
)
from modules.auth.schema import LoginRequest, TokenPair, UserMe
from modules.auth_policy.service import get_global_policy
from modules.errors import NotFoundError
from modules.mfa.service import MfaService
from modules.users.model import User
from modules.emails.service import EmailNotificationService


class InvalidCredentialsError(Exception):
    pass


class InvalidRefreshTokenError(Exception):
    pass


class AuthService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def _issue_token_pair(self, user: User) -> TokenPair:
        settings = get_settings()
        jti = str(uuid.uuid4())
        access = create_access_token({"sub": str(user.id)})
        delta = timedelta(days=settings.refresh_token_expire_days)
        refresh = create_refresh_token(subject=str(user.id), jti=jti, expires_delta=delta)
        now = datetime.now(timezone.utc)
        self._db.add(
            UserSession(
                refresh_jti=jti,
                user_id=user.id,
                expires_at=now + delta,
            )
        )
        self._db.commit()
        return TokenPair(access_token=access, refresh_token=refresh)

    def issue_token_pair(self, user: User) -> TokenPair:
        """Public: used after MFA verification."""
        return self._issue_token_pair(user)

    def _load_user_for_login(self, data: LoginRequest) -> User | None:
        if data.email is not None:
            email = str(data.email).lower().strip()
            return self._db.scalar(
                select(User)
                .where(User.email == email)
                .options(selectinload(User.org_units), selectinload(User.mfa_record))
            )
        if data.username is not None:
            uname = str(data.username).strip()
            return self._db.scalar(
                select(User)
                .where(User.username == uname)
                .options(selectinload(User.org_units), selectinload(User.mfa_record))
            )
        if data.phone:
            phone = str(data.phone).strip()
            return self._db.scalar(
                select(User)
                .where(User.phone == phone)
                .options(selectinload(User.org_units), selectinload(User.mfa_record))
            )
        return None

    def login_outcome(self, data: LoginRequest) -> LoginOutcome:
        user = self._load_user_for_login(data)
        if (
            user is None
            or not user.is_active
            or not verify_password(data.password, user.hashed_password)
        ):
            raise InvalidCredentialsError
        if is_password_expired(user):
            raise PasswordExpiredError

        if user.is_superuser:
            return LoginOutcomeTokens(tokens=self._issue_token_pair(user))

        pol = get_global_policy(self._db)
        if not pol.password_enabled:
            raise PasswordLoginDisabledError
        if pol.captcha_enabled and not captcha_is_valid(
            token=data.captcha_token, captcha_enabled=True
        ):
            raise CaptchaInvalidError

        if not pol.mfa_enabled:
            return LoginOutcomeTokens(tokens=self._issue_token_pair(user))

        mfa = user.mfa_record
        setup_ok = mfa is not None and bool(mfa.setup_completed) and bool(mfa.is_enabled)
        if not setup_ok:
            if pol.mfa_enforced:
                msvc = MfaService(self._db)
                raw = msvc.create_setup_token(int(user.id))
                exp_min = int((os.environ.get("MFA_SETUP_TOKEN_EXPIRE_MINUTES") or "10080").strip() or "10080")
                return LoginOutcomeMfaSetup(setup_token=raw, expires_in_seconds=max(60, exp_min * 60))
            return LoginOutcomeTokens(tokens=self._issue_token_pair(user))

        msvc = MfaService(self._db)
        ch = msvc.create_login_challenge(int(user.id))
        return LoginOutcomeMfaOtp(challenge_token=ch, expires_in_seconds=600)

    def refresh(self, refresh_token: str) -> TokenPair:
        settings = get_settings()
        try:
            payload = decode_refresh_token(refresh_token)
        except JWTError as exc:
            raise InvalidRefreshTokenError from exc
        jti = payload.get("jti")
        sub = payload.get("sub")
        if not jti or not isinstance(jti, str) or sub is None:
            raise InvalidRefreshTokenError
        user_id = int(sub) if isinstance(sub, str) else int(sub)
        now = datetime.now(timezone.utc)
        row = self._db.scalar(
            select(UserSession).where(
                UserSession.refresh_jti == jti,
                UserSession.revoked_at.is_(None),
                UserSession.expires_at > now,
            )
        )
        if row is None:
            raise InvalidRefreshTokenError
        row.revoked_at = now
        new_jti = str(uuid.uuid4())
        delta = timedelta(days=settings.refresh_token_expire_days)
        new_refresh = create_refresh_token(
            subject=str(user_id), jti=new_jti, expires_delta=delta
        )
        self._db.add(
            UserSession(
                refresh_jti=new_jti,
                user_id=user_id,
                expires_at=now + delta,
            )
        )
        access = create_access_token({"sub": str(user_id)})
        self._db.commit()
        return TokenPair(access_token=access, refresh_token=new_refresh)

    def get_me(self, user_id: int) -> User:
        user = self._db.scalar(
            select(User)
            .where(User.id == user_id)
            .options(selectinload(User.roles), selectinload(User.org_units))
        )
        if user is None:
            raise NotFoundError("User", user_id)
        return user

    def get_me_public(self, user_id: int) -> UserMe:
        user = self.get_me(user_id)
        org = user.org_units[0] if user.org_units else None
        codes = get_flat_permission_codes_for_user(self._db, user_id)
        role_names = sorted({r.name for r in user.roles})
        role_display = ", ".join(role_names) if role_names else None
        return UserMe(
            id=user.id,
            full_name=user.full_name,
            email=user.email,
            phone=user.phone,
            created_at=user.created_at,
            is_superuser=user.is_superuser,
            is_active=user.is_active,
            role=role_display,
            org_unit=None if org is None else org.name,
            permissions=codes,
        )

    def forgot_password(self, *, email: str) -> None:
        email_norm = (email or "").strip().lower()
        if not email_norm or "@" not in email_norm:
            return
        user = self._db.scalar(select(User).where(User.email == email_norm))
        if user is None or not user.is_active:
            return

        raw = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        expires_minutes = int((os.environ.get("PASSWORD_RESET_TOKEN_EXPIRE_MINUTES") or "30").strip() or "30")
        if expires_minutes < 5:
            expires_minutes = 5
        now = datetime.now(timezone.utc)
        row = PasswordResetToken(
            user_id=int(user.id), token_hash=token_hash, expires_at=now + timedelta(minutes=expires_minutes)
        )
        self._db.add(row)
        self._db.commit()

        base = (os.environ.get("FRONTEND_APP_URL") or os.environ.get("FRONTEND_ORIGIN") or "http://localhost:5173").rstrip(
            "/"
        )
        reset_link = f"{base}/reset-password?token={quote(raw, safe='')}"
        EmailNotificationService(self._db).trigger_event(
            event_code="FORGOT_PASSWORD",
            payload={
                "user_name": user.full_name,
                "email": user.email,
                "reset_link": reset_link,
            },
        )

    def reset_password(self, *, token: str, new_password: str) -> None:
        raw = (token or "").strip()
        if not raw:
            raise ValueError("Invalid token")
        validate_password(new_password)

        token_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        now = datetime.now(timezone.utc)
        row = self._db.scalar(
            select(PasswordResetToken).where(
                PasswordResetToken.token_hash == token_hash,
                PasswordResetToken.used_at.is_(None),
                PasswordResetToken.expires_at > now,
            )
        )
        if row is None:
            raise ValueError("Invalid or expired token")

        user = self._db.get(User, int(row.user_id))
        if user is None:
            raise ValueError("Invalid token")

        user.hashed_password = hash_password(new_password)
        user.password_changed_at = now
        row.used_at = now
        self._db.commit()

        if user.email:
            EmailNotificationService(self._db).trigger_event(
                event_code="PASSWORD_RESET",
                payload={"user_name": user.full_name, "email": user.email},
            )
