"""Lazy-loaded setting values with an in-memory cache."""

from __future__ import annotations

import threading
from typing import Final

from sqlalchemy import select

from db.session import SessionLocal
from modules.settings.model import Setting

_lock: Final[threading.RLock] = threading.RLock()
_loaded: Final[dict[str, str]] = {}
_missing: Final[set[str]] = set()


def get_setting(key: str) -> str | None:
    """
    Return the value for *key* from the database, using an in-memory cache.

    Keys are loaded on first access (lazy); unknown keys are cached as missing
    so repeated lookups do not hit the database. Returns ``None`` if the key
    is absent or the stored value is null.
    """
    k = key.strip()
    if not k:
        return None

    with _lock:
        if k in _loaded:
            return _loaded[k]
        if k in _missing:
            return None

    db = SessionLocal()
    try:
        row = db.scalar(select(Setting).where(Setting.key == k))
    finally:
        db.close()

    with _lock:
        if k in _loaded:
            return _loaded[k]
        if row is None or row.value is None:
            _missing.add(k)
            return None
        _missing.discard(k)
        _loaded[k] = row.value
        return row.value


def clear_setting_cache(*keys: str) -> None:
    """
    Drop cached values so the next :func:`get_setting` reloads from the database.

    With no *keys*, clears the entire cache.
    """
    with _lock:
        if not keys:
            _loaded.clear()
            _missing.clear()
            return
        for raw in keys:
            k = raw.strip()
            if not k:
                continue
            _loaded.pop(k, None)
            _missing.discard(k)
