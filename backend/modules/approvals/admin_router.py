from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_permission, require_superuser
from db.session import get_db
from modules.approvals.schema import (
    ApprovalStepCreate,
    ApprovalWorkflowCreate,
    ApprovalWorkflowDetail,
    ApprovalWorkflowPublic,
)
from modules.approvals.service import ApprovalError, ApprovalWorkflowService
from modules.errors import ConflictError, NotFoundError

router = APIRouter(
    prefix="/approval-workflows",
    tags=["admin", "approval-workflows"],
    dependencies=[Depends(require_superuser()), Depends(require_permission("approval.manage"))],
)


def get_workflow_service(db: Session = Depends(get_db)) -> ApprovalWorkflowService:
    return ApprovalWorkflowService(db)


@router.post("", response_model=ApprovalWorkflowDetail, status_code=status.HTTP_201_CREATED)
def create_workflow(
    payload: ApprovalWorkflowCreate,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[ApprovalWorkflowService, Depends(get_workflow_service)],
) -> ApprovalWorkflowDetail:
    try:
        return svc.create_workflow(
            name=payload.name,
            entity_type=payload.entity_type,
            created_by=int(current.subject),
            is_active=payload.is_active,
        )
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("", response_model=list[ApprovalWorkflowDetail])
def list_workflows(
    svc: Annotated[ApprovalWorkflowService, Depends(get_workflow_service)],
) -> list[ApprovalWorkflowDetail]:
    return svc.list_workflows()


@router.post("/{workflow_id}/steps", response_model=dict, status_code=status.HTTP_201_CREATED)
def add_step(
    workflow_id: int,
    payload: ApprovalStepCreate,
    svc: Annotated[ApprovalWorkflowService, Depends(get_workflow_service)],
) -> dict:
    try:
        step = svc.add_step(
            workflow_id=workflow_id,
            step_order=payload.step_order,
            approver_role_id=payload.approver_role_id,
            required_approvals=payload.required_approvals,
        )
        return {"id": step.id}
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/{workflow_id}/steps/{step_id}", response_model=ApprovalWorkflowDetail)
def remove_step(
    workflow_id: int,
    step_id: int,
    svc: Annotated[ApprovalWorkflowService, Depends(get_workflow_service)],
) -> ApprovalWorkflowDetail:
    try:
        return svc.remove_step(workflow_id=workflow_id, step_id=step_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/{workflow_id}/activate", response_model=ApprovalWorkflowDetail)
def activate_workflow(
    workflow_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[ApprovalWorkflowService, Depends(get_workflow_service)],
) -> ApprovalWorkflowDetail:
    try:
        return svc.activate_workflow(workflow_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ApprovalError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.patch("/{workflow_id}/deactivate", response_model=ApprovalWorkflowDetail)
def deactivate_workflow(
    workflow_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[ApprovalWorkflowService, Depends(get_workflow_service)],
) -> ApprovalWorkflowDetail:
    try:
        return svc.deactivate_workflow(workflow_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ApprovalError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
