from __future__ import annotations

import os
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from modules.approvals.model import ApprovalRequest
from modules.emails.service import EmailNotificationService
from modules.mfa.service import MfaService
from modules.users.model import User


def _setup_link(raw: str) -> str:
    from urllib.parse import quote

    base = (os.environ.get("FRONTEND_APP_URL") or os.environ.get("FRONTEND_ORIGIN") or "http://localhost:5173").rstrip(
        "/"
    )
    return f"{base}/mfa/setup?token={quote(raw, safe='')}"


def create_mfa_setup_link(db: Session, *, user: User) -> str | None:
    """
    Create a one-time MFA setup token and return the setup URL.

    Does not send email. Caller is responsible for policy gating.
    """
    if not user.is_active or not user.email or user.is_superuser:
        return None
    if user_has_pending_user_creation_approval(db, int(user.id)):
        return None
    raw = MfaService(db).create_setup_token(int(user.id))
    return _setup_link(raw)


def user_has_pending_user_creation_approval(db: Session, user_id: int) -> bool:
    """True if a user_creation request is still pending (user should not receive MFA email yet)."""
    q = select(ApprovalRequest.id).where(
        ApprovalRequest.entity_type == "user_creation",
        ApprovalRequest.entity_id == int(user_id),
        ApprovalRequest.status == "pending",
    )
    return db.scalar(q) is not None


def trigger_mfa_setup_email(
    db: Session,
    *,
    user: User,
    event_code: str,
) -> None:
    if not user.is_active or not user.email or user.is_superuser:
        return
    if user_has_pending_user_creation_approval(db, int(user.id)):
        return
    setup_link = create_mfa_setup_link(db, user=user)
    if not setup_link:
        return
    EmailNotificationService(db).trigger_event(
        event_code=event_code,
        payload={
            "user_name": user.full_name,
            "email": user.email,
            "setup_link": setup_link,
        },
    )


def email_payload_stub(*, user: User, setup_link: str) -> dict[str, Any]:
    return {"user_name": user.full_name, "email": user.email, "setup_link": setup_link}
