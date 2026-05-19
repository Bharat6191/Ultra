from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, status
from starlette.datastructures import UploadFile as StarletteUploadFile
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_any_permission, require_permission
from db.session import get_db
from modules.errors import ConflictError, NotFoundError
from modules.invoices.models import Invoice
from modules.invoices.schema import (
    InvoiceCreate,
    InvoiceUpdate,
    InvoicePreflightResponse,
    InvoicePublic,
    InvoiceIssueJustificationUpdate,
    InvoiceAuditEntry,
    SuggestedInvoiceNumber,
)
from modules.invoices.commercial_amount import invoice_line_ex_vat_amount
from modules.invoices.models import InvoiceAttachment
from modules.invoices.line_format import rate_basis_label, unit_label_from_type
from modules.invoices.storage import save_invoice_attachment
from modules.invoices.service import InvoiceService
from modules.work_orders.schema import WorkOrderPublic
from modules.work_orders.service import WorkOrderService
from modules.work_orders.models import WorkOrder, WorkOrderItem


router = APIRouter(tags=["app", "invoices"])


def _svc(db: Session = Depends(get_db)) -> InvoiceService:
    return InvoiceService(db)


def _wo_svc(db: Session = Depends(get_db)) -> WorkOrderService:
    return WorkOrderService(db)


def _q2(x: Decimal) -> Decimal:
    return Decimal(str(x)).quantize(Decimal("0.01"))


def _line_validation_status(inv: Invoice, *, line_pk: int) -> str | None:
    ranked: str | None = None
    for iss in inv.issues or []:
        if iss.line_id is None or int(iss.line_id) != int(line_pk):
            continue
        if iss.severity == "blocker":
            return "blocked"
        if iss.severity == "error":
            ranked = "blocked"
        elif iss.severity == "warning" and ranked != "blocked":
            ranked = "warn"
    return ranked


def _to_public(inv: Invoice, db: Session | None = None) -> dict:
    line_rows: list[dict] = []
    for l in inv.lines or []:
        qty = Decimal(str(l.quantity))
        rate_dec = Decimal(str(l.rate))
        wo_no: str | None = None
        job_desc: str | None = None
        wit = db.get(WorkOrderItem, int(l.work_order_item_id)) if db is not None else None
        ps = (wit.pricing_snapshot or {}) if wit is not None else {}
        if wit is not None:
            try:
                base_expect = invoice_line_ex_vat_amount(
                    item=wit,
                    invoice_quantity=qty,
                    resolved_rate=rate_dec,
                )
            except ValueError:
                base_expect = _q2(qty * rate_dec)
            job_desc = f"{ps.get('part_code') or ''} — {ps.get('part_name') or ''}".strip(" —")
            wo = db.get(WorkOrder, int(wit.work_order_id))
            if wo is not None:
                wo_no = wo.work_order_number
        else:
            base_expect = _q2(qty * rate_dec)
        amt = Decimal(str(l.amount))
        var_hint = None
        if base_expect != 0:
            try:
                var_hint = float(_q2(amt - base_expect) / float(base_expect) * 100.0)
            except Exception:
                var_hint = None
        tp = Decimal(str(l.tax_pct or 0))
        gross = _q2(amt * (Decimal("1") + tp / Decimal("100")))
        tax_amt = _q2(amt * tp / Decimal("100")) if tp else Decimal("0")
        ut_raw = ps.get("unit_type")
        ut = str(ut_raw) if ut_raw not in (None, "") else None
        rut_raw = ps.get("rate_unit_type")
        rut = str(rut_raw) if rut_raw not in (None, "") else None
        w_kg: float | None = None
        if wit is not None:
            w_snap = getattr(wit, "weight_per_piece_snapshot", None)
            if w_snap is not None:
                try:
                    w_kg = float(w_snap)
                except (TypeError, ValueError):
                    w_kg = None
            if w_kg is None and ps.get("weight_per_piece") not in (None, ""):
                try:
                    w_kg = float(ps["weight_per_piece"])
                except (TypeError, ValueError):
                    w_kg = None
        line_rows.append(
            {
                "id": int(l.id),
                "work_order_item_id": int(l.work_order_item_id),
                "quantity": l.quantity,
                "rate": l.rate,
                "amount": l.amount,
                "tax_pct": l.tax_pct,
                "amount_including_tax": gross,
                "variance_pct_hint": var_hint,
                "work_order_number": wo_no,
                "job_description": job_desc,
                "part_code": ps.get("part_code"),
                "part_name": ps.get("part_name"),
                "unit_type": ut,
                "unit_label": unit_label_from_type(ut),
                "pricing_method": ps.get("pricing_method"),
                "rate_unit_type": rut,
                "rate_basis_label": rate_basis_label(rut),
                "weight_per_piece_kg": w_kg,
                "unit_rate": l.rate,
                "taxable_value": amt,
                "tax_amount": tax_amt,
                "rate_source": l.rate_source,
                "resolved_contractor_rate_id": l.resolved_contractor_rate_id,
                "resolved_part_master_id": l.resolved_part_master_id,
                "notes": l.notes,
                "validation_line_status": _line_validation_status(inv, line_pk=int(l.id)),
            }
        )

    return {
        "id": int(inv.id),
        "contractor_id": int(inv.contractor_id),
        "org_unit_id": int(inv.org_unit_id),
        "invoice_number": inv.invoice_number,
        "invoice_date": inv.invoice_date,
        "status": inv.status,
        "currency": inv.currency,
        "total_amount": inv.total_amount,
        "extra_amount_ex_vat": inv.extra_amount_ex_vat,
        "extra_lines": [
            {
                "id": int(x.id),
                "description": x.description,
                "quantity": x.quantity,
                "unit": x.unit,
                "unit_price": x.unit_price,
                "amount_ex_vat": x.amount_ex_vat,
            }
            for x in (inv.extra_lines or [])
        ],
        "lines_subtotal_ex_vat": sum((l.amount for l in (inv.lines or [])), Decimal("0")),
        "validation_status": inv.validation_status,
        "validation_score": inv.validation_score,
        "last_validated_at": inv.last_validated_at,
        "approval_request_id": inv.approval_request_id,
        "submitted_by": inv.submitted_by,
        "submitted_at": inv.submitted_at,
        "created_by": inv.created_by,
        "created_at": inv.created_at,
        "updated_at": inv.updated_at,
        "lines": line_rows,
        "issues": [
            {
                "id": int(i.id),
                "invoice_id": int(i.invoice_id),
                "line_id": i.line_id,
                "code": i.code,
                "severity": i.severity,
                "message": i.message,
                "allowed_value": i.allowed_value,
                "actual_value": i.actual_value,
                "allowed_qty": i.allowed_qty,
                "actual_qty": i.actual_qty,
                "tolerance_pct": i.tolerance_pct,
                "requires_justification": bool(i.requires_justification),
                "requires_attachments": bool(i.requires_attachments),
                "justification": i.justification,
                "metadata_json": i.metadata_json,
                "created_at": i.created_at,
            }
            for i in (inv.issues or [])
        ],
        "attachments": [
            {
                "id": int(a.id),
                "file_name": a.file_name,
                "file_path": a.file_path,
                "content_type": a.content_type,
            }
            for a in (inv.attachments or [])
        ],
    }


def _resolve_user_name(db: Session, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    from modules.users.model import User  # local import to avoid circulars

    u = db.get(User, int(user_id))
    if u is None:
        return None
    return str(u.full_name or u.username or f"User #{user_id}")


@router.get(
    "/invoices/{invoice_id:int}/audit-logs",
    response_model=list[InvoiceAuditEntry],
    dependencies=[Depends(require_permission("invoices.view"))],
)
def invoice_audit_logs(
    invoice_id: int,
    svc: Annotated[InvoiceService, Depends(_svc)],
    db: Annotated[Session, Depends(get_db)],
) -> list[InvoiceAuditEntry]:
    inv = svc.get(int(invoice_id))
    out: list[InvoiceAuditEntry] = []
    for a in (inv.audit_logs or []):
        out.append(
            InvoiceAuditEntry(
                id=int(a.id),
                invoice_id=int(a.invoice_id),
                action=str(a.action),
                changed_by=int(a.changed_by) if a.changed_by is not None else None,
                actor_name=_resolve_user_name(db, int(a.changed_by)) if a.changed_by is not None else None,
                old_value=a.old_value,
                new_value=a.new_value,
                metadata=a.metadata_json,
                created_at=a.created_at,
            )
        )
    return out


@router.get(
    "/invoices/preflight-billables",
    response_model=InvoicePreflightResponse,
    dependencies=[
        Depends(
            require_any_permission(
                "invoices.create",
                "invoices.view",
            ),
        ),
    ],
)
def invoice_preflight(
    contractor_id: int = Query(..., ge=1),
    org_unit_id: int = Query(..., ge=1),
    work_order_ids: str | None = Query(
        None,
        description="Comma-separated work order ids to scope prefilled billable rows (omit for all active WOs in plant).",
    ),
    svc: InvoiceService = Depends(_svc),
) -> InvoicePreflightResponse:
    wo_ids: list[int] | None = None
    if work_order_ids:
        wo_ids = [int(x.strip()) for x in work_order_ids.split(",") if x.strip().isdigit()]
    try:
        raw = svc.preflight_billables(
            contractor_id=int(contractor_id),
            org_unit_id=int(org_unit_id),
            work_order_ids=wo_ids,
        )
        return InvoicePreflightResponse.model_validate(raw)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get(
    "/invoices/suggested-number",
    response_model=SuggestedInvoiceNumber,
    dependencies=[Depends(require_permission("invoices.create"))],
)
def invoice_suggested_number(
    contractor_id: int = Query(..., ge=1),
    org_unit_id: int = Query(..., ge=1),
    svc: InvoiceService = Depends(_svc),
) -> SuggestedInvoiceNumber:
    try:
        n = svc.suggest_next_invoice_number(contractor_id=int(contractor_id), org_unit_id=int(org_unit_id))
        return SuggestedInvoiceNumber(invoice_number=n)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get(
    "/invoices/work-orders/eligible",
    response_model=list[WorkOrderPublic],
    dependencies=[
        Depends(
            require_any_permission(
                "invoices.create",
                "invoices.view",
            ),
        ),
    ],
)
def invoice_eligible_work_orders(
    contractor_id: int = Query(..., ge=1),
    org_unit_id: int = Query(..., ge=1),
    wo_svc: WorkOrderService = Depends(_wo_svc),
    db: Session = Depends(get_db),
) -> list[WorkOrderPublic]:
    """Approved (operational ``active``) work orders for a contractor + plant — invoice creation scope."""
    from modules.work_orders.router_app import _to_public as wo_to_public

    rows = wo_svc.list(
        org_unit_id=int(org_unit_id),
        contractor_id=int(contractor_id),
        statuses=["active"],
        limit=200,
    )
    return [WorkOrderPublic.model_validate(wo_to_public(db, r)) for r in rows]


@router.get(
    "/invoices",
    response_model=list[InvoicePublic],
    dependencies=[Depends(require_permission("invoices.view"))],
)
def list_invoices(
    svc: Annotated[InvoiceService, Depends(_svc)],
    db: Annotated[Session, Depends(get_db)],
    contractor_id: int | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=200),
) -> list[InvoicePublic]:
    rows = svc.list(contractor_id=contractor_id, status=status_filter, limit=limit)
    return [InvoicePublic.model_validate(_to_public(r, db)) for r in rows]


@router.post(
    "/invoices",
    response_model=InvoicePublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("invoices.create"))],
)
def create_invoice(
    payload: InvoiceCreate,
    svc: Annotated[InvoiceService, Depends(_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> InvoicePublic:
    try:
        inv = svc.create(payload, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return InvoicePublic.model_validate(_to_public(inv, db))


@router.get(
    "/invoices/{invoice_id:int}",
    response_model=InvoicePublic,
    dependencies=[Depends(require_permission("invoices.view"))],
)
def get_invoice(
    invoice_id: int,
    svc: Annotated[InvoiceService, Depends(_svc)],
    db: Annotated[Session, Depends(get_db)],
) -> InvoicePublic:
    try:
        inv = svc.get(invoice_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return InvoicePublic.model_validate(_to_public(inv, db))


@router.patch(
    "/invoices/{invoice_id:int}",
    response_model=InvoicePublic,
    dependencies=[Depends(require_permission("invoices.update"))],
)
def update_invoice_draft(
    invoice_id: int,
    payload: InvoiceUpdate,
    svc: Annotated[InvoiceService, Depends(_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> InvoicePublic:
    try:
        inv = svc.update_draft(invoice_id, payload, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return InvoicePublic.model_validate(_to_public(inv, db))


@router.post(
    "/invoices/{invoice_id:int}/submit",
    response_model=InvoicePublic,
    dependencies=[Depends(require_permission("invoices.submit"))],
)
def submit_invoice(
    invoice_id: int,
    svc: Annotated[InvoiceService, Depends(_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> InvoicePublic:
    try:
        inv = svc.submit(invoice_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return InvoicePublic.model_validate(_to_public(inv, db))


@router.post(
    "/invoices/{invoice_id:int}/validate",
    response_model=InvoicePublic,
    dependencies=[Depends(require_permission("invoices.validate"))],
)
def validate_invoice(
    invoice_id: int,
    svc: Annotated[InvoiceService, Depends(_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> InvoicePublic:
    try:
        inv = svc.validate(invoice_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return InvoicePublic.model_validate(_to_public(inv, db))


@router.post(
    "/invoices/{invoice_id:int}/request-exception-approval",
    response_model=InvoicePublic,
    dependencies=[Depends(require_permission("invoices.submit"))],
)
def request_invoice_variance_approval(
    invoice_id: int,
    svc: Annotated[InvoiceService, Depends(_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> InvoicePublic:
    try:
        inv = svc.request_exception_approval(invoice_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return InvoicePublic.model_validate(_to_public(inv, db))


@router.patch(
    "/invoices/issues/{issue_id:int}/justification",
    dependencies=[Depends(require_permission("invoices.update"))],
)
def justify_issue(
    issue_id: int,
    payload: InvoiceIssueJustificationUpdate,
    svc: Annotated[InvoiceService, Depends(_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict:
    try:
        row = svc.update_issue_justification(issue_id, payload, actor_user_id=int(current.subject))
        return {"ok": True, "id": int(row.id)}
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post(
    "/invoices/{invoice_id:int}/attachments",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("invoices.update"))],
)
async def upload_attachment(
    invoice_id: int,
    request: Request,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
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
    path = save_invoice_attachment(invoice_id=int(invoice_id), filename=upload.filename or "attachment", content=raw)
    row = InvoiceAttachment(
        invoice_id=int(invoice_id),
        file_path=path,
        file_name=upload.filename,
        content_type=getattr(upload, "content_type", None),
        uploaded_by=int(current.subject),
    )
    db.add(row)
    db.commit()
    return {"ok": True, "id": int(row.id), "file_path": path}

