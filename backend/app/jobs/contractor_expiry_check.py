from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from db.session import SessionLocal
from modules.contractor.models import Contractor, ContractorDocument
from modules.emails.service import EmailNotificationService
from modules.notifications.model import NotificationDedupKey
from modules.notifications.service import NotificationSettingsService
from modules.rbac_association import user_role
from modules.users.model import User


NOTIFICATION_EVENT_CODE = "contractor_doc_expiry"
EMAIL_EVENT_CODE = "CONTRACTOR_DOC_EXPIRY"


def _dedup_key(*, doc_id: int, on_date: date) -> str:
    return f"contractor_doc_alert:{int(doc_id)}:{on_date.isoformat()}"


def _claim_dedup(db: Session, key: str) -> bool:
    """
    Return True if the key was claimed (first time), False if it already existed.
    """
    db.add(NotificationDedupKey(key=key))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return False
    return True


def _role_user_emails(db: Session, role_ids: list[int]) -> list[tuple[str, str]]:
    """
    Return (full_name, email) for active users that have any of the given roles.
    """
    role_ids = [int(rid) for rid in (role_ids or []) if rid is not None]
    if not role_ids:
        return []
    stmt = (
        select(User.full_name, User.email)
        .select_from(user_role)
        .join(User, User.id == user_role.c.user_id)
        .where(
            and_(
                user_role.c.role_id.in_(role_ids),
                User.is_active.is_(True),
                User.email.is_not(None),
            )
        )
        .distinct()
        .order_by(User.id.asc())
    )
    rows = db.execute(stmt).all()
    out: list[tuple[str, str]] = []
    for full_name, email in rows:
        if not email:
            continue
        out.append((str(full_name or "").strip() or "User", str(email).strip()))
    return out


def run(*, batch_size: int = 500) -> dict[str, int]:
    """
    Background job: contractor document expiry alerts.

    De-dup strategy: insert-once key per (doc_id, date).
    """
    db = SessionLocal()
    try:
        return _run(db, batch_size=batch_size)
    finally:
        db.close()


def _run(db: Session, *, batch_size: int) -> dict[str, int]:
    setting = NotificationSettingsService(db).get_by_event_code(NOTIFICATION_EVENT_CODE)
    if setting is None or not bool(setting.is_active):
        return {"documents_scanned": 0, "notifications_sent": 0, "notifications_skipped_dedup": 0}

    days_before = int(setting.days_before or 0)
    threshold = date.today() + timedelta(days=days_before)
    notify_roles = list(setting.notify_roles or [])

    last_id = 0
    scanned = 0
    sent = 0
    skipped_dedup = 0

    while True:
        stmt = (
            select(ContractorDocument, Contractor)
            .join(Contractor, Contractor.id == ContractorDocument.contractor_id)
            .where(
                ContractorDocument.id > int(last_id),
                ContractorDocument.expiry_date.is_not(None),
                ContractorDocument.expiry_date <= threshold,
                Contractor.is_active.is_(True),
            )
            .order_by(ContractorDocument.id.asc())
            .limit(int(batch_size))
        )
        rows = db.execute(stmt).all()
        if not rows:
            break

        role_recipients = _role_user_emails(db, notify_roles)

        for doc, contractor in rows:
            scanned += 1
            last_id = int(doc.id)

            expiry = doc.expiry_date
            if expiry is None:
                continue

            # De-dup for this doc on this run date (daily).
            key = _dedup_key(doc_id=int(doc.id), on_date=date.today())
            if not _claim_dedup(db, key):
                skipped_dedup += 1
                continue

            days_left = (expiry - date.today()).days

            base_payload = {
                "contractor_name": str(contractor.name),
                "document_name": str(doc.document_name),
                "document_type": str(doc.document_type),
                "expiry_date": expiry.isoformat(),
                "days_left": int(days_left),
            }

            # 1) Contractor email (if available)
            if contractor.email:
                EmailNotificationService(db).trigger_event_best_effort(
                    event_code=EMAIL_EVENT_CODE,
                    payload={
                        "user_name": str(contractor.contact_person or contractor.name),
                        "email": str(contractor.email),
                        **base_payload,
                    },
                )
                sent += 1

            # 2) Role-based recipients
            for full_name, email in role_recipients:
                EmailNotificationService(db).trigger_event_best_effort(
                    event_code=EMAIL_EVENT_CODE,
                    payload={
                        "user_name": full_name,
                        "email": email,
                        **base_payload,
                    },
                )
                sent += 1

        # Move on; statement filters by id, so no offset scan.

    return {
        "documents_scanned": int(scanned),
        "notifications_sent": int(sent),
        "notifications_skipped_dedup": int(skipped_dedup),
    }

