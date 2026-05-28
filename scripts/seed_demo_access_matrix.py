#!/usr/bin/env python3
"""Seed demo RBAC personas from a presentation-friendly access matrix.

This script creates four demo roles based on the matrix shared by the user:

* ``Admin``
* ``COO``
* ``PPM``
* ``Controller``

It also creates demo users for each role and repoints the core demo approval
flows so task routing matches the matrix:

* Negotiation approval -> ``COO``
* Work order review / approval -> ``Controller``
* Exceptional invoice approval -> ``COO``

Idempotent and safe to run on every container start.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session, selectinload

import db.models  # noqa: F401
from core.password_policy import PasswordPolicyError, validate_password
from core.security import hash_password
from db.session import SessionLocal
from modules.approvals.assignment_service import resolve_registered_action_code
from modules.approvals.model import ApprovalRequest, ApprovalStep, ApprovalTask, ApprovalWorkflow, ApprovalWorkflowMapping
from modules.contractor_rates.service import ACTION_CODE_CREATE as ACTION_CODE_NEGOTIATION_CREATE
from modules.contractor_rates.service import APPROVAL_ENTITY_TYPE as CONTRACTOR_RATE_ENTITY_TYPE
from modules.invoices.service import ACTION_CODE_EXCEPTION_APPROVE as ACTION_CODE_INVOICE_EXCEPTION_APPROVE
from modules.invoices.service import APPROVAL_ENTITY_TYPE as INVOICE_EXCEPTION_ENTITY_TYPE
from modules.org_units.model import OrgUnit
from modules.permissions.model import Permission
from modules.rbac_association import user_org_unit
from modules.rbac_sync import sync_all_modules_to_db
from modules.roles.model import Role
from modules.users.model import User
from modules.work_orders.service import ACTION_CODE_CREATE as ACTION_CODE_WORK_ORDER_CREATE


WORK_ORDER_ENTITY_TYPE = "work_order_approval"


ROLE_MATRIX: dict[str, dict[str, object]] = {
    "Admin": {
        "description": "Full demo administrator across user, role, negotiation, work order, and invoice flows.",
        "perms": "__all__",
    },
    "COO": {
        "description": "Approves negotiated rates and exceptional blocked invoices.",
        "perms": [
            "contractor.view",
            "part_master.view",
            "contractor_rates.view",
            "contractor_rates.approve",
            "invoices.view",
            "invoices.validate",
            "invoices.approve_exceptions",
            "approval.view",
            "approval.act",
        ],
    },
    "PPM": {
        "description": "Manages negotiations, reviews rates, creates work orders, and updates invoices.",
        "perms": [
            "contractor.view",
            "org_units.view",
            "part_master.view",
            "contractor_rates.view",
            "contractor_rates.create",
            "contractor_rates.update",
            "work_orders.view",
            "work_orders.create",
            "work_orders.update",
            "work_orders.manage_completion",
            "invoices.view",
            "invoices.create",
            "invoices.update",
            "invoices.submit",
            "invoices.validate",
            "approval.view",
        ],
    },
    "Controller": {
        "description": "Reviews and approves submitted work orders.",
        "perms": [
            "work_orders.view",
            "work_orders.approve",
            "approval.view",
            "approval.act",
        ],
    },
}


USERS: list[tuple[str, str, str, str, list[str]]] = [
    ("admin_demo", "admin.demo@demo.test", "Demo Admin", "+15550300001", ["Admin", "COO", "PPM", "Controller"]),
    ("coo_demo", "coo.demo@demo.test", "Demo COO", "+15550300002", ["COO"]),
    ("ppm_demo", "ppm.demo@demo.test", "Demo PPM", "+15550300003", ["PPM"]),
    ("controller_demo", "controller.demo@demo.test", "Demo Controller", "+15550300004", ["Controller"]),
]


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
            + ". Run sync_modules first."
        )
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
    role.permissions = list(db.scalars(select(Permission).where(Permission.id.in_(perm_ids))).all())
    role.org_units = []
    db.commit()
    db.refresh(role)
    return role


def _default_org(db: Session) -> OrgUnit | None:
    plant = db.scalars(select(OrgUnit).where(OrgUnit.type == "PLANT").order_by(OrgUnit.id.asc())).first()
    if plant is not None:
        return plant
    return db.scalars(select(OrgUnit).order_by(OrgUnit.id.asc())).first()


def _upsert_user(
    db: Session,
    *,
    username: str,
    email: str,
    full_name: str,
    phone: str,
    password: str,
    roles: list[Role],
    org: OrgUnit | None,
) -> User:
    existing = db.scalar(select(User).where((User.username == username) | (User.email == email)))
    now = datetime.now(timezone.utc)
    if existing is None:
        user = User(
            full_name=full_name.strip(),
            username=username.strip(),
            email=email.strip().lower(),
            phone=phone.strip(),
            hashed_password=hash_password(password),
            password_changed_at=now,
            is_active=True,
            is_superuser=False,
        )
        user.roles = list(roles)
        db.add(user)
        db.flush()
        if org is not None:
            db.execute(delete(user_org_unit).where(user_org_unit.c.user_id == user.id))
            db.execute(user_org_unit.insert().values(user_id=user.id, org_unit_id=org.id))
        db.commit()
        db.refresh(user)
        return user

    existing.roles = list(roles)
    existing.is_active = True
    existing.hashed_password = hash_password(password)
    existing.password_changed_at = now
    if org is not None:
        db.execute(delete(user_org_unit).where(user_org_unit.c.user_id == existing.id))
        db.execute(user_org_unit.insert().values(user_id=existing.id, org_unit_id=org.id))
    db.commit()
    db.refresh(existing)
    return existing


def _repoint_pending_role_tasks(db: Session, *, entity_type: str, approver_role_id: int) -> int:
    tasks = list(
        db.scalars(
            select(ApprovalTask)
            .join(ApprovalRequest, ApprovalRequest.id == ApprovalTask.request_id)
            .options(selectinload(ApprovalTask.step))
            .where(
                ApprovalTask.task_type == "approval",
                ApprovalTask.status.in_(("open", "pending", "in_progress")),
                ApprovalRequest.entity_type == entity_type,
                ApprovalRequest.status == "pending",
            )
        ).all()
    )
    updated = 0
    for task in tasks:
        if task.assigned_role_id != int(approver_role_id):
            task.assigned_role_id = int(approver_role_id)
            task.assigned_user_id = None
            updated += 1
        if task.step is not None and int(task.step.approver_role_id) != int(approver_role_id):
            task.step.approver_role_id = int(approver_role_id)
    return updated


def _ensure_single_step_workflow(
    db: Session,
    *,
    action_code: str,
    entity_type: str,
    approver_role: Role,
    workflow_name: str,
) -> ApprovalWorkflow:
    canonical = resolve_registered_action_code(db, action_code) or action_code
    wf = db.scalar(
        select(ApprovalWorkflow).where(
            ApprovalWorkflow.entity_type == entity_type,
            ApprovalWorkflow.name == workflow_name,
        )
    )
    if wf is None:
        wf = ApprovalWorkflow(
            name=workflow_name,
            entity_type=entity_type,
            is_active=True,
            created_by=None,
        )
        db.add(wf)
        db.flush()
    else:
        wf.is_active = True

    db.execute(delete(ApprovalStep).where(ApprovalStep.workflow_id == int(wf.id)))
    db.add(
        ApprovalStep(
            workflow_id=int(wf.id),
            step_order=1,
            approver_role_id=int(approver_role.id),
            required_approvals=1,
        )
    )
    db.flush()

    mappings = list(
        db.scalars(select(ApprovalWorkflowMapping).where(ApprovalWorkflowMapping.action_code == canonical)).all()
    )
    target_mapping = next((m for m in mappings if int(m.workflow_id) == int(wf.id)), None)

    # Clear all active mappings for this action first so the partial unique index
    # on ``(action_code) WHERE is_active`` never sees two active rows mid-flush.
    db.execute(
        update(ApprovalWorkflowMapping)
        .where(ApprovalWorkflowMapping.action_code == canonical)
        .values(is_active=False)
    )
    db.flush()

    if target_mapping is None:
        db.add(
            ApprovalWorkflowMapping(
                action_code=canonical,
                workflow_id=int(wf.id),
                is_active=True,
            )
        )
    else:
        target_mapping.is_active = True

    _repoint_pending_role_tasks(db, entity_type=entity_type, approver_role_id=int(approver_role.id))
    db.commit()
    db.refresh(wf)
    return wf


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed demo access-matrix users, roles, and workflow routing.")
    parser.add_argument("--password", default="DemoPass123!", help="Password for the demo access-matrix users.")
    args = parser.parse_args()

    try:
        validate_password(args.password)
    except PasswordPolicyError as exc:
        print(f"error: password policy: {exc.error}", file=sys.stderr)
        return 2

    db = SessionLocal()
    try:
        sync_all_modules_to_db(db)
        org = _default_org(db)

        all_codes = list(db.scalars(select(Permission.code).order_by(Permission.code.asc())).all())
        created_roles: dict[str, Role] = {}
        for name, cfg in ROLE_MATRIX.items():
            codes = all_codes if cfg["perms"] == "__all__" else list(cfg["perms"])  # type: ignore[arg-type]
            created_roles[name] = _upsert_role(
                db,
                name=name,
                description=str(cfg["description"]),
                permission_codes=codes,
            )

        created_users: list[User] = []
        for username, email, full_name, phone, role_names in USERS:
            roles = [created_roles[role_name] for role_name in role_names]
            created_users.append(
                _upsert_user(
                    db,
                    username=username,
                    email=email,
                    full_name=full_name,
                    phone=phone,
                    password=args.password,
                    roles=roles,
                    org=org,
                )
            )

        _ensure_single_step_workflow(
            db,
            action_code=ACTION_CODE_NEGOTIATION_CREATE,
            entity_type=CONTRACTOR_RATE_ENTITY_TYPE,
            approver_role=created_roles["COO"],
            workflow_name="Demo Access Matrix: contractor_rates.create",
        )
        _ensure_single_step_workflow(
            db,
            action_code=ACTION_CODE_WORK_ORDER_CREATE,
            entity_type=WORK_ORDER_ENTITY_TYPE,
            approver_role=created_roles["Controller"],
            workflow_name="Demo Access Matrix: work_orders.create",
        )
        _ensure_single_step_workflow(
            db,
            action_code=ACTION_CODE_INVOICE_EXCEPTION_APPROVE,
            entity_type=INVOICE_EXCEPTION_ENTITY_TYPE,
            approver_role=created_roles["COO"],
            workflow_name="Demo Access Matrix: invoices.approve_exceptions",
        )

        print("Seeded demo access-matrix roles:")
        for role_name, role in created_roles.items():
            print(f"- {role_name}: role_id={role.id}")
        print("")
        print(f"Shared password: {args.password!r}")
        print("Seeded demo access-matrix users:")
        for user in created_users:
            role_names = ", ".join(sorted(r.name for r in user.roles))
            print(f"- {user.username}  <{user.email}>  roles=[{role_names}]")
        print("")
        print("Workflow routing:")
        print("- Negotiation approval -> COO")
        print("- Work order review -> Controller")
        print("- Exceptional invoice approval -> COO")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
