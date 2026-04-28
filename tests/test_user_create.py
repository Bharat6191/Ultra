from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from db.base import Base
from modules.auth.model import UserSession  # noqa: F401
from modules.features.model import Feature  # noqa: F401
from modules.org_units.model import OrgUnit
from modules.permissions.model import Permission
from modules.roles.model import Role
from modules.users.model import User
from modules.users.schema import UserCreate
from modules.users.service import DuplicatePhoneError, UserService


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    with SessionLocal() as session:
        yield session


def test_create_user_assigns_role_and_org(db: Session) -> None:
    plant = OrgUnit(name="Plant A", type="PLANT")
    role = Role(name="Operator", description=None)
    db.add_all([plant, role])
    db.commit()
    db.refresh(plant)
    db.refresh(role)

    svc = UserService(db)
    user = svc.create_user(
        UserCreate(
            full_name="Alice Example",
            username="alice.example",
            phone="+15550000001",
            password="GoodPass1!",
            email="alice@example.com",
            role_id=role.id,
            org_unit_id=plant.id,
        )
    )
    assert user.id > 0
    assert user.phone == "+15550000001"
    assert len(user.roles) == 1
    assert user.roles[0].id == role.id
    assert len(user.org_units) == 1
    assert user.org_units[0].id == plant.id


def test_duplicate_phone_fails(db: Session) -> None:
    plant = OrgUnit(name="Plant A", type="PLANT")
    role = Role(name="Operator", description=None)
    db.add_all([plant, role])
    db.commit()
    db.refresh(plant)
    db.refresh(role)

    svc = UserService(db)
    svc.create_user(
        UserCreate(
            full_name="A",
            username="user.a",
            phone="+15550000002",
            password="GoodPass1!",
            email="a@example.com",
            role_id=role.id,
            org_unit_id=plant.id,
        )
    )
    with pytest.raises(DuplicatePhoneError):
        svc.create_user(
            UserCreate(
                full_name="B",
                username="user.b",
                phone="+15550000002",
                password="GoodPass2!",
                email="b@example.com",
                role_id=role.id,
                org_unit_id=plant.id,
            )
        )


def test_missing_role_fails(db: Session) -> None:
    plant = OrgUnit(name="Plant A", type="PLANT")
    db.add(plant)
    db.commit()
    db.refresh(plant)

    svc = UserService(db)
    from modules.errors import NotFoundError

    with pytest.raises(NotFoundError):
        svc.create_user(
            UserCreate(
                full_name="A",
                username="user.missingrole",
                phone="+15550000003",
                password="GoodPass1!",
                email="missingrole@example.com",
                role_id=999,
                org_unit_id=plant.id,
            )
        )
