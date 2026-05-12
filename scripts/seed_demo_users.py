#!/usr/bin/env python3
"""Seed a representative cast of demo users + roles for manual testing.

Each user maps to a single role (with one "stacked" user that gets multiple
roles to exercise OR-style permission combinations). Roles are intentionally
narrow so it is easy to verify RBAC by logging in as each persona.

Run from project root:

    ./venv/bin/python scripts/seed_demo_users.py

Common flags:

    --password <pwd>   override the shared password (must satisfy policy)
    --reset            delete previously-seeded users (matched by username)
                       before re-creating them — useful if you've fiddled
                       with role memberships and want a clean baseline.

Idempotent: safe to run repeatedly. Existing users keep their id/email and
are simply re-attached to the (re-synced) role definitions.

Output: a markdown-style credentials table printed at the end so you can
paste it into a doc / send it over for a UI walkthrough.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

_SCRIPTS_ROOT = Path(__file__).resolve().parent
_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
for _p in (_BACKEND_ROOT, _SCRIPTS_ROOT):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

import db.models  # noqa: F401 — register all models on Base.metadata
from core.password_policy import PasswordPolicyError, validate_password
from core.security import hash_password
from db.session import SessionLocal
from modules.org_units.model import OrgUnit
from modules.permissions.model import Permission
from modules.rbac_association import user_org_unit
from modules.rbac_sync import sync_all_modules_to_db
from modules.roles.model import Role
from modules.users.model import User

from _work_order_demo_workflow import ensure_work_orders_create_workflow


# ---------- role catalog -----------------------------------------------------
#
# Each role is intentionally scoped to one job-to-be-done so QA can verify
# RBAC by logging in as the persona and confirming exactly which screens load
# / which actions are allowed. Only canonical (dotted) permission codes are
# used; ``rbac_sync.sync_all_modules_to_db`` takes care of seeding them in the
# DB before this script touches them.

ROLES: dict[str, dict] = {
    "Plant Admin": {
        "description": "Owns plants (org units) + user/role assignments.",
        "perms": [
            "org_units.view", "org_units.create", "org_units.update", "org_units.delete",
            "users.view", "users.create", "users.update",
            "roles.view",
            "permissions.view",
        ],
    },
    "Contractor Manager": {
        "description": "Full CRUD on contractor master + uploads + plant mappings.",
        "perms": [
            "contractor.view", "contractor.create", "contractor.update",
            "contractor.activate", "contractor.manage_plants",
            "contractor.document.upload",
            "org_units.view",
        ],
    },
    "Contractor Auditor": {
        "description": "Read-only on contractor master, can verify uploaded docs.",
        "perms": [
            "contractor.view",
            "contractor.verify_documents",
            "contractor.document.upload",
        ],
    },
    "Rate Master Admin": {
        "description": "Maintains base rates per plant/job/skill.",
        "perms": [
            "part_master.view", "part_master.create", "part_master.update",
            "part_master.delete",
            "org_units.view",
        ],
    },
    "Procurement Negotiator": {
        "description": "Creates and negotiates contractor rate proposals; submits work orders for approval.",
        "perms": [
            "contractor.view",
            "part_master.view",
            "contractor_rates.view", "contractor_rates.create", "contractor_rates.update",
            "work_orders.view",
            "work_orders.create",
            "work_orders.update",
            "work_orders.manage_completion",
            "approval.view",
        ],
    },
    "Procurement Approver": {
        "description": "Level-1 inbox for negotiated contractor rates.",
        "perms": [
            "contractor.view",
            "contractor_rates.view", "contractor_rates.approve",
            "approval.view", "approval.act",
        ],
    },
    "Work Order Approver (L1)": {
        "description": "Operations level-1 approver for submitted work orders (Tasks inbox).",
        "perms": [
            "work_orders.view",
            "work_orders.approve",
            "approval.view",
            "approval.act",
        ],
    },
    "Work Order Approver (L2)": {
        "description": "Second-level approver after L1 (e.g. plant head / finance) for work order activation.",
        "perms": [
            "work_orders.view",
            "work_orders.approve",
            "approval.view",
            "approval.act",
        ],
    },
    "Approval Workflow Manager": {
        "description": "Owns approval workflow definitions + can act on any task.",
        "perms": [
            "approval.view", "approval.act", "approval.manage",
            "task.view", "task.act", "task.close",
        ],
    },
    "Task Operator": {
        "description": "Inbox-only role: works tasks assigned to them.",
        "perms": ["task.view", "task.act", "task.close"],
    },
    "Notifications Admin": {
        "description": "Curates email templates and notification routing rules.",
        "perms": [
            "email_templates.manage",
            "notification_settings.manage",
            "settings.view",
        ],
    },
    "Read-only Auditor": {
        "description": "View-only across the major modules — useful for compliance reviews.",
        "perms": [
            "users.view",
            "org_units.view",
            "contractor.view",
            "part_master.view",
            "contractor_rates.view",
            "approval.view",
            "task.view",
        ],
    },
}


# ---------- user roster ------------------------------------------------------
#
# Tuple shape: (username, email, full_name, phone, [role_name, ...]).
# The username is stable across runs; passwords are taken from --password.
# The order of this list is preserved in the printed credentials table.

USERS: list[tuple[str, str, str, str, list[str]]] = [
    ("plant_admin",   "plant.admin@demo.test",   "Priya Plant",       "+15550200001", ["Plant Admin"]),
    ("ctr_manager",   "ctr.manager@demo.test",   "Carlos Contractor", "+15550200002", ["Contractor Manager"]),
    ("ctr_auditor",   "ctr.auditor@demo.test",   "Aisha Auditor",     "+15550200003", ["Contractor Auditor"]),
    ("rate_admin",    "rate.admin@demo.test",    "Ravi Rates",        "+15550200004", ["Rate Master Admin"]),
    ("negotiator",    "negotiator@demo.test",    "Nora Negotiator",   "+15550200005", ["Procurement Negotiator"]),
    ("rate_approver", "rate.approver@demo.test", "Aaron Approver",    "+15550200006",
     ["Procurement Approver", "Work Order Approver (L1)"]),
    ("wo_approver1", "wo.approver1@demo.test", "Owen WO Approver", "+15550200011", ["Work Order Approver (L1)"]),
    ("wo_approver2", "wo.approver2@demo.test", "Olivia WO L2", "+15550200012", ["Work Order Approver (L2)"]),
    ("wf_manager",    "wf.manager@demo.test",    "Wendy Workflow",    "+15550200007", ["Approval Workflow Manager"]),
    ("task_operator", "task.operator@demo.test", "Tara Tasks",        "+15550200008", ["Task Operator"]),
    ("notif_admin",   "notif.admin@demo.test",   "Nikhil Notify",     "+15550200009", ["Notifications Admin"]),
    ("auditor",       "auditor@demo.test",       "Quinn Quality",     "+15550200010", ["Read-only Auditor"]),
    # Stacked persona: a single user holding multiple roles. Lets QA verify
    # OR-style permission guards (e.g. plant pickers gated on any-of).
    ("super_demo",    "super.demo@demo.test",    "Sam Super",         "+15550200099",
     ["Contractor Manager", "Procurement Negotiator", "Procurement Approver", "Work Order Approver (L1)"]),
]


# ---------- helpers ----------------------------------------------------------


def _perm_ids_for_codes(db: Session, codes: list[str]) -> list[int]:
    ids: list[int] = []
    missing: list[str] = []
    for code in codes:
        canonical = code.strip()
        row = db.scalar(select(Permission).where(Permission.code == canonical))
        if row is None and "." in canonical:
            legacy = canonical.replace(".", ":", 1)
            row = db.scalar(select(Permission).where(Permission.code == legacy))
        if row is None:
            missing.append(canonical)
            continue
        ids.append(int(row.id))
    if missing:
        raise RuntimeError(
            "Missing permission codes in DB: "
            + ", ".join(repr(c) for c in missing)
            + ". Run scripts/sync_modules.py first."
        )
    return sorted(set(ids))


def _upsert_role(
    db: Session, *, name: str, description: str, permission_codes: list[str]
) -> Role:
    role = db.scalar(select(Role).where(Role.name == name))
    perm_ids = _perm_ids_for_codes(db, permission_codes)
    if role is None:
        role = Role(name=name.strip(), description=description)
        db.add(role)
        db.flush()
    else:
        role.description = description
    role.permissions = list(
        db.scalars(select(Permission).where(Permission.id.in_(perm_ids))).all()
    )
    role.org_units = []  # global role across all plants
    db.commit()
    db.refresh(role)
    return role


def _upsert_user(
    db: Session,
    *,
    username: str,
    email: str,
    full_name: str,
    phone: str,
    password: str,
    roles: list[Role],
    org: OrgUnit,
) -> User:
    """Create or update a demo user; resets roles to exactly ``roles``.

    Resetting (rather than appending) makes the script idempotent across
    role-catalog edits — a user previously created with two roles will be
    pared down to one if the catalog now lists only one.
    """
    existing = db.scalar(
        select(User).where((User.username == username) | (User.email == email))
    )
    now = datetime.now(timezone.utc)

    if existing is None:
        u = User(
            full_name=full_name.strip(),
            username=username.strip(),
            email=email.strip().lower(),
            phone=phone.strip(),
            hashed_password=hash_password(password),
            password_changed_at=now,
            is_active=True,
            is_superuser=False,
        )
        u.roles = list(roles)
        db.add(u)
        db.flush()
        db.execute(delete(user_org_unit).where(user_org_unit.c.user_id == u.id))
        db.execute(user_org_unit.insert().values(user_id=u.id, org_unit_id=org.id))
        db.commit()
        db.refresh(u)
        return u

    # Reset role membership to match the catalog exactly.
    existing.roles = list(roles)
    if not existing.is_active:
        existing.is_active = True
    db.execute(delete(user_org_unit).where(user_org_unit.c.user_id == existing.id))
    db.execute(user_org_unit.insert().values(user_id=existing.id, org_unit_id=org.id))
    # Re-set the password every run so a forgotten override is recoverable.
    existing.hashed_password = hash_password(password)
    existing.password_changed_at = now
    db.commit()
    db.refresh(existing)
    return existing


def _upsert_all_access_user(db: Session, *, password: str, org: OrgUnit) -> User:
    """
    Create/update a single *normal* demo user with all access via RBAC.

    This user is NOT a superuser. Instead, we create/update an "All Access"
    role containing every permission code present in the DB and assign it.
    """
    username = "all_access"
    email = "all.access@demo.test"
    full_name = "All Access Admin"
    phone = "+15550999999"

    # Ensure an RBAC role that includes *all* permissions currently in the DB.
    sync_all_modules_to_db(db)
    all_codes = list(db.scalars(select(Permission.code).order_by(Permission.code.asc())).all())
    all_role = _upsert_role(
        db,
        name="All Access",
        description="All permissions (seeded). Normal user, not superadmin.",
        permission_codes=all_codes,
    )

    existing = db.scalar(select(User).where((User.username == username) | (User.email == email)))
    now = datetime.now(timezone.utc)
    if existing is None:
        u = User(
            full_name=full_name,
            username=username,
            email=email,
            phone=phone,
            hashed_password=hash_password(password),
            password_changed_at=now,
            is_active=True,
            is_superuser=False,
        )
        u.roles = [all_role]
        db.add(u)
        db.flush()
        db.execute(delete(user_org_unit).where(user_org_unit.c.user_id == u.id))
        db.execute(user_org_unit.insert().values(user_id=u.id, org_unit_id=org.id))
        db.commit()
        db.refresh(u)
        return u

    existing.full_name = full_name
    existing.username = username
    existing.email = email
    existing.phone = phone
    if not existing.is_active:
        existing.is_active = True
    if existing.is_superuser:
        existing.is_superuser = False
    # Force role membership to the all-permissions role.
    existing.roles = [all_role]
    db.execute(delete(user_org_unit).where(user_org_unit.c.user_id == existing.id))
    db.execute(user_org_unit.insert().values(user_id=existing.id, org_unit_id=org.id))
    existing.hashed_password = hash_password(password)
    existing.password_changed_at = now
    db.commit()
    db.refresh(existing)
    return existing


def _reset_demo_users(db: Session) -> int:
    """Delete previously-seeded demo users (matched by username).

    User rows have foreign-key dependencies (audit logs, tasks, etc.) so this
    only runs when the user explicitly passes ``--reset`` to avoid surprises.
    """
    usernames = [row[0] for row in USERS]
    rows = list(
        db.scalars(select(User).where(User.username.in_(usernames))).all()
    )
    for u in rows:
        db.delete(u)
    db.commit()
    return len(rows)


# ---------- main -------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed a representative cast of demo users + roles for manual testing."
    )
    parser.add_argument(
        "--password",
        default="DemoPass123!",
        help="Shared password for every seeded user (default: DemoPass123!).",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete previously-seeded demo users before re-creating them.",
    )
    args = parser.parse_args()

    try:
        validate_password(args.password)
    except PasswordPolicyError as exc:
        print(f"error: password policy: {exc.error}", file=sys.stderr)
        return 2

    db = SessionLocal()
    try:
        sync_all_modules_to_db(db)

        org = db.scalars(
            select(OrgUnit).where(OrgUnit.type == "PLANT").order_by(OrgUnit.id.asc())
        ).first()
        if org is None:
            print(
                "error: no PLANT org unit found. Seed plants (e.g. scripts/seed_manual_test_contractors.py) first.",
                file=sys.stderr,
            )
            return 3

        if args.reset:
            removed = _reset_demo_users(db)
            print(f"--reset: removed {removed} pre-existing demo users.")

        # 1) Roles.
        created_roles: dict[str, Role] = {}
        for name, cfg in ROLES.items():
            created_roles[name] = _upsert_role(
                db,
                name=name,
                description=cfg["description"],
                permission_codes=list(cfg["perms"]),
            )

        wo_l1 = created_roles["Work Order Approver (L1)"]
        wo_l2 = created_roles.get("Work Order Approver (L2)")
        if ensure_work_orders_create_workflow(db, approver_role_l1=wo_l1, approver_role_l2=wo_l2):
            if wo_l2 is not None:
                print(
                    "Approval mapping: work_orders.create → two-step workflow "
                    '(L1: "Work Order Approver (L1)" → wo.approver1@demo.test; '
                    'L2: "Work Order Approver (L2)" → wo.approver2@demo.test). '
                    "Other mappings for that action were deactivated."
                )
            else:
                print(
                    "Approval mapping: work_orders.create → single-step workflow "
                    '(role "Work Order Approver (L1)" → e.g. wo.approver1@demo.test). '
                    "Other mappings for that action were deactivated."
                )
        else:
            print(
                "warning: could not map work_orders.create (missing permission?) — "
                "run scripts/sync_modules.py then re-run this seed.",
                file=sys.stderr,
            )

        # 2) Users.
        seeded: list[tuple[str, str, str, list[str], User]] = []
        for username, email, full_name, phone, role_names in USERS:
            roles = [created_roles[rn] for rn in role_names]
            u = _upsert_user(
                db,
                username=username,
                email=email,
                full_name=full_name,
                phone=phone,
                password=args.password,
                roles=roles,
                org=org,
            )
            seeded.append((username, email, full_name, role_names, u))

        # 2b) One normal user with all access (RBAC role with all perms).
        all_access = _upsert_all_access_user(db, password=args.password, org=org)
        seeded.append((all_access.username, all_access.email, all_access.full_name, ["All Access (all perms)"], all_access))

        # 3) Pretty-print credentials table.
        print()
        print("=" * 78)
        print("Demo users seeded — login with `username` OR `email` + the shared password")
        print("=" * 78)
        print()

        # ASCII table — easier to copy/paste than a raw markdown table when
        # the destination is a terminal-rendered chat or a plain-text doc.
        col_username = max(len("Username"), max(len(r[0]) for r in USERS))
        col_email = max(len("Email"), max(len(r[1]) for r in USERS))
        col_full = max(len("Full name"), max(len(r[2]) for r in USERS))
        col_role = max(
            len("Role(s)"),
            max(len(", ".join(r[4])) for r in USERS),
        )

        def _row(a: str, b: str, c: str, d: str) -> str:
            return f"| {a.ljust(col_username)} | {b.ljust(col_email)} | {c.ljust(col_full)} | {d.ljust(col_role)} |"

        sep = "+" + "-" * (col_username + 2) + "+" + "-" * (col_email + 2) + "+" + "-" * (col_full + 2) + "+" + "-" * (col_role + 2) + "+"
        print(sep)
        print(_row("Username", "Email", "Full name", "Role(s)"))
        print(sep)
        for username, email, full_name, role_names, _u in seeded:
            print(_row(username, email, full_name, ", ".join(role_names)))
        print(sep)

        print()
        print(f"Shared password: {args.password!r}")
        print(
            "Logins accept either ``username`` or ``email``. "
            "Plant assignment for every user: "
            f"org_unit_id={int(org.id)} ({org.name!r})."
        )
        print()
        print("Try:")
        print("  • POST /login with {username, password}  → access_token")
        print("  • Or open the UI at /login and use the table above.")

        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
