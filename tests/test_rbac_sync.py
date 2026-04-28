from __future__ import annotations

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from core.permissions import invalidate_permission_cache, require_permission
from db.base import Base
from modules.auth.model import UserSession  # noqa: F401
from modules.features.model import Feature  # noqa: F401
from modules.permissions.model import Permission
from modules.rbac_sync import sync_all_modules_to_db


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    with SessionLocal() as session:
        invalidate_permission_cache()
        yield session


def test_sync_all_modules_creates_users_view(db: Session) -> None:
    result = sync_all_modules_to_db(db)
    assert result["permissions_created"] >= 1
    row = db.scalar(select(Permission).where(Permission.code == "users.view"))
    assert row is not None
    assert row.action == "view"
    org = db.scalar(select(Permission).where(Permission.code == "org_units.view"))
    assert org is not None
    assert org.action == "view"


def test_sync_updates_legacy_colon_code_in_place(db: Session) -> None:
    feature = Feature(key="users", name="Users", description=None)
    perm = Permission(feature=feature, action="view", code="users:view", description=None)
    db.add_all([feature, perm])
    db.commit()

    sync_all_modules_to_db(db)
    db.refresh(perm)
    assert perm.code == "users.view"


def test_require_permission_dotted_matches_legacy_colon_in_db(db: Session) -> None:
    from core.auth import CurrentUser
    from modules.roles.model import Role
    from modules.users.model import User
    from datetime import datetime, timezone

    feature = Feature(key="users", name="Users", description=None)
    perm = Permission(feature=feature, action="view", code="users:view", description=None)
    role = Role(name="r", description=None)
    role.permissions.append(perm)
    user = User(
        full_name="u",
        username="u_test",
        email="u@example.com",
        phone="+15550009999",
        hashed_password="x",
        password_changed_at=datetime.now(timezone.utc),
        is_superuser=False,
    )
    user.roles.append(role)
    db.add_all([feature, perm, role, user])
    db.commit()
    db.refresh(user)

    checker = require_permission("users.view")
    out = checker(current_user=CurrentUser(subject=str(user.id), permissions=frozenset(), claims={}), db=db)
    assert out.subject == str(user.id)
