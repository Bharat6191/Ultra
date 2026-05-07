from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, func, true
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


class NotificationSetting(Base):
    __tablename__ = "notification_settings"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    event_code: Mapped[str] = mapped_column(String(128), nullable=False, index=True, unique=True)
    notify_roles: Mapped[list[int] | None] = mapped_column(JSONB, nullable=True)
    days_before: Mapped[int] = mapped_column(Integer, nullable=False, server_default="7")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=true())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class NotificationDedupKey(Base):
    """
    Persistent de-dup store for background notifications.

    Used when Redis isn't available or to provide a durable fallback.
    """

    __tablename__ = "notification_dedup_keys"

    key: Mapped[str] = mapped_column(String(255), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

