import re

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from modules.errors import ConflictError, NotFoundError
from modules.features.model import Feature
from modules.features.schema import FeatureCreate, FeatureUpdate
from modules.permissions.model import Permission
from modules.rbac_constants import DEFAULT_PERMISSION_ACTIONS, permission_code

_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


def _normalize_feature_key(raw: str) -> str:
    key = raw.strip().lower().replace("-", "_").replace(" ", "_")
    if not _KEY_RE.fullmatch(key):
        raise ConflictError(
            "Feature key must start with a letter and contain only lowercase "
            "letters, digits, and underscores (max 64 characters)."
        )
    return key


class FeatureService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def list_features(self, *, offset: int = 0, limit: int = 50) -> list[Feature]:
        stmt = select(Feature).order_by(Feature.created_at.desc()).offset(offset).limit(limit)
        return list(self._db.scalars(stmt).all())

    def get_feature(self, feature_id: int) -> Feature:
        feature = self._db.get(Feature, feature_id)
        if feature is None:
            raise NotFoundError("Feature", feature_id)
        return feature

    def create_feature(self, data: FeatureCreate) -> Feature:
        key = _normalize_feature_key(data.key)
        existing = self._db.scalar(select(Feature.id).where(Feature.key == key))
        if existing is not None:
            raise ConflictError("A feature with this key already exists.")
        feature = Feature(key=key, name=data.name.strip(), description=data.description)
        self._db.add(feature)
        self._db.flush()
        for action in DEFAULT_PERMISSION_ACTIONS:
            self._db.add(
                Permission(
                    feature_id=feature.id,
                    action=action,
                    code=permission_code(feature.key, action),
                )
            )
        try:
            self._db.commit()
        except IntegrityError:
            self._db.rollback()
            raise ConflictError("Could not create feature (constraint violation).") from None
        self._db.refresh(feature)
        return feature

    def update_feature(self, feature_id: int, data: FeatureUpdate) -> Feature:
        feature = self.get_feature(feature_id)
        old_key = feature.key
        updates = data.model_dump(exclude_unset=True)
        if "key" in updates:
            new_key = _normalize_feature_key(updates["key"])
            if new_key != feature.key:
                taken = self._db.scalar(
                    select(Feature.id).where(Feature.key == new_key, Feature.id != feature_id)
                )
                if taken is not None:
                    raise ConflictError("A feature with this key already exists.")
                feature.key = new_key
        if "name" in updates:
            feature.name = updates["name"].strip()
        if "description" in updates:
            feature.description = updates["description"]
        if "key" in updates and feature.key != old_key:
            for perm in feature.permissions:
                perm.code = permission_code(feature.key, perm.action)
        try:
            self._db.commit()
        except IntegrityError:
            self._db.rollback()
            raise ConflictError("Could not update feature (constraint violation).") from None
        self._db.refresh(feature)
        return feature

    def delete_feature(self, feature_id: int) -> None:
        feature = self.get_feature(feature_id)
        self._db.delete(feature)
        self._db.commit()
