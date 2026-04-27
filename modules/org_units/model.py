from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base
from modules.rbac_association import role_org_unit


class OrgUnit(Base):
    __tablename__ = "org_units"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(String(32))
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("org_units.id", ondelete="SET NULL"),
        nullable=True,
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

    parent = relationship("OrgUnit", remote_side=[id], back_populates="children")
    children = relationship("OrgUnit", back_populates="parent")
    roles = relationship(
        "Role",
        secondary=role_org_unit,
        back_populates="org_units",
    )
