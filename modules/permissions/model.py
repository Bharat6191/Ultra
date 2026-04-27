from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base
from modules.features.model import Feature
from modules.rbac_association import role_permission


class Permission(Base):
    __tablename__ = "permissions"
    __table_args__ = (UniqueConstraint("feature_id", "action", name="uq_permissions_feature_action"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    feature_id: Mapped[int] = mapped_column(ForeignKey("features.id", ondelete="CASCADE"))
    action: Mapped[str] = mapped_column(String(32))
    code: Mapped[str] = mapped_column(String(255), unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    feature = relationship("Feature", back_populates="permissions")
    roles = relationship("Role", secondary=role_permission, back_populates="permissions")
