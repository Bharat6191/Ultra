"""Sync MODULE_CONFIG into ``features`` / ``permissions`` rows (action-level, dotted codes)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.permissions import invalidate_permission_cache
from modules.features.model import Feature
from modules.module_config import MODULE_CONFIG, _normalize_action_token
from modules.permissions.model import Permission
from modules.rbac_constants import build_permission_code, feature_storage_key


def sync_all_modules_to_db(db: Session) -> dict[str, int]:
    """
    Upsert features and permissions from MODULE_CONFIG.

    - ``Feature.key`` uses underscores (``users`` or ``users_invites``), never dots.
    - ``Permission.code`` uses dotted form (``users.view`` or ``users.invites.view``).
    - Existing rows matched by ``(feature_id, action)`` get ``code`` updated to the canonical
      dotted value so role assignments stay intact.
    """
    created_features = 0
    updated_codes = 0
    created_permissions = 0

    for mod in MODULE_CONFIG:
        module_key = mod["key"].strip().lower()
        for tab in mod["tabs"]:
            tab_key = tab["key"].strip().lower()
            fkey = feature_storage_key(module_key, tab_key)
            title = (tab.get("title") or mod["title"]).strip()

            feature = db.scalar(select(Feature).where(Feature.key == fkey))
            if feature is None:
                feature = Feature(key=fkey, name=title, description=None)
                db.add(feature)
                db.flush()
                created_features += 1
            elif feature.name != title:
                feature.name = title

            for raw_action in tab["actions"]:
                action = _normalize_action_token(raw_action)
                code = build_permission_code(module_key, tab_key, action)

                perm = db.scalar(
                    select(Permission).where(
                        Permission.feature_id == feature.id,
                        Permission.action == action,
                    )
                )
                if perm is None:
                    taken = db.scalar(select(Permission.id).where(Permission.code == code))
                    if taken is not None:
                        # Avoid unique collisions (legacy duplicate); skip creating second row.
                        continue
                    db.add(
                        Permission(
                            feature_id=feature.id,
                            action=action,
                            code=code,
                            description=None,
                        )
                    )
                    created_permissions += 1
                elif perm.code != code:
                    conflict = db.scalar(
                        select(Permission.id).where(Permission.code == code, Permission.id != perm.id)
                    )
                    if conflict is None:
                        perm.code = code
                        updated_codes += 1

    db.commit()
    invalidate_permission_cache(None)
    return {
        "features_created": created_features,
        "permissions_created": created_permissions,
        "permission_codes_updated": updated_codes,
    }
