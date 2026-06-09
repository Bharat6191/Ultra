from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from core.password_policy import password_policy_admin_view
from modules.settings.lookup import clear_setting_cache
from modules.settings.model import Setting
from modules.settings.schema import (
    AppearanceSettingsPublic,
    AuthPolicyPublic,
    DEFAULT_PAGE_BACKGROUND_COLOR,
    PasswordPolicyPublic,
)
from modules.users.model import User
from modules.mfa.policy_hooks import maybe_send_mfa_setup_for_user


class SettingsService:
    def __init__(self, db: Session) -> None:
        self._db = db

    @staticmethod
    def _bool_from_row(row: Setting | None, default: bool) -> bool:
        if row is None or row.value is None:
            return default
        return str(row.value).strip().lower() in ("1", "true", "yes", "on")

    @staticmethod
    def _str_from_row(row: Setting | None, default: str) -> str:
        if row is None or row.value is None:
            return default
        return str(row.value).strip() or default

    @staticmethod
    def _int_from_row(row: Setting | None, default: int) -> int:
        if row is None or row.value is None:
            return default
        try:
            value = int(str(row.value).strip())
        except (TypeError, ValueError):
            return default
        return value if value >= 1 else default

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
        def row(key: str) -> Setting | None:
            return self._db.scalar(select(Setting).where(Setting.key == key))

        mode = self._str_from_row(row("auth.session_timeout_mode"), "token_expiry")
        if mode not in {"token_expiry", "idle_timeout"}:
            mode = "token_expiry"

        return AuthPolicyPublic(
            password_enabled=self._bool_from_row(row("auth.password_enabled"), True),
            mfa_enabled=self._bool_from_row(row("auth.mfa_enabled"), False),
            captcha_enabled=self._bool_from_row(row("auth.captcha_enabled"), False),
            mfa_enforced=self._bool_from_row(row("auth.mfa_enforced"), False),
            session_timeout_mode=mode,
            idle_timeout_minutes=self._int_from_row(row("auth.idle_timeout_minutes"), 10),
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

    def get_appearance_settings(self) -> AppearanceSettingsPublic:
        row = self._db.scalar(select(Setting).where(Setting.key == "appearance.page_background_color"))
        color = self._str_from_row(row, DEFAULT_PAGE_BACKGROUND_COLOR)
        return AppearanceSettingsPublic(page_background_color=color)

    def put_appearance_settings(self, payload: AppearanceSettingsPublic) -> AppearanceSettingsPublic:
        mapping: list[tuple[str, str]] = [
            ("appearance.page_background_color", payload.page_background_color),
        ]
        for key, value in mapping:
            self._upsert(key, value)
        self._db.commit()
        clear_setting_cache(*[k for k, _ in mapping])
        return self.get_appearance_settings()

    def _upsert(self, key: str, value: str) -> None:
        row = self._db.scalar(select(Setting).where(Setting.key == key))
        if row is None:
            self._db.add(Setting(key=key, value=value))
        else:
            row.value = value
