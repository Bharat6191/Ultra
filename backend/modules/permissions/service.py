from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from modules.errors import ConflictError, NotFoundError
from modules.rbac_audit.service import RbacAuditService
from modules.rbac_safety import (
    assert_did_not_remove_last_role_based_admin,
    count_users_with_admin_capability,
)
from modules.rbac_versioning.service import bump_company_permission_version
from modules.features.model import Feature
from modules.module_config import MODULE_CONFIG, _normalize_action_token, flatten_config_actions
from modules.permissions.model import Permission
from modules.permissions.schema import (
    CatalogModuleItem,
    CatalogPermissionItem,
    CatalogTabItem,
    PermissionCatalogPublic,
    PermissionCreate,
    PermissionUpdate,
)
from modules.rbac_constants import DEFAULT_PERMISSION_ACTIONS, build_permission_code, permission_code

_ALLOWED_ACTIONS: frozenset[str] = frozenset(DEFAULT_PERMISSION_ACTIONS) | flatten_config_actions()


class PermissionService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def _permission_by_canonical_or_legacy(self, canonical_code: str) -> Permission | None:
        row = self._db.scalar(select(Permission).where(Permission.code == canonical_code))
        if row is not None:
            return row
        if "." in canonical_code:
            legacy_first = canonical_code.replace(".", ":", 1)
            row = self._db.scalar(select(Permission).where(Permission.code == legacy_first))
            if row is not None:
                return row
            # Older installs sometimes stored every segment with colons (e.g. ``a:b:c``).
            legacy_all = canonical_code.replace(".", ":")
            if legacy_all != legacy_first:
                row = self._db.scalar(select(Permission).where(Permission.code == legacy_all))
            if row is not None:
                return row
        return None

    def list_permissions(
        self,
        *,
        offset: int = 0,
        limit: int = 50,
        feature_id: int | None = None,
    ) -> list[Permission]:
        stmt = select(Permission).order_by(Permission.code.asc())
        if feature_id is not None:
            stmt = stmt.where(Permission.feature_id == feature_id)
        stmt = stmt.offset(offset).limit(limit)
        return list(self._db.scalars(stmt).all())

    def get_permission(self, permission_id: int) -> Permission:
        perm = self._db.get(Permission, permission_id)
        if perm is None:
            raise NotFoundError("Permission", permission_id)
        return perm

    def create_permission(
        self,
        data: PermissionCreate,
        *,
        actor_user_id: int | None = None,
    ) -> Permission:
        feature = self._db.get(Feature, data.feature_id)
        if feature is None:
            raise NotFoundError("Feature", data.feature_id)
        action = data.action.strip().lower()
        if action == "edit":
            action = "update"
        if action not in _ALLOWED_ACTIONS:
            raise ConflictError(
                f"Action must be one of: {', '.join(sorted(_ALLOWED_ACTIONS))}."
            )
        existing = self._db.scalar(
            select(Permission.id).where(
                Permission.feature_id == data.feature_id,
                Permission.action == action,
            )
        )
        if existing is not None:
            raise ConflictError("This permission already exists for the feature.")
        code = permission_code(feature.key, action)
        perm = Permission(
            feature_id=feature.id,
            action=action,
            code=code,
            description=data.description,
        )
        self._db.add(perm)
        self._db.flush()
        audit = RbacAuditService(self._db)
        audit.log(
            actor_user_id=actor_user_id,
            target_type="permission",
            target_id=perm.id,
            action="create",
            new_value={"code": perm.code, "feature_id": perm.feature_id, "action": perm.action},
        )
        bump_company_permission_version(self._db)
        try:
            self._db.commit()
        except IntegrityError:
            self._db.rollback()
            raise ConflictError("Could not create permission (constraint violation).") from None
        self._db.refresh(perm)
        return perm

    def update_permission(self, permission_id: int, data: PermissionUpdate) -> Permission:
        perm = self.get_permission(permission_id)
        updates = data.model_dump(exclude_unset=True)
        if "description" in updates:
            perm.description = updates["description"]
        self._db.commit()
        self._db.refresh(perm)
        return perm

    def delete_permission(
        self,
        permission_id: int,
        *,
        actor_user_id: int | None = None,
    ) -> None:
        admin_before = count_users_with_admin_capability(self._db)
        perm = self.get_permission(permission_id)
        old_val = {"code": perm.code, "feature_id": perm.feature_id, "action": perm.action}
        audit = RbacAuditService(self._db)
        audit.log(
            actor_user_id=actor_user_id,
            target_type="permission",
            target_id=permission_id,
            action="delete",
            old_value=old_val,
            new_value=None,
        )
        self._db.delete(perm)
        self._db.flush()
        assert_did_not_remove_last_role_based_admin(
            self._db, admin_capable_users_before=admin_before
        )
        bump_company_permission_version(self._db)
        self._db.commit()

    def build_permission_catalog(self) -> PermissionCatalogPublic:
        """Merge MODULE_CONFIG with persisted permissions (grouped by module → tab)."""
        modules_out: list[CatalogModuleItem] = []
        for mod in MODULE_CONFIG:
            module_key = mod["key"].strip().lower()
            tabs_out: list[CatalogTabItem] = []
            for tab in mod["tabs"]:
                tab_key = tab["key"].strip().lower()
                perms_out: list[CatalogPermissionItem] = []
                for raw_action in tab["actions"]:
                    action = _normalize_action_token(raw_action)
                    code = build_permission_code(module_key, tab_key, action)
                    row = self._permission_by_canonical_or_legacy(code)
                    perms_out.append(
                        CatalogPermissionItem(
                            id=row.id if row else None,
                            action=action,
                            code=code,
                            description=row.description if row else None,
                        )
                    )
                tabs_out.append(
                    CatalogTabItem(
                        key=tab_key,
                        title=tab["title"].strip(),
                        actions=[_normalize_action_token(a) for a in tab["actions"]],
                        permissions=perms_out,
                    )
                )
            modules_out.append(
                CatalogModuleItem(
                    key=module_key,
                    title=mod["title"].strip(),
                    tabs=tabs_out,
                )
            )
        return PermissionCatalogPublic(modules=modules_out)
