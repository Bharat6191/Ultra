"""Increment and read permission cache version counters."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from modules.rbac_versioning.model import (
    DEFAULT_COMPANY_ID,
    RbacCompanyPermissionVersion,
    RbacUserPermissionVersion,
)


def get_permission_version_pair(db: Session, user_id: int) -> tuple[int, int]:
    """
    Return ``(company_version, user_version)`` for cache keys.

    Ensures a company version row exists (for environments created without migrations).
    """
    row = db.get(RbacCompanyPermissionVersion, DEFAULT_COMPANY_ID)
    if row is None:
        db.add(RbacCompanyPermissionVersion(company_id=DEFAULT_COMPANY_ID, version=0))
        db.flush()
        row = db.get(RbacCompanyPermissionVersion, DEFAULT_COMPANY_ID)
    assert row is not None
    gv = int(row.version)

    uv_row = db.get(RbacUserPermissionVersion, user_id)
    uv = 0 if uv_row is None else int(uv_row.version)
    return (gv, uv)


def bump_company_permission_version(db: Session) -> None:
    row = db.get(RbacCompanyPermissionVersion, DEFAULT_COMPANY_ID)
    if row is None:
        db.add(RbacCompanyPermissionVersion(company_id=DEFAULT_COMPANY_ID, version=1))
    else:
        row.version = int(row.version) + 1


def bump_user_permission_version(db: Session, user_id: int) -> None:
    row = db.get(RbacUserPermissionVersion, user_id)
    if row is None:
        db.add(RbacUserPermissionVersion(user_id=user_id, version=1))
    else:
        row.version = int(row.version) + 1


def bump_users_for_role(db: Session, role_id: int) -> None:
    """Bump user versions for everyone assigned a role (role permission/org changes)."""
    from modules.rbac_association import user_role

    user_ids = db.scalars(select(user_role.c.user_id).where(user_role.c.role_id == role_id)).all()
    for uid in {int(x) for x in user_ids}:
        bump_user_permission_version(db, uid)
