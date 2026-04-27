"""Row-level permission cache versioning (single-tenant company scope)."""

from sqlalchemy import ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base

DEFAULT_COMPANY_ID = 1


class RbacCompanyPermissionVersion(Base):
    """Global RBAC version for the default company (``company_id`` = 1)."""

    __tablename__ = "rbac_company_permission_versions"

    company_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")


class RbacUserPermissionVersion(Base):
    """Per-user RBAC version (role assignment changes)."""

    __tablename__ = "rbac_user_permission_versions"

    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
