from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from modules.org_units.model import OrgUnit
from modules.org_units.schema import OrgUnitCreate


class OrgUnitService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def list_org_units(self, *, org_type: str | None = None) -> list[OrgUnit]:
        stmt = select(OrgUnit).order_by(OrgUnit.name.asc())
        if org_type:
            stmt = stmt.where(OrgUnit.type == org_type)
        return list(self._db.scalars(stmt).all())

    def create_org_unit(self, data: OrgUnitCreate) -> OrgUnit:
        row = OrgUnit(name=data.name.strip(), type=data.type.strip(), parent_id=data.parent_id)
        self._db.add(row)
        self._db.commit()
        self._db.refresh(row)
        return row
