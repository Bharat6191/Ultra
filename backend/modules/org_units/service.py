from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from modules.org_units.hierarchy import validate_org_unit_parent
from modules.org_units.model import OrgUnit
from modules.errors import ConflictError, NotFoundError
from modules.org_units.schema import OrgUnitCreate, OrgUnitPatch


class OrgUnitService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def list_org_units(self, *, org_type: str | None = None) -> list[OrgUnit]:
        stmt = select(OrgUnit).order_by(OrgUnit.name.asc())
        if org_type:
            stmt = stmt.where(OrgUnit.type == str(org_type).strip().upper())
        return list(self._db.scalars(stmt).all())

    def create_org_unit(self, data: OrgUnitCreate) -> OrgUnit:
        t = data.type.strip().upper()
        validate_org_unit_parent(self._db, unit_type=t, parent_id=data.parent_id)
        row = OrgUnit(name=data.name.strip(), type=t, parent_id=data.parent_id)
        self._db.add(row)
        self._db.commit()
        self._db.refresh(row)
        return row

    def update_org_unit(self, org_unit_id: int, payload: OrgUnitPatch) -> OrgUnit:
        row = self._db.get(OrgUnit, int(org_unit_id))
        if row is None:
            raise NotFoundError("OrgUnit", org_unit_id)
        updates = payload.model_dump(exclude_unset=True)
        if not updates:
            raise ConflictError("No fields to update.")
        ut = str(row.type or "").strip().upper()
        if "name" in updates:
            nm = updates["name"]
            if nm is None or not str(nm).strip():
                raise ConflictError("name cannot be empty.")
            row.name = str(nm).strip()
        if "parent_id" in updates:
            new_parent: int | None = updates["parent_id"]
            validate_org_unit_parent(self._db, unit_type=ut, parent_id=new_parent)
            row.parent_id = new_parent
        self._db.commit()
        self._db.refresh(row)
        return row
