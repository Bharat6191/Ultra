"""Part Master CRUD, audit trail, versions, and attachments."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile as StarletteUploadFile

from core.auth import CurrentUser, get_current_user
from core.permissions import require_any_permission, require_permission
from db.session import get_db
from modules.errors import ConflictError, NotFoundError
from modules.part_master.models import PartMasterAttachment
from modules.part_master.schema import (
    PartMasterAuditEntry,
    PartMasterAttachmentPublic,
    PartMasterCreate,
    PartMasterPublic,
    PartMasterUpdate,
)
from modules.part_master.service import PartMasterService
from modules.part_master.storage import save_part_master_attachment
from modules.contractor.analytics_schema import AnalyticsTimelineEvent, PendingActions
from modules.part_master.part_master_analytics_schema import (
    PartAnalyticsFilters,
    PartCommercialInsights,
    PartCompetitionAnalytics,
    PartContractorsAnalytics,
    PartMasterAnalyticsSummary,
    PartNegotiationBundle,
    PartWorkOrderAnalytics,
)
from modules.part_master.part_master_analytics_service import PartMasterAnalyticsService
from modules.contractor_rates.audit import standard_diff
from modules.contractor_rates.schema import RateVersionEntry
from modules.users.model import User

router = APIRouter(tags=["app", "part_master"])


def _svc(db: Annotated[Session, Depends(get_db)]) -> PartMasterService:
    return PartMasterService(db)


def _part_analytics_svc(db: Annotated[Session, Depends(get_db)]) -> PartMasterAnalyticsService:
    return PartMasterAnalyticsService(db)


def part_analytics_filter_params(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    plant_id: int | None = Query(None, ge=1),
    contractor_id: int | None = Query(None, ge=1),
    work_order_status: str | None = Query(None),
    negotiation_status: str | None = Query(None),
) -> PartAnalyticsFilters:
    return PartAnalyticsFilters(
        date_from=date_from,
        date_to=date_to,
        plant_id=plant_id,
        contractor_id=contractor_id,
        work_order_status=work_order_status,
        negotiation_status=negotiation_status,
    )


def _resolve_user_name(db: Session, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    u = db.get(User, int(user_id))
    return getattr(u, "full_name", None) if u else None


def _versions_to_public(db: Session, versions: list) -> list[RateVersionEntry]:
    entries: list[RateVersionEntry] = []
    prev_snapshot: dict | None = None
    for v in versions:
        snap = dict(v.snapshot_json or {})
        diff = standard_diff(prev_snapshot, snap) if prev_snapshot is not None else None
        parent_id = getattr(v, "part_master_id", None)
        entries.append(
            RateVersionEntry(
                id=int(v.id),
                parent_id=int(parent_id) if parent_id is not None else 0,
                version_number=int(v.version_number),
                snapshot_json=snap,
                change_reason=v.change_reason,
                created_by=v.created_by,
                created_by_name=_resolve_user_name(db, v.created_by),
                created_at=v.created_at,
                diff=diff,
            )
        )
        prev_snapshot = snap
    return entries


@router.get(
    "/part-master",
    response_model=list[PartMasterPublic],
    dependencies=[
        Depends(
            require_any_permission(
                "part_master.view",
                "work_orders.view",
                "work_orders.create",
                "work_orders.update",
            )
        )
    ],
)
def list_part_master(
    svc: Annotated[PartMasterService, Depends(_svc)],
    org_unit_id: int | None = Query(None),
    search: str | None = Query(None),
    part_code: str | None = Query(None),
    active_only: bool = Query(False, alias="active"),
) -> list[PartMasterPublic]:
    rows = svc.list_part_masters(
        org_unit_id=org_unit_id,
        search=(search if search is not None else part_code),
        active_only=active_only,
    )
    return [PartMasterPublic.model_validate(svc._public_dict(r)) for r in rows]


@router.post(
    "/part-master",
    response_model=PartMasterPublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("part_master.create"))],
)
def create_part_master(
    payload: PartMasterCreate,
    svc: Annotated[PartMasterService, Depends(_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> PartMasterPublic:
    try:
        row = svc.create_part_master(payload, actor_user_id=int(current.subject))
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return PartMasterPublic.model_validate(svc._public_dict(row))


@router.get(
    "/part-master/{part_master_id:int}",
    response_model=PartMasterPublic,
    dependencies=[Depends(require_permission("part_master.view"))],
)
def get_part_master(
    part_master_id: int,
    svc: Annotated[PartMasterService, Depends(_svc)],
) -> PartMasterPublic:
    try:
        row = svc.get_part_master(part_master_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return PartMasterPublic.model_validate(svc._public_dict(row))


# ---------- Part analytics (intelligence dashboard) ----------


@router.get(
    "/part-master/{part_master_id:int}/analytics/summary",
    response_model=PartMasterAnalyticsSummary,
    dependencies=[Depends(require_permission("part_master.view"))],
)
def part_analytics_summary(
    part_master_id: int,
    flt: Annotated[PartAnalyticsFilters, Depends(part_analytics_filter_params)],
    svc: Annotated[PartMasterAnalyticsService, Depends(_part_analytics_svc)],
) -> PartMasterAnalyticsSummary:
    try:
        return svc.get_summary(part_master_id, flt)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/part-master/{part_master_id:int}/analytics/contractors",
    response_model=PartContractorsAnalytics,
    dependencies=[Depends(require_permission("part_master.view"))],
)
def part_analytics_contractors(
    part_master_id: int,
    flt: Annotated[PartAnalyticsFilters, Depends(part_analytics_filter_params)],
    svc: Annotated[PartMasterAnalyticsService, Depends(_part_analytics_svc)],
) -> PartContractorsAnalytics:
    try:
        return svc.get_contractors(part_master_id, flt)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/part-master/{part_master_id:int}/analytics/negotiations",
    response_model=PartNegotiationBundle,
    dependencies=[Depends(require_permission("part_master.view"))],
)
def part_analytics_negotiations(
    part_master_id: int,
    flt: Annotated[PartAnalyticsFilters, Depends(part_analytics_filter_params)],
    svc: Annotated[PartMasterAnalyticsService, Depends(_part_analytics_svc)],
) -> PartNegotiationBundle:
    try:
        return svc.get_negotiations(part_master_id, flt)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/part-master/{part_master_id:int}/analytics/work-orders",
    response_model=PartWorkOrderAnalytics,
    dependencies=[Depends(require_permission("part_master.view"))],
)
def part_analytics_work_orders(
    part_master_id: int,
    flt: Annotated[PartAnalyticsFilters, Depends(part_analytics_filter_params)],
    svc: Annotated[PartMasterAnalyticsService, Depends(_part_analytics_svc)],
) -> PartWorkOrderAnalytics:
    try:
        return svc.get_work_orders(part_master_id, flt)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/part-master/{part_master_id:int}/analytics/commercial",
    response_model=PartCommercialInsights,
    dependencies=[Depends(require_permission("part_master.view"))],
)
def part_analytics_commercial(
    part_master_id: int,
    flt: Annotated[PartAnalyticsFilters, Depends(part_analytics_filter_params)],
    svc: Annotated[PartMasterAnalyticsService, Depends(_part_analytics_svc)],
) -> PartCommercialInsights:
    try:
        return svc.get_commercial(part_master_id, flt)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/part-master/{part_master_id:int}/analytics/competition",
    response_model=PartCompetitionAnalytics,
    dependencies=[Depends(require_permission("part_master.view"))],
)
def part_analytics_competition(
    part_master_id: int,
    flt: Annotated[PartAnalyticsFilters, Depends(part_analytics_filter_params)],
    svc: Annotated[PartMasterAnalyticsService, Depends(_part_analytics_svc)],
) -> PartCompetitionAnalytics:
    try:
        return svc.get_competition(part_master_id, flt)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/part-master/{part_master_id:int}/analytics/pending",
    response_model=PendingActions,
    dependencies=[Depends(require_permission("part_master.view"))],
)
def part_analytics_pending(
    part_master_id: int,
    svc: Annotated[PartMasterAnalyticsService, Depends(_part_analytics_svc)],
) -> PendingActions:
    try:
        return svc.get_pending(part_master_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/part-master/{part_master_id:int}/analytics/timeline",
    response_model=list[AnalyticsTimelineEvent],
    dependencies=[Depends(require_permission("part_master.view"))],
)
def part_analytics_timeline(
    part_master_id: int,
    svc: Annotated[PartMasterAnalyticsService, Depends(_part_analytics_svc)],
    categories: str | None = Query(
        None,
        description="Comma-separated: negotiations,work_orders,approvals,financial,compliance or all",
    ),
) -> list[AnalyticsTimelineEvent]:
    try:
        parts = [p.strip().lower() for p in categories.split(",")] if categories else ["all"]
        return svc.get_timeline(part_master_id, parts)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/part-master/{part_master_id:int}/analytics/report",
    dependencies=[Depends(require_permission("part_master.view"))],
)
def part_analytics_report(
    part_master_id: int,
    svc: Annotated[PartMasterAnalyticsService, Depends(_part_analytics_svc)],
    flt: Annotated[PartAnalyticsFilters, Depends(part_analytics_filter_params)],
    format: str = Query("xlsx", description="xlsx supported; PDF from the UI."),
) -> Response:
    try:
        if str(format).lower() not in ("xlsx", "excel"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only format=xlsx is available from the API. Use the in-app PDF export for print.",
            )
        data = svc.build_xlsx(part_master_id, flt)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    fname = f"part-master-{part_master_id}-analytics.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.patch(
    "/part-master/{part_master_id:int}",
    response_model=PartMasterPublic,
    dependencies=[Depends(require_permission("part_master.update"))],
)
def update_part_master(
    part_master_id: int,
    payload: PartMasterUpdate,
    svc: Annotated[PartMasterService, Depends(_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> PartMasterPublic:
    try:
        row = svc.update_part_master(part_master_id, payload, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return PartMasterPublic.model_validate(svc._public_dict(row))


@router.get(
    "/part-master/{part_master_id:int}/audit-logs",
    response_model=list[PartMasterAuditEntry],
    dependencies=[Depends(require_permission("part_master.view"))],
)
def list_part_master_audit_logs(
    part_master_id: int,
    svc: Annotated[PartMasterService, Depends(_svc)],
) -> list[PartMasterAuditEntry]:
    try:
        rows = svc.list_audit_logs(part_master_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return [PartMasterAuditEntry.model_validate(r) for r in rows]


@router.get(
    "/part-master/{part_master_id:int}/versions",
    response_model=list[RateVersionEntry],
    dependencies=[Depends(require_permission("part_master.view"))],
)
def list_part_master_versions(
    part_master_id: int,
    svc: Annotated[PartMasterService, Depends(_svc)],
    db: Annotated[Session, Depends(get_db)],
) -> list[RateVersionEntry]:
    try:
        versions = svc.list_versions(part_master_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _versions_to_public(db, versions)


@router.get(
    "/part-master/{part_master_id:int}/attachments",
    response_model=list[PartMasterAttachmentPublic],
    dependencies=[Depends(require_permission("part_master.view"))],
)
def list_part_master_attachments(
    part_master_id: int,
    db: Annotated[Session, Depends(get_db)],
) -> list[PartMasterAttachmentPublic]:
    svc = PartMasterService(db)
    svc.get_part_master(part_master_id)
    rows = list(
        db.scalars(
            select(PartMasterAttachment)
            .where(PartMasterAttachment.part_master_id == int(part_master_id))
            .order_by(PartMasterAttachment.uploaded_at.asc())
        ).all()
    )
    return [PartMasterAttachmentPublic.model_validate(r) for r in rows]


@router.post(
    "/part-master/{part_master_id:int}/attachments",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("part_master.update"))],
)
async def upload_part_master_attachment(
    part_master_id: int,
    request: Request,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    svc = PartMasterService(db)
    svc.get_part_master(part_master_id)
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type != "multipart/form-data":
        raise HTTPException(status_code=422, detail="multipart/form-data required")
    form = await request.form()
    upload = form.get("file") or form.get("upload") or form.get("attachment")
    if upload is None:
        raise HTTPException(status_code=422, detail="file is required (multipart field name: file)")
    if not isinstance(upload, (UploadFile, StarletteUploadFile)):
        raise HTTPException(status_code=422, detail="file must be an uploaded file")
    raw = await upload.read()
    path = save_part_master_attachment(
        part_master_id=int(part_master_id), filename=upload.filename or "attachment", content=raw
    )
    row = PartMasterAttachment(
        part_master_id=int(part_master_id),
        file_path=path,
        file_name=upload.filename,
        content_type=getattr(upload, "content_type", None),
        uploaded_by=int(current.subject),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "id": int(row.id), "file_path": path}
