from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_permission
from db.session import get_db
from modules.errors import ConflictError, NotFoundError, RbacSafetyError
from modules.roles.model import Role
from modules.roles.schema import RoleCreate, RoleDetail, RoleListItem, RoleUpdate
from modules.roles.service import RoleService

router = APIRouter(prefix="/roles", tags=["admin", "roles"])


def get_role_service(db: Session = Depends(get_db)) -> RoleService:
    return RoleService(db)


@router.post("", response_model=RoleDetail, status_code=status.HTTP_201_CREATED)
def create_role(
    payload: RoleCreate,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[RoleService, Depends(get_role_service)],
    _: Annotated[object, Depends(require_permission("roles.create"))],
) -> Role:
    try:
        return svc.create_role(payload, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except RbacSafetyError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.get("", response_model=list[RoleListItem])
def list_roles(
    svc: Annotated[RoleService, Depends(get_role_service)],
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
) -> list[RoleListItem]:
    roles = svc.list_roles(offset=skip, limit=limit)
    return [
        RoleListItem(
            id=r.id,
            name=r.name,
            description=r.description,
            created_at=r.created_at,
            org_unit_ids=[o.id for o in r.org_units],
        )
        for r in roles
    ]


@router.get("/{role_id}", response_model=RoleDetail)
def get_role(
    role_id: int,
    svc: Annotated[RoleService, Depends(get_role_service)],
) -> Role:
    try:
        return svc.get_role(role_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/{role_id}", response_model=RoleDetail)
def update_role(
    role_id: int,
    payload: RoleUpdate,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[RoleService, Depends(get_role_service)],
    _: Annotated[object, Depends(require_permission("roles.update"))],
) -> Role:
    try:
        return svc.update_role(role_id, payload, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except RbacSafetyError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.delete("/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_role(
    role_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[RoleService, Depends(get_role_service)],
    _: Annotated[object, Depends(require_permission("roles.delete"))],
) -> None:
    try:
        svc.delete_role(role_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RbacSafetyError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
