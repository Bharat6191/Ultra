"""Public/app router for the Contractor master module.

All endpoints are RBAC-guarded. Permissions follow the dotted convention:
  * contractor.view
  * contractor.create
  * contractor.update
  * contractor.delete
  * contractor.activate
  * contractor.verify_documents
  * contractor.manage_plants (plant mutations also allowed with contractor.update)
  * contractor.document.upload
"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, UploadFile, status
from starlette.datastructures import UploadFile as StarletteUploadFile
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_any_permission, require_permission
from db.session import get_db
from modules.contractor.schema import (
    ComplianceConfigCreate,
    ComplianceConfigPublic,
    ComplianceConfigUpdate,
    ContractorAuditEntry,
    ContractorComplianceSummary,
    ContractorCreate,
    ContractorDocumentCreate,
    ContractorDocumentPublic,
    ContractorDocumentUpdate,
    ContractorDocumentVerifyRequest,
    ContractorPlantCreate,
    ContractorPlantPublic,
    ContractorPlantUpdate,
    ContractorPublic,
    ContractorStatusChange,
    ContractorTimelineEvent,
    ContractorUpdate,
)
from modules.contractor.service import ContractorService
from modules.contractor.timeline import ContractorTimelineService
from modules.contractor.analytics_schema import (
    AnalyticsFilters,
    AnalyticsTimelineEvent,
    CommercialInsights,
    ContractorAnalyticsSummary,
    NegotiationAnalytics,
    PendingActions,
    WorkOrderAnalytics,
)
from modules.contractor.analytics_service import ContractorAnalyticsService
from modules.errors import ConflictError, NotFoundError


router = APIRouter(prefix="/contractors", tags=["app", "contractors"])


def get_contractor_service(db: Session = Depends(get_db)) -> ContractorService:
    return ContractorService(db)


def get_timeline_service(db: Session = Depends(get_db)) -> ContractorTimelineService:
    return ContractorTimelineService(db)


def get_contractor_analytics_service(db: Session = Depends(get_db)) -> ContractorAnalyticsService:
    return ContractorAnalyticsService(db)


def analytics_filter_params(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    plant_id: int | None = Query(None, ge=1),
    work_order_status: str | None = Query(None),
    negotiation_status: str | None = Query(None),
    part_search: str | None = Query(None),
) -> AnalyticsFilters:
    return AnalyticsFilters(
        date_from=date_from,
        date_to=date_to,
        plant_id=plant_id,
        work_order_status=work_order_status,
        negotiation_status=negotiation_status,
        part_search=part_search,
    )


# ---------- Contractors: list / create / read / update ----------

@router.get(
    "/lookup",
    dependencies=[
        Depends(
            require_any_permission(
                # Contractor module access
                "contractor.view",
                # Rate master / negotiated rates need contractor dropdowns
                "part_master.view",
                "part_master.create",
                "part_master.update",
                "contractor_rates.view",
                "contractor_rates.create",
                "contractor_rates.update",
                # Work orders & invoices will also need contractor dropdowns
                "work_orders.view",
                "work_orders.create",
                "work_orders.update",
                "invoices.view",
                "invoices.create",
                "invoices.update",
            )
        )
    ],
)
def contractor_lookup(
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
    limit: int = Query(200, ge=1, le=500),
    status_filter: str | None = Query("active", alias="status"),
    q: str | None = Query(None, alias="q"),
) -> list[dict[str, object]]:
    """
    Lightweight contractor picker for cross-module dropdowns.

    Returns only ``{id, name}`` to avoid leaking full contractor master data to roles that
    can legitimately create rates/work orders/invoices but should not browse the contractor module.
    """
    parsed_status = status_filter.strip().lower() if status_filter else None
    is_active: bool | None = None
    if parsed_status in ("active", "1", "true"):
        parsed_status = None
        is_active = True
    elif parsed_status in ("inactive", "0", "false"):
        parsed_status = None
        is_active = False
    elif parsed_status in ("all", ""):
        parsed_status = None
    rows, _total = svc.list_contractors(
        offset=0,
        limit=int(limit),
        search=q,
        status=parsed_status,
        is_active=is_active,
    )
    return [{"id": int(r.id), "name": str(r.name)} for r in rows]


@router.get(
    "",
    response_model=list[ContractorPublic],
    dependencies=[Depends(require_permission("contractor.view"))],
)
def list_contractors(
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
    response: Response,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    q: str | None = Query(None, alias="q"),
    status_filter: str | None = Query(None, alias="status"),
    contractor_type: str | None = Query(None, alias="type"),
    plant_id: int | None = Query(None, alias="plant_id"),
) -> list[ContractorPublic]:
    """Filter contractors by search/status/type/plant."""
    is_active: bool | None = None
    parsed_status: str | None = None
    if status_filter:
        s = status_filter.strip().lower()
        # Accept both legacy active/inactive markers and new lifecycle values.
        if s in ("active", "1", "true"):
            parsed_status = None
            is_active = True
        elif s in ("inactive", "0", "false"):
            parsed_status = None
            is_active = False
        else:
            parsed_status = s
    rows, total = svc.list_contractors(
        offset=offset,
        limit=limit,
        search=q,
        status=parsed_status,
        contractor_type=contractor_type,
        plant_id=plant_id,
        is_active=is_active,
    )
    public = [ContractorPublic.model_validate(svc.to_public_dict(r)) for r in rows]
    response.headers["X-Total-Count"] = str(total)
    return public


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
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return ContractorPublic.model_validate(svc.to_public_dict(row))


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
    return ContractorPublic.model_validate(svc.to_public_dict(row))


# ---------- Analytics dashboard ----------


@router.get(
    "/{contractor_id:int}/analytics/summary",
    response_model=ContractorAnalyticsSummary,
    dependencies=[Depends(require_permission("contractor.view"))],
)
def contractor_analytics_summary(
    contractor_id: int,
    flt: Annotated[AnalyticsFilters, Depends(analytics_filter_params)],
    svc: Annotated[ContractorAnalyticsService, Depends(get_contractor_analytics_service)],
) -> ContractorAnalyticsSummary:
    try:
        return svc.get_summary(contractor_id, flt)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/{contractor_id:int}/analytics/negotiations",
    response_model=NegotiationAnalytics,
    dependencies=[Depends(require_permission("contractor.view"))],
)
def contractor_analytics_negotiations(
    contractor_id: int,
    flt: Annotated[AnalyticsFilters, Depends(analytics_filter_params)],
    svc: Annotated[ContractorAnalyticsService, Depends(get_contractor_analytics_service)],
) -> NegotiationAnalytics:
    try:
        return svc.get_negotiations(contractor_id, flt)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/{contractor_id:int}/analytics/work-orders",
    response_model=WorkOrderAnalytics,
    dependencies=[Depends(require_permission("contractor.view"))],
)
def contractor_analytics_work_orders(
    contractor_id: int,
    flt: Annotated[AnalyticsFilters, Depends(analytics_filter_params)],
    svc: Annotated[ContractorAnalyticsService, Depends(get_contractor_analytics_service)],
) -> WorkOrderAnalytics:
    try:
        return svc.get_work_orders(contractor_id, flt)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/{contractor_id:int}/analytics/commercial",
    response_model=CommercialInsights,
    dependencies=[Depends(require_permission("contractor.view"))],
)
def contractor_analytics_commercial(
    contractor_id: int,
    flt: Annotated[AnalyticsFilters, Depends(analytics_filter_params)],
    svc: Annotated[ContractorAnalyticsService, Depends(get_contractor_analytics_service)],
) -> CommercialInsights:
    try:
        return svc.get_commercial(contractor_id, flt)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/{contractor_id:int}/analytics/pending",
    response_model=PendingActions,
    dependencies=[Depends(require_permission("contractor.view"))],
)
def contractor_analytics_pending(
    contractor_id: int,
    svc: Annotated[ContractorAnalyticsService, Depends(get_contractor_analytics_service)],
) -> PendingActions:
    try:
        return svc.get_pending(contractor_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/{contractor_id:int}/analytics/timeline",
    response_model=list[AnalyticsTimelineEvent],
    dependencies=[Depends(require_permission("contractor.view"))],
)
def contractor_analytics_timeline(
    contractor_id: int,
    svc: Annotated[ContractorAnalyticsService, Depends(get_contractor_analytics_service)],
    categories: str | None = Query(
        None,
        description="Comma-separated: negotiations,work_orders,approvals,financial,compliance or all",
    ),
) -> list[AnalyticsTimelineEvent]:
    try:
        parts = [p.strip().lower() for p in categories.split(",")] if categories else ["all"]
        return svc.get_timeline(contractor_id, parts)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/{contractor_id:int}/analytics/report",
    dependencies=[Depends(require_permission("contractor.view"))],
)
def contractor_analytics_report(
    contractor_id: int,
    svc: Annotated[ContractorAnalyticsService, Depends(get_contractor_analytics_service)],
    flt: Annotated[AnalyticsFilters, Depends(analytics_filter_params)],
    format: str = Query("xlsx", description="xlsx supported; PDF is generated client-side."),
) -> Response:
    try:
        if str(format).lower() not in ("xlsx", "excel"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only format=xlsx is available from the API. Use the in-app PDF export for print-quality reports.",
            )
        data = svc.build_xlsx(contractor_id, flt)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    fname = f"contractor-{contractor_id}-analytics.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.patch(
    "/{contractor_id:int}",
    response_model=ContractorPublic,
    dependencies=[Depends(require_permission("contractor.update"))],
)
def update_contractor(
    contractor_id: int,
    payload: ContractorUpdate,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> ContractorPublic:
    try:
        row = svc.update_contractor(contractor_id, payload, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return ContractorPublic.model_validate(svc.to_public_dict(row))


# ---------- Lifecycle ----------


@router.patch(
    "/{contractor_id:int}/status",
    response_model=ContractorPublic,
    dependencies=[Depends(require_any_permission("contractor.activate", "contractor.update"))],
)
def change_contractor_status(
    contractor_id: int,
    payload: ContractorStatusChange,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> ContractorPublic:
    try:
        row = svc.change_status(contractor_id, payload, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ContractorPublic.model_validate(svc.to_public_dict(row))


# ---------- Compliance ----------


@router.get(
    "/{contractor_id:int}/compliance",
    response_model=ContractorComplianceSummary,
    dependencies=[Depends(require_permission("contractor.view"))],
)
def contractor_compliance(
    contractor_id: int,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
) -> ContractorComplianceSummary:
    try:
        return svc.get_compliance_summary(contractor_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


# ---------- Documents ----------


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
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> ContractorDocumentPublic:
    """Accept either JSON body (with file_url) or multipart/form-data (with file)."""
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type == "multipart/form-data":
        form = await request.form()
        upload = form.get("file") or form.get("upload") or form.get("document")
        if upload is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "file is required (multipart field name: file). "
                    f"Received fields: {sorted(list(form.keys()))}"
                ),
            )
        if not isinstance(upload, (UploadFile, StarletteUploadFile)):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "file must be an uploaded file (multipart field name: file). "
                    f"Got: {type(upload).__name__}"
                ),
            )
        raw = await upload.read()
        # We don't yet know the next version number; use the contractor service to compute it
        # by checking the existing document. For storage we save with a timestamp in the name.
        file_url = svc.save_document_file(
            contractor_id=int(contractor_id),
            filename=upload.filename or "document",
            content=raw,
        )
        payload = ContractorDocumentCreate(
            document_name=str(form.get("document_name") or "").strip(),
            document_type=str(form.get("document_type") or "").strip(),
            file_url=file_url,
            issued_date=form.get("issued_date") or None,
            issue_date=form.get("issue_date") or None,
            expiry_date=form.get("expiry_date") or None,
            remarks=str(form.get("remarks") or "").strip() or None,
        )
    else:
        body = await request.json()
        payload = ContractorDocumentCreate.model_validate(body)
    try:
        row = svc.add_or_version_document(
            contractor_id, payload, actor_user_id=int(current.subject)
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ContractorDocumentPublic.model_validate(row)


@router.patch(
    "/{contractor_id:int}/documents/{document_id:int}",
    response_model=ContractorDocumentPublic,
    dependencies=[Depends(require_permission("contractor.document.upload"))],
)
def update_document_metadata(
    contractor_id: int,
    document_id: int,
    payload: ContractorDocumentUpdate,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> ContractorDocumentPublic:
    """Edit document metadata (name / dates / remarks) without re-uploading the file."""
    try:
        row = svc.update_document_metadata(
            contractor_id=contractor_id,
            document_id=document_id,
            payload=payload,
            actor_user_id=int(current.subject),
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ContractorDocumentPublic.model_validate(row)


@router.post(
    "/{contractor_id:int}/documents/{document_id:int}/verify",
    response_model=ContractorDocumentPublic,
    dependencies=[Depends(require_permission("contractor.verify_documents"))],
)
def verify_document(
    contractor_id: int,
    document_id: int,
    payload: ContractorDocumentVerifyRequest,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> ContractorDocumentPublic:
    try:
        row = svc.verify_document(
            contractor_id=contractor_id,
            document_id=document_id,
            payload=payload,
            actor_user_id=int(current.subject),
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ContractorDocumentPublic.model_validate(row)


@router.delete(
    "/{contractor_id:int}/documents/{document_id:int}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission("contractor.delete"))],
)
def delete_document(
    contractor_id: int,
    document_id: int,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> None:
    try:
        svc.delete_document(contractor_id, document_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


# ---------- Plant mapping ----------


@router.get(
    "/{contractor_id:int}/plants",
    response_model=list[ContractorPlantPublic],
    dependencies=[Depends(require_permission("contractor.view"))],
)
def list_plant_mappings(
    contractor_id: int,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
) -> list[ContractorPlantPublic]:
    try:
        rows = svc.list_plants(contractor_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return [ContractorPlantPublic.model_validate(svc.plant_mapping_to_public_dict(r)) for r in rows]


@router.post(
    "/{contractor_id:int}/plants",
    response_model=ContractorPlantPublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[
        Depends(require_any_permission("contractor.manage_plants", "contractor.update"))
    ],
)
def add_plant_mapping(
    contractor_id: int,
    payload: ContractorPlantCreate,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> ContractorPlantPublic:
    try:
        row = svc.add_plant_mapping(contractor_id, payload, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return ContractorPlantPublic.model_validate(svc.plant_mapping_to_public_dict(row))


@router.patch(
    "/{contractor_id:int}/plants/{mapping_id:int}",
    response_model=ContractorPlantPublic,
    dependencies=[
        Depends(require_any_permission("contractor.manage_plants", "contractor.update"))
    ],
)
def update_plant_mapping(
    contractor_id: int,
    mapping_id: int,
    payload: ContractorPlantUpdate,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> ContractorPlantPublic:
    try:
        row = svc.update_plant_mapping(
            contractor_id=contractor_id,
            mapping_id=mapping_id,
            payload=payload,
            actor_user_id=int(current.subject),
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ContractorPlantPublic.model_validate(svc.plant_mapping_to_public_dict(row))


@router.delete(
    "/{contractor_id:int}/plants/{mapping_id:int}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[
        Depends(require_any_permission("contractor.manage_plants", "contractor.update"))
    ],
)
def remove_plant_mapping(
    contractor_id: int,
    mapping_id: int,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> None:
    try:
        svc.remove_plant_mapping(
            contractor_id=contractor_id,
            mapping_id=mapping_id,
            actor_user_id=int(current.subject),
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


# ---------- Plant -> contractors ----------


@router.get(
    "/by-plant/{org_unit_id:int}",
    response_model=list[ContractorPublic],
    dependencies=[Depends(require_permission("contractor.view"))],
)
def contractors_for_plant(
    org_unit_id: int,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
    only_active: bool = Query(False),
) -> list[ContractorPublic]:
    rows = svc.list_contractors_for_plant(org_unit_id, only_active=only_active)
    return [ContractorPublic.model_validate(svc.to_public_dict(r)) for r in rows]


# ---------- Audit / Timeline ----------


@router.get(
    "/{contractor_id:int}/audit",
    response_model=list[ContractorAuditEntry],
    dependencies=[Depends(require_permission("contractor.view"))],
)
def list_audit(
    contractor_id: int,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
    db: Annotated[Session, Depends(get_db)],
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
) -> list[ContractorAuditEntry]:
    try:
        rows = svc.list_audit(contractor_id, offset=offset, limit=limit)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    out: list[ContractorAuditEntry] = []
    for r in rows:
        actor_name = None
        if r.changed_by is not None:
            from modules.users.model import User

            u = db.get(User, int(r.changed_by))
            if u is not None:
                actor_name = u.full_name or u.email or u.username
        out.append(
            ContractorAuditEntry(
                id=int(r.id),
                contractor_id=int(r.contractor_id),
                action=r.action,
                changed_by=r.changed_by,
                actor_name=actor_name,
                old_value=r.old_value,
                new_value=r.new_value,
                metadata=r.metadata_json,
                created_at=r.created_at,
            )
        )
    return out


@router.get(
    "/{contractor_id:int}/timeline",
    response_model=list[ContractorTimelineEvent],
    dependencies=[Depends(require_permission("contractor.view"))],
)
def get_timeline(
    contractor_id: int,
    svc: Annotated[ContractorTimelineService, Depends(get_timeline_service)],
) -> list[ContractorTimelineEvent]:
    try:
        events = svc.build_timeline(contractor_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return [ContractorTimelineEvent.model_validate(e) for e in events]


# ---------- Compliance config (admin-style endpoints exposed to permitted users) ----------


@router.get(
    "/compliance-configs",
    response_model=list[ComplianceConfigPublic],
    dependencies=[Depends(require_permission("contractor.view"))],
)
def list_compliance_configs(
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
) -> list[ComplianceConfigPublic]:
    return [ComplianceConfigPublic.model_validate(r) for r in svc.list_compliance_configs()]


@router.post(
    "/compliance-configs",
    response_model=ComplianceConfigPublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("contractor.update"))],
)
def upsert_compliance_config(
    payload: ComplianceConfigCreate,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
) -> ComplianceConfigPublic:
    return ComplianceConfigPublic.model_validate(svc.upsert_compliance_config(payload))


@router.patch(
    "/compliance-configs/{config_id:int}",
    response_model=ComplianceConfigPublic,
    dependencies=[Depends(require_permission("contractor.update"))],
)
def update_compliance_config(
    config_id: int,
    payload: ComplianceConfigUpdate,
    svc: Annotated[ContractorService, Depends(get_contractor_service)],
) -> ComplianceConfigPublic:
    try:
        row = svc.update_compliance_config(config_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ComplianceConfigPublic.model_validate(row)
