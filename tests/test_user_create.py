from __future__ import annotations

import pytest
from pydantic import ValidationError
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


@pytest.fixture(autouse=True)
def isolate_user_service_side_effects(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("modules.users.service.validate_password", lambda _: None)
    monkeypatch.setattr("modules.users.service.maybe_send_mfa_setup_for_user", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("modules.users.service.EmailNotificationService.trigger_event", lambda *_args, **_kwargs: None)


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
            phone="6555000001",
            email="alice@example.com",
            role_id=role.id,
            org_unit_id=plant.id,
        )
    )
    assert user.id > 0
    assert user.phone == "6555000001"
    assert len(user.roles) == 1
    assert user.roles[0].id == role.id
    assert len(user.org_units) == 1
    assert user.org_units[0].id == plant.id


def test_create_user_multiple_roles(db: Session) -> None:
    plant = OrgUnit(name="Plant A", type="PLANT")
    r1 = Role(name="Operator", description=None)
    r2 = Role(name="Auditor", description=None)
    db.add_all([plant, r1, r2])
    db.commit()
    db.refresh(plant)
    db.refresh(r1)
    db.refresh(r2)

    svc = UserService(db)
    user = svc.create_user(
        UserCreate(
            full_name="Bob Multi",
            username="bob.multi",
            phone="7555000009",
            email="bob@example.com",
            role_ids=[r1.id, r2.id],
            org_unit_id=plant.id,
        )
    )
    assert sorted(r.id for r in user.roles) == sorted([r1.id, r2.id])


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
            phone="8555000002",
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
                phone="8555000002",
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
                phone="9555000003",
                email="missingrole@example.com",
                role_id=999,
                org_unit_id=plant.id,
            )
        )


def test_phone_must_start_between_6_and_9() -> None:
    with pytest.raises(ValidationError):
        UserCreate(
            full_name="Bad Phone",
            username="bad.phone",
            phone="5555000003",
            email="badphone@example.com",
            role_id=1,
            org_unit_id=1,
        )


def test_create_user_can_start_inactive_without_workflow(db: Session) -> None:
    plant = OrgUnit(name="Plant A", type="PLANT")
    role = Role(name="Operator", description=None)
    db.add_all([plant, role])
    db.commit()
    db.refresh(plant)
    db.refresh(role)

    svc = UserService(db)
    user = svc.create_user(
        UserCreate(
            full_name="Inactive User",
            username="inactive.user",
            phone="9555000004",
            email="inactive@example.com",
            role_id=role.id,
            org_unit_id=plant.id,
            is_active=False,
        )
    )

    assert user.is_active is False
