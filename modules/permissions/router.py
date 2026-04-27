from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_permission
from db.session import get_db
from modules.errors import ConflictError, NotFoundError, RbacSafetyError
from modules.permissions.model import Permission
from modules.permissions.schema import (
    PermissionCatalogPublic,
    PermissionCreate,
    PermissionPublic,
    PermissionUpdate,
)
from modules.permissions.service import PermissionService

router = APIRouter(prefix="/permissions", tags=["admin", "permissions"])


def get_permission_service(db: Session = Depends(get_db)) -> PermissionService:
    return PermissionService(db)


@router.get("/catalog", response_model=PermissionCatalogPublic)
def permission_catalog(
    svc: Annotated[PermissionService, Depends(get_permission_service)],
) -> PermissionCatalogPublic:
    """Grouped permission definitions merged with database ids (for admin UI)."""
    return svc.build_permission_catalog()


@router.post("", response_model=PermissionPublic, status_code=status.HTTP_201_CREATED)
def create_permission(
    payload: PermissionCreate,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[PermissionService, Depends(get_permission_service)],
    _: Annotated[object, Depends(require_permission("permissions.create"))],
) -> Permission:
    try:
        return svc.create_permission(payload, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("", response_model=list[PermissionPublic])
def list_permissions(
    svc: Annotated[PermissionService, Depends(get_permission_service)],
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    feature_id: int | None = Query(default=None),
) -> list[Permission]:
    return svc.list_permissions(offset=skip, limit=limit, feature_id=feature_id)


@router.get("/{permission_id}", response_model=PermissionPublic)
def get_permission(
    permission_id: int,
    svc: Annotated[PermissionService, Depends(get_permission_service)],
) -> Permission:
    try:
        return svc.get_permission(permission_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/{permission_id}", response_model=PermissionPublic)
def update_permission(
    permission_id: int,
    payload: PermissionUpdate,
    svc: Annotated[PermissionService, Depends(get_permission_service)],
    _: Annotated[object, Depends(require_permission("permissions.update"))],
) -> Permission:
    try:
        return svc.update_permission(permission_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.delete("/{permission_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_permission(
    permission_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[PermissionService, Depends(get_permission_service)],
    _: Annotated[object, Depends(require_permission("permissions.delete"))],
) -> None:
    try:
        svc.delete_permission(permission_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RbacSafetyError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
