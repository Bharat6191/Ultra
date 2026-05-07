from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text, false, func, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base
from modules.rbac_association import user_org_unit, user_role


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    username: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True, unique=True, index=True)
    employee_code: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)
    department: Mapped[str | None] = mapped_column(String(128), nullable=True)
    designation: Mapped[str | None] = mapped_column(String(128), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    password_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    is_superuser: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=false(),
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=true(),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    roles = relationship(
        "Role",
        secondary=user_role,
        back_populates="users",
    )
    sessions = relationship(
        "UserSession",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    org_units = relationship(
        "OrgUnit",
        secondary=user_org_unit,
        lazy="selectin",
    )
    mfa_record = relationship(
        "UserMfa",
        back_populates="user",
        uselist=False,
    )
