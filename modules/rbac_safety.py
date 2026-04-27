"""RBAC guardrails (called from services, not routes)."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from modules.errors import RbacSafetyError
from modules.permissions.model import Permission
from modules.rbac_association import role_permission, user_role
from modules.roles.model import Role
from modules.users.model import User


def _permission_code_variants(code: str) -> set[str]:
    variants = {code}
    if "." in code:
        variants.add(code.replace(".", ":", 1))
    if ":" in code:
        variants.add(code.replace(":", ".", 1))
    return variants


# Effective "can administer RBAC or users" — at least one account must retain these.
_ADMIN_CAPABILITY_CODES: frozenset[str] = frozenset(
    {
        "users.update",
        "users:update",
        "roles.update",
        "roles:update",
        "permissions.update",
        "permissions:update",
    }
)


def _user_effective_permission_codes(db: Session, user_id: int) -> set[str]:
    user = db.get(User, user_id)
    if user is None:
        return set()
    if user.is_superuser:
        return set(_ADMIN_CAPABILITY_CODES)
    stmt = (
        select(Permission.code)
        .select_from(user_role)
        .join(Role, Role.id == user_role.c.role_id)
        .join(role_permission, role_permission.c.role_id == Role.id)
        .join(Permission, Permission.id == role_permission.c.permission_id)
        .where(user_role.c.user_id == user_id)
    )
    return {row[0] for row in db.execute(stmt).all() if row and row[0]}


def assert_actor_retains_users_view_after_role_permission_change(
    db: Session,
    *,
    actor_user_id: int | None,
    role_id: int,
    new_permission_ids: list[int],
) -> None:
    if actor_user_id is None:
        return
    actor = db.scalar(
        select(User)
        .where(User.id == actor_user_id)
        .options(selectinload(User.roles).selectinload(Role.permissions))
    )
    if actor is None or actor.is_superuser:
        return
    role_ids = {r.id for r in actor.roles}
    if role_id not in role_ids:
        return

    new_codes: set[str] = set()
    if new_permission_ids:
        rows = db.scalars(select(Permission).where(Permission.id.in_(new_permission_ids))).all()
        new_codes = {p.code for p in rows}

    merged: set[str] = set()
    for r in actor.roles:
        if r.id == role_id:
            merged |= new_codes
        else:
            merged |= {p.code for p in r.permissions}

    if not merged.intersection(_permission_code_variants("users.view")):
        raise RbacSafetyError(
            "This change would remove your own access to view users. "
            "Ask another administrator to adjust this role, or keep a users.view permission."
        )


def assert_no_empty_permission_set(permission_ids: list[int] | None) -> None:
    if permission_ids is not None and len(permission_ids) == 0:
        raise RbacSafetyError("A role must include at least one permission.")


def assert_role_not_last_assignment_for_users(db: Session, role_id: int) -> None:
    stmt = (
        select(User)
        .join(User.roles)
        .where(Role.id == role_id)
        .options(selectinload(User.roles))
        .distinct()
    )
    for user in db.scalars(stmt).unique().all():
        if len(user.roles) == 1 and user.roles[0].id == role_id:
            raise RbacSafetyError(
                "Cannot delete this role while users are assigned only to it. "
                "Assign another role first."
            )


def count_users_with_admin_capability(db: Session) -> int:
    codes_union: set[str] = set()
    for c in _ADMIN_CAPABILITY_CODES:
        codes_union |= _permission_code_variants(c)
    stmt = (
        select(func.count(func.distinct(user_role.c.user_id)))
        .select_from(user_role)
        .join(role_permission, role_permission.c.role_id == user_role.c.role_id)
        .join(Permission, Permission.id == role_permission.c.permission_id)
        .where(Permission.code.in_(codes_union))
    )
    n = db.scalar(stmt)
    return int(n or 0)


def count_superusers(db: Session) -> int:
    return int(
        db.scalar(select(func.count()).select_from(User).where(User.is_superuser.is_(True))) or 0
    )


def assert_did_not_remove_last_role_based_admin(
    db: Session,
    *,
    admin_capable_users_before: int,
) -> None:
    """
    Block a transition from \"at least one role-based admin\" to \"none\" when no superuser exists.

    If the system already has zero role-based admins (misconfiguration / bootstrap), mutations
    are still allowed so operators can recover by assigning the right role again.
    """
    total_users = int(db.scalar(select(func.count()).select_from(User)) or 0)
    if total_users <= 1:
        return
    if count_superusers(db) >= 1:
        return
    if admin_capable_users_before < 1:
        return
    if count_users_with_admin_capability(db) < 1:
        raise RbacSafetyError(
            "This change would remove the last account that can manage users, roles, or permissions. "
            "Keep at least one such role assigned, create a superuser, or assign users.update / "
            "roles.update / permissions.update before continuing."
        )


def assert_self_role_update_keeps_users_view(
    db: Session,
    *,
    actor_user_id: int | None,
    target_user_id: int,
    new_role_id: int,
) -> None:
    if actor_user_id is None or actor_user_id != target_user_id:
        return
    role = db.scalar(
        select(Role).where(Role.id == new_role_id).options(selectinload(Role.permissions))
    )
    if role is None:
        return
    codes = {p.code for p in role.permissions}
    if not codes.intersection(_permission_code_variants("users.view")):
        raise RbacSafetyError(
            "You cannot assign yourself a role that removes users.view access."
        )


def assert_self_role_assign_keeps_users_view(
    db: Session,
    *,
    actor_user_id: int | None,
    target_user_id: int,
    role_id: int,
) -> None:
    if actor_user_id is None or actor_user_id != target_user_id:
        return
    user = db.scalar(
        select(User)
        .where(User.id == target_user_id)
        .options(selectinload(User.roles).selectinload(Role.permissions))
    )
    role = db.scalar(
        select(Role).where(Role.id == role_id).options(selectinload(Role.permissions))
    )
    if user is None or role is None:
        return
    if role in user.roles:
        return
    codes: set[str] = set()
    for r in user.roles:
        codes |= {p.code for p in r.permissions}
    codes |= {p.code for p in role.permissions}
    if not codes.intersection(_permission_code_variants("users.view")):
        raise RbacSafetyError(
            "Assigning this role would remove your own users.view access. "
            "Keep another role that includes users.view or pick a different role."
        )
