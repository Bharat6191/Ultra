"""Superadmin APIs: map RBAC action codes (permission codes) to approval workflows."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_permission, require_superuser
from db.session import get_db
from modules.approvals.assignment_service import WorkflowMappingService
from modules.approvals.schema import PermissionActionOption, WorkflowMappingCreate, WorkflowMappingPublic
from modules.errors import ConflictError, NotFoundError

router = APIRouter(
    prefix="/workflow-mappings",
    tags=["admin", "workflow-mappings"],
    dependencies=[Depends(require_superuser()), Depends(require_permission("approval.manage"))],
)


def get_mapping_service(db: Session = Depends(get_db)) -> WorkflowMappingService:
    return WorkflowMappingService(db)


@router.get("/action-codes", response_model=list[PermissionActionOption])
def list_action_codes(
    svc: Annotated[WorkflowMappingService, Depends(get_mapping_service)],
) -> list[PermissionActionOption]:
    """All permission codes from the catalog (each row belongs to a feature)."""
    rows = svc.list_action_codes()
    return [PermissionActionOption(**r) for r in rows]


@router.get("", response_model=list[WorkflowMappingPublic])
def list_mappings(
    svc: Annotated[WorkflowMappingService, Depends(get_mapping_service)],
    active_only: bool = Query(False),
) -> list[WorkflowMappingPublic]:
    out: list[WorkflowMappingPublic] = []
    for m in svc.list_mappings(active_only=active_only):
        wn = m.workflow.name if m.workflow is not None else None
        out.append(
            WorkflowMappingPublic(
                id=m.id,
                action_code=m.action_code,
                workflow_id=m.workflow_id,
                workflow_name=wn,
                is_active=m.is_active,
                created_at=m.created_at,
            )
        )
    return out


@router.post("", response_model=WorkflowMappingPublic, status_code=status.HTTP_201_CREATED)
def create_mapping(
    payload: WorkflowMappingCreate,
    _: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[WorkflowMappingService, Depends(get_mapping_service)],
) -> WorkflowMappingPublic:
    try:
        m = svc.create_mapping(action_code=payload.action_code, workflow_id=payload.workflow_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    wn = m.workflow.name if m.workflow is not None else None
    return WorkflowMappingPublic(
        id=m.id,
        action_code=m.action_code,
        workflow_id=m.workflow_id,
        workflow_name=wn,
        is_active=m.is_active,
        created_at=m.created_at,
    )
