"""Read-only audit-style timelines for domain entities."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_permission
from db.session import get_db
from modules.approvals.service import ApprovalError
from modules.approvals.timeline_service import ApprovalTimelineService

router = APIRouter(prefix="/audit", tags=["audit"])


def get_timeline_service(db: Session = Depends(get_db)) -> ApprovalTimelineService:
    return ApprovalTimelineService(db)


@router.get("/entity/{entity_type}/{entity_id}")
def entity_timeline(
    entity_type: str,
    entity_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[ApprovalTimelineService, Depends(get_timeline_service)],
    _: Annotated[object, Depends(require_permission("approval.view"))],
) -> list[dict[str, Any]]:
    try:
        return svc.get_entity_timeline(
            path_entity_type=entity_type,
            entity_id=entity_id,
            viewer_id=int(current.subject),
        )
    except ApprovalError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
