from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


class EmailTemplate(Base):
    __tablename__ = "email_templates"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    event_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    subject: Mapped[str] = mapped_column(Text, nullable=False)
    body_html: Mapped[str] = mapped_column(Text, nullable=False)
    body_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    mappings = relationship("EmailTemplateMapping", back_populates="template", cascade="all, delete-orphan")


class EmailTemplateMapping(Base):
    __tablename__ = "email_template_mappings"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    event_code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    template_id: Mapped[int] = mapped_column(Integer, ForeignKey("email_templates.id", ondelete="CASCADE"), nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    template = relationship("EmailTemplate", back_populates="mappings")


class EmailLog(Base):
    __tablename__ = "email_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    event_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    to_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    subject: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)  # sent|failed|skipped
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

