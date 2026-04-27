from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from core.permissions import require_any_permission, require_permission
from db.session import get_db
from modules.org_units.model import OrgUnit
from modules.org_units.schema import OrgUnitCreate, OrgUnitPublic
from modules.org_units.service import OrgUnitService

router = APIRouter(prefix="/org-units", tags=["admin", "org-units"])


def get_org_unit_service(db: Session = Depends(get_db)) -> OrgUnitService:
    return OrgUnitService(db)


@router.get("", response_model=list[OrgUnitPublic])
def list_org_units(
    svc: Annotated[OrgUnitService, Depends(get_org_unit_service)],
    _: Annotated[
        object,
        Depends(
            require_any_permission(
                "org_units.view",
                "users.create",
                "users.update",
                "roles.create",
                "roles.update",
            )
        ),
    ],
    org_type: str | None = Query(None, alias="type"),
) -> list[OrgUnit]:
    return svc.list_org_units(org_type=org_type)


@router.post("", response_model=OrgUnitPublic, status_code=status.HTTP_201_CREATED)
def create_org_unit(
    payload: OrgUnitCreate,
    svc: Annotated[OrgUnitService, Depends(get_org_unit_service)],
    _: Annotated[object, Depends(require_permission("org_units.create"))],
) -> OrgUnit:
    return svc.create_org_unit(payload)
