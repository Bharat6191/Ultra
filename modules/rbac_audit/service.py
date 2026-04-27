from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from modules.rbac_audit.model import RbacAuditLog


class RbacAuditService:
    """Append-only RBAC audit entries (same transaction as mutating service)."""

    def __init__(self, db: Session) -> None:
        self._db = db

    def log(
        self,
        *,
        actor_user_id: int | None,
        target_type: str,
        target_id: int,
        action: str,
        old_value: dict[str, Any] | None = None,
        new_value: dict[str, Any] | None = None,
    ) -> None:
        self._db.add(
            RbacAuditLog(
                actor_user_id=actor_user_id,
                target_type=target_type,
                target_id=target_id,
                action=action,
                old_value=old_value,
                new_value=new_value,
            )
        )
