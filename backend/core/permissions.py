from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
import threading
import time

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from db.session import get_db
from modules.permissions.model import Permission
from modules.rbac_association import role_permission, user_role
from modules.roles.model import Role
from modules.rbac_versioning.service import get_permission_version_pair
from modules.users.model import User


def _permission_code_variants(required: str) -> set[str]:
    """
    Match literal codes plus legacy two-part ``module:action`` vs ``module.action`` (first
    separator only) so existing route strings and migrated DB rows stay compatible.
    """
    variants = {required}
    if "." in required:
        variants.add(required.replace(".", ":", 1))
    if ":" in required:
        variants.add(required.replace(":", ".", 1))
    return variants


@dataclass(frozen=True, slots=True)
class _PermissionSnapshot:
    is_superuser: bool
    permission_codes: frozenset[str]


_CACHE_TTL_SECONDS = 30.0
_cache_lock = threading.Lock()
# Key: ``(user_id, company_permission_version, user_permission_version)`` — versions
# force a cache miss after RBAC mutations even if the TTL has not elapsed.
_permission_cache: dict[tuple[int, int, int], tuple[float, _PermissionSnapshot]] = {}


def invalidate_permission_cache(user_id: int | None = None) -> None:
    """
    Clear cached permission snapshots.

    Useful after role/permission mutations and for tests that use ephemeral DBs.
    """
    with _cache_lock:
        if user_id is None:
            _permission_cache.clear()
        else:
            for key in list(_permission_cache.keys()):
                if key[0] == user_id:
                    _permission_cache.pop(key, None)


def _load_permission_snapshot(db: Session, user_id: int) -> _PermissionSnapshot:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    if user.is_superuser:
        return _PermissionSnapshot(is_superuser=True, permission_codes=frozenset())

    stmt = (
        select(Permission.code)
        .select_from(user_role)
        .join(Role, Role.id == user_role.c.role_id)
        .join(role_permission, role_permission.c.role_id == Role.id)
        .join(Permission, Permission.id == role_permission.c.permission_id)
        .where(user_role.c.user_id == user_id)
    )
    codes = {row[0] for row in db.execute(stmt).all() if row and row[0]}
    return _PermissionSnapshot(is_superuser=False, permission_codes=frozenset(codes))


def _get_cached_permission_snapshot(db: Session, user_id: int) -> _PermissionSnapshot:
    gv, uv = get_permission_version_pair(db, user_id)
    cache_key = (user_id, gv, uv)
    now = time.monotonic()
    with _cache_lock:
        cached = _permission_cache.get(cache_key)
        if cached is not None:
            expires_at, snapshot = cached
            if expires_at > now:
                return snapshot
            _permission_cache.pop(cache_key, None)

    snapshot = _load_permission_snapshot(db, user_id)
    with _cache_lock:
        _permission_cache[cache_key] = (now + _CACHE_TTL_SECONDS, snapshot)
    return snapshot


def _has_permissions(snapshot: _PermissionSnapshot, required: Iterable[str]) -> bool:
    if snapshot.is_superuser:
        return True
    if not required:
        return True
    for req in required:
        variants = _permission_code_variants(req)
        if snapshot.permission_codes.isdisjoint(variants):
            return False
    return True


def _has_any_permission(snapshot: _PermissionSnapshot, alternatives: Iterable[str]) -> bool:
    """True if the user has at least one of the permission codes (or is superuser)."""
    if snapshot.is_superuser:
        return True
    for req in alternatives:
        variants = _permission_code_variants(req)
        if not snapshot.permission_codes.isdisjoint(variants):
            return True
    return False


def get_flat_permission_codes_for_user(db: Session, user_id: int) -> list[str]:
    """
    Return all permission codes for a user (RBAC via roles), sorted.

    Superusers receive every permission code currently defined in the database.
    Uses the same cached snapshot path as ``require_permission`` for non-superusers.
    """
    snapshot = _get_cached_permission_snapshot(db, user_id)
    if snapshot.is_superuser:
        stmt = select(Permission.code).order_by(Permission.code.asc())
        return [row[0] for row in db.execute(stmt).all() if row and row[0]]
    return sorted(snapshot.permission_codes)


def require_permission(permission_code: str, *more_permission_codes: str) -> Callable[..., CurrentUser]:
    """
    Enforce permissions from the database (user_roles → roles → permissions).

    Superusers bypass all checks. Permission strings match ``permissions.code``;
    dotted codes (``users.view``) and legacy two-part colon codes (``users:view``) are
    treated as equivalent for the first separator only.
    """
    required_permissions = (permission_code, *more_permission_codes)

    def permission_checker(
        current_user: CurrentUser = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> CurrentUser:
        try:
            user_id = int(current_user.subject)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token subject",
            ) from exc
        snapshot = _get_cached_permission_snapshot(db, user_id)
        if not _has_permissions(snapshot, required_permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied",
            )
        return current_user

    return permission_checker


def require_any_permission(permission_code: str, *alternative_codes: str) -> Callable[..., CurrentUser]:
    """
    Like ``require_permission`` but the user needs **at least one** of the listed codes (OR).

    Use when an endpoint serves multiple workflows (e.g. listing org units for the Plants
    admin screen vs. for user/role assignment pickers).
    """
    alternatives = (permission_code, *alternative_codes)

    def permission_checker(
        current_user: CurrentUser = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> CurrentUser:
        try:
            user_id = int(current_user.subject)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token subject",
            ) from exc
        snapshot = _get_cached_permission_snapshot(db, user_id)
        if not _has_any_permission(snapshot, alternatives):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied",
            )
        return current_user

    return permission_checker


def require_superuser() -> Callable[..., CurrentUser]:
    """
    Require an authenticated user whose database row has ``is_superuser=True``.

    Use for routes that must never rely on frontend-only checks.
    """

    def superuser_checker(
        current_user: CurrentUser = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> CurrentUser:
        try:
            user_id = int(current_user.subject)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token subject",
            ) from exc
        user = db.get(User, user_id)
        if user is None or not user.is_superuser:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Superuser access required",
            )
        return current_user

    return superuser_checker
