from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from core.password_policy import password_policy_admin_view
from modules.settings.lookup import clear_setting_cache
from modules.settings.model import Setting
from modules.settings.schema import AuthPolicyPublic, PasswordPolicyPublic
from modules.users.model import User
from modules.mfa.policy_hooks import maybe_send_mfa_setup_for_user


class SettingsService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_password_policy(self) -> PasswordPolicyPublic:
        return PasswordPolicyPublic.model_validate(password_policy_admin_view())

    def put_password_policy(self, payload: PasswordPolicyPublic) -> PasswordPolicyPublic:
        mapping: list[tuple[str, str]] = [
            ("password.min_length", str(payload.min_length)),
            (
                "password.require_uppercase",
                "true" if payload.require_uppercase else "false",
            ),
            (
                "password.require_lowercase",
                "true" if payload.require_lowercase else "false",
            ),
            ("password.require_digit", "true" if payload.require_digit else "false"),
            (
                "password.require_special",
                "true" if payload.require_special else "false",
            ),
            ("password.max_age_days", str(payload.max_age_days)),
        ]
        for key, value in mapping:
            self._upsert(key, value)
        self._db.commit()
        clear_setting_cache(*[k for k, _ in mapping])
        return self.get_password_policy()

    def get_auth_policy(self) -> AuthPolicyPublic:
        def b(key: str, default: bool) -> bool:
            row = self._db.scalar(select(Setting).where(Setting.key == key))
            if row is None or row.value is None:
                return default
            return str(row.value).strip().lower() in ("1", "true", "yes", "on")

        def s(key: str, default: str) -> str:
            row = self._db.scalar(select(Setting).where(Setting.key == key))
            if row is None or row.value is None:
                return default
            return str(row.value).strip() or default

        def i(key: str, default: int) -> int:
            row = self._db.scalar(select(Setting).where(Setting.key == key))
            if row is None or row.value is None:
                return default
            try:
                value = int(str(row.value).strip())
            except (TypeError, ValueError):
                return default
            return value if value >= 1 else default

        mode = s("auth.session_timeout_mode", "token_expiry")
        if mode not in {"token_expiry", "idle_timeout"}:
            mode = "token_expiry"

        return AuthPolicyPublic(
            password_enabled=b("auth.password_enabled", True),
            mfa_enabled=b("auth.mfa_enabled", False),
            captcha_enabled=b("auth.captcha_enabled", False),
            mfa_enforced=b("auth.mfa_enforced", False),
            session_timeout_mode=mode,
            idle_timeout_minutes=i("auth.idle_timeout_minutes", 10),
        )

    def put_auth_policy(self, payload: AuthPolicyPublic) -> AuthPolicyPublic:
        before = self.get_auth_policy()
        mapping: list[tuple[str, str]] = [
            ("auth.password_enabled", "true" if payload.password_enabled else "false"),
            ("auth.mfa_enabled", "true" if payload.mfa_enabled else "false"),
            ("auth.captcha_enabled", "true" if payload.captcha_enabled else "false"),
            ("auth.mfa_enforced", "true" if payload.mfa_enforced else "false"),
            ("auth.session_timeout_mode", payload.session_timeout_mode),
            ("auth.idle_timeout_minutes", str(payload.idle_timeout_minutes)),
        ]
        for key, value in mapping:
            self._upsert(key, value)
        self._db.commit()
        clear_setting_cache(*[k for k, _ in mapping])

        # If MFA was just enabled globally, send setup emails to all active users missing setup.
        if (not before.mfa_enabled) and payload.mfa_enabled:
            stmt = (
                select(User)
                .where(User.is_active.is_(True), User.is_superuser.is_(False))
                .options(selectinload(User.mfa_record), selectinload(User.org_units))
            )
            for u in self._db.scalars(stmt).unique().all():
                maybe_send_mfa_setup_for_user(self._db, u, event_code="MFA_SETUP_REQUIRED")

        return self.get_auth_policy()

    def _upsert(self, key: str, value: str) -> None:
        row = self._db.scalar(select(Setting).where(Setting.key == key))
        if row is None:
            self._db.add(Setting(key=key, value=value))
        else:
            row.value = value
