from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_permission, require_superuser
from core.password_policy import PasswordPolicyError
from db.session import get_db
from modules.errors import NotFoundError, RbacSafetyError
from modules.users.model import User
from modules.users.schema import UserCreate, UserPublic, UserUpdate
from modules.users.service import DuplicateEmailError, DuplicatePhoneError, DuplicateUsernameError, UserService

router = APIRouter(prefix="/users", tags=["admin", "users"])


def get_user_service(db: Session = Depends(get_db)) -> UserService:
    return UserService(db)


@router.post(
    "",
    response_model=UserPublic,
    status_code=status.HTTP_201_CREATED,
)
def create_user(
    payload: UserCreate,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_permission("users.create"))],
) -> User | JSONResponse:
    try:
        return svc.create_user(payload, actor_user_id=int(current.subject))
    except PasswordPolicyError as exc:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"error": exc.error},
        )
    except DuplicateEmailError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        ) from None
    except DuplicateUsernameError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already registered",
        ) from None
    except DuplicatePhoneError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Phone already registered",
        ) from None
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RbacSafetyError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.get("", response_model=list[UserPublic])
def list_users(
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_permission("users.view"))],
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
) -> list[User]:
    return svc.list_users(offset=skip, limit=limit)


@router.patch("/{user_id}", response_model=UserPublic)
def update_user(
    user_id: int,
    payload: UserUpdate,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_permission("users.update"))],
) -> User | JSONResponse:
    try:
        return svc.update_user(user_id, payload, actor_user_id=int(current.subject))
    except PasswordPolicyError as exc:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"error": exc.error},
        )
    except DuplicateEmailError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        ) from None
    except DuplicateUsernameError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already registered",
        ) from None
    except DuplicatePhoneError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Phone already registered",
        ) from None
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RbacSafetyError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.post(
    "/{user_id}/resend-mfa",
    status_code=status.HTTP_204_NO_CONTENT,
)
def resend_mfa_setup(
    user_id: int,
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_permission("mfa.manage"))],
) -> None:
    try:
        svc.resend_mfa_setup_email(user_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/{user_id}/resend-welcome",
    status_code=status.HTTP_204_NO_CONTENT,
)
def resend_welcome_email(
    user_id: int,
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_permission("users.update"))],
) -> None:
    try:
        svc.resend_welcome_email(user_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/{user_id}/roles/{role_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def assign_role_to_user(
    user_id: int,
    role_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_permission("users.update"))],
) -> None:
    try:
        svc.assign_role(user_id, role_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except RbacSafetyError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_user(
    user_id: int,
    current: Annotated[CurrentUser, Depends(require_superuser())],
    svc: Annotated[UserService, Depends(get_user_service)],
) -> Response:
    try:
        svc.delete_user_permanently(user_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RbacSafetyError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
