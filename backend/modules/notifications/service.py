from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from modules.notifications.model import NotificationSetting
from modules.notifications.schema import NotificationSettingUpsert, NotificationSettingUpdate
from modules.errors import NotFoundError


class NotificationSettingsService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_by_event_code(self, event_code: str) -> NotificationSetting | None:
        code = (event_code or "").strip()
        if not code:
            return None
        return self._db.scalar(select(NotificationSetting).where(NotificationSetting.event_code == code))

    def get(self, setting_id: int) -> NotificationSetting:
        row = self._db.get(NotificationSetting, int(setting_id))
        if row is None:
            raise NotFoundError("NotificationSetting", setting_id)
        return row

    def upsert(self, payload: NotificationSettingUpsert) -> NotificationSetting:
        code = payload.event_code.strip()
        row = self.get_by_event_code(code)
        notify_roles = [int(rid) for rid in (payload.notify_roles or [])]
        if row is None:
            row = NotificationSetting(
                event_code=code,
                notify_roles=notify_roles,
                days_before=int(payload.days_before),
                is_active=bool(payload.is_active),
            )
            self._db.add(row)
        else:
            row.notify_roles = notify_roles
            row.days_before = int(payload.days_before)
            row.is_active = bool(payload.is_active)
        self._db.commit()
        self._db.refresh(row)
        return row

    def update(self, setting_id: int, payload: NotificationSettingUpdate) -> NotificationSetting:
        row = self.get(setting_id)
        upd = payload.model_dump(exclude_unset=True)
        if "notify_roles" in upd and upd["notify_roles"] is not None:
            row.notify_roles = [int(rid) for rid in (upd["notify_roles"] or [])]
        if "days_before" in upd and upd["days_before"] is not None:
            row.days_before = int(upd["days_before"])
        if "is_active" in upd and upd["is_active"] is not None:
            row.is_active = bool(upd["is_active"])
        self._db.commit()
        self._db.refresh(row)
        return row

