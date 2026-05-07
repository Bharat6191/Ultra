from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.permissions import require_permission, require_superuser
from db.session import get_db
from modules.errors import NotFoundError
from modules.notifications.schema import (
    NotificationSettingPublic,
    NotificationSettingUpdate,
    NotificationSettingUpsert,
)
from modules.notifications.service import NotificationSettingsService


router = APIRouter(
    prefix="/notification-settings",
    tags=["admin", "notification-settings"],
    dependencies=[Depends(require_superuser())],
)


def get_settings_service(db: Session = Depends(get_db)) -> NotificationSettingsService:
    return NotificationSettingsService(db)


@router.get("", response_model=list[NotificationSettingPublic])
def get_by_event_code(
    svc: Annotated[NotificationSettingsService, Depends(get_settings_service)],
    _: Annotated[object, Depends(require_permission("notification_settings.manage"))],
    event_code: str = Query(..., min_length=1),
) -> list[NotificationSettingPublic]:
    row = svc.get_by_event_code(event_code)
    if row is None:
        return []
    return [NotificationSettingPublic.model_validate(row)]


@router.post("", response_model=NotificationSettingPublic, status_code=status.HTTP_201_CREATED)
def upsert_setting(
    payload: NotificationSettingUpsert,
    svc: Annotated[NotificationSettingsService, Depends(get_settings_service)],
    _: Annotated[object, Depends(require_permission("notification_settings.manage"))],
) -> NotificationSettingPublic:
    try:
        row = svc.upsert(payload)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return NotificationSettingPublic.model_validate(row)


@router.patch("/{setting_id:int}", response_model=NotificationSettingPublic)
def update_setting(
    setting_id: int,
    payload: NotificationSettingUpdate,
    svc: Annotated[NotificationSettingsService, Depends(get_settings_service)],
    _: Annotated[object, Depends(require_permission("notification_settings.manage"))],
) -> NotificationSettingPublic:
    try:
        row = svc.update(setting_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return NotificationSettingPublic.model_validate(row)

