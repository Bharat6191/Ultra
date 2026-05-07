from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_permission, require_superuser
from db.session import get_db
from modules.emails.constants import EVENT_CODES
from modules.emails.model import EmailTemplate, EmailTemplateMapping
from modules.emails.schema import (
    EmailPreviewRequest,
    EmailPreviewResponse,
    EmailTemplateCreate,
    EmailTemplateMappingCreate,
    EmailTemplateMappingPublic,
    EmailTemplateMappingUpdate,
    EmailTemplatePublic,
    EmailTemplateUpdate,
    EmailVariablesResponse,
)
from modules.emails.service import EmailNotificationService, extract_variables, render_template

router = APIRouter(
    prefix="/email-templates",
    tags=["admin", "email-templates"],
    dependencies=[Depends(require_superuser())],
)


def _db(db: Session = Depends(get_db)) -> Session:
    return db


@router.post(
    "",
    response_model=EmailTemplatePublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("email_templates.manage"))],
)
def create_template(
    payload: dict,
    db: Annotated[Session, Depends(_db)],
) -> EmailTemplatePublic:
    """
    Backward compatible create endpoint:
    - If body matches EmailTemplateCreate -> create a new template row.
    - Else treat as an upsert-by-event_code payload (control center):
      {event_code, subject, body_html, is_active?}
    """
    try:
        parsed = EmailTemplateCreate.model_validate(payload)
        t = EmailTemplate(
            name=parsed.name.strip(),
            event_code=parsed.event_code.strip().upper(),
            subject=parsed.subject,
            body_html=parsed.body_html,
            body_text=parsed.body_text,
            is_active=bool(parsed.is_active),
        )
        db.add(t)
        db.commit()
        db.refresh(t)
        return EmailTemplatePublic.model_validate(t)
    except Exception:
        pass

    event_code = str(payload.get("event_code") or "").strip().upper()
    if not event_code:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="event_code is required")
    if event_code not in EVENT_CODES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid event_code")
    subject = str(payload.get("subject") or "").strip()
    body_html = str(payload.get("body_html") or payload.get("body") or "").strip()
    if not subject or not body_html:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="subject and body_html are required")
    is_active = bool(payload.get("is_active", True))

    existing = db.scalar(select(EmailTemplate).where(EmailTemplate.event_code == event_code).order_by(EmailTemplate.id.desc()))
    if existing is None:
        existing = EmailTemplate(
            name=f"{event_code} (managed)",
            event_code=event_code,
            subject=subject,
            body_html=body_html,
            body_text=None,
            is_active=is_active,
        )
        db.add(existing)
        db.flush()
    else:
        existing.subject = subject
        existing.body_html = body_html
        existing.is_active = is_active

    # Ensure a mapping exists and is enabled.
    mapping = db.scalar(select(EmailTemplateMapping).where(EmailTemplateMapping.event_code == event_code))
    if mapping is None:
        mapping = EmailTemplateMapping(event_code=event_code, template_id=int(existing.id), is_enabled=True)
        db.add(mapping)
    else:
        mapping.template_id = int(existing.id)
        mapping.is_enabled = bool(payload.get("is_enabled", True))

    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    db.refresh(existing)
    return EmailTemplatePublic.model_validate(existing)


@router.get(
    "",
    response_model=list[EmailTemplatePublic],
    dependencies=[Depends(require_permission("email_templates.manage"))],
)
def list_templates(
    db: Annotated[Session, Depends(_db)],
    event_code: str | None = Query(None),
) -> list[EmailTemplatePublic]:
    stmt = select(EmailTemplate)
    if event_code:
        stmt = stmt.where(EmailTemplate.event_code == event_code.strip().upper())
    rows = db.scalars(stmt.order_by(EmailTemplate.id.desc())).all()
    return [EmailTemplatePublic.model_validate(r) for r in rows]


@router.patch(
    "/{template_id:int}",
    response_model=EmailTemplatePublic,
    dependencies=[Depends(require_permission("email_templates.update"))],
)
def update_template(
    template_id: int,
    payload: EmailTemplateUpdate,
    db: Annotated[Session, Depends(_db)],
) -> EmailTemplatePublic:
    t = db.get(EmailTemplate, template_id)
    if t is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    upd = payload.model_dump(exclude_unset=True)
    if "name" in upd and upd["name"] is not None:
        t.name = str(upd["name"]).strip()
    if "event_code" in upd and upd["event_code"] is not None:
        t.event_code = str(upd["event_code"]).strip().upper()
    if "subject" in upd and upd["subject"] is not None:
        t.subject = str(upd["subject"])
    if "body_html" in upd and upd["body_html"] is not None:
        t.body_html = str(upd["body_html"])
    if "body_text" in upd:
        t.body_text = upd["body_text"]
    if "is_active" in upd and upd["is_active"] is not None:
        t.is_active = bool(upd["is_active"])
    db.commit()
    db.refresh(t)
    return EmailTemplatePublic.model_validate(t)


@router.delete(
    "/{template_id:int}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission("email_templates.delete"))],
)
def delete_template(template_id: int, db: Annotated[Session, Depends(_db)]) -> None:
    t = db.get(EmailTemplate, template_id)
    if t is None:
        return
    db.delete(t)
    db.commit()


@router.get(
    "/variables/{event_code}",
    response_model=EmailVariablesResponse,
    dependencies=[Depends(require_permission("email_templates.view"))],
)
def variables_for_event(event_code: str) -> EmailVariablesResponse:
    code = (event_code or "").strip().upper()
    # Start minimal: engine enforces variables based on the chosen template at send-time.
    # Admin UI uses this as a hint list for each event.
    vars_by_event: dict[str, list[str]] = {
        "USER_CREATED": ["user_name", "email", "company_name", "temp_password"],
        "FORGOT_PASSWORD": ["user_name", "email", "reset_link"],
        "PASSWORD_RESET": ["user_name", "email"],
        "TASK_ASSIGNED": ["user_name", "email", "task_name", "entity_name"],
        "TASK_APPROVED": ["user_name", "email", "task_name", "entity_name"],
        "TASK_REJECTED": ["user_name", "email", "task_name", "entity_name"],
        "TASK_REWORK_REQUIRED": ["user_name", "email", "entity_name", "rejection_reason", "task_link"],
        "TASK_RESUBMITTED": ["user_name", "email", "entity_name", "task_link"],
        "MFA_SETUP_REQUIRED": ["user_name", "email", "setup_link"],
        "MFA_SETUP_REMINDER": ["user_name", "email", "setup_link"],
        "MFA_ENABLED": ["user_name", "email"],
        "CONTRACTOR_DOC_EXPIRY": [
            "user_name",
            "email",
            "contractor_name",
            "document_name",
            "document_type",
            "expiry_date",
            "days_left",
        ],
    }
    return EmailVariablesResponse(event_code=code, variables=vars_by_event.get(code, []))


@router.post(
    "/preview",
    response_model=EmailPreviewResponse,
    dependencies=[Depends(require_permission("email_templates.view"))],
)
def preview(payload: EmailPreviewRequest) -> EmailPreviewResponse:
    required = sorted(set(extract_variables(payload.subject) + extract_variables(payload.body_html)))
    missing = [k for k in required if k not in (payload.payload or {})]
    subj = payload.subject
    body = payload.body_html
    if not missing:
        try:
            subj = render_template(payload.subject, payload.payload)
            body = render_template(payload.body_html, payload.payload)
        except Exception:
            # Preview is best-effort; template errors are shown as missing_variables.
            missing = missing or required
    return EmailPreviewResponse(subject=subj, body_html=body, missing_variables=missing)


@router.post(
    "/mappings",
    response_model=EmailTemplateMappingPublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("email_templates.update"))],
)
def create_mapping(payload: EmailTemplateMappingCreate, db: Annotated[Session, Depends(_db)]) -> EmailTemplateMappingPublic:
    code = payload.event_code.strip().upper()
    if code not in EVENT_CODES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid event_code")
    if db.get(EmailTemplate, int(payload.template_id)) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    m = EmailTemplateMapping(event_code=code, template_id=int(payload.template_id), is_enabled=bool(payload.is_enabled))
    db.add(m)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    db.refresh(m)
    return EmailTemplateMappingPublic.model_validate(m)


@router.get(
    "/mappings",
    response_model=list[EmailTemplateMappingPublic],
    dependencies=[Depends(require_permission("email_templates.view"))],
)
def list_mappings(db: Annotated[Session, Depends(_db)]) -> list[EmailTemplateMappingPublic]:
    rows = db.scalars(select(EmailTemplateMapping).order_by(EmailTemplateMapping.id.desc())).all()
    return [EmailTemplateMappingPublic.model_validate(r) for r in rows]


@router.patch(
    "/mappings/{mapping_id}",
    response_model=EmailTemplateMappingPublic,
    dependencies=[Depends(require_permission("email_templates.update"))],
)
def update_mapping(
    mapping_id: int, payload: EmailTemplateMappingUpdate, db: Annotated[Session, Depends(_db)]
) -> EmailTemplateMappingPublic:
    m = db.get(EmailTemplateMapping, mapping_id)
    if m is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mapping not found")
    upd = payload.model_dump(exclude_unset=True)
    if "template_id" in upd and upd["template_id"] is not None:
        if db.get(EmailTemplate, int(upd["template_id"])) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
        m.template_id = int(upd["template_id"])
    if "is_enabled" in upd and upd["is_enabled"] is not None:
        m.is_enabled = bool(upd["is_enabled"])
    db.commit()
    db.refresh(m)
    return EmailTemplateMappingPublic.model_validate(m)


@router.get(
    "/{template_id:int}",
    response_model=EmailTemplatePublic,
    dependencies=[Depends(require_permission("email_templates.view"))],
)
def get_template(template_id: int, db: Annotated[Session, Depends(_db)]) -> EmailTemplatePublic:
    """
    Keep this route **after** static subpaths like ``/mappings`` so FastAPI doesn't try to treat
    ``mappings`` as a template id (which would yield a 422).
    """
    t = db.get(EmailTemplate, template_id)
    if t is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    return EmailTemplatePublic.model_validate(t)

