from __future__ import annotations

from datetime import date, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import get_flat_permission_codes_for_user
from db.session import get_db
from modules.contractor.models import (
    Contractor,
    ContractorDocument,
    ContractorPlant,
)
from modules.contractor_rates.models import ContractorRate
from modules.part_master.models import PartMaster
from modules.org_units.model import OrgUnit
from modules.work_orders.models import WorkOrder
from modules.invoices.models import Invoice
from modules.dashboard.intelligence_service import DashboardIntelligenceService, IntelligenceFilters


router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _contractors_module(db: Session) -> dict[str, Any]:
    today = date.today()
    seven_days = today + timedelta(days=7)

    total_contractors = int(db.scalar(select(func.count()).select_from(Contractor)) or 0)
    active_contractors = int(
        db.scalar(select(func.count()).select_from(Contractor).where(Contractor.status == "active")) or 0
    )
    non_compliant = int(
        db.scalar(select(func.count()).select_from(Contractor).where(Contractor.status == "non_compliant")) or 0
    )
    suspended = int(
        db.scalar(select(func.count()).select_from(Contractor).where(Contractor.status == "suspended")) or 0
    )
    blacklisted = int(
        db.scalar(select(func.count()).select_from(Contractor).where(Contractor.status == "blacklisted")) or 0
    )
    pending = int(db.scalar(select(func.count()).select_from(Contractor).where(Contractor.status == "pending")) or 0)
    expiring_documents_7_days = int(
        db.scalar(
            select(func.count())
            .select_from(ContractorDocument)
            .where(
                ContractorDocument.expiry_date.is_not(None),
                ContractorDocument.expiry_date >= today,
                ContractorDocument.expiry_date <= seven_days,
            )
        )
        or 0
    )
    expired_documents = int(
        db.scalar(
            select(func.count())
            .select_from(ContractorDocument)
            .where(
                ContractorDocument.expiry_date.is_not(None),
                ContractorDocument.expiry_date < today,
            )
        )
        or 0
    )

    by_status_rows = db.execute(
        select(Contractor.status, func.count()).group_by(Contractor.status).order_by(Contractor.status.asc())
    ).all()
    by_status = [{"status": str(s or "unknown"), "count": int(c)} for s, c in by_status_rows]

    plants_rows = db.execute(
        select(OrgUnit.id, OrgUnit.name, func.count(ContractorPlant.id))
        .join(ContractorPlant, ContractorPlant.org_unit_id == OrgUnit.id)
        .group_by(OrgUnit.id, OrgUnit.name)
        .order_by(func.count(ContractorPlant.id).desc())
        .limit(8)
    ).all()
    contractors_by_plant = [
        {"org_unit_id": int(pid), "name": str(pname), "count": int(cnt)} for pid, pname, cnt in plants_rows
    ]

    return {
        "total": total_contractors,
        "active": active_contractors,
        "non_compliant": non_compliant,
        "suspended": suspended,
        "blacklisted": blacklisted,
        "pending": pending,
        "expiring_documents_7_days": expiring_documents_7_days,
        "expired_documents": expired_documents,
        "by_status": by_status,
        "contractors_by_plant": contractors_by_plant,
        "total_contractors": total_contractors,
        "documents_with_expiry": expiring_documents_7_days + expired_documents,
    }


def _contractor_rates_module(db: Session) -> dict[str, Any]:
    rate_status_rows = db.execute(select(ContractorRate.status, func.count()).group_by(ContractorRate.status)).all()
    by_rate_status: dict[str, int] = {str(s or "unknown"): int(c) for s, c in rate_status_rows}
    total_negotiations = sum(by_rate_status.values())
    pending_approvals = by_rate_status.get("pending_approval", 0)
    approved_count = by_rate_status.get("approved", 0)
    rejected_count = by_rate_status.get("rejected", 0)

    total_savings = db.scalar(
        select(func.coalesce(func.sum(ContractorRate.savings_amount), 0)).where(
            ContractorRate.status == "approved",
            ContractorRate.savings_amount.is_not(None),
        )
    ) or 0
    avg_savings_pct = db.scalar(
        select(func.coalesce(func.avg(ContractorRate.savings_percentage), 0)).where(
            ContractorRate.status == "approved",
            ContractorRate.savings_percentage.is_not(None),
        )
    ) or 0

    approved_above_base = 0
    approved_below_base = 0
    approved_at_base = 0
    total_premium_above_base = 0.0
    total_below_base_savings = 0.0
    try:
        rows = db.execute(
            select(ContractorRate.negotiated_rate, PartMaster.base_rate)
            .join(PartMaster, PartMaster.id == ContractorRate.part_master_id)
            .where(ContractorRate.status == "approved")
        ).all()
    except ProgrammingError:
        rows = []
    for negotiated, base in rows:
        if negotiated is None or base is None:
            continue
        diff = float(negotiated) - float(base)
        if diff > 0:
            approved_above_base += 1
            total_premium_above_base += diff
        elif diff < 0:
            approved_below_base += 1
            total_below_base_savings += -diff
        else:
            approved_at_base += 1

    return {
        "total_negotiations": total_negotiations,
        "pending_approvals": pending_approvals,
        "approved": approved_count,
        "rejected": rejected_count,
        "total_savings": float(total_savings or 0),
        "avg_savings_percentage": float(avg_savings_pct or 0),
        "total_premium_above_base": round(total_premium_above_base, 2),
        "total_below_base_savings": round(total_below_base_savings, 2),
        "approved_above_base": approved_above_base,
        "approved_below_base": approved_below_base,
        "approved_at_base": approved_at_base,
        "by_status": [{"status": k, "count": v} for k, v in sorted(by_rate_status.items())],
    }


def _work_orders_module(db: Session) -> dict[str, Any]:
    wo_by_status_rows = db.execute(select(WorkOrder.status, func.count()).group_by(WorkOrder.status)).all()
    wo_by_status: dict[str, int] = {str(s or "unknown"): int(c) for s, c in wo_by_status_rows}
    return {
        "total": int(sum(wo_by_status.values())),
        "active": int(wo_by_status.get("active", 0)),
        "pending_approval": int(wo_by_status.get("pending_approval", 0)),
        "draft": int(wo_by_status.get("draft", 0)),
        "by_status": [{"status": k, "count": v} for k, v in sorted(wo_by_status.items())],
    }


def _invoices_module(db: Session) -> dict[str, Any]:
    inv_by_status_rows = db.execute(select(Invoice.status, func.count()).group_by(Invoice.status)).all()
    inv_by_status: dict[str, int] = {str(s or "unknown"): int(c) for s, c in inv_by_status_rows}
    blocked = int(inv_by_status.get("blocked", 0))
    pending_ex = int(inv_by_status.get("pending_exception_approval", 0))
    draft = int(inv_by_status.get("draft", 0))
    total_value = float(db.scalar(select(func.coalesce(func.sum(Invoice.total_amount), 0)).select_from(Invoice)) or 0)
    pass_count = int(
        db.scalar(
            select(func.count())
            .select_from(Invoice)
            .where(Invoice.validation_status.in_(("pass", "warn")))
        )
        or 0
    )
    pass_value = float(
        db.scalar(
            select(func.coalesce(func.sum(Invoice.total_amount), 0))
            .select_from(Invoice)
            .where(Invoice.validation_status.in_(("pass", "warn")))
        )
        or 0
    )
    pending_ex_value = float(
        db.scalar(
            select(func.coalesce(func.sum(Invoice.total_amount), 0))
            .select_from(Invoice)
            .where(Invoice.status == "pending_exception_approval")
        )
        or 0
    )
    blocked_value = float(
        db.scalar(
            select(func.coalesce(func.sum(Invoice.total_amount), 0))
            .select_from(Invoice)
            .where(Invoice.status == "blocked")
        )
        or 0
    )
    return {
        "total": int(sum(inv_by_status.values())),
        "total_value": round(total_value, 2),
        "draft": draft,
        "pass": pass_count,
        "pass_value": round(pass_value, 2),
        "blocked": blocked,
        "blocked_value": round(blocked_value, 2),
        "pending_exception_approval": pending_ex,
        "pending_exception_approval_value": round(pending_ex_value, 2),
        "by_status": [{"status": k, "count": v} for k, v in sorted(inv_by_status.items())],
    }


@router.get("/summary")
def get_dashboard_summary(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """
    Workspace overview for all authenticated users (contractors, negotiations, work orders, invoices).
    """
    del current
    return {
        "modules": {
            "contractors": _contractors_module(db),
            "contractor_rates": _contractor_rates_module(db),
            "work_orders": _work_orders_module(db),
            "invoices": _invoices_module(db),
        }
    }


@router.get("/intelligence")
def get_dashboard_intelligence(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    date_from: date | None = None,
    date_to: date | None = None,
    plant_id: int | None = Query(default=None),
    contractor_id: int | None = Query(default=None),
    work_order_status: str | None = None,
    negotiation_status: str | None = None,
    invoice_status: str | None = None,
    part_pricing_method: str | None = None,
) -> dict[str, Any]:
    user_id = int(current.subject)
    grants = set(get_flat_permission_codes_for_user(db, user_id))
    flt = IntelligenceFilters(
        date_from=date_from,
        date_to=date_to,
        plant_id=plant_id,
        contractor_id=contractor_id,
        work_order_status=work_order_status,
        negotiation_status=negotiation_status,
        invoice_status=invoice_status,
        part_pricing_method=part_pricing_method,
    )
    return DashboardIntelligenceService(db).build(grants, flt)


@router.get("/intelligence/report")
def get_dashboard_intelligence_report(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    date_from: date | None = None,
    date_to: date | None = None,
    plant_id: int | None = Query(default=None),
    contractor_id: int | None = Query(default=None),
    work_order_status: str | None = None,
    negotiation_status: str | None = None,
    invoice_status: str | None = None,
    part_pricing_method: str | None = None,
    export_format: str = Query("xlsx", alias="format", description="xlsx supported; PDF from the UI."),
) -> Response:
    user_id = int(current.subject)
    grants = set(get_flat_permission_codes_for_user(db, user_id))
    flt = IntelligenceFilters(
        date_from=date_from,
        date_to=date_to,
        plant_id=plant_id,
        contractor_id=contractor_id,
        work_order_status=work_order_status,
        negotiation_status=negotiation_status,
        invoice_status=invoice_status,
        part_pricing_method=part_pricing_method,
    )
    if str(export_format).lower() not in ("xlsx", "excel"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only format=xlsx is available from the API. Use the in-app PDF export for print.",
        )
    try:
        data = DashboardIntelligenceService(db).build_xlsx(grants, flt)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    fname = "dashboard-intelligence.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
