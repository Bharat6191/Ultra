from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.permissions import require_permission
from db.session import get_db
from modules.settings.schema import AppearanceSettingsPublic, AuthPolicyPublic, PasswordPolicyPublic
from modules.settings.service import SettingsService

router = APIRouter(prefix="/settings", tags=["admin", "settings"])


def get_settings_service(db: Session = Depends(get_db)) -> SettingsService:
    return SettingsService(db)


@router.get("/password-policy", response_model=PasswordPolicyPublic)
def get_password_policy(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
) -> PasswordPolicyPublic:
    return svc.get_password_policy()


@router.put("/password-policy", response_model=PasswordPolicyPublic)
def put_password_policy(
    payload: PasswordPolicyPublic,
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: Annotated[object, Depends(require_permission("settings.update"))],
) -> PasswordPolicyPublic:
    return svc.put_password_policy(payload)


@router.get("/auth-policy", response_model=AuthPolicyPublic)
def get_auth_policy(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: Annotated[object, Depends(require_permission("auth_policy.view"))],
) -> AuthPolicyPublic:
    return svc.get_auth_policy()


@router.put("/auth-policy", response_model=AuthPolicyPublic)
def put_auth_policy(
    payload: AuthPolicyPublic,
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: Annotated[object, Depends(require_permission("auth_policy.update"))],
) -> AuthPolicyPublic:
    return svc.put_auth_policy(payload)


@router.get("/appearance", response_model=AppearanceSettingsPublic)
def get_appearance_settings(
    svc: Annotated[SettingsService, Depends(get_settings_service)],
) -> AppearanceSettingsPublic:
    return svc.get_appearance_settings()


@router.put("/appearance", response_model=AppearanceSettingsPublic)
def put_appearance_settings(
    payload: AppearanceSettingsPublic,
    svc: Annotated[SettingsService, Depends(get_settings_service)],
    _: Annotated[object, Depends(require_permission("settings.update"))],
) -> AppearanceSettingsPublic:
    return svc.put_appearance_settings(payload)
