from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy import create_engine

from db.base import Base
from modules.approvals.model import ApprovalRequest, ApprovalTask, ApprovalWorkflow  # noqa: F401
from modules.auth.model import UserSession  # noqa: F401
from modules.features.model import Feature  # noqa: F401
from modules.permissions.model import Permission  # noqa: F401
from modules.roles.model import Role  # noqa: F401
from modules.settings.model import Setting
from modules.settings.schema import AppearanceSettingsPublic, DEFAULT_PAGE_BACKGROUND_COLOR
from modules.settings.service import SettingsService
from modules.users.model import User  # noqa: F401


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    with SessionLocal() as session:
        yield session


def test_appearance_settings_default_and_update(db: Session) -> None:
    svc = SettingsService(db)

    current = svc.get_appearance_settings()
    assert current.page_background_color == DEFAULT_PAGE_BACKGROUND_COLOR

    updated = svc.put_appearance_settings(AppearanceSettingsPublic(page_background_color="#ABC"))
    assert updated.page_background_color == "#aabbcc"

    row = db.scalar(select(Setting).where(Setting.key == "appearance.page_background_color"))
    assert row is not None
    assert row.value == "#aabbcc"

    refreshed = svc.get_appearance_settings()
    assert refreshed.page_background_color == "#aabbcc"
