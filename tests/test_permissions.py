from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from core.auth import CurrentUser
from core.permissions import invalidate_permission_cache, require_any_permission, require_permission
from db.base import Base
from modules.approvals.model import ApprovalRequest, ApprovalTask, ApprovalWorkflow  # noqa: F401
from modules.approvals.router import require_task_action_permission
from modules.auth.model import UserSession  # noqa: F401
from modules.features.model import Feature
from modules.tasks.router import TASK_INBOX_PERMISSION_CODES
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
    local = email.split("@", 1)[0]
    return User(
        full_name=local,
        username=f"{local}_{abs(hash(email)) % 10_000:04d}",
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


def test_task_inbox_accepts_negotiation_approver_permission(db: Session) -> None:
    feature = Feature(key="contractor_rates", name="Negotiation", description=None)
    perm = Permission(
        feature=feature,
        action="approve",
        code="contractor_rates.approve",
        description=None,
    )
    role = Role(name="controller", description=None)
    role.permissions.append(perm)
    user = _mk_user(email="controller@example.com", is_superuser=False)
    user.roles.append(role)
    db.add_all([feature, perm, role, user])
    db.commit()
    db.refresh(user)

    checker = require_any_permission(*TASK_INBOX_PERMISSION_CODES)
    out = checker(current_user=CurrentUser(subject=str(user.id), permissions=frozenset(), claims={}), db=db)
    assert out.subject == str(user.id)


def test_negotiation_approval_task_action_allows_contractor_rate_approver(db: Session) -> None:
    feature = Feature(key="contractor_rates", name="Negotiation", description=None)
    perm = Permission(
        feature=feature,
        action="approve",
        code="contractor_rates.approve",
        description=None,
    )
    role = Role(name="controller_approver", description=None)
    role.permissions.append(perm)
    user = _mk_user(email="approver@example.com", is_superuser=False)
    user.roles.append(role)
    db.add_all([feature, perm, role, user])
    db.commit()
    db.refresh(user)
    db.refresh(role)

    workflow = ApprovalWorkflow(
        name="Negotiation Workflow",
        entity_type="contractor_rate_approval",
        is_active=True,
        created_by=user.id,
    )
    db.add(workflow)
    db.commit()
    db.refresh(workflow)

    request = ApprovalRequest(
        workflow_id=workflow.id,
        entity_type="contractor_rate_approval",
        entity_id=101,
        status="pending",
        current_step=1,
        payload={},
        created_by=user.id,
    )
    db.add(request)
    db.commit()
    db.refresh(request)

    task = ApprovalTask(
        task_type="approval",
        request_id=request.id,
        assigned_role_id=role.id,
        status="pending",
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    out = require_task_action_permission(
        task_id=task.id,
        current=CurrentUser(subject=str(user.id), permissions=frozenset(), claims={}),
        db=db,
    )
    assert out.subject == str(user.id)
