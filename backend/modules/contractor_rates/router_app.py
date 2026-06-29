"""Public/app router for the negotiation workflow.

RBAC permissions:
  * ``part_master.view``  /  ``.create`` / ``.update`` / ``.delete``
  * ``contractor_rates.view`` / ``.create`` / ``.update`` / ``.delete`` / ``.approve``

Endpoints exposed:

  Part Master lives under ``/part-master/*`` (separate router).
  Contractor Rates (``/contractor-rates/*``):
    * GET    /contractor-rates           -- list (filters)
  * POST   /contractor-rates           -- create draft
  * POST   /contractor-rates/{id}/opening-evidence  -- multipart: seed round 1 + files (new draft)
  * GET    /contractor-rates/{id}      -- get one (with rounds + savings)
    * PATCH  /contractor-rates/{id}      -- update draft (negotiated_rate / dates / remarks)
  * POST   /contractor-rates/{id}/negotiate  -- add a round
  * POST   /contractor-rates/{id}/negotiation-logs/{log_id}/attachments  -- upload round file
  * GET    /contractor-rates/{id}/negotiation-logs/{log_id}/attachments/{aid}/content  -- view/download (auth)
  * POST   /contractor-rates/{id}/submit     -- submit for approval (or auto-approve)
    * POST   /contractor-rates/{id}/cancel     -- cancel draft / pending / rejected
    * GET    /contractor-rates/{id}/timeline   -- merged audit + rounds + approvals
    * GET    /contractor-rates/summary         -- KPI counters
"""

from __future__ import annotations

import inspect
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_any_permission, require_permission
from db.session import get_db
from modules.contractor_rates.schema import (
    ContractorRateCreate,
    ContractorRatePublic,
    ContractorRateTimelineEvent,
    ContractorRateUpdate,
    NegotiationAttachmentPublic,
    NegotiationRoundCreate,
    NegotiationRoundPublic,
    OpeningEvidenceUploadResult,
    RateCardBenchmark,
    RateCardRowPublic,
    RateVersionEntry,
)
from modules.contractor_rates.service import ContractorRateService
from modules.contractor_rates.audit import standard_diff
from modules.contractor_rates.rate_card import RateCardService
from modules.contractor_rates.timeline import ContractorRateTimelineService
from modules.errors import ConflictError, NotFoundError
from modules.users.model import User


router = APIRouter(tags=["app", "contractor_rates"])

CONTRACTOR_RATE_READ_PERMISSION_CODES = (
    "contractor_rates.view",
    "contractor_rates.approve",
)


def _require_multipart(request: Request) -> None:
    """Browsers send ``multipart/form-data; boundary=…`` — do not require an exact match."""
    ct = (request.headers.get("content-type") or "").lower()
    if "multipart/form-data" not in ct:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="multipart/form-data required",
        )


async def _multipart_upload_parts(form: Any) -> list[tuple[str, bytes, str | None]]:
    """
    Collect ``(filename, bytes, content_type)`` from multipart fields.

    Accepts repeated ``file``, ``files``, or a single ``file`` / ``files`` entry.
    Skips plain string fields. Does not rely on a specific UploadFile subclass.
    """
    raw: list[Any] = list(form.getlist("file"))
    if not raw:
        raw = list(form.getlist("files"))
    if not raw:
        one = form.get("file")
        if one is not None:
            raw = [one]
    if not raw:
        one = form.get("files")
        if one is not None:
            raw = [one]
    if not raw and hasattr(form, "multi_items"):
        for key, u in form.multi_items():
            if key in ("file", "files") and not isinstance(u, str):
                raw.append(u)

    out: list[tuple[str, bytes, str | None]] = []
    for u in raw:
        if isinstance(u, str):
            continue
        read = getattr(u, "read", None)
        if read is None:
            continue
        if inspect.iscoroutinefunction(read):
            data = await read()
        else:
            data = read()
        fn = getattr(u, "filename", None) or "attachment"
        ct = getattr(u, "content_type", None)
        out.append((fn, data, ct))
    return out


def _get_rate_service(db: Annotated[Session, Depends(get_db)]) -> ContractorRateService:
    return ContractorRateService(db)


def _get_timeline_service(
    db: Annotated[Session, Depends(get_db)],
) -> ContractorRateTimelineService:
    return ContractorRateTimelineService(db)


def _get_rate_card_service(
    db: Annotated[Session, Depends(get_db)],
) -> RateCardService:
    return RateCardService(db)


def _resolve_user_name(db: Session, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    u = db.get(User, int(user_id))
    return getattr(u, "full_name", None) if u else None


def _versions_to_public(db: Session, versions: list) -> list[RateVersionEntry]:
    """Convert versioned rows into the API shape, attaching diffs vs. previous."""
    entries: list[RateVersionEntry] = []
    prev_snapshot: dict | None = None
    for v in versions:
        snap = dict(v.snapshot_json or {})
        diff = standard_diff(prev_snapshot, snap) if prev_snapshot is not None else None
        # ``parent_id`` is whichever FK the row stores.
        parent_id = (
            getattr(v, "part_master_id", None)
            if hasattr(v, "part_master_id")
            else getattr(v, "contractor_rate_id", None)
        )
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


# ---------- Contractor rates: list / create / get / patch ----------


@router.get(
    "/contractor-rates/summary",
    dependencies=[Depends(require_any_permission(*CONTRACTOR_RATE_READ_PERMISSION_CODES))],
)
def contractor_rate_summary(
    svc: Annotated[ContractorRateService, Depends(_get_rate_service)],
    contractor_id: int | None = Query(None),
    org_unit_id: int | None = Query(None),
) -> dict[str, Any]:
    return svc.aggregate_summary(scope_contractor_id=contractor_id, scope_org_unit_id=org_unit_id)


@router.get(
    "/contractor-rates",
    response_model=list[ContractorRatePublic],
    dependencies=[Depends(require_any_permission(*CONTRACTOR_RATE_READ_PERMISSION_CODES))],
)
def list_contractor_rates(
    svc: Annotated[ContractorRateService, Depends(_get_rate_service)],
    response: Response,
    contractor_id: int | None = Query(None),
    part_master_id: int | None = Query(None),
    org_unit_id: int | None = Query(None),
    part_code: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
) -> list[ContractorRatePublic]:
    rows = svc.list_rates(
        contractor_id=contractor_id,
        status=status_filter,
        part_master_id=part_master_id,
        org_unit_id=org_unit_id,
        part_code=part_code,
    )
    response.headers["X-Total-Count"] = str(len(rows))
    return [ContractorRatePublic.model_validate(svc.to_public_dict(r)) for r in rows]


@router.post(
    "/contractor-rates",
    response_model=ContractorRatePublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("contractor_rates.create"))],
)
def create_contractor_rate(
    payload: ContractorRateCreate,
    svc: Annotated[ContractorRateService, Depends(_get_rate_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> ContractorRatePublic:
    try:
        row = svc.create_rate(payload, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return ContractorRatePublic.model_validate(svc.to_public_dict(row))


@router.post(
    "/contractor-rates/{rate_id:int}/opening-evidence",
    response_model=OpeningEvidenceUploadResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[
        Depends(require_any_permission("contractor_rates.create", "contractor_rates.update"))
    ],
)
async def upload_opening_evidence(
    rate_id: int,
    request: Request,
    svc: Annotated[ContractorRateService, Depends(_get_rate_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> OpeningEvidenceUploadResult:
    """For a brand-new draft (no negotiation rounds yet), create round 1 and attach files."""
    _require_multipart(request)
    form = await request.form()
    parsed = await _multipart_upload_parts(form)
    if not parsed:
        raise HTTPException(status_code=422, detail="at least one file is required (field name: file)")
    try:
        log, saved = svc.upload_opening_evidence(
            rate_id,
            parsed,
            actor_user_id=int(current.subject),
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return OpeningEvidenceUploadResult(
        negotiation_log_id=int(log.id),
        attachments=[NegotiationAttachmentPublic.model_validate(a, from_attributes=True) for a in saved],
    )


@router.get(
    "/contractor-rates/{rate_id:int}",
    response_model=ContractorRatePublic,
    dependencies=[Depends(require_any_permission(*CONTRACTOR_RATE_READ_PERMISSION_CODES))],
)
def get_contractor_rate(
    rate_id: int,
    svc: Annotated[ContractorRateService, Depends(_get_rate_service)],
) -> ContractorRatePublic:
    try:
        row = svc.get_rate(rate_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ContractorRatePublic.model_validate(svc.to_public_dict(row))


@router.patch(
    "/contractor-rates/{rate_id:int}",
    response_model=ContractorRatePublic,
    dependencies=[Depends(require_permission("contractor_rates.update"))],
)
def update_contractor_rate(
    rate_id: int,
    payload: ContractorRateUpdate,
    svc: Annotated[ContractorRateService, Depends(_get_rate_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> ContractorRatePublic:
    try:
        row = svc.update_rate(rate_id, payload, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return ContractorRatePublic.model_validate(svc.to_public_dict(row))


# ---------- Negotiation rounds, submit, cancel ----------


@router.post(
    "/contractor-rates/{rate_id:int}/negotiate",
    response_model=NegotiationRoundPublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("contractor_rates.update"))],
)
def add_negotiation_round(
    rate_id: int,
    payload: NegotiationRoundCreate,
    svc: Annotated[ContractorRateService, Depends(_get_rate_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> NegotiationRoundPublic:
    remarks = (payload.remarks or "").strip()
    if not remarks:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Remarks are required for a negotiation round.",
        )
    payload = payload.model_copy(update={"remarks": remarks})
    try:
        row = svc.add_negotiation_round(rate_id, payload, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return NegotiationRoundPublic.model_validate(row, from_attributes=True)


@router.post(
    "/contractor-rates/{rate_id:int}/negotiation-logs/{log_id:int}/attachments",
    response_model=NegotiationAttachmentPublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("contractor_rates.update"))],
)
async def upload_negotiation_attachment(
    rate_id: int,
    log_id: int,
    request: Request,
    svc: Annotated[ContractorRateService, Depends(_get_rate_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> NegotiationAttachmentPublic:
    _require_multipart(request)
    form = await request.form()
    parsed = await _multipart_upload_parts(form)
    if not parsed:
        raise HTTPException(status_code=422, detail="file is required (multipart field name: file)")
    filename, raw, content_type = parsed[0]
    try:
        row = svc.add_negotiation_attachment(
            rate_id,
            log_id,
            filename=filename,
            content=raw,
            content_type=content_type,
            actor_user_id=int(current.subject),
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return NegotiationAttachmentPublic.model_validate(row, from_attributes=True)


@router.get(
    "/contractor-rates/{rate_id:int}/negotiation-logs/{log_id:int}/attachments/{attachment_id:int}/content",
    dependencies=[Depends(require_any_permission(*CONTRACTOR_RATE_READ_PERMISSION_CODES))],
)
def negotiation_attachment_content(
    rate_id: int,
    log_id: int,
    attachment_id: int,
    svc: Annotated[ContractorRateService, Depends(_get_rate_service)],
) -> FileResponse:
    """Return stored bytes for preview/download (images, PDF, etc.)."""
    try:
        att, path = svc.get_negotiation_attachment_file(rate_id, log_id, attachment_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    name = att.file_name or path.name
    return FileResponse(
        str(path),
        media_type=att.content_type or "application/octet-stream",
        filename=name,
        content_disposition_type="inline",
    )


@router.post(
    "/contractor-rates/{rate_id:int}/submit",
    response_model=ContractorRatePublic,
    dependencies=[Depends(require_permission("contractor_rates.create"))],
)
def submit_contractor_rate(
    rate_id: int,
    svc: Annotated[ContractorRateService, Depends(_get_rate_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> ContractorRatePublic:
    try:
        row = svc.submit_for_approval(rate_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return ContractorRatePublic.model_validate(svc.to_public_dict(row))


@router.post(
    "/contractor-rates/{rate_id:int}/cancel",
    response_model=ContractorRatePublic,
    dependencies=[Depends(require_permission("contractor_rates.update"))],
)
def cancel_contractor_rate(
    rate_id: int,
    svc: Annotated[ContractorRateService, Depends(_get_rate_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> ContractorRatePublic:
    try:
        row = svc.cancel_rate(rate_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return ContractorRatePublic.model_validate(svc.to_public_dict(row))


# ---------- Timeline ----------


@router.get(
    "/contractor-rates/{rate_id:int}/timeline",
    response_model=list[ContractorRateTimelineEvent],
    dependencies=[Depends(require_any_permission(*CONTRACTOR_RATE_READ_PERMISSION_CODES))],
)
def get_contractor_rate_timeline(
    rate_id: int,
    svc: Annotated[ContractorRateTimelineService, Depends(_get_timeline_service)],
) -> list[ContractorRateTimelineEvent]:
    try:
        events = svc.get_timeline(rate_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return [ContractorRateTimelineEvent.model_validate(e) for e in events]


@router.get(
    "/contractor-rates/{rate_id:int}/versions",
    response_model=list[RateVersionEntry],
    dependencies=[Depends(require_any_permission(*CONTRACTOR_RATE_READ_PERMISSION_CODES))],
)
def list_contractor_rate_versions(
    rate_id: int,
    svc: Annotated[ContractorRateService, Depends(_get_rate_service)],
    db: Annotated[Session, Depends(get_db)],
) -> list[RateVersionEntry]:
    """Time-travel snapshots for a contractor's negotiated rate."""
    try:
        versions = svc.list_versions(rate_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _versions_to_public(db, versions)


# ---------- Unified Rate Card ----------


@router.get(
    "/rate-card",
    response_model=list[RateCardRowPublic],
    dependencies=[Depends(require_permission("part_master.view"))],
)
def get_rate_card(
    svc: Annotated[RateCardService, Depends(_get_rate_card_service)],
    plant_id: int | None = Query(None, alias="plant_id"),
    contractor_id: int | None = Query(None),
    part_master_id: int | None = Query(None),
    part_code: str | None = Query(None),
    active_base_only: bool = Query(True),
) -> list[RateCardRowPublic]:
    """Commercial comparison grid: plant, contractor, and Part Master."""
    try:
        rows = svc.get_rate_card(
            plant_id=plant_id,
            contractor_id=contractor_id,
            part_master_id=part_master_id,
            part_code=part_code,
            active_base_only=active_base_only,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return [RateCardRowPublic.model_validate(r.as_dict()) for r in rows]


@router.get(
    "/rate-card/benchmark",
    response_model=RateCardBenchmark,
    dependencies=[Depends(require_permission("part_master.view"))],
)
def get_rate_card_benchmark(
    svc: Annotated[RateCardService, Depends(_get_rate_card_service)],
    plant_id: int | None = Query(None),
    contractor_id: int | None = Query(None),
    part_master_id: int | None = Query(None),
    part_code: str | None = Query(None),
    active_base_only: bool = Query(True),
) -> RateCardBenchmark:
    """Benchmark KPIs across the rate card filter."""
    try:
        kpis = svc.benchmark(
            plant_id=plant_id,
            contractor_id=contractor_id,
            part_master_id=part_master_id,
            part_code=part_code,
            active_base_only=active_base_only,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return RateCardBenchmark.model_validate(kpis)
