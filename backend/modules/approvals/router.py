from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import _get_cached_permission_snapshot, _has_any_permission, require_permission
from db.session import get_db
from modules.approvals.inbox_service import ApprovalInboxService
from modules.approvals.schema import (
    ApprovalRequestPublic,
    ApprovalRequestStatusDetailPublic,
    ApprovalTaskActionRequest,
    ApprovalTaskCommentRequest,
    MyApprovalTaskItem,
    ResubmitRejectedResponse,
)
from modules.approvals.service import ApprovalEngineService, ApprovalError
from modules.errors import ConflictError, NotFoundError
from modules.approvals.model import ApprovalAction, ApprovalTask, TaskAuditLog, TaskComment
from modules.approvals.inbox_service import _viewer_can_access_request

router = APIRouter(prefix="/approvals", tags=["approvals"])

APPROVAL_ACTION_PERMISSION_CODES_BY_ENTITY_TYPE: dict[str, tuple[str, ...]] = {
    "contractor_rate_approval": ("contractor_rates.approve",),
    "work_order_approval": ("work_orders.approve",),
    "work_order_rate_override": ("work_orders.approve",),
    "invoice_exception_approval": ("invoices.approve_exceptions",),
}


def get_engine(db: Session = Depends(get_db)) -> ApprovalEngineService:
    return ApprovalEngineService(db)


def get_inbox(db: Session = Depends(get_db)) -> ApprovalInboxService:
    return ApprovalInboxService(db)


def _approval_action_permission_codes(entity_type: str | None) -> tuple[str, ...]:
    codes = ["approval.act"]
    if entity_type:
        codes.extend(APPROVAL_ACTION_PERMISSION_CODES_BY_ENTITY_TYPE.get(str(entity_type), ()))
    return tuple(dict.fromkeys(codes))


def require_task_action_permission(
    task_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> CurrentUser:
    task = db.get(ApprovalTask, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    try:
        user_id = int(current.subject)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token subject",
        ) from exc

    snapshot = _get_cached_permission_snapshot(db, user_id)
    entity_type = str(task.request.entity_type) if task.request is not None else None
    allowed_codes = _approval_action_permission_codes(entity_type)

    if not _has_any_permission(snapshot, allowed_codes):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
    return current


@router.get("/my-tasks", response_model=list[MyApprovalTaskItem])
def my_tasks(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    inbox: Annotated[ApprovalInboxService, Depends(get_inbox)],
    _: Annotated[object, Depends(require_permission("approval.view"))],
) -> list[MyApprovalTaskItem]:
    rows = inbox.get_my_tasks_enriched(user_id=int(current.subject))
    return [MyApprovalTaskItem.model_validate(r) for r in rows]


@router.get("/requests/{request_id}", response_model=ApprovalRequestPublic)
def get_request(
    request_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[ApprovalEngineService, Depends(get_engine)],
    _: Annotated[object, Depends(require_permission("approval.view"))],
) -> ApprovalRequestPublic:
    try:
        req = svc.get_request(request_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    uid = int(current.subject)
    # Allow creator, direct assignee, or member of the assigned role/group.
    viewer_role_ids = svc._role_ids_for_user(uid)  # service-layer helper; keeps logic centralized
    if req.created_by != uid and all(
        (t.assigned_user_id != uid)
        and (t.assigned_role_id is None or int(t.assigned_role_id) not in viewer_role_ids)
        for t in req.tasks
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
    return req


@router.post(
    "/requests/{request_id}/resubmit",
    response_model=ResubmitRejectedResponse,
    status_code=status.HTTP_200_OK,
)
def resubmit_rejected(
    request_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[ApprovalEngineService, Depends(get_engine)],
) -> ResubmitRejectedResponse:
    """Submitter re-opens a rejected/in-rework user-creation approval and restarts at step 1."""
    try:
        _req, new_task_id = svc.resubmit_rejected_request(
            request_id=request_id, actor_user_id=int(current.subject)
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ApprovalError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message) from exc
    return ResubmitRejectedResponse(request_id=int(request_id), new_task_id=int(new_task_id), status="pending")


@router.get("/requests/{request_id}/status", response_model=ApprovalRequestStatusDetailPublic)
def get_request_status(
    request_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    inbox: Annotated[ApprovalInboxService, Depends(get_inbox)],
    _: Annotated[object, Depends(require_permission("approval.view"))],
) -> ApprovalRequestStatusDetailPublic:
    try:
        data = inbox.get_request_status(request_id=request_id, viewer_id=int(current.subject))
        return ApprovalRequestStatusDetailPublic(**data)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ApprovalError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.post("/tasks/{task_id}/action", response_model=ApprovalRequestPublic)
def act_on_task(
    task_id: int,
    payload: ApprovalTaskActionRequest,
    current: Annotated[CurrentUser, Depends(require_task_action_permission)],
    svc: Annotated[ApprovalEngineService, Depends(get_engine)],
) -> ApprovalRequestPublic:
    try:
        return svc.act_on_task(
            task_id=task_id,
            actor_user_id=int(current.subject),
            action=payload.action,
            comment=payload.comment,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ApprovalError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/tasks/{task_id}/comment", status_code=status.HTTP_201_CREATED)
def add_task_comment(
    task_id: int,
    payload: ApprovalTaskCommentRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    _: Annotated[object, Depends(require_permission("approval.view"))],
    db: Session = Depends(get_db),
) -> dict:
    task = db.get(ApprovalTask, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if not _viewer_can_access_request(db, request_id=int(task.request_id), viewer_id=int(current.subject)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
    act = ApprovalAction(
        task_id=int(task.id),
        user_id=int(current.subject),
        action="comment",
        comment=payload.comment,
    )
    db.add(act)
    db.add(TaskComment(task_id=int(task.id), user_id=int(current.subject), comment=payload.comment))
    db.add(
        TaskAuditLog(
            task_id=int(task.id),
            action="commented",
            actor_user_id=int(current.subject),
            new_value={"comment": payload.comment},
        )
    )
    db.commit()
    return {"ok": True}
