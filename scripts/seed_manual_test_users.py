#!/usr/bin/env python3
"""Create a few normal (non-superuser) accounts for manual testing.

Run from the project root (same as ``create_superuser.py``), e.g.::

    ./venv/bin/python scripts/seed_manual_test_users.py

Uses the first Role and first OrgUnit in the database. Users are created
directly (not via approval flow) so they are active immediately.

Default password for all seeded users: ``TestPass123!`` (override with ``--password``).
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.password_policy import PasswordPolicyError, validate_password
from core.security import hash_password
from db.session import SessionLocal
from modules.org_units.model import OrgUnit
from modules.rbac_association import user_org_unit
from modules.roles.model import Role
from modules.users.model import User

import db.models  # noqa: F401


def _upsert_user(
    db: Session,
    *,
    email: str,
    phone: str,
    full_name: str,
    password: str,
    role: Role,
    org: OrgUnit,
) -> tuple[User, bool]:
    """Return (user, created)."""
    now = datetime.now(timezone.utc)
    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None:
        return existing, False

    user = User(
        full_name=full_name,
        email=email,
        phone=phone,
        hashed_password=hash_password(password),
        password_changed_at=now,
        is_active=True,
        is_superuser=False,
    )
    user.roles.append(role)
    db.add(user)
    db.flush()

    db.execute(delete(user_org_unit).where(user_org_unit.c.user_id == user.id))
    db.execute(user_org_unit.insert().values(user_id=user.id, org_unit_id=org.id))
    return user, True


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed manual test users (non-superuser).")
    parser.add_argument(
        "--password",
        default="TestPass123!",
        help="Plain password shared by all seeded users (must satisfy password policy).",
    )
    args = parser.parse_args()

    try:
        validate_password(args.password)
    except PasswordPolicyError as exc:
        print(f"error: password policy: {exc.error}", file=sys.stderr)
        return 2

    db = SessionLocal()
    try:
        role = db.scalars(select(Role).order_by(Role.id.asc())).first()
        org = db.scalars(select(OrgUnit).order_by(OrgUnit.id.asc())).first()
        if role is None:
            print("error: no Role rows found. Create a role in the admin UI or seed the DB.", file=sys.stderr)
            return 3
        if org is None:
            print("error: no OrgUnit rows found. Run migrations/sync_modules as in README.", file=sys.stderr)
            return 4

        seeds = [
            ("manual1@example.test", "+15550100001", "Manual Tester 1"),
            ("manual2@example.test", "+15550100002", "Manual Tester 2"),
            ("manual3@example.test", "+15550100003", "Manual Tester 3"),
        ]

        print(f"Using role_id={role.id} ({role.name!r}), org_unit_id={org.id}")
        print()
        for email, phone, full_name in seeds:
            try:
                user, created = _upsert_user(
                    db,
                    email=email,
                    phone=phone,
                    full_name=full_name,
                    password=args.password,
                    role=role,
                    org=org,
                )
                db.commit()
                db.refresh(user)
            except IntegrityError:
                db.rollback()
                print(f"error: could not create {email} (unique constraint)", file=sys.stderr)
                return 5

            status = "created" if created else "already existed"
            print(f"{status}: id={user.id}  email={user.email}  phone={user.phone}")

        print()
        print("Login with email + password (POST /login JSON body).")
        print(f"Password for all listed accounts: {args.password!r}")
    finally:
        db.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
