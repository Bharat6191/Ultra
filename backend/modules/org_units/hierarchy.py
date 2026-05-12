"""Cluster → plant hierarchy helpers for ``org_units``.

Operational data (work orders, invoices, Part Master, contractor plant mappings)
remains **plant-scoped** (``type=PLANT``). Clusters (``type=CLUSTER``) group plants
via ``parent_id`` and are used for navigation, admin, and **list filters** that
expand to all descendant plants.
"""

from __future__ import annotations

from collections import deque

from sqlalchemy import select
from sqlalchemy.orm import Session

from modules.errors import ConflictError, NotFoundError
from modules.org_units.model import OrgUnit


def _norm_type(org: OrgUnit) -> str:
    return str(getattr(org, "type", None) or "").strip().upper()


def collect_plant_ids_under_scope(db: Session, org_unit_id: int) -> list[int]:
    """Return plant org-unit ids covered by this scope.

    * **PLANT** — ``[that id]``.
    * **CLUSTER** — all descendant org units of type PLANT (recursive through
      nested clusters).
    """
    root = db.get(OrgUnit, int(org_unit_id))
    if root is None:
        raise NotFoundError("OrgUnit", org_unit_id)
    t = _norm_type(root)
    if t == "PLANT":
        return [int(root.id)]
    if t == "CLUSTER":
        out: set[int] = set()
        q: deque[int] = deque([int(root.id)])
        while q:
            cur = q.popleft()
            children = list(db.scalars(select(OrgUnit).where(OrgUnit.parent_id == int(cur))).all())
            for ch in children:
                ct = _norm_type(ch)
                cid = int(ch.id)
                if ct == "PLANT":
                    out.add(cid)
                elif ct == "CLUSTER":
                    q.append(cid)
        return sorted(out)
    raise ConflictError(
        f"org_unit_id={org_unit_id} must reference a PLANT or CLUSTER (got type={t or 'unknown'})."
    )


def validate_org_unit_parent(db: Session, *, unit_type: str, parent_id: int | None) -> None:
    """Enforce cluster/plant parent rules on create."""
    ut = str(unit_type or "").strip().upper()
    if ut == "CLUSTER":
        if parent_id is None:
            return
        par = db.get(OrgUnit, int(parent_id))
        if par is None:
            raise NotFoundError("OrgUnit", parent_id)
        if _norm_type(par) != "CLUSTER":
            raise ConflictError("A cluster may only be parented under another cluster.")
        return
    if ut == "PLANT":
        if parent_id is None:
            return
        par = db.get(OrgUnit, int(parent_id))
        if par is None:
            raise NotFoundError("OrgUnit", parent_id)
        if _norm_type(par) != "CLUSTER":
            raise ConflictError("A plant must belong to a cluster (parent must be type CLUSTER).")
        return
