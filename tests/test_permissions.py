from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from core.auth import CurrentUser
from core.permissions import invalidate_permission_cache, require_permission
from db.base import Base
from modules.auth.model import UserSession  # noqa: F401
from modules.features.model import Feature
from modules.permissions.model import Permission
from modules.roles.model import Role
from modules.users.model import User


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    # Ensure all models are registered on Base.metadata
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    with SessionLocal() as session:
        invalidate_permission_cache()
        yield session


def _mk_user(*, email: str, is_superuser: bool) -> User:
    return User(
        full_name=email.split("@", 1)[0],
        email=email,
        phone=f"+1555{abs(hash(email)) % 10_000_000:07d}",
        hashed_password="x",
        password_changed_at=datetime.now(timezone.utc),
        is_superuser=is_superuser,
    )


def test_user_without_permission_gets_403(db: Session) -> None:
    user = _mk_user(email="u1@example.com", is_superuser=False)
    db.add(user)
    db.commit()
    db.refresh(user)

    checker = require_permission("users:view")
    with pytest.raises(Exception) as excinfo:
        checker(current_user=CurrentUser(subject=str(user.id), permissions=frozenset(), claims={}), db=db)
    assert getattr(excinfo.value, "status_code", None) == 403


def test_user_with_permission_is_allowed(db: Session) -> None:
    feature = Feature(key="users", name="Users", description=None)
    perm = Permission(feature=feature, action="view", code="users:view", description=None)
    role = Role(name="viewer", description=None)
    role.permissions.append(perm)
    user = _mk_user(email="u2@example.com", is_superuser=False)
    user.roles.append(role)
    db.add_all([feature, perm, role, user])
    db.commit()
    db.refresh(user)

    checker = require_permission("users:view")
    out = checker(current_user=CurrentUser(subject=str(user.id), permissions=frozenset(), claims={}), db=db)
    assert out.subject == str(user.id)


def test_require_permission_colon_matches_dotted_code_in_db(db: Session) -> None:
    feature = Feature(key="users", name="Users", description=None)
    perm = Permission(feature=feature, action="view", code="users.view", description=None)
    role = Role(name="viewer2", description=None)
    role.permissions.append(perm)
    user = _mk_user(email="u3@example.com", is_superuser=False)
    user.roles.append(role)
    db.add_all([feature, perm, role, user])
    db.commit()
    db.refresh(user)

    checker = require_permission("users:view")
    out = checker(current_user=CurrentUser(subject=str(user.id), permissions=frozenset(), claims={}), db=db)
    assert out.subject == str(user.id)


def test_superuser_is_always_allowed(db: Session) -> None:
    user = _mk_user(email="admin@example.com", is_superuser=True)
    db.add(user)
    db.commit()
    db.refresh(user)

    checker = require_permission("anything:at:all")
    out = checker(current_user=CurrentUser(subject=str(user.id), permissions=frozenset(), claims={}), db=db)
    assert out.subject == str(user.id)

