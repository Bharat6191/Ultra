from __future__ import annotations

from datetime import date, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import get_flat_permission_codes_for_user
from db.session import get_db
from modules.approvals.model import ApprovalTask
from modules.org_units.model import OrgUnit
from modules.users.model import User


router = APIRouter(prefix="/dashboard", tags=["admin", "dashboard"])


def _permission_code_variants(required: str) -> set[str]:
    variants = {required}
    if "." in required:
        variants.add(required.replace(".", ":", 1))
    if ":" in required:
        variants.add(required.replace(":", ".", 1))
    return variants


def _has_any(grants: set[str], *codes: str) -> bool:
    for c in codes:
        if not grants.isdisjoint(_permission_code_variants(c)):
            return True
    return False


def _has(grants: set[str], code: str) -> bool:
    return not grants.isdisjoint(_permission_code_variants(code))


def _scalar_int(db: Session, stmt: Select[Any]) -> int:
    return int(db.scalar(stmt) or 0)


def _last_n_days_counts(
    db: Session,
    *,
    column,
    select_from,
    n_days: int,
    whereclause=None,
) -> list[int]:
    """
    Return counts for the last N days (including today) as a fixed-length list.

    Uses ``func.date(...)`` so it works on SQLite and Postgres in most setups.
    """
    start = date.today() - timedelta(days=n_days - 1)
    day_expr = func.date(column)
    stmt = select(day_expr, func.count()).select_from(select_from).where(day_expr >= start).group_by(day_expr)
    if whereclause is not None:
        stmt = stmt.where(whereclause)
    rows = db.execute(stmt).all()
    by_day: dict[str, int] = {str(d): int(c) for d, c in rows if d is not None}
    out: list[int] = []
    for i in range(n_days):
        d = start + timedelta(days=i)
        out.append(by_day.get(str(d), 0))
    return out


@router.get("/summary")
def dashboard_summary(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    user_id = int(current.subject)
    grants = set(get_flat_permission_codes_for_user(db, user_id))

    can_users = _has(grants, "users.view")
    can_plants = _has_any(grants, "org_units.view", "org_units.create", "org_units.update", "org_units.delete")
    can_tasks = _has(grants, "approval.view")
    can_roles = _has_any(grants, "roles.view", "roles.create", "roles.update")
    can_permissions = _has_any(grants, "permissions.view", "permissions.create")
    can_settings = _has(grants, "settings.update")

    counts: dict[str, int | None] = {
        "users_total": None,
        "users_active": None,
        "plants_total": None,
        "my_pending_tasks": None,
    }
    series: dict[str, list[int] | None] = {
        "users_created_last_7_days": None,
        "my_tasks_created_last_7_days": None,
    }

    if can_users:
        counts["users_total"] = _scalar_int(db, select(func.count()).select_from(User))
        counts["users_active"] = _scalar_int(db, select(func.count()).select_from(User).where(User.is_active.is_(True)))
        series["users_created_last_7_days"] = _last_n_days_counts(db, column=User.created_at, select_from=User, n_days=7)

    if can_plants:
        counts["plants_total"] = _scalar_int(db, select(func.count()).select_from(OrgUnit))

    if can_tasks:
        counts["my_pending_tasks"] = _scalar_int(
            db,
            select(func.count())
            .select_from(ApprovalTask)
            .where(
                ApprovalTask.status == "pending",
                (ApprovalTask.assigned_to_user_id == user_id) | (ApprovalTask.assigned_user_id == user_id),
            ),
        )
        # No created_at on ApprovalTask currently; keep this stable for UI.
        series["my_tasks_created_last_7_days"] = [0, 0, 0, 0, 0, 0, 0]

    return {
        "capabilities": {
            "users": can_users,
            "plants": can_plants,
            "tasks": can_tasks,
            "roles": can_roles,
            "permissions": can_permissions,
            "settings": can_settings,
        },
        "counts": counts,
        "series": series,
    }

