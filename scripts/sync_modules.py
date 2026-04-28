#!/usr/bin/env python3
"""Sync ``MODULE_CONFIG`` into ``features`` / ``permissions`` (action-level dotted codes).

Run from the project root with ``DATABASE_URL`` set (same as Alembic / uvicorn), e.g.::

    ./venv/bin/python scripts/sync_modules.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Ensure backend root is importable (so `import db`, `import modules`, etc. work).
_BACKEND_ROOT = Path(__file__).resolve().parent.parent / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import db.models  # noqa: F401  — register models
from db.session import SessionLocal
from modules.rbac_sync import sync_all_modules_to_db


def main() -> None:
    db = SessionLocal()
    try:
        result = sync_all_modules_to_db(db)
        print(result)
    finally:
        db.close()


if __name__ == "__main__":
    main()
