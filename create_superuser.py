#!/usr/bin/env python3
"""Create a database user with ``is_superuser=True``.

Run from the project root (same layout as ``alembic`` / ``uvicorn``), e.g.::

    ./venv/bin/python create_superuser.py --email admin@example.com --password '...'
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

# Ensure backend root is importable (so `import core`, `import modules`, etc. work).
BACKEND_ROOT = Path(__file__).resolve().parent / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from core.password_policy import PasswordPolicyError, validate_password
from core.security import hash_password
from db.session import SessionLocal
from modules.users.model import User
import db.models  # noqa: F401


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a superuser (is_superuser=True).")
    parser.add_argument("--email", required=True, help="Login email (stored lowercased).")
    parser.add_argument("--password", required=True, help="Plain password (validated against settings).")
    parser.add_argument(
        "--phone",
        required=False,
        help="Unique phone number for this user (recommended). If omitted, a deterministic placeholder is generated.",
    )
    parser.add_argument(
        "--full-name",
        required=False,
        default="",
        help="Display name for this user (defaults to the email local-part).",
    )
    args = parser.parse_args()

    email = args.email.strip().lower()
    if not email:
        print("error: email is empty", file=sys.stderr)
        return 1

    try:
        validate_password(args.password)
    except PasswordPolicyError as exc:
        print(f"error: password policy: {exc.error}", file=sys.stderr)
        return 2

    now = datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        existing = db.scalar(select(User).where(User.email == email))
        if existing is not None:
            changed = False
            if not existing.full_name:
                existing.full_name = (args.full_name or email.split("@", 1)[0]).strip() or email
                changed = True
            if not existing.phone:
                existing.phone = args.phone or f"+1000000{existing.id}"
                changed = True
            if changed:
                try:
                    db.commit()
                except IntegrityError:
                    db.rollback()
                    print("error: could not backfill full_name/phone for existing user", file=sys.stderr)
                    return 5
            print(f"ok: superuser already exists id={existing.id} email={existing.email}")
            return 0

        full_name = (args.full_name or email.split("@", 1)[0]).strip() or email
        user = User(
            username=email.split("@")[0],
            full_name=full_name,
            email=email,
            phone=None,
            hashed_password=hash_password(args.password),
            password_changed_at=now,
            is_superuser=True,
        )
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            print(f"error: could not create user (constraint): {email}", file=sys.stderr)
            return 4
        db.refresh(user)

        # Ensure phone uniqueness after we know the id.
        user.phone = args.phone or f"+1000000{user.id}"
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            print("error: could not assign a unique phone number; pass --phone explicitly", file=sys.stderr)
            return 6
        db.refresh(user)
    finally:
        db.close()

    print(f"ok: superuser id={user.id} email={user.email} phone={user.phone}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
