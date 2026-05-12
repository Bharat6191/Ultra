from __future__ import annotations

import uuid

import pytest

import db.models  # noqa: F401
from db.session import SessionLocal
from modules.errors import ConflictError
from modules.org_units.hierarchy import collect_plant_ids_under_scope, validate_org_unit_parent
from modules.org_units.model import OrgUnit
from modules.org_units.schema import OrgUnitCreate, OrgUnitPatch
from modules.org_units.service import OrgUnitService


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _cleanup_org_units(db, *ids: int) -> None:
    for oid in sorted(set(ids), reverse=True):
        row = db.get(OrgUnit, int(oid))
        if row is not None:
            db.delete(row)
    db.commit()


def test_collect_plant_ids_under_nested_clusters(db):
    u = uuid.uuid4().hex[:8]
    c1 = OrgUnit(name=f"T C1 {u}", type="CLUSTER")
    db.add(c1)
    db.flush()
    c2 = OrgUnit(name=f"T C2 {u}", type="CLUSTER", parent_id=int(c1.id))
    db.add(c2)
    db.flush()
    p1 = OrgUnit(name=f"T P1 {u}", type="PLANT", parent_id=int(c2.id))
    p2 = OrgUnit(name=f"T P2 {u}", type="PLANT", parent_id=int(c1.id))
    db.add_all([p1, p2])
    db.commit()
    try:
        assert sorted(collect_plant_ids_under_scope(db, int(c1.id))) == sorted([int(p1.id), int(p2.id)])
        assert collect_plant_ids_under_scope(db, int(p1.id)) == [int(p1.id)]
        assert collect_plant_ids_under_scope(db, int(c2.id)) == [int(p1.id)]
    finally:
        _cleanup_org_units(db, int(p1.id), int(p2.id), int(c2.id), int(c1.id))


def test_validate_plant_parent_must_be_cluster(db):
    u = uuid.uuid4().hex[:8]
    parent_plant = OrgUnit(name=f"T PP {u}", type="PLANT")
    db.add(parent_plant)
    db.commit()
    try:
        with pytest.raises(ConflictError):
            validate_org_unit_parent(db, unit_type="PLANT", parent_id=int(parent_plant.id))
    finally:
        _cleanup_org_units(db, int(parent_plant.id))


def test_validate_cluster_parent_must_be_cluster(db):
    u = uuid.uuid4().hex[:8]
    plant = OrgUnit(name=f"T P {u}", type="PLANT")
    db.add(plant)
    db.commit()
    try:
        with pytest.raises(ConflictError):
            validate_org_unit_parent(db, unit_type="CLUSTER", parent_id=int(plant.id))
    finally:
        _cleanup_org_units(db, int(plant.id))


def test_update_org_unit_sets_plant_parent(db):
    u = uuid.uuid4().hex[:8]
    svc = OrgUnitService(db)
    cluster = svc.create_org_unit(OrgUnitCreate(name=f"T Cl {u}", type="CLUSTER", parent_id=None))
    plant = svc.create_org_unit(OrgUnitCreate(name=f"T Pl {u}", type="PLANT", parent_id=None))
    try:
        out = svc.update_org_unit(int(plant.id), OrgUnitPatch(parent_id=int(cluster.id)))
        assert int(out.parent_id or 0) == int(cluster.id)
        cleared = svc.update_org_unit(int(plant.id), OrgUnitPatch(parent_id=None))
        assert cleared.parent_id is None
    finally:
        _cleanup_org_units(db, int(plant.id), int(cluster.id))


def test_org_unit_service_normalizes_type_and_allows_cluster_then_plant(db):
    u = uuid.uuid4().hex[:8]
    svc = OrgUnitService(db)
    cluster = svc.create_org_unit(OrgUnitCreate(name=f"T Cl {u}", type="cluster", parent_id=None))
    plant = svc.create_org_unit(OrgUnitCreate(name=f"T Pl {u}", type="plant", parent_id=int(cluster.id)))
    try:
        assert str(cluster.type).upper() == "CLUSTER"
        assert str(plant.type).upper() == "PLANT"
        assert int(plant.parent_id or 0) == int(cluster.id)
    finally:
        _cleanup_org_units(db, int(plant.id), int(cluster.id))
