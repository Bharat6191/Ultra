"""Public/app router for the negotiation workflow.

RBAC permissions:
  * ``rate_master.view``  /  ``.create`` / ``.update`` / ``.delete``
  * ``contractor_rates.view`` / ``.create`` / ``.update`` / ``.delete`` / ``.approve``

Endpoints exposed:

  Rate Master (``/rate-master/*``):
    * GET    /rate-master                -- list (filters)
    * POST   /rate-master                -- create
    * GET    /rate-master/{id}           -- get one
    * PATCH  /rate-master/{id}           -- update

  Contractor Rates (``/contractor-rates/*``):
    * GET    /contractor-rates           -- list (filters)
    * POST   /contractor-rates           -- create draft
    * GET    /contractor-rates/{id}      -- get one (with rounds + savings)
    * PATCH  /contractor-rates/{id}      -- update draft (negotiated_rate / dates / remarks)
    * POST   /contractor-rates/{id}/negotiate  -- add a round
    * POST   /contractor-rates/{id}/submit     -- submit for approval (or auto-approve)
    * POST   /contractor-rates/{id}/cancel     -- cancel draft / pending / rejected
    * GET    /contractor-rates/{id}/timeline   -- merged audit + rounds + approvals
    * GET    /contractor-rates/summary         -- KPI counters
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_permission
from db.session import get_db
from modules.contractor_rates.schema import (
    ContractorRateCreate,
    ContractorRatePublic,
    ContractorRateTimelineEvent,
    ContractorRateUpdate,
    NegotiationRoundCreate,
    NegotiationRoundPublic,
    RateMasterAuditEntry,
    RateMasterCreate,
    RateMasterPublic,
    RateMasterUpdate,
)
from modules.contractor_rates.service import (
    ContractorRateService,
    RateMasterService,
)
from modules.contractor_rates.timeline import ContractorRateTimelineService
from modules.errors import ConflictError, NotFoundError


router = APIRouter(tags=["app", "contractor_rates"])


def _get_rate_master_service(db: Annotated[Session, Depends(get_db)]) -> RateMasterService:
    return RateMasterService(db)


def _get_rate_service(db: Annotated[Session, Depends(get_db)]) -> ContractorRateService:
    return ContractorRateService(db)


def _get_timeline_service(
    db: Annotated[Session, Depends(get_db)],
) -> ContractorRateTimelineService:
    return ContractorRateTimelineService(db)


# ---------- Rate master ----------


@router.get(
    "/rate-master",
    response_model=list[RateMasterPublic],
    dependencies=[Depends(require_permission("rate_master.view"))],
)
def list_rate_master(
    svc: Annotated[RateMasterService, Depends(_get_rate_master_service)],
    org_unit_id: int | None = Query(None),
    job_type: str | None = Query(None),
    skill_type: str | None = Query(None),
    unit: str | None = Query(None),
    active_only: bool = Query(False, alias="active"),
) -> list[RateMasterPublic]:
    rows = svc.list_rate_masters(
        org_unit_id=org_unit_id,
        job_type=job_type,
        skill_type=skill_type,
        unit=unit,
        active_only=active_only,
    )
    return [RateMasterPublic.model_validate(svc._public_dict(r)) for r in rows]


@router.post(
    "/rate-master",
    response_model=RateMasterPublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("rate_master.create"))],
)
def create_rate_master(
    payload: RateMasterCreate,
    svc: Annotated[RateMasterService, Depends(_get_rate_master_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> RateMasterPublic:
    try:
        row = svc.create_rate_master(payload, actor_user_id=int(current.subject))
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return RateMasterPublic.model_validate(svc._public_dict(row))


@router.get(
    "/rate-master/{rate_master_id:int}",
    response_model=RateMasterPublic,
    dependencies=[Depends(require_permission("rate_master.view"))],
)
def get_rate_master(
    rate_master_id: int,
    svc: Annotated[RateMasterService, Depends(_get_rate_master_service)],
) -> RateMasterPublic:
    try:
        row = svc.get_rate_master(rate_master_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return RateMasterPublic.model_validate(svc._public_dict(row))


@router.patch(
    "/rate-master/{rate_master_id:int}",
    response_model=RateMasterPublic,
    dependencies=[Depends(require_permission("rate_master.update"))],
)
def update_rate_master(
    rate_master_id: int,
    payload: RateMasterUpdate,
    svc: Annotated[RateMasterService, Depends(_get_rate_master_service)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> RateMasterPublic:
    try:
        row = svc.update_rate_master(rate_master_id, payload, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return RateMasterPublic.model_validate(svc._public_dict(row))


@router.get(
    "/rate-master/{rate_master_id:int}/audit-logs",
    response_model=list[RateMasterAuditEntry],
    dependencies=[Depends(require_permission("rate_master.view"))],
)
def list_rate_master_audit_logs(
    rate_master_id: int,
    svc: Annotated[RateMasterService, Depends(_get_rate_master_service)],
) -> list[RateMasterAuditEntry]:
    """Return the chronological audit trail for one base rate."""
    try:
        rows = svc.list_audit_logs(rate_master_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return [RateMasterAuditEntry.model_validate(r) for r in rows]


# ---------- Contractor rates: list / create / get / patch ----------


@router.get(
    "/contractor-rates/summary",
    dependencies=[Depends(require_permission("contractor_rates.view"))],
)
def contractor_rate_summary(
    svc: Annotated[ContractorRateService, Depends(_get_rate_service)],
    contractor_id: int | None = Query(None),
) -> dict[str, Any]:
    return svc.aggregate_summary(scope_contractor_id=contractor_id)


@router.get(
    "/contractor-rates",
    response_model=list[ContractorRatePublic],
    dependencies=[Depends(require_permission("contractor_rates.view"))],
)
def list_contractor_rates(
    svc: Annotated[ContractorRateService, Depends(_get_rate_service)],
    response: Response,
    contractor_id: int | None = Query(None),
    rate_master_id: int | None = Query(None),
    org_unit_id: int | None = Query(None),
    job_type: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
) -> list[ContractorRatePublic]:
    rows = svc.list_rates(
        contractor_id=contractor_id,
        status=status_filter,
        rate_master_id=rate_master_id,
        org_unit_id=org_unit_id,
        job_type=job_type,
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


@router.get(
    "/contractor-rates/{rate_id:int}",
    response_model=ContractorRatePublic,
    dependencies=[Depends(require_permission("contractor_rates.view"))],
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
    try:
        row = svc.add_negotiation_round(rate_id, payload, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return NegotiationRoundPublic.model_validate(row, from_attributes=True)


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
    dependencies=[Depends(require_permission("contractor_rates.view"))],
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
