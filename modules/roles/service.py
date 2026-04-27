from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from modules.errors import ConflictError, NotFoundError
from modules.org_units.model import OrgUnit
from modules.permissions.model import Permission
from modules.rbac_association import user_role
from modules.rbac_audit.service import RbacAuditService
from modules.rbac_safety import (
    assert_actor_retains_users_view_after_role_permission_change,
    assert_did_not_remove_last_role_based_admin,
    assert_no_empty_permission_set,
    assert_role_not_last_assignment_for_users,
    count_users_with_admin_capability,
)
from modules.rbac_versioning.service import (
    bump_company_permission_version,
    bump_user_permission_version,
    bump_users_for_role,
)
from modules.roles.model import Role
from modules.roles.schema import RoleCreate, RoleUpdate


def _role_snapshot(role: Role) -> dict:
    return {
        "name": role.name,
        "description": role.description,
        "permission_ids": sorted({p.id for p in role.permissions}),
        "org_unit_ids": sorted({o.id for o in role.org_units}),
    }


class RoleService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def list_roles(self, *, offset: int = 0, limit: int = 50) -> list[Role]:
        stmt = (
            select(Role)
            .options(selectinload(Role.org_units))
            .order_by(Role.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return list(self._db.scalars(stmt).all())

    def get_role(self, role_id: int) -> Role:
        role = self._db.scalar(
            select(Role)
            .where(Role.id == role_id)
            .options(selectinload(Role.permissions), selectinload(Role.org_units))
        )
        if role is None:
            raise NotFoundError("Role", role_id)
        return role

    def _set_role_permissions(self, role: Role, permission_ids: list[int]) -> None:
        seen: set[int] = set()
        loaded: list[Permission] = []
        for pid in permission_ids:
            if pid in seen:
                continue
            seen.add(pid)
            perm = self._db.get(Permission, pid)
            if perm is None:
                raise NotFoundError("Permission", pid)
            loaded.append(perm)
        role.permissions = loaded

    def _set_role_org_units(self, role: Role, org_unit_ids: list[int]) -> None:
        seen: set[int] = set()
        loaded: list[OrgUnit] = []
        for oid in org_unit_ids:
            if oid in seen:
                continue
            seen.add(oid)
            ou = self._db.get(OrgUnit, oid)
            if ou is None:
                raise NotFoundError("OrgUnit", oid)
            loaded.append(ou)
        role.org_units = loaded

    def create_role(self, data: RoleCreate, *, actor_user_id: int | None = None) -> Role:
        assert_no_empty_permission_set(list(data.permission_ids))
        name = data.name.strip()
        exists = self._db.scalar(select(Role.id).where(Role.name == name))
        if exists is not None:
            raise ConflictError("A role with this name already exists.")
        role = Role(name=name, description=data.description)
        self._db.add(role)
        self._db.flush()
        self._set_role_permissions(role, data.permission_ids)
        self._set_role_org_units(role, data.org_unit_ids)
        audit = RbacAuditService(self._db)
        audit.log(
            actor_user_id=actor_user_id,
            target_type="role",
            target_id=role.id,
            action="create",
            new_value=_role_snapshot(role),
        )
        bump_company_permission_version(self._db)
        try:
            self._db.commit()
        except IntegrityError:
            self._db.rollback()
            raise ConflictError("Could not create role (constraint violation).") from None
        return self.get_role(role.id)

    def update_role(self, role_id: int, data: RoleUpdate, *, actor_user_id: int | None = None) -> Role:
        admin_before = count_users_with_admin_capability(self._db)
        role = self.get_role(role_id)
        old_snapshot = _role_snapshot(role)
        updates = data.model_dump(exclude_unset=True)
        rbac_mutated = False
        if "permission_ids" in updates:
            assert_no_empty_permission_set(updates["permission_ids"])
            assert_actor_retains_users_view_after_role_permission_change(
                self._db,
                actor_user_id=actor_user_id,
                role_id=role_id,
                new_permission_ids=list(updates["permission_ids"]),
            )
            rbac_mutated = True
        if "org_unit_ids" in updates:
            rbac_mutated = True

        if "name" in updates:
            new_name = updates["name"].strip()
            taken = self._db.scalar(
                select(Role.id).where(Role.name == new_name, Role.id != role_id)
            )
            if taken is not None:
                raise ConflictError("A role with this name already exists.")
            role.name = new_name
        if "description" in updates:
            role.description = updates["description"]
        if "permission_ids" in updates:
            self._set_role_permissions(role, updates["permission_ids"])
        if "org_unit_ids" in updates:
            self._set_role_org_units(role, updates["org_unit_ids"])

        self._db.flush()
        assert_did_not_remove_last_role_based_admin(
            self._db, admin_capable_users_before=admin_before
        )

        new_snapshot = _role_snapshot(role)
        if new_snapshot != old_snapshot:
            audit = RbacAuditService(self._db)
            audit.log(
                actor_user_id=actor_user_id,
                target_type="role",
                target_id=role_id,
                action="update",
                old_value=old_snapshot,
                new_value=new_snapshot,
            )
        if rbac_mutated:
            bump_company_permission_version(self._db)
            bump_users_for_role(self._db, role_id)

        try:
            self._db.commit()
        except IntegrityError:
            self._db.rollback()
            raise ConflictError("Could not update role (constraint violation).") from None
        return self.get_role(role_id)

    def delete_role(self, role_id: int, *, actor_user_id: int | None = None) -> None:
        admin_before = count_users_with_admin_capability(self._db)
        assert_role_not_last_assignment_for_users(self._db, role_id)
        role = self.get_role(role_id)
        old_snapshot = _role_snapshot(role)
        user_ids = list(
            self._db.scalars(select(user_role.c.user_id).where(user_role.c.role_id == role_id)).all()
        )
        audit = RbacAuditService(self._db)
        audit.log(
            actor_user_id=actor_user_id,
            target_type="role",
            target_id=role_id,
            action="delete",
            old_value=old_snapshot,
            new_value=None,
        )
        self._db.delete(role)
        self._db.flush()
        assert_did_not_remove_last_role_based_admin(
            self._db, admin_capable_users_before=admin_before
        )
        bump_company_permission_version(self._db)
        for uid in {int(u) for u in user_ids}:
            bump_user_permission_version(self._db, uid)
        try:
            self._db.commit()
        except IntegrityError:
            self._db.rollback()
            raise ConflictError("Could not delete role (constraint violation).") from None
