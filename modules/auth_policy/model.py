from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


class AuthPolicy(Base):
    __tablename__ = "auth_policies"
    __table_args__ = ()

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(
        ForeignKey("org_units.id", ondelete="CASCADE"), unique=True, index=True, nullable=False
    )
    password_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    captcha_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    mfa_enforced: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    company = relationship("OrgUnit", foreign_keys=[company_id])
