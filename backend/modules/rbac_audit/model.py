"""Dedicated RBAC audit trail (separate from generic ``audit_logs``)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


class RbacAuditLog(Base):
    __tablename__ = "rbac_audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    actor_user_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    target_type: Mapped[str] = mapped_column(String(32), nullable=False)
    target_id: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    old_value: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    new_value: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
