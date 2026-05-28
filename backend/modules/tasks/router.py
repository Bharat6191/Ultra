from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_any_permission, require_permission
from db.session import get_db
from modules.errors import NotFoundError
from modules.tasks.schema import (
    TaskAssignRequest,
    TaskCommentCreateRequest,
    TaskCreateRequest,
    TaskDetailPublic,
    TaskInboxItem,
)
from modules.approvals.model import ApprovalTask as ApprovalTaskModel
from modules.tasks.service import TaskService, build_task_detail_public


def _friendly_approval_inbox_title(task: ApprovalTaskModel) -> str | None:
    """Human-readable inbox title using request payload when the task row has no explicit title."""
    if str(task.task_type) != "approval" or task.request is None:
        return None
    req = task.request
    pl = req.payload if isinstance(req.payload, dict) else {}
    et = req.entity_type
    if et == "work_order_approval":
        wn = str(pl.get("work_order_number") or "").strip()
        ttl = str(pl.get("title") or "").strip()
        base = [x for x in (wn, ttl) if x]
        if base:
            return "Approve work order · " + " · ".join(base)
        return f"Approve work order · #{req.entity_id}"
    if et == "work_order_rate_override":
        wn = str(pl.get("work_order_number") or "").strip()
        jl = ""
        ln = pl.get("line")
        if isinstance(ln, dict) and ln.get("job_type"):
            jl = str(ln.get("job_type")).strip()
        ore = str(pl.get("override_rate") or "").strip()
        bits = []
        if wn:
            bits.append(wn)
        if jl:
            bits.append(jl)
        if ore:
            bits.append(f"→ {ore}")
        if bits:
            return "Approve rate override · " + " · ".join(bits)
        return "Approve governed rate override"
    if et == "invoice_exception_approval":
        invn = str(pl.get("invoice_number") or "").strip()
        vst = str(pl.get("validation_status") or "").strip()
        base = [x for x in (invn, vst) if x]
        if base:
            return "Approve invoice exception · " + " · ".join(base)
        return f"Approve invoice exception · #{req.entity_id}"
    if et == "contractor_rate_approval":
        return "Approve negotiated rate"
    if et in ("contractor_creation", "contractor_activation"):
        return "Approve contractor onboarding"
    if et == "contractor_update":
        return "Approve contractor update"
    if et == "user_creation":
        nm = str(pl.get("full_name") or "").strip()
        return f"Approve new user{f' · {nm}' if nm else ''}"
    return None


router = APIRouter(prefix="/tasks", tags=["tasks"])

TASK_INBOX_PERMISSION_CODES = (
    "task.view",
    "task.act",
    "task.close",
    "approval.view",
    "approval.act",
    "contractor_rates.approve",
    "work_orders.approve",
    "invoices.approve_exceptions",
)


def get_task_service(db: Session = Depends(get_db)) -> TaskService:
    return TaskService(db)


@router.get("/my-tasks", response_model=list[TaskInboxItem])
def my_tasks(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TaskService, Depends(get_task_service)],
    _: Annotated[
        object,
        Depends(require_any_permission(*TASK_INBOX_PERMISSION_CODES)),
    ],
    status_filter: str | None = Query(default=None, alias="status"),
    task_type: str | None = Query(default=None),
    due_before: datetime | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    inbox: str = Query(
        default="active",
        pattern="^(active|done)$",
        description="``active`` = work that needs your attention. ``done`` = finished (approved, rejected, completed, closed).",
    ),
) -> list[TaskInboxItem]:
    rows = svc.my_tasks(
        viewer_id=int(current.subject),
        status=status_filter,
        task_type=task_type,
        due_before=due_before,
        limit=limit,
        inbox=inbox,
    )
    out: list[TaskInboxItem] = []
    for t in rows:
        title = t.title
        if not title:
            nicer = _friendly_approval_inbox_title(t)
            title = nicer
        if not title:
            if str(t.task_type) == "approval" and t.request is not None:
                title = f"Approval: {t.request.entity_type} #{t.request.entity_id}"
            elif str(t.task_type) == "manual":
                title = "Manual task"
            else:
                title = "Task"
        ent_type = t.entity_type
        ent_id = t.entity_id
        if t.request is not None:
            ent_type = ent_type or t.request.entity_type
            ent_id = ent_id if ent_id is not None else t.request.entity_id
        out.append(
            TaskInboxItem(
                id=int(t.id),
                task_type=str(t.task_type),
                title=title,
                status=t.status,
                assigned_to_user_id=t.assigned_to_user_id,
                due_date=t.due_date,
                request_id=t.request_id,
                step_id=t.step_id,
                entity_type=ent_type,
                entity_id=ent_id,
            )
        )
    return out


@router.get("/{task_id}", response_model=TaskDetailPublic)
def get_task(
    task_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TaskService, Depends(get_task_service)],
    _: Annotated[
        object,
        Depends(require_any_permission(*TASK_INBOX_PERMISSION_CODES)),
    ],
    db: Session = Depends(get_db),
) -> TaskDetailPublic:
    try:
        t = svc.get_task(task_id=task_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    if not svc.viewer_can_access_task(task=t, viewer_id=int(current.subject)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")

    return build_task_detail_public(db, t)


@router.post("", response_model=TaskDetailPublic, status_code=status.HTTP_201_CREATED)
def create_task(
    payload: TaskCreateRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TaskService, Depends(get_task_service)],
    _: Annotated[object, Depends(require_permission("task.create"))],
    db: Session = Depends(get_db),
) -> TaskDetailPublic:
    t = svc.create_manual_task(
        actor_user_id=int(current.subject),
        title=payload.title,
        description=payload.description,
        assigned_to_user_id=payload.assigned_to,
        due_date=payload.due_date,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        form_schema=payload.form_schema,
        form_data=payload.form_data,
    )
    return build_task_detail_public(db, t)


@router.post("/{task_id}/assign", response_model=TaskDetailPublic)
def assign_task(
    task_id: int,
    payload: TaskAssignRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TaskService, Depends(get_task_service)],
    _: Annotated[object, Depends(require_permission("task.assign"))],
    db: Session = Depends(get_db),
) -> TaskDetailPublic:
    t = svc.assign(task_id=task_id, actor_user_id=int(current.subject), assigned_to_user_id=payload.assigned_to)
    return build_task_detail_public(db, t)


@router.post("/{task_id}/start", response_model=TaskDetailPublic)
def start_task(
    task_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TaskService, Depends(get_task_service)],
    _: Annotated[object, Depends(require_permission("task.act"))],
    db: Session = Depends(get_db),
) -> TaskDetailPublic:
    t = svc.start(task_id=task_id, actor_user_id=int(current.subject))
    return build_task_detail_public(db, t)


@router.post("/{task_id}/complete", response_model=TaskDetailPublic)
def complete_task(
    task_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TaskService, Depends(get_task_service)],
    _: Annotated[object, Depends(require_permission("task.act"))],
    db: Session = Depends(get_db),
) -> TaskDetailPublic:
    t = svc.complete(task_id=task_id, actor_user_id=int(current.subject))
    return build_task_detail_public(db, t)


@router.post("/{task_id}/close", response_model=TaskDetailPublic)
def close_task(
    task_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TaskService, Depends(get_task_service)],
    _: Annotated[object, Depends(require_permission("task.close"))],
    db: Session = Depends(get_db),
) -> TaskDetailPublic:
    t = svc.close(task_id=task_id, actor_user_id=int(current.subject))
    return build_task_detail_public(db, t)


@router.post("/{task_id}/comments", status_code=status.HTTP_201_CREATED)
def add_comment(
    task_id: int,
    payload: TaskCommentCreateRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[TaskService, Depends(get_task_service)],
    _: Annotated[
        object,
        Depends(require_any_permission(*TASK_INBOX_PERMISSION_CODES)),
    ],
) -> dict:
    try:
        t = svc.get_task(task_id=task_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if not svc.viewer_can_access_task(task=t, viewer_id=int(current.subject)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")

    svc.add_comment(task_id=task_id, actor_user_id=int(current.subject), comment=payload.comment)
    return {"ok": True}
