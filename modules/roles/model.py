from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base
from modules.rbac_association import role_org_unit, role_permission, user_role


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    permissions = relationship(
        "Permission",
        secondary=role_permission,
        back_populates="roles",
    )
    org_units = relationship(
        "OrgUnit",
        secondary=role_org_unit,
        back_populates="roles",
    )
    users = relationship(
        "User",
        secondary=user_role,
        back_populates="roles",
    )
