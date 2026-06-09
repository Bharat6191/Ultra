from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db.session import get_db
from modules.settings.schema import AppearanceSettingsPublic
from modules.settings.service import SettingsService

router = APIRouter(prefix="/settings", tags=["settings"])


def get_settings_service(db: Session = Depends(get_db)) -> SettingsService:
    return SettingsService(db)


@router.get("/appearance", response_model=AppearanceSettingsPublic)
def get_public_appearance_settings(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
) -> AppearanceSettingsPublic:
    return svc.get_appearance_settings()
