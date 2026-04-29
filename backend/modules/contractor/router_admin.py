from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_permission
from db.session import get_db
from modules.contractor.schema import (
    ContractorCreate,
    ContractorDocumentCreate,
    ContractorDocumentPublic,
    ContractorPublic,
    ContractorUpdate,
)
from modules.contractor.service import ContractorService
from modules.errors import NotFoundError


router = APIRouter(prefix="/contractors", tags=["admin", "contractors"])


def get_contractor_service(db: Session = Depends(get_db)) -> ContractorService:
    return ContractorService(db)


@router.get(
    "",
    response_model=list[ContractorPublic],
    dependencies=[Depends(require_permission("contractor.view"))],
)
def list_contractors(
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    q: str | None = Query(None, alias="q"),
    status_filter: str | None = Query(None, alias="status"),
) -> list[ContractorPublic]:
    is_active: bool | None = None
    if status_filter:
        s = status_filter.strip().lower()
        if s in ("active", "1", "true"):
            is_active = True
        elif s in ("inactive", "0", "false"):
            is_active = False
    rows = svc.list_contractors(offset=offset, limit=limit, search=q, is_active=is_active)
    return [ContractorPublic.model_validate(r) for r in rows]


@router.get(
    "/{contractor_id:int}",
    response_model=ContractorPublic,
    dependencies=[Depends(require_permission("contractor.view"))],
)
def get_contractor(
    contractor_id: int,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
) -> ContractorPublic:
    try:
        row = svc.get_contractor(contractor_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ContractorPublic.model_validate(row)


@router.post(
    "",
    response_model=ContractorPublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("contractor.create"))],
)
def create_contractor(
    payload: ContractorCreate,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> ContractorPublic:
    try:
        row = svc.create_contractor(payload, actor_user_id=int(current.subject))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ContractorPublic.model_validate(row)


@router.patch(
    "/{contractor_id:int}",
    response_model=ContractorPublic,
    dependencies=[Depends(require_permission("contractor.update"))],
)
def update_contractor(
    contractor_id: int,
    payload: ContractorUpdate,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
) -> ContractorPublic:
    try:
        row = svc.update_contractor(contractor_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ContractorPublic.model_validate(row)


@router.post(
    "/{contractor_id:int}/documents",
    response_model=ContractorDocumentPublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("contractor.document.upload"))],
)
def upload_document(
    contractor_id: int,
    payload: ContractorDocumentCreate,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
) -> ContractorDocumentPublic:
    try:
        row = svc.add_document(contractor_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ContractorDocumentPublic.model_validate(row)


@router.get(
    "/{contractor_id:int}/documents",
    response_model=list[ContractorDocumentPublic],
    dependencies=[Depends(require_permission("contractor.view"))],
)
def list_documents(
    contractor_id: int,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
) -> list[ContractorDocumentPublic]:
    try:
        rows = svc.list_documents(contractor_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return [ContractorDocumentPublic.model_validate(r) for r in rows]

