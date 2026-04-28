"""MFA email triggers driven by auth policy and lifecycle (no import cycles in models)."""

from __future__ import annotations

from sqlalchemy.orm import Session, selectinload
from sqlalchemy import select

from modules.auth_policy.service import get_global_policy
from modules.mfa.notify import trigger_mfa_setup_email
from modules.users.model import User


def maybe_send_mfa_setup_for_user(db: Session, user: User, *, event_code: str = "MFA_SETUP_REQUIRED") -> None:
    """If company policy requires MFA and user has not finished setup, send email (respects pending approval)."""
    if not user.is_active or user.is_superuser or not user.email:
        return
    user = db.scalar(
        select(User)
        .where(User.id == int(user.id))
        .options(selectinload(User.org_units), selectinload(User.mfa_record))
    )
    if user is None:
        return
    pol = get_global_policy(db)
    if not pol.mfa_enabled:
        return
    m = user.mfa_record
    if m is not None and bool(m.setup_completed):
        return
    trigger_mfa_setup_email(db, user, event_code)
