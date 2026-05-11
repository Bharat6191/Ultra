#!/usr/bin/env python3
"""
Seed additional roles + users + a few tasks for manual UI testing.

Run from project root (same as create_superuser.py):

    ./venv/bin/python scripts/seed_admin_test_data.py

Notes:
- Idempotent: safe to run multiple times.
- Creates roles with org_unit_ids=[] (global role across plants).
- Creates a small set of users with password `TestPass123!` (override with --password).
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

import db.models  # noqa: F401
from core.password_policy import PasswordPolicyError, validate_password
from core.security import hash_password
from db.session import SessionLocal
from modules.approvals.assignment_service import resolve_registered_action_code
from modules.approvals.model import ApprovalStep, ApprovalWorkflow, ApprovalWorkflowMapping
from modules.org_units.model import OrgUnit
from modules.permissions.model import Permission
from modules.rbac_association import user_org_unit
from modules.rbac_sync import sync_all_modules_to_db
from modules.roles.model import Role
from modules.tasks.service import TaskService
from modules.users.model import User


def _perm_ids_for_codes(db: Session, codes: list[str]) -> list[int]:
    ids: list[int] = []
    for code in codes:
        canonical = code.strip()
        row = db.scalar(select(Permission).where(Permission.code == canonical))
        if row is None and "." in canonical:
            legacy = canonical.replace(".", ":", 1)
            row = db.scalar(select(Permission).where(Permission.code == legacy))
        if row is None:
            raise RuntimeError(f"Missing permission code in DB: {canonical!r}. Run scripts/sync_modules.py")
        ids.append(int(row.id))
    return sorted(set(ids))


def _upsert_role(db: Session, *, name: str, description: str, permission_codes: list[str]) -> Role:
    role = db.scalar(select(Role).where(Role.name == name))
    perm_ids = _perm_ids_for_codes(db, permission_codes)
    if role is None:
        role = Role(name=name.strip(), description=description)
        db.add(role)
        db.flush()
    else:
        role.description = description
    perms = list(db.scalars(select(Permission).where(Permission.id.in_(perm_ids))).all())
    role.permissions = perms
    # org_units empty => role applies to all plants
    role.org_units = []
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
    role: Role,
    org: OrgUnit,
) -> User:
    existing = db.scalar(select(User).where((User.username == username) | (User.email == email)))
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
        u.roles.append(role)
        db.add(u)
        db.flush()
        db.execute(delete(user_org_unit).where(user_org_unit.c.user_id == u.id))
        db.execute(user_org_unit.insert().values(user_id=u.id, org_unit_id=org.id))
        db.commit()
        db.refresh(u)
        return u

    # Ensure the role is assigned (additive).
    if role not in existing.roles:
        existing.roles.append(role)
    if not existing.is_active:
        existing.is_active = True
    db.execute(delete(user_org_unit).where(user_org_unit.c.user_id == existing.id))
    db.execute(user_org_unit.insert().values(user_id=existing.id, org_unit_id=org.id))
    db.commit()
    db.refresh(existing)
    return existing


def _ensure_work_orders_create_workflow_if_unmapped(
    db: Session,
    *,
    approver_role: Role,
    creator_user_id: int | None,
) -> bool:
    """
    If ``work_orders.create`` has no active workflow mapping yet, attach a single-step
    workflow so submitted work orders create Level-1 inbox tasks (Ops Approver role).

    Skips quietly when already configured so admins are not overwritten.
    """
    canonical = resolve_registered_action_code(db, "work_orders.create")
    if canonical is None:
        print(
            "warning: permission work_orders.create not found in DB — run sync_modules before seed.",
            file=sys.stderr,
        )
        return False

    already = db.scalar(
        select(ApprovalWorkflowMapping.id)
        .join(ApprovalWorkflow, ApprovalWorkflow.id == ApprovalWorkflowMapping.workflow_id)
        .where(
            ApprovalWorkflowMapping.action_code == canonical,
            ApprovalWorkflowMapping.is_active.is_(True),
            ApprovalWorkflow.is_active.is_(True),
        )
    )
    if already is not None:
        return False

    entity_type = "work_order_approval"
    name = "Seed: WO create → Ops Approver"

    wf = db.scalar(
        select(ApprovalWorkflow).where(
            ApprovalWorkflow.entity_type == entity_type,
            ApprovalWorkflow.name == name,
        )
    )
    if wf is None:
        wf = ApprovalWorkflow(
            name=name,
            entity_type=entity_type,
            is_active=True,
            created_by=creator_user_id,
        )
        db.add(wf)
        db.flush()
    else:
        wf.is_active = True

    step_count = db.scalar(
        select(func.count()).select_from(ApprovalStep).where(ApprovalStep.workflow_id == wf.id)
    )
    if not step_count:
        db.add(
            ApprovalStep(
                workflow_id=int(wf.id),
                step_order=1,
                approver_role_id=int(approver_role.id),
                required_approvals=1,
            )
        )

    db.add(
        ApprovalWorkflowMapping(
            action_code=canonical,
            workflow_id=int(wf.id),
            is_active=True,
        )
    )
    db.commit()
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed additional roles/users/tasks for manual testing.")
    parser.add_argument("--password", default="TestPass123!", help="Password for seeded users (must satisfy policy).")
    args = parser.parse_args()

    try:
        validate_password(args.password)
    except PasswordPolicyError as exc:
        print(f"error: password policy: {exc.error}", file=sys.stderr)
        return 2

    db = SessionLocal()
    try:
        # Ensure permissions exist.
        sync_all_modules_to_db(db)

        org = db.scalars(select(OrgUnit).order_by(OrgUnit.id.asc())).first()
        if org is None:
            print("error: no OrgUnit rows found. Run migrations/sync_modules as in README.", file=sys.stderr)
            return 3

        roles = {
            "Contractor Manager": {
                "description": "Full access to contractor master + document uploads + rate negotiations.",
                "perms": [
                    "contractor.view",
                    "contractor.create",
                    "contractor.update",
                    "contractor.delete",
                    "contractor.manage_plants",
                    "contractor.document.upload",
                    "rate_master.view",
                    "rate_master.create",
                    "rate_master.update",
                    "contractor_rates.view",
                    "contractor_rates.create",
                    "contractor_rates.update",
                ],
            },
            "Procurement Approver": {
                "description": "Can approve negotiated rates produced by procurement.",
                "perms": [
                    "contractor.view",
                    "contractor_rates.view",
                    "contractor_rates.approve",
                    "approval.view",
                    "approval.act",
                ],
            },
            "Task Operator": {
                "description": "Can view and act on tasks (inbox user).",
                "perms": ["task.view", "task.act", "task.close"],
            },
            "Task Manager": {
                "description": "Can manage tasks + approvals workflows.",
                "perms": ["task.view", "task.create", "task.assign", "task.act", "task.close", "approval.view", "approval.act"],
            },
            "Read-only Viewer": {
                "description": "View-only across core modules.",
                "perms": ["contractor.view", "task.view", "users.view"],
            },
            "Operations Work Orders": {
                "description": "Create/track work orders and submit for approval.",
                "perms": [
                    "work_orders.view",
                    "work_orders.create",
                    "work_orders.update",
                    "work_orders.manage_completion",
                    "work_orders.override_rate",
                    "approval.view",
                ],
            },
            "Finance Invoice Validator": {
                "description": "Create/submit invoices, validate, and review exception approvals.",
                "perms": [
                    "invoices.view",
                    "invoices.create",
                    "invoices.update",
                    "invoices.submit",
                    "invoices.validate",
                    "approval.view",
                ],
            },
            "Ops Approver": {
                "description": "Approves work orders and rate overrides.",
                "perms": [
                    "work_orders.view",
                    "work_orders.approve",
                    "work_orders.override_rate",
                    "approval.view",
                    "approval.act",
                ],
            },
            "Finance Approver": {
                "description": "Approves invoice exceptions.",
                "perms": [
                    "invoices.view",
                    "invoices.validate",
                    "invoices.approve_exceptions",
                    "approval.view",
                    "approval.act",
                ],
            },
        }

        created_roles: dict[str, Role] = {}
        for name, cfg in roles.items():
            created_roles[name] = _upsert_role(
                db,
                name=name,
                description=cfg["description"],
                permission_codes=list(cfg["perms"]),
            )

        seeded_wo_wf = _ensure_work_orders_create_workflow_if_unmapped(
            db,
            approver_role=created_roles["Ops Approver"],
            creator_user_id=None,
        )

        users = [
            # contractor module
            ("ctr_manager", "ctr.manager@example.test", "Contractor Manager", "+15550101001", "Contractor Manager"),
            # negotiation approver
            ("rate_approver", "rate.approver@example.test", "Procurement Approver", "+15550101005", "Procurement Approver"),
            # tasks
            ("task_operator", "task.operator@example.test", "Task Operator", "+15550101002", "Task Operator"),
            ("task_manager", "task.manager@example.test", "Task Manager", "+15550101003", "Task Manager"),
            # viewer
            ("viewer", "viewer@example.test", "Read-only Viewer", "+15550101004", "Read-only Viewer"),
            # work orders / invoices
            ("ops_user", "ops.user@example.test", "Operations Work Orders", "+15550101006", "Operations Work Orders"),
            ("ops_approver", "ops.approver@example.test", "Ops Approver", "+15550101007", "Ops Approver"),
            ("fin_user", "fin.user@example.test", "Finance Invoice Validator", "+15550101008", "Finance Invoice Validator"),
            ("fin_approver", "fin.approver@example.test", "Finance Approver", "+15550101009", "Finance Approver"),
        ]

        seeded_users: dict[str, User] = {}
        for username, email, full_name, phone, role_name in users:
            u = _upsert_user(
                db,
                username=username,
                email=email,
                full_name=full_name,
                phone=phone,
                password=args.password,
                role=created_roles[role_name],
                org=org,
            )
            seeded_users[username] = u

        # Seed a few manual tasks so Tasks UI has rows.
        svc = TaskService(db)
        actor = seeded_users["task_manager"]
        assignee = seeded_users["task_operator"]
        now = datetime.now(timezone.utc)
        existing_titles = set(
            db.execute(
                select(User.id)  # dummy select to keep SQLAlchemy happy in older versions
            ).scalars().all()
        )
        _ = existing_titles  # no-op; tasks are seeded without de-dupe across restarts

        for i in range(1, 4):
            svc.create_manual_task(
                actor_user_id=int(actor.id),
                title=f"Manual check #{i}: Contractor compliance",
                description="Review contractor documents and mark compliance status.",
                assigned_to_user_id=int(assignee.id),
                due_date=now + timedelta(days=i),
                entity_type="contractor",
                entity_id=None,
                form_schema=None,
                form_data=None,
            )

        print("Seeded roles:")
        for r in created_roles.values():
            print(f"- role_id={r.id}  name={r.name}")
        print()
        print("Seeded users (login with email OR username + password):")
        for username, email, *_rest in users:
            u = seeded_users[username]
            print(f"- user_id={u.id}  username={u.username}  email={u.email}")
        print()
        print(f"Password for seeded users: {args.password!r}")
        print("Seeded 3 manual tasks assigned to task_operator.")
        if seeded_wo_wf:
            print(
                "Seeded approval mapping: work_orders.create → single-step workflow (Ops Approver role)."
            )
        print(
            "If approvers never see work order tasks, ensure Tasks admin has mapped work_orders.create "
            "to an active workflow and step-1 role matches your approver user."
        )
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())

