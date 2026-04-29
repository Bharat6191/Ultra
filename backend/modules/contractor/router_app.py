from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, status
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_permission
from db.session import get_db
from modules.contractor.schema import ContractorCreate, ContractorDocumentCreate, ContractorDocumentPublic, ContractorPublic
from modules.contractor.service import ContractorService
from modules.errors import NotFoundError


router = APIRouter(prefix="/contractors", tags=["app", "contractors"])


def get_contractor_service(db: Session = Depends(get_db)) -> ContractorService:
    return ContractorService(db)


@router.get("", response_model=list[ContractorPublic], dependencies=[Depends(require_permission("contractor.view"))])
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
    row = svc.create_contractor(payload, actor_user_id=int(current.subject))
    return ContractorPublic.model_validate(row)


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


@router.post(
    "/{contractor_id:int}/documents",
    response_model=ContractorDocumentPublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("contractor.document.upload"))],
)
async def upload_document(
    contractor_id: int,
    request: Request,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
) -> ContractorDocumentPublic:
    """
    Accept either:
    - JSON body (ContractorDocumentCreate, includes file_url)
    - multipart/form-data (fields + file), stores file under /uploads
    """
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type == "multipart/form-data":
        form = await request.form()
        upload = form.get("file")
        if not isinstance(upload, UploadFile):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="file is required")
        raw = await upload.read()
        file_url = svc.save_document_file(contractor_id=int(contractor_id), filename=upload.filename or "document", content=raw)
        payload = ContractorDocumentCreate(
            document_name=str(form.get("document_name") or "").strip(),
            document_type=str(form.get("document_type") or "").strip(),
            file_url=file_url,
            issued_date=form.get("issued_date") or None,
            expiry_date=form.get("expiry_date") or None,
        )
    else:
        body = await request.json()
        payload = ContractorDocumentCreate.model_validate(body)
    try:
        row = svc.add_document(contractor_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ContractorDocumentPublic.model_validate(row)

