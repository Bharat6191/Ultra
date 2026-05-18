from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_any_permission, require_permission
from db.session import get_db
from modules.contractor.models import Contractor
from modules.errors import ConflictError, NotFoundError
from modules.invoices.service import InvoiceService
from modules.invoices.validation import (
    prior_invoiced_ex_vat_for_work_order,
    prior_passed_invoiced_ex_vat_for_work_order,
    work_order_ex_vat_cap,
)
from modules.work_orders.models import WORK_ORDER_STATUSES, WorkOrder
from modules.work_orders.schema import (
    WorkOrderCreate,
    WorkOrderDraftUpdate,
    WorkOrderItemProgressHistoryEntry,
    WorkOrderPublic,
    WorkOrderProgressUpsertResponse,
    WorkOrderRateOverrideRequest,
    WorkOrderAuditEntry,
    WorkOrderItemProgressCreate,
    WorkOrderLinkedInvoice,
)
from modules.work_orders.service import WorkOrderService


router = APIRouter(tags=["app", "work_orders"])


def _svc(db: Session = Depends(get_db)) -> WorkOrderService:
    return WorkOrderService(db)


def _inv_svc(db: Session = Depends(get_db)) -> InvoiceService:
    return InvoiceService(db)


def _to_public(db: Session, row: WorkOrder) -> dict:
    svc = WorkOrderService(db)
    ctr = db.get(Contractor, int(row.contractor_id))
    contractor_name = getattr(ctr, "name", None) if ctr is not None else None
    cap_dec = work_order_ex_vat_cap(db, row)
    committed_ex = prior_invoiced_ex_vat_for_work_order(
        db, work_order_id=int(row.id), exclude_invoice_id=None
    )
    inv_ex = prior_passed_invoiced_ex_vat_for_work_order(
        db, work_order_id=int(row.id), exclude_invoice_id=None
    )
    rem = (cap_dec - committed_ex).quantize(Decimal("0.01"))
    if rem < Decimal("0"):
        rem = Decimal("0")
    return {
        "id": int(row.id),
        "work_order_number": row.work_order_number,
        "org_unit_id": int(row.org_unit_id),
        "contractor_id": int(row.contractor_id),
        "contractor_name": contractor_name,
        "title": row.title,
        "description": row.description,
        "status": row.status,
        "approval_request_id": row.approval_request_id,
        "approved_value_total": row.approved_value_total,
        "approved_by": row.approved_by,
        "approved_at": row.approved_at,
        "rejected_by": row.rejected_by,
        "rejected_at": row.rejected_at,
        "invoiced_ex_tax_total": inv_ex,
        "committed_invoiced_ex_tax_total": committed_ex,
        "remaining_invoiceable_value": rem,
        "created_by": row.created_by,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "items": [
            {
                "id": int(i.id),
                "part_master_id": int(i.part_master_id),
                "part_code": (i.pricing_snapshot or {}).get("part_code"),
                "part_name": (i.pricing_snapshot or {}).get("part_name"),
                "unit_type": (i.pricing_snapshot or {}).get("unit_type"),
                "pricing_method": (i.pricing_snapshot or {}).get("pricing_method"),
                "rate_unit_type": (i.pricing_snapshot or {}).get("rate_unit_type"),
                "pricing_snapshot": i.pricing_snapshot,
                "progress_type": i.progress_type,
                "planned_quantity": i.planned_quantity,
                "planned_percentage": i.planned_percentage,
                "weight_per_piece_snapshot": i.weight_per_piece_snapshot,
                "taxable_value": i.taxable_value,
                "resolved_rate": i.resolved_rate,
                "rate_source": i.rate_source,
                "contractor_rate_id": i.contractor_rate_id,
                "override_rate": i.override_rate,
                "override_reason": i.override_reason,
                "override_status": i.override_status,
                "notes": i.notes,
                "completion": svc.item_completion_projection(i),
            }
            for i in (row.items or [])
        ],
    }


@router.get(
    "/work-orders",
    response_model=list[WorkOrderPublic],
    dependencies=[Depends(require_permission("work_orders.view"))],
)
def list_work_orders(
    svc: Annotated[WorkOrderService, Depends(_svc)],
    db: Session = Depends(get_db),
    org_unit_id: int | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    statuses: list[str] | None = Query(
        None,
        description="Repeat query param to filter by several statuses, e.g. ?statuses=draft&statuses=rejected",
    ),
    limit: int = Query(100, ge=1, le=200),
) -> list[WorkOrderPublic]:
    allowed = set(WORK_ORDER_STATUSES)
    if statuses is not None:
        cleaned = [s.strip().lower() for s in statuses if s and str(s).strip()]
        if cleaned:
            bad = [s for s in cleaned if s not in allowed]
            if bad:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid status value(s): {bad}. Allowed: {sorted(allowed)}",
                )
            rows = svc.list(org_unit_id=org_unit_id, statuses=cleaned, limit=limit)
        else:
            rows = svc.list(org_unit_id=org_unit_id, status=status_filter, limit=limit)
    else:
        rows = svc.list(org_unit_id=org_unit_id, status=status_filter, limit=limit)
    return [WorkOrderPublic.model_validate(_to_public(db, r)) for r in rows]


@router.post(
    "/work-orders",
    response_model=WorkOrderPublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("work_orders.create"))],
)
def create_work_order(
    payload: WorkOrderCreate,
    svc: Annotated[WorkOrderService, Depends(_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> WorkOrderPublic:
    try:
        row = svc.create(payload, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return WorkOrderPublic.model_validate(_to_public(db, row))


@router.get(
    "/work-orders/rate-preview",
    dependencies=[
        Depends(require_any_permission("work_orders.view", "work_orders.create", "work_orders.approve"))
    ],
)
def work_order_rate_preview(
    svc: Annotated[WorkOrderService, Depends(_svc)],
    contractor_id: int = Query(..., ge=1),
    part_master_id: int = Query(..., ge=1),
    pricing_date: date | None = Query(None, description="Rate lookup date; defaults to today for new drafts."),
) -> dict[str, Any]:
    """Resolved unit rate for a contractor + part (negotiated window vs Part Master)."""
    try:
        return svc.preview_resolved_line_rate(
            contractor_id=contractor_id,
            part_master_id=part_master_id,
            pricing_date=pricing_date or date.today(),
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get(
    "/work-orders/{work_order_id:int}",
    response_model=WorkOrderPublic,
    dependencies=[Depends(require_any_permission("work_orders.view", "work_orders.approve"))],
)
def get_work_order(
    work_order_id: int,
    svc: Annotated[WorkOrderService, Depends(_svc)],
    db: Session = Depends(get_db),
) -> WorkOrderPublic:
    try:
        row = svc.get(work_order_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return WorkOrderPublic.model_validate(_to_public(db, row))


@router.get(
    "/work-orders/{work_order_id:int}/remaining-balance",
    dependencies=[Depends(require_any_permission("work_orders.view", "work_orders.approve"))],
)
def work_order_remaining_balance(
    work_order_id: int,
    inv_svc: Annotated[InvoiceService, Depends(_inv_svc)],
) -> dict:
    """Cumulative invoice commitment vs approved WO cap, plus per-line preflight rows for this work order."""
    try:
        return inv_svc.work_order_invoice_balance(work_order_id=int(work_order_id))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/work-orders/{work_order_id:int}/invoices",
    response_model=list[WorkOrderLinkedInvoice],
    dependencies=[Depends(require_any_permission("work_orders.view", "work_orders.approve"))],
)
def list_work_order_invoices(
    work_order_id: int,
    svc: Annotated[WorkOrderService, Depends(_svc)],
) -> list[WorkOrderLinkedInvoice]:
    try:
        rows = svc.list_invoices_for_work_order(work_order_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return [
        WorkOrderLinkedInvoice(
            id=int(r.id),
            invoice_number=str(r.invoice_number),
            invoice_date=r.invoice_date,
            status=str(r.status),
            validation_status=r.validation_status,
            total_amount=r.total_amount,
            lines_subtotal_ex_vat=sum((ln.amount for ln in (r.lines or [])), Decimal("0")),
            extra_amount_ex_vat=r.extra_amount_ex_vat,
        )
        for r in rows
    ]


@router.get(
    "/work-orders/{work_order_id:int}/audit-logs",
    response_model=list[WorkOrderAuditEntry],
    dependencies=[
        Depends(
            require_any_permission(
                "work_orders.view",
                "work_orders.manage_completion",
                "work_orders.track_completion",
                "work_orders.approve",
            )
        )
    ],
)
def work_order_audit_logs(
    work_order_id: int,
    svc: Annotated[WorkOrderService, Depends(_svc)],
) -> list[WorkOrderAuditEntry]:
    rows = svc.get(work_order_id).audit_logs or []
    out: list[WorkOrderAuditEntry] = []
    for a in rows:
        out.append(
            WorkOrderAuditEntry(
                id=int(a.id),
                work_order_id=int(a.work_order_id),
                action=str(a.action),
                changed_by=int(a.actor_user_id) if a.actor_user_id is not None else None,
                actor_name=svc._user_display_name(a.actor_user_id) if a.actor_user_id is not None else None,
                old_value=a.old_value,
                new_value=a.new_value,
                metadata=a.metadata_json,
                created_at=a.created_at,
            )
        )
    return out


@router.patch(
    "/work-orders/{work_order_id:int}",
    response_model=WorkOrderPublic,
    dependencies=[Depends(require_permission("work_orders.create"))],
)
def update_work_order_draft(
    work_order_id: int,
    payload: WorkOrderDraftUpdate,
    svc: Annotated[WorkOrderService, Depends(_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> WorkOrderPublic:
    try:
        row = svc.update_draft(work_order_id, payload, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return WorkOrderPublic.model_validate(_to_public(db, row))


@router.post(
    "/work-orders/{work_order_id:int}/submit",
    response_model=WorkOrderPublic,
    dependencies=[Depends(require_permission("work_orders.create"))],
)
def submit_work_order(
    work_order_id: int,
    svc: Annotated[WorkOrderService, Depends(_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> WorkOrderPublic:
    try:
        row = svc.submit_for_approval(work_order_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return WorkOrderPublic.model_validate(_to_public(db, row))


@router.post(
    "/work-orders/items/{work_order_item_id:int}/progress",
    response_model=WorkOrderProgressUpsertResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_any_permission("work_orders.manage_completion", "work_orders.track_completion"))],
)
def add_progress(
    work_order_item_id: int,
    payload: WorkOrderItemProgressCreate,
    svc: Annotated[WorkOrderService, Depends(_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> WorkOrderProgressUpsertResponse:
    try:
        row = svc.add_progress(work_order_item_id, payload, actor_user_id=int(current.subject))
        return WorkOrderProgressUpsertResponse(
            ok=True,
            id=int(row.id),
            completed_quantity=float(row.completed_quantity) if row.completed_quantity is not None else None,
            completed_percentage=float(row.completed_percentage) if row.completed_percentage is not None else 0.0,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post(
    "/work-orders/{work_order_id:int}/complete",
    response_model=WorkOrderPublic,
    status_code=status.HTTP_200_OK,
    dependencies=[
        Depends(require_any_permission("work_orders.manage_completion", "work_orders.track_completion"))
    ],
)
def complete_work_order(
    work_order_id: int,
    svc: Annotated[WorkOrderService, Depends(_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> WorkOrderPublic:
    """Close the work order once every line item is at 100% saved completion."""
    try:
        row = svc.close_active_work_order(work_order_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return WorkOrderPublic.model_validate(_to_public(db, row))


@router.get(
    "/work-orders/items/{work_order_item_id:int}/completion-history",
    response_model=list[WorkOrderItemProgressHistoryEntry],
    dependencies=[
        Depends(
            require_any_permission(
                "work_orders.view",
                "work_orders.manage_completion",
                "work_orders.track_completion",
            )
        )
    ],
)
def work_order_item_completion_history(
    work_order_item_id: int,
    svc: Annotated[WorkOrderService, Depends(_svc)],
) -> list[WorkOrderItemProgressHistoryEntry]:
    try:
        rows = svc.list_item_progress_history(work_order_item_id)
        return [WorkOrderItemProgressHistoryEntry.model_validate(x) for x in rows]
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    "/work-orders/items/{work_order_item_id:int}/override-rate",
    dependencies=[Depends(require_permission("work_orders.override_rate"))],
)
def request_override(
    work_order_item_id: int,
    payload: WorkOrderRateOverrideRequest,
    svc: Annotated[WorkOrderService, Depends(_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict:
    try:
        item = svc.request_rate_override(work_order_item_id, payload, actor_user_id=int(current.subject))
        return {
            "ok": True,
            "work_order_item_id": int(item.id),
            "override_status": item.override_status,
            "override_approval_request_id": item.override_approval_request_id,
        }
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete(
    "/work-orders/{work_order_id:int}",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_permission("work_orders.delete"))],
)
def archive_work_order(
    work_order_id: int,
    svc: Annotated[WorkOrderService, Depends(_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict:
    try:
        row = svc.archive(work_order_id, actor_user_id=int(current.subject))
        return {"ok": True, "id": int(row.id), "is_active": bool(row.is_active), "status": row.status}
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete(
    "/work-orders/{work_order_id:int}/hard",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_permission("work_orders.delete"))],
)
def hard_delete_work_order(
    work_order_id: int,
    svc: Annotated[WorkOrderService, Depends(_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict:
    try:
        svc.hard_delete(work_order_id, actor_user_id=int(current.subject))
        return {"ok": True, "id": int(work_order_id), "deleted": True}
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

