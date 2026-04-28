"""Association tables for RBAC (role-permission, user-role, user-org, role-org)."""

from sqlalchemy import Column, ForeignKey, Integer, Table

from db.base import Base

role_permission = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", Integer, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column(
        "permission_id",
        Integer,
        ForeignKey("permissions.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)

user_role = Table(
    "user_roles",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", Integer, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)

user_org_unit = Table(
    "user_org_units",
    Base.metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("org_unit_id", Integer, ForeignKey("org_units.id", ondelete="CASCADE"), nullable=False),
)

role_org_unit = Table(
    "role_org_units",
    Base.metadata,
    Column("role_id", Integer, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column(
        "org_unit_id",
        Integer,
        ForeignKey("org_units.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)
