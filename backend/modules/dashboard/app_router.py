from __future__ import annotations

from datetime import date, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import get_flat_permission_codes_for_user
from db.session import get_db
from modules.approvals.model import ApprovalTask
from modules.rbac_association import user_role
from modules.roles.model import Role
from modules.users.model import User
from modules.contractor.models import (
    Contractor,
    ContractorDocument,
    ContractorPlant,
)
from modules.contractor.compliance import evaluate_contractor_compliance
from modules.contractor_rates.models import ContractorRate, RateMaster
from modules.org_units.model import OrgUnit


router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _variants(code: str) -> set[str]:
    v = {code}
    if "." in code:
        v.add(code.replace(".", ":", 1))
    if ":" in code:
        v.add(code.replace(":", ".", 1))
    return v


def _has(grants: set[str], code: str) -> bool:
    return not grants.isdisjoint(_variants(code))


def _has_any(grants: set[str], *codes: str) -> bool:
    for c in codes:
        if _has(grants, c):
            return True
    return False


@router.get("/summary")
def get_dashboard_summary(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """
    Dynamic dashboard summary. Modules are enabled based on the caller's permission snapshot.
    """
    user_id = int(current.subject)
    grants = set(get_flat_permission_codes_for_user(db, user_id))

    has_users = _has(grants, "users.view")
    # UI currently gates tasks by `approval.view`, but backend tasks are under `task.*`.
    has_tasks = _has_any(grants, "approval.view", "task.view")
    has_contractors = _has_any(grants, "contractor.view", "contractor.create", "contractor.update")
    has_rates = _has_any(
        grants,
        "contractor_rates.view",
        "contractor_rates.create",
        "contractor_rates.update",
        "contractor_rates.approve",
    )

    modules: dict[str, Any] = {}

    if has_users:
        total_users = int(db.scalar(select(func.count()).select_from(User)) or 0)
        active_users = int(db.scalar(select(func.count()).select_from(User).where(User.is_active.is_(True))) or 0)
        inactive_users = total_users - active_users

        seven_days_ago = date.today() - timedelta(days=6)
        new_last_7_days = int(
            db.scalar(select(func.count()).select_from(User).where(func.date(User.created_at) >= seven_days_ago)) or 0
        )

        users_by_role_rows = db.execute(
            select(Role.name, func.count(func.distinct(user_role.c.user_id)))
            .select_from(user_role)
            .join(Role, Role.id == user_role.c.role_id)
            .group_by(Role.name)
            .order_by(Role.name.asc())
        ).all()
        users_by_role = [{"role": str(name), "count": int(cnt)} for name, cnt in users_by_role_rows]

        modules["users"] = {
            "total_users": total_users,
            "active_users": active_users,
            "inactive_users": inactive_users,
            "new_users_last_7_days": new_last_7_days,
            "users_by_role": users_by_role,
        }

    if has_tasks:
        # Viewer-scoped status stats for inbox
        base = (
            select(ApprovalTask.status, func.count())
            .select_from(ApprovalTask)
            .where((ApprovalTask.assigned_to_user_id == user_id) | (ApprovalTask.assigned_user_id == user_id))
            .group_by(ApprovalTask.status)
        )
        rows = db.execute(base).all()
        by_status: dict[str, int] = {str(s): int(c) for s, c in rows if s is not None}
        modules["tasks"] = {
            "pending": by_status.get("pending", 0),
            "approved": by_status.get("approved", 0),
            "rejected": by_status.get("rejected", 0),
            # "Completed" should reflect finished work:
            # - approval tasks: approved
            # - manual tasks: completed / closed
            "completed": by_status.get("approved", 0) + by_status.get("completed", 0) + by_status.get("closed", 0),
        }

    if has_contractors:
        today = date.today()
        seven_days = today + timedelta(days=7)

        total_contractors = int(db.scalar(select(func.count()).select_from(Contractor)) or 0)
        active_contractors = int(
            db.scalar(
                select(func.count())
                .select_from(Contractor)
                .where(Contractor.status == "active")
            )
            or 0
        )
        non_compliant = int(
            db.scalar(
                select(func.count())
                .select_from(Contractor)
                .where(Contractor.status == "non_compliant")
            )
            or 0
        )
        suspended = int(
            db.scalar(
                select(func.count())
                .select_from(Contractor)
                .where(Contractor.status == "suspended")
            )
            or 0
        )
        blacklisted = int(
            db.scalar(
                select(func.count())
                .select_from(Contractor)
                .where(Contractor.status == "blacklisted")
            )
            or 0
        )
        pending = int(
            db.scalar(
                select(func.count())
                .select_from(Contractor)
                .where(Contractor.status == "pending")
            )
            or 0
        )
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

        # By status (for donut)
        by_status_rows = db.execute(
            select(Contractor.status, func.count())
            .group_by(Contractor.status)
            .order_by(Contractor.status.asc())
        ).all()
        by_status = [
            {"status": str(s or "unknown"), "count": int(c)} for s, c in by_status_rows
        ]

        # Top plants by contractor count (bar)
        plants_rows = db.execute(
            select(OrgUnit.id, OrgUnit.name, func.count(ContractorPlant.id))
            .join(ContractorPlant, ContractorPlant.org_unit_id == OrgUnit.id)
            .group_by(OrgUnit.id, OrgUnit.name)
            .order_by(func.count(ContractorPlant.id).desc())
            .limit(8)
        ).all()
        contractors_by_plant = [
            {"org_unit_id": int(pid), "name": str(pname), "count": int(cnt)}
            for pid, pname, cnt in plants_rows
        ]

        modules["contractors"] = {
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
            # Backward-compat fields read by older clients.
            "total_contractors": total_contractors,
            "documents_with_expiry": expiring_documents_7_days + expired_documents,
        }

    if has_rates:
        # Aggregate KPIs for the negotiation workflow widget.
        rate_status_rows = db.execute(
            select(ContractorRate.status, func.count())
            .group_by(ContractorRate.status)
        ).all()
        by_rate_status: dict[str, int] = {str(s or "unknown"): int(c) for s, c in rate_status_rows}
        total_negotiations = sum(by_rate_status.values())
        pending_approvals = by_rate_status.get("pending_approval", 0)
        approved_count = by_rate_status.get("approved", 0)
        rejected_count = by_rate_status.get("rejected", 0)

        # Negotiation savings — anchored on the contractor's initial ask
        # (clamped at 0). This is procurement's "we shaved X off the opening
        # price" story and is always non-negative.
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

        # Vs-base metrics — signed differences against the procurement
        # baseline. Computed in Python because we want bucketed counts
        # (above/below/at) along with the totals, which is easier than three
        # separate aggregate queries.
        approved_above_base = 0
        approved_below_base = 0
        approved_at_base = 0
        total_premium_above_base = 0.0
        total_below_base_savings = 0.0
        for negotiated, base in db.execute(
            select(ContractorRate.negotiated_rate, RateMaster.base_rate)
            .join(RateMaster, RateMaster.id == ContractorRate.rate_master_id)
            .where(ContractorRate.status == "approved")
        ).all():
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

        modules["contractor_rates"] = {
            "total_negotiations": total_negotiations,
            "pending_approvals": pending_approvals,
            "approved": approved_count,
            "rejected": rejected_count,
            # Negotiation savings (initial ask -> final agreement, always >= 0).
            "total_savings": float(total_savings or 0),
            "avg_savings_percentage": float(avg_savings_pct or 0),
            # Vs-base KPIs (signed).
            "total_premium_above_base": round(total_premium_above_base, 2),
            "total_below_base_savings": round(total_below_base_savings, 2),
            "approved_above_base": approved_above_base,
            "approved_below_base": approved_below_base,
            "approved_at_base": approved_at_base,
            "by_status": [
                {"status": k, "count": v} for k, v in sorted(by_rate_status.items())
            ],
        }

    return {"modules": modules}

