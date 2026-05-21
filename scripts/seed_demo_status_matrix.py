#!/usr/bin/env python3
"""Seed a full demo lifecycle matrix for the quick-fix Ultra checkout.

This script is scenario-driven rather than bulk-random:

1. Runs the existing idempotent base seeds for users, roles, contractors,
   part master, negotiated rates, and general demo data.
2. Ensures approval workflows exist for:
   - ``work_orders.create``
   - ``invoices.approve_exceptions``
3. Creates named work order scenarios covering the major lifecycle states.
4. Creates named invoice scenarios covering the major lifecycle states,
   including real blocked / exception-approval flows with approval requests,
   approval tasks, and invoice audit rows.

Run from repo root:

    ../engin/bin/python scripts/seed_demo_status_matrix.py

Optional:

    ../engin/bin/python scripts/seed_demo_status_matrix.py --skip-base-seeds
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

_SCRIPTS_ROOT = Path(__file__).resolve().parent
_REPO_ROOT = _SCRIPTS_ROOT.parent
_BACKEND_ROOT = _REPO_ROOT / "backend"
for _p in (_BACKEND_ROOT, _SCRIPTS_ROOT):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import db.models  # noqa: F401
from db.session import SessionLocal
from modules.approvals.assignment_service import resolve_registered_action_code
from modules.approvals.model import (
    ApprovalAction,
    ApprovalRequest,
    ApprovalStep,
    ApprovalTask,
    ApprovalWorkflow,
    ApprovalWorkflowMapping,
    TaskAuditLog,
    TaskComment,
)
from modules.approvals.service import ApprovalEngineService
from modules.contractor.models import Contractor
from modules.errors import ConflictError
from modules.invoices import audit as invoice_audit
from modules.invoices.commercial_amount import invoice_line_ex_vat_amount
from modules.invoices.models import Invoice, InvoiceAttachment
from modules.invoices.schema import InvoiceCreate, InvoiceLineCreate, InvoiceUpdate
from modules.invoices.service import ACTION_CODE_EXCEPTION_APPROVE, APPROVAL_ENTITY_TYPE, InvoiceService
from modules.invoices.validation import InvoiceValidationEngine
from modules.org_units.model import OrgUnit
from modules.part_master.models import PartMaster
from modules.rbac_sync import sync_all_modules_to_db
from modules.roles.model import Role
from modules.users.model import User
from modules.work_orders.models import WorkOrder
from modules.work_orders.schema import WorkOrderCreate, WorkOrderItemCreate, WorkOrderItemProgressCreate
from modules.work_orders.service import WorkOrderService

from _work_order_demo_workflow import ensure_work_orders_create_workflow


PREFIX = "DEMO STATUS MATRIX"
ATTACH_DIR = _REPO_ROOT / ".seed_demo_files"

BASE_SCRIPTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("seed_manual_test_contractors.py", ()),
    ("seed_admin_test_data.py", ("--password",)),
    ("seed_manual_test_rates.py", ()),
    ("seed_demo_users.py", ("--password",)),
)

WO_TITLES = {
    "draft": f"{PREFIX} — WO draft",
    "pending": f"{PREFIX} — WO pending approval",
    "rejected": f"{PREFIX} — WO rejected",
    "active": f"{PREFIX} — WO active",
    "closed": f"{PREFIX} — WO closed",
    "cancelled": f"{PREFIX} — WO cancelled",
    "invoice_draft": f"{PREFIX} — Invoice WO draft",
    "invoice_submitted": f"{PREFIX} — Invoice WO submitted",
    "invoice_blocked": f"{PREFIX} — Invoice WO blocked",
    "invoice_pending_exception": f"{PREFIX} — Invoice WO pending exception",
    "invoice_approved": f"{PREFIX} — Invoice WO approved exception",
    "invoice_rejected": f"{PREFIX} — Invoice WO rejected exception",
    "invoice_paid": f"{PREFIX} — Invoice WO paid",
    "invoice_cancelled": f"{PREFIX} — Invoice WO cancelled",
}

INVOICE_NUMBERS = {
    "draft": "INV-MATRIX-DRAFT",
    "submitted": "INV-MATRIX-SUBMITTED",
    "blocked": "INV-MATRIX-BLOCKED",
    "pending_exception": "INV-MATRIX-PENDING",
    "approved_exception": "INV-MATRIX-APPROVED",
    "rejected_exception": "INV-MATRIX-REJECTED",
    "paid": "INV-MATRIX-PAID",
    "cancelled": "INV-MATRIX-CANCELLED",
}


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _q2(value: Decimal | str | int | float) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _q3(value: Decimal | str | int | float) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.001"))


def _seed_script_args(script_name: str) -> list[str]:
    if script_name == "seed_admin_test_data.py":
        password = os.environ.get("ADMIN_TEST_PASSWORD", "TestPass123!").strip() or "TestPass123!"
        return ["--password", password]
    if script_name == "seed_demo_users.py":
        password = os.environ.get("DEMO_USER_PASSWORD", "DemoPass123!").strip() or "DemoPass123!"
        return ["--password", password]
    return []


def _run_seed(script_name: str, extra_args: list[str] | None = None) -> None:
    subprocess.run(
        [sys.executable, str(_SCRIPTS_ROOT / script_name), *(extra_args or [])],
        cwd=str(_REPO_ROOT),
        check=True,
    )


def _user_by_username(db: Session, username: str) -> User | None:
    return db.scalar(select(User).where(User.username == username))


def _pick_user(db: Session, *usernames: str) -> User:
    for username in usernames:
        row = _user_by_username(db, username)
        if row is not None:
            return row
    row = db.scalars(select(User).order_by(User.id.asc())).first()
    if row is None:
        raise RuntimeError("No users found after base seeding.")
    return row


def _role_by_name(db: Session, name: str) -> Role | None:
    return db.scalar(select(Role).where(Role.name == name))


def _pick_role(db: Session, *names: str) -> Role:
    for name in names:
        row = _role_by_name(db, name)
        if row is not None:
            return row
    raise RuntimeError(f"None of the required roles exist: {', '.join(names)}")


def _first_plant(db: Session) -> OrgUnit:
    plant = db.scalars(select(OrgUnit).where(OrgUnit.type == "PLANT").order_by(OrgUnit.id.asc())).first()
    if plant is None:
        raise RuntimeError("No PLANT org unit found.")
    return plant


def _first_active_contractor(db: Session) -> Contractor:
    row = db.scalars(
        select(Contractor)
        .where(Contractor.is_active.is_(True))
        .order_by(Contractor.id.asc())
    ).first()
    if row is None:
        raise RuntimeError("No active contractor found.")
    return row


def _invoice_friendly_part(db: Session, *, plant_id: int) -> PartMaster:
    row = db.scalars(
        select(PartMaster)
        .where(
            PartMaster.org_unit_id == int(plant_id),
            PartMaster.is_active.is_(True),
        )
        .order_by(PartMaster.id.asc())
    ).all()
    if not row:
        raise RuntimeError("No active part master found for the selected plant.")
    for part in row:
        pricing = str(getattr(part, "pricing_method", "") or "").strip().lower()
        unit = str(getattr(part, "unit_type", "") or "").strip().lower()
        if pricing != "weight_based" and unit in {"pcs", "day", "hr", "hour", "job"}:
            return part
    return row[0]


def _work_order_item(part: PartMaster, *, qty: Decimal, notes: str) -> WorkOrderItemCreate:
    payload: dict[str, object] = {
        "part_master_id": int(part.id),
        "progress_type": "quantity",
        "planned_quantity": _q3(qty),
        "planned_percentage": None,
        "notes": notes,
    }
    pricing = str(getattr(part, "pricing_method", "") or "").strip().lower()
    rate_unit = str(getattr(part, "rate_unit_type", "") or "").strip().lower()
    if pricing == "weight_based" and rate_unit == "per_kg":
        weight = getattr(part, "weight_per_piece", None)
        payload["weight_per_piece"] = Decimal(str(weight if weight is not None else "1.25"))
    return WorkOrderItemCreate(**payload)


def _find_work_order(db: Session, title: str) -> WorkOrder | None:
    return db.scalar(select(WorkOrder).where(WorkOrder.title == title))


def _find_invoice(db: Session, *, contractor_id: int, org_unit_id: int, invoice_number: str) -> Invoice | None:
    return db.scalar(
        select(Invoice).where(
            Invoice.contractor_id == int(contractor_id),
            Invoice.org_unit_id == int(org_unit_id),
            Invoice.invoice_number == invoice_number,
        )
    )


def _pending_approval_task_for_entity(db: Session, *, entity_type: str, entity_id: int) -> ApprovalTask | None:
    return db.scalars(
        select(ApprovalTask)
        .join(ApprovalRequest, ApprovalRequest.id == ApprovalTask.request_id)
        .where(
            ApprovalRequest.entity_type == entity_type,
            ApprovalRequest.entity_id == int(entity_id),
            ApprovalRequest.status == "pending",
            ApprovalTask.task_type == "approval",
            ApprovalTask.status == "pending",
        )
        .order_by(ApprovalTask.id.asc())
        .limit(1)
    ).first()


def _ensure_invoice_exception_workflow(
    db: Session,
    *,
    approver_role: Role,
    creator_user_id: int | None,
) -> ApprovalWorkflow:
    canonical = resolve_registered_action_code(db, ACTION_CODE_EXCEPTION_APPROVE) or ACTION_CODE_EXCEPTION_APPROVE
    name = "TiM Demo: invoices.approve_exceptions"
    wf = db.scalar(
        select(ApprovalWorkflow).where(
            ApprovalWorkflow.entity_type == APPROVAL_ENTITY_TYPE,
            ApprovalWorkflow.name == name,
        )
    )
    if wf is None:
        wf = ApprovalWorkflow(
            name=name,
            entity_type=APPROVAL_ENTITY_TYPE,
            is_active=True,
            created_by=creator_user_id,
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
    ours_active = False
    for mapping in mappings:
        mapping.is_active = int(mapping.workflow_id) == int(wf.id)
        if mapping.is_active:
            ours_active = True
    if not ours_active:
        db.add(
            ApprovalWorkflowMapping(
                action_code=canonical,
                workflow_id=int(wf.id),
                is_active=True,
            )
        )
    db.commit()
    db.refresh(wf)
    return wf


def _create_minimal_work_order(
    db: Session,
    svc: WorkOrderService,
    *,
    title: str,
    description: str,
    actor_user_id: int,
    plant_id: int,
    contractor_id: int,
    part: PartMaster,
    qty: Decimal,
) -> WorkOrder:
    existing = _find_work_order(db, title)
    if existing is not None:
        return svc.get(int(existing.id))
    row = svc.create(
        WorkOrderCreate(
            org_unit_id=int(plant_id),
            contractor_id=int(contractor_id),
            title=title,
            description=description,
            items=[_work_order_item(part, qty=qty, notes=f"[{PREFIX}] {description}")],
        ),
        actor_user_id=int(actor_user_id),
    )
    return svc.get(int(row.id))


def _complete_work_order_items(
    svc: WorkOrderService,
    wo: WorkOrder,
    *,
    actor_user_id: int,
) -> WorkOrder:
    current = svc.get(int(wo.id))
    for item in current.items or []:
        projection = svc.item_completion_projection(item)
        completed_pct = projection.get("completed_percentage")
        if completed_pct is not None and float(completed_pct) >= 99.99:
            continue
        if item.planned_quantity is not None:
            payload = WorkOrderItemProgressCreate(
                completed_quantity=Decimal(str(item.planned_quantity)),
                completed_percentage=None,
                remarks=f"[{PREFIX}] seeded full completion for WO {current.work_order_number}",
            )
        else:
            payload = WorkOrderItemProgressCreate(
                completed_quantity=None,
                completed_percentage=Decimal("100"),
                remarks=f"[{PREFIX}] seeded full completion for WO {current.work_order_number}",
            )
        svc.add_progress(int(item.id), payload, actor_user_id=int(actor_user_id))
    return svc.get(int(wo.id))


def _approve_all_work_order_steps(
    db: Session,
    *,
    work_order_id: int,
    role_actor_ids: dict[int, int],
    fallback_actor_id: int,
) -> WorkOrder:
    engine = ApprovalEngineService(db)
    while True:
        task = _pending_approval_task_for_entity(
            db, entity_type="work_order_approval", entity_id=int(work_order_id)
        )
        if task is None:
            break
        actor_id = role_actor_ids.get(int(task.assigned_role_id or 0), int(fallback_actor_id))
        engine.act_on_task(
            task_id=int(task.id),
            actor_user_id=int(actor_id),
            action="approve",
            comment=f"[{PREFIX}] seeded approval",
        )
    return WorkOrderService(db).get(int(work_order_id))


def _ensure_work_order_status_matrix(
    db: Session,
    *,
    plant: OrgUnit,
    contractor: Contractor,
    part: PartMaster,
    actor_creator: User,
    approver_l1: User,
    approver_l2: User | None,
    role_l1: Role,
    role_l2: Role | None,
) -> dict[str, WorkOrder]:
    svc = WorkOrderService(db)
    role_actor_ids = {int(role_l1.id): int(approver_l1.id)}
    if role_l2 is not None and approver_l2 is not None:
        role_actor_ids[int(role_l2.id)] = int(approver_l2.id)

    out: dict[str, WorkOrder] = {}

    draft = _create_minimal_work_order(
        db,
        svc,
        title=WO_TITLES["draft"],
        description="Draft work order scenario",
        actor_user_id=int(actor_creator.id),
        plant_id=int(plant.id),
        contractor_id=int(contractor.id),
        part=part,
        qty=Decimal("10"),
    )
    out["draft"] = draft

    pending = _create_minimal_work_order(
        db,
        svc,
        title=WO_TITLES["pending"],
        description="Pending-approval work order scenario",
        actor_user_id=int(actor_creator.id),
        plant_id=int(plant.id),
        contractor_id=int(contractor.id),
        part=part,
        qty=Decimal("11"),
    )
    if str(pending.status) == "draft":
        pending = svc.submit_for_approval(int(pending.id), actor_user_id=int(actor_creator.id))
    out["pending"] = svc.get(int(pending.id))

    rejected = _create_minimal_work_order(
        db,
        svc,
        title=WO_TITLES["rejected"],
        description="Rejected work order scenario",
        actor_user_id=int(actor_creator.id),
        plant_id=int(plant.id),
        contractor_id=int(contractor.id),
        part=part,
        qty=Decimal("12"),
    )
    if str(rejected.status) == "draft":
        rejected = svc.submit_for_approval(int(rejected.id), actor_user_id=int(actor_creator.id))
    if str(rejected.status) == "pending_approval":
        task = _pending_approval_task_for_entity(
            db, entity_type="work_order_approval", entity_id=int(rejected.id)
        )
        if task is not None:
            ApprovalEngineService(db).act_on_task(
                task_id=int(task.id),
                actor_user_id=int(approver_l1.id),
                action="reject",
                comment=f"[{PREFIX}] seeded rejection",
            )
    out["rejected"] = svc.get(int(rejected.id))

    active = _create_minimal_work_order(
        db,
        svc,
        title=WO_TITLES["active"],
        description="Active work order scenario",
        actor_user_id=int(actor_creator.id),
        plant_id=int(plant.id),
        contractor_id=int(contractor.id),
        part=part,
        qty=Decimal("13"),
    )
    if str(active.status) in {"draft", "rejected"}:
        active = svc.submit_for_approval(int(active.id), actor_user_id=int(actor_creator.id))
    if str(active.status) == "pending_approval":
        active = _approve_all_work_order_steps(
            db,
            work_order_id=int(active.id),
            role_actor_ids=role_actor_ids,
            fallback_actor_id=int(approver_l1.id),
        )
    out["active"] = svc.get(int(active.id))

    closed = _create_minimal_work_order(
        db,
        svc,
        title=WO_TITLES["closed"],
        description="Closed work order scenario",
        actor_user_id=int(actor_creator.id),
        plant_id=int(plant.id),
        contractor_id=int(contractor.id),
        part=part,
        qty=Decimal("14"),
    )
    if str(closed.status) in {"draft", "rejected"}:
        closed = svc.submit_for_approval(int(closed.id), actor_user_id=int(actor_creator.id))
    if str(closed.status) == "pending_approval":
        closed = _approve_all_work_order_steps(
            db,
            work_order_id=int(closed.id),
            role_actor_ids=role_actor_ids,
            fallback_actor_id=int(approver_l1.id),
        )
    if str(closed.status) == "active":
        closed = _complete_work_order_items(svc, closed, actor_user_id=int(actor_creator.id))
        closed = svc.close_active_work_order(int(closed.id), actor_user_id=int(actor_creator.id))
    out["closed"] = svc.get(int(closed.id))

    cancelled = _create_minimal_work_order(
        db,
        svc,
        title=WO_TITLES["cancelled"],
        description="Cancelled work order scenario",
        actor_user_id=int(actor_creator.id),
        plant_id=int(plant.id),
        contractor_id=int(contractor.id),
        part=part,
        qty=Decimal("15"),
    )
    if bool(cancelled.is_active):
        cancelled = svc.archive(int(cancelled.id), actor_user_id=int(actor_creator.id))
    out["cancelled"] = svc.get(int(cancelled.id))

    return out


def _ensure_invoice_ready_work_order(
    db: Session,
    *,
    title: str,
    plant: OrgUnit,
    contractor: Contractor,
    part: PartMaster,
    creator: User,
    approver_l1: User,
    approver_l2: User | None,
    role_l1: Role,
    role_l2: Role | None,
    qty: Decimal,
) -> WorkOrder:
    svc = WorkOrderService(db)
    role_actor_ids = {int(role_l1.id): int(approver_l1.id)}
    if role_l2 is not None and approver_l2 is not None:
        role_actor_ids[int(role_l2.id)] = int(approver_l2.id)
    wo = _create_minimal_work_order(
        db,
        svc,
        title=title,
        description=f"Invoice scenario work order for {title}",
        actor_user_id=int(creator.id),
        plant_id=int(plant.id),
        contractor_id=int(contractor.id),
        part=part,
        qty=qty,
    )
    if str(wo.status) in {"draft", "rejected"}:
        wo = svc.submit_for_approval(int(wo.id), actor_user_id=int(creator.id))
    if str(wo.status) == "pending_approval":
        wo = _approve_all_work_order_steps(
            db,
            work_order_id=int(wo.id),
            role_actor_ids=role_actor_ids,
            fallback_actor_id=int(approver_l1.id),
        )
    if str(wo.status) != "active":
        wo = svc.get(int(wo.id))
    return _complete_work_order_items(svc, wo, actor_user_id=int(creator.id))


def _invoice_line_hint(inv_svc: InvoiceService, *, work_order: WorkOrder) -> dict:
    preflight = inv_svc.preflight_billables(
        contractor_id=int(work_order.contractor_id),
        org_unit_id=int(work_order.org_unit_id),
        work_order_ids=[int(work_order.id)],
    )
    lines = list(preflight.get("lines") or [])
    if not lines:
        raise RuntimeError(
            f"No billable lines available for work order {work_order.work_order_number}."
        )
    return lines[0]


def _clean_invoice_qty(line_hint: dict[str, object], *, fraction: Decimal = Decimal("0.40")) -> Decimal:
    for key in ("remaining_invoiceable_qty_hint", "approved_quantity", "approved_line_qty_basis"):
        raw = line_hint.get(key)
        if raw not in (None, "", 0):
            qty = _q3(Decimal(str(raw)) * fraction)
            if qty > 0:
                return qty
    return Decimal("1.000")


def _blocked_invoice_qty(line_hint: dict[str, object]) -> Decimal:
    for key in ("remaining_invoiceable_qty_hint", "approved_quantity", "approved_line_qty_basis"):
        raw = line_hint.get(key)
        if raw not in (None, "", 0):
            base = Decimal(str(raw))
            if base <= 0:
                continue
            return max(_q3(base + Decimal("5.000")), _q3(base * Decimal("2.00")))
    return Decimal("10.000")


def _delete_invoice_scenario(db: Session, invoice_id: int) -> None:
    inv = db.get(Invoice, int(invoice_id))
    if inv is None:
        return
    req_id = int(inv.approval_request_id) if inv.approval_request_id is not None else None
    if req_id is not None:
        task_ids = list(
            db.scalars(select(ApprovalTask.id).where(ApprovalTask.request_id == int(req_id))).all()
        )
        if task_ids:
            db.execute(delete(ApprovalAction).where(ApprovalAction.task_id.in_(task_ids)))
            db.execute(delete(TaskComment).where(TaskComment.task_id.in_(task_ids)))
            db.execute(delete(TaskAuditLog).where(TaskAuditLog.task_id.in_(task_ids)))
            db.execute(delete(ApprovalTask).where(ApprovalTask.id.in_(task_ids)))
        db.execute(delete(ApprovalRequest).where(ApprovalRequest.id == int(req_id)))
    db.delete(inv)
    db.commit()


def _create_invoice(
    inv_svc: InvoiceService,
    *,
    work_order: WorkOrder,
    invoice_number: str,
    actor_user_id: int,
    quantity: Decimal,
    note: str,
) -> Invoice:
    line_hint = _invoice_line_hint(inv_svc, work_order=work_order)
    row = inv_svc.create(
        InvoiceCreate(
            contractor_id=int(work_order.contractor_id),
            org_unit_id=int(work_order.org_unit_id),
            invoice_number=invoice_number,
            invoice_date=date.today(),
            lines=[
                InvoiceLineCreate(
                    work_order_item_id=int(line_hint["work_order_item_id"]),
                    quantity=_q3(quantity),
                    tax_pct=Decimal("18"),
                    notes=note,
                )
            ],
        ),
        actor_user_id=int(actor_user_id),
    )
    return inv_svc.get(int(row.id))


def _ensure_editable_invoice(
    db: Session,
    inv_svc: InvoiceService,
    *,
    work_order: WorkOrder,
    invoice_number: str,
    actor_user_id: int,
    quantity: Decimal,
    note: str,
) -> Invoice:
    existing = _find_invoice(
        db,
        contractor_id=int(work_order.contractor_id),
        org_unit_id=int(work_order.org_unit_id),
        invoice_number=invoice_number,
    )
    line_hint = _invoice_line_hint(inv_svc, work_order=work_order)
    lines = [
        InvoiceLineCreate(
            work_order_item_id=int(line_hint["work_order_item_id"]),
            quantity=_q3(quantity),
            tax_pct=Decimal("18"),
            notes=note,
        )
    ]
    if existing is None:
        return _create_invoice(
            inv_svc,
            work_order=work_order,
            invoice_number=invoice_number,
            actor_user_id=actor_user_id,
            quantity=quantity,
            note=note,
        )
    current = inv_svc.get(int(existing.id))
    if str(current.status) in {"draft", "rejected"}:
        return inv_svc.update_draft(
            int(current.id),
            InvoiceUpdate(
                invoice_number=invoice_number,
                invoice_date=date.today(),
                lines=lines,
            ),
            actor_user_id=int(actor_user_id),
        )
    return current


def _create_blocked_invoice(
    db: Session,
    inv_svc: InvoiceService,
    *,
    work_order: WorkOrder,
    invoice_number: str,
    actor_user_id: int,
    note: str,
) -> Invoice:
    existing = _find_invoice(
        db,
        contractor_id=int(work_order.contractor_id),
        org_unit_id=int(work_order.org_unit_id),
        invoice_number=invoice_number,
    )
    if existing is not None:
        current = inv_svc.get(int(existing.id))
        if str(current.validation_status) == "blocked":
            if str(current.status) != "blocked":
                current.status = "blocked"
                db.commit()
            return inv_svc.get(int(current.id))
        _delete_invoice_scenario(db, int(current.id))

    line_hint = _invoice_line_hint(inv_svc, work_order=work_order)
    qty = _blocked_invoice_qty(line_hint)
    inv = _create_invoice(
        inv_svc,
        work_order=work_order,
        invoice_number=invoice_number,
        actor_user_id=actor_user_id,
        quantity=qty,
        note=note,
    )

    model = inv_svc.get(int(inv.id))
    model.status = "submitted"
    model.submitted_by = int(actor_user_id)
    model.submitted_at = _now_utc()
    invoice_audit.write_audit(
        db,
        invoice_id=int(model.id),
        action=invoice_audit.ACTION_SUBMITTED,
        actor_user_id=int(actor_user_id),
        new_value={"status": "submitted", "seeded": True},
    )

    result = InvoiceValidationEngine(db).validate_and_persist(model)
    inv_svc._apply_validation_outcome(
        model,
        result,
        actor_user_id=int(actor_user_id),
        auto_approve_when_clean=False,
    )
    model.status = "blocked" if str(result.status) == "blocked" else "submitted"
    invoice_audit.write_audit(
        db,
        invoice_id=int(model.id),
        action=invoice_audit.ACTION_VALIDATED,
        actor_user_id=int(actor_user_id),
        new_value={
            "validation_engine_status": result.status,
            "invoice_status": model.status,
            "validation_score": str(result.score),
            "blockers": result.blocker_count,
            "errors": result.error_count,
            "warnings": result.warning_count,
            "seeded": True,
        },
    )
    if str(model.status) == "blocked":
        invoice_audit.write_audit(
            db,
            invoice_id=int(model.id),
            action=invoice_audit.ACTION_BLOCKED,
            actor_user_id=int(actor_user_id),
            new_value={"status": "blocked", "seeded": True},
        )
    inv_svc._recompute_contractor_compliance(contractor_id=int(model.contractor_id))
    db.commit()
    return inv_svc.get(int(model.id))


def _ensure_exception_package(
    db: Session,
    inv: Invoice,
    *,
    actor_user_id: int,
) -> Invoice:
    for issue in inv.issues or []:
        if bool(issue.requires_justification) and not (issue.justification or "").strip():
            issue.justification = (
                f"[{PREFIX}] Business exception requested for {issue.code}. "
                f"Seeded to exercise approval workflow."
            )
    if not (inv.attachments or []):
        ATTACH_DIR.mkdir(parents=True, exist_ok=True)
        attachment_path = ATTACH_DIR / f"{inv.invoice_number.lower().replace('/', '_')}.txt"
        attachment_path.write_text(
            f"{PREFIX}\nInvoice: {inv.invoice_number}\nReason: seeded exception approval package.\n"
        )
        db.add(
            InvoiceAttachment(
                invoice_id=int(inv.id),
                file_name=attachment_path.name,
                file_path=str(attachment_path),
                content_type="text/plain",
                uploaded_by=int(actor_user_id),
            )
        )
    db.commit()
    db.expire_all()
    return InvoiceService(db).get(int(inv.id))


def _mark_invoice_status(
    db: Session,
    inv_svc: InvoiceService,
    *,
    invoice: Invoice,
    status: str,
    actor_user_id: int,
    action: str,
) -> Invoice:
    current = inv_svc.get(int(invoice.id))
    old_status = str(current.status)
    if old_status == status:
        return current
    current.status = status
    if status == "cancelled":
        current.is_active = False
    if status == "paid":
        current.validation_status = "pass"
    invoice_audit.write_audit(
        db,
        invoice_id=int(current.id),
        action=action,
        actor_user_id=int(actor_user_id),
        old_value={"status": old_status},
        new_value={"status": status, "seeded": True},
    )
    inv_svc._recompute_contractor_compliance(contractor_id=int(current.contractor_id))
    db.commit()
    return inv_svc.get(int(current.id))


def _ensure_invoice_matrix(
    db: Session,
    *,
    plant: OrgUnit,
    contractor: Contractor,
    part: PartMaster,
    creator: User,
    wo_approver_l1: User,
    wo_approver_l2: User | None,
    wo_role_l1: Role,
    wo_role_l2: Role | None,
    invoice_actor: User,
    finance_approver: User,
    finance_role: Role,
) -> dict[str, Invoice]:
    inv_svc = InvoiceService(db)
    engine = ApprovalEngineService(db)
    scenarios: dict[str, Invoice] = {}

    wo_by_key = {
        "draft": _ensure_invoice_ready_work_order(
            db,
            title=WO_TITLES["invoice_draft"],
            plant=plant,
            contractor=contractor,
            part=part,
            creator=creator,
            approver_l1=wo_approver_l1,
            approver_l2=wo_approver_l2,
            role_l1=wo_role_l1,
            role_l2=wo_role_l2,
            qty=Decimal("20"),
        ),
        "submitted": _ensure_invoice_ready_work_order(
            db,
            title=WO_TITLES["invoice_submitted"],
            plant=plant,
            contractor=contractor,
            part=part,
            creator=creator,
            approver_l1=wo_approver_l1,
            approver_l2=wo_approver_l2,
            role_l1=wo_role_l1,
            role_l2=wo_role_l2,
            qty=Decimal("21"),
        ),
        "blocked": _ensure_invoice_ready_work_order(
            db,
            title=WO_TITLES["invoice_blocked"],
            plant=plant,
            contractor=contractor,
            part=part,
            creator=creator,
            approver_l1=wo_approver_l1,
            approver_l2=wo_approver_l2,
            role_l1=wo_role_l1,
            role_l2=wo_role_l2,
            qty=Decimal("22"),
        ),
        "pending_exception": _ensure_invoice_ready_work_order(
            db,
            title=WO_TITLES["invoice_pending_exception"],
            plant=plant,
            contractor=contractor,
            part=part,
            creator=creator,
            approver_l1=wo_approver_l1,
            approver_l2=wo_approver_l2,
            role_l1=wo_role_l1,
            role_l2=wo_role_l2,
            qty=Decimal("23"),
        ),
        "approved_exception": _ensure_invoice_ready_work_order(
            db,
            title=WO_TITLES["invoice_approved"],
            plant=plant,
            contractor=contractor,
            part=part,
            creator=creator,
            approver_l1=wo_approver_l1,
            approver_l2=wo_approver_l2,
            role_l1=wo_role_l1,
            role_l2=wo_role_l2,
            qty=Decimal("24"),
        ),
        "rejected_exception": _ensure_invoice_ready_work_order(
            db,
            title=WO_TITLES["invoice_rejected"],
            plant=plant,
            contractor=contractor,
            part=part,
            creator=creator,
            approver_l1=wo_approver_l1,
            approver_l2=wo_approver_l2,
            role_l1=wo_role_l1,
            role_l2=wo_role_l2,
            qty=Decimal("25"),
        ),
        "paid": _ensure_invoice_ready_work_order(
            db,
            title=WO_TITLES["invoice_paid"],
            plant=plant,
            contractor=contractor,
            part=part,
            creator=creator,
            approver_l1=wo_approver_l1,
            approver_l2=wo_approver_l2,
            role_l1=wo_role_l1,
            role_l2=wo_role_l2,
            qty=Decimal("26"),
        ),
        "cancelled": _ensure_invoice_ready_work_order(
            db,
            title=WO_TITLES["invoice_cancelled"],
            plant=plant,
            contractor=contractor,
            part=part,
            creator=creator,
            approver_l1=wo_approver_l1,
            approver_l2=wo_approver_l2,
            role_l1=wo_role_l1,
            role_l2=wo_role_l2,
            qty=Decimal("27"),
        ),
    }

    draft = _find_invoice(
        db,
        contractor_id=int(contractor.id),
        org_unit_id=int(plant.id),
        invoice_number=INVOICE_NUMBERS["draft"],
    )
    draft_line = _invoice_line_hint(inv_svc, work_order=wo_by_key["draft"])
    draft_qty = _clean_invoice_qty(draft_line, fraction=Decimal("0.30"))
    if draft is None or str(draft.status) in {"draft", "rejected"}:
        draft = _ensure_editable_invoice(
            db,
            inv_svc,
            work_order=wo_by_key["draft"],
            invoice_number=INVOICE_NUMBERS["draft"],
            actor_user_id=int(invoice_actor.id),
            quantity=draft_qty,
            note=f"[{PREFIX}] draft invoice scenario",
        )
    scenarios["draft"] = inv_svc.get(int(draft.id))

    submitted = _find_invoice(
        db,
        contractor_id=int(contractor.id),
        org_unit_id=int(plant.id),
        invoice_number=INVOICE_NUMBERS["submitted"],
    )
    submitted_line = _invoice_line_hint(inv_svc, work_order=wo_by_key["submitted"])
    submitted_qty = _clean_invoice_qty(submitted_line, fraction=Decimal("0.35"))
    if submitted is None or str(submitted.status) in {"draft", "rejected"}:
        submitted = _ensure_editable_invoice(
            db,
            inv_svc,
            work_order=wo_by_key["submitted"],
            invoice_number=INVOICE_NUMBERS["submitted"],
            actor_user_id=int(invoice_actor.id),
            quantity=submitted_qty,
            note=f"[{PREFIX}] submitted invoice scenario",
        )
    if str(submitted.status) == "draft":
        submitted = inv_svc.submit(int(submitted.id), actor_user_id=int(invoice_actor.id))
    scenarios["submitted"] = inv_svc.get(int(submitted.id))

    blocked = _create_blocked_invoice(
        db,
        inv_svc,
        work_order=wo_by_key["blocked"],
        invoice_number=INVOICE_NUMBERS["blocked"],
        actor_user_id=int(invoice_actor.id),
        note=f"[{PREFIX}] blocked invoice scenario",
    )
    scenarios["blocked"] = blocked

    pending_ex = _create_blocked_invoice(
        db,
        inv_svc,
        work_order=wo_by_key["pending_exception"],
        invoice_number=INVOICE_NUMBERS["pending_exception"],
        actor_user_id=int(invoice_actor.id),
        note=f"[{PREFIX}] pending exception invoice scenario",
    )
    if pending_ex.approval_request_id is not None:
        if str(pending_ex.status) != "pending_exception_approval":
            pending_ex.status = "pending_exception_approval"
            db.commit()
        pending_ex = inv_svc.get(int(pending_ex.id))
    elif str(pending_ex.validation_status) == "blocked":
        pending_ex = _ensure_exception_package(
            db, pending_ex, actor_user_id=int(invoice_actor.id)
        )
        pending_ex = inv_svc.request_exception_approval(
            int(pending_ex.id), actor_user_id=int(invoice_actor.id)
        )
    scenarios["pending_exception"] = inv_svc.get(int(pending_ex.id))

    approved_ex = _create_blocked_invoice(
        db,
        inv_svc,
        work_order=wo_by_key["approved_exception"],
        invoice_number=INVOICE_NUMBERS["approved_exception"],
        actor_user_id=int(invoice_actor.id),
        note=f"[{PREFIX}] approved exception invoice scenario",
    )
    if approved_ex.approval_request_id is None and str(approved_ex.validation_status) == "blocked":
        approved_ex = _ensure_exception_package(
            db, approved_ex, actor_user_id=int(invoice_actor.id)
        )
        approved_ex = inv_svc.request_exception_approval(
            int(approved_ex.id), actor_user_id=int(invoice_actor.id)
        )
    if approved_ex.approval_request_id is not None and str(approved_ex.status) != "approved":
        if str(approved_ex.status) != "pending_exception_approval":
            approved_ex.status = "pending_exception_approval"
            db.commit()
            approved_ex = inv_svc.get(int(approved_ex.id))
        task = _pending_approval_task_for_entity(
            db,
            entity_type=APPROVAL_ENTITY_TYPE,
            entity_id=int(approved_ex.id),
        )
        if task is not None:
            engine.act_on_task(
                task_id=int(task.id),
                actor_user_id=int(finance_approver.id),
                action="approve",
                comment=f"[{PREFIX}] seeded exception approval",
            )
    scenarios["approved_exception"] = inv_svc.get(int(approved_ex.id))

    rejected_ex = _create_blocked_invoice(
        db,
        inv_svc,
        work_order=wo_by_key["rejected_exception"],
        invoice_number=INVOICE_NUMBERS["rejected_exception"],
        actor_user_id=int(invoice_actor.id),
        note=f"[{PREFIX}] rejected exception invoice scenario",
    )
    if rejected_ex.approval_request_id is None and str(rejected_ex.validation_status) == "blocked":
        rejected_ex = _ensure_exception_package(
            db, rejected_ex, actor_user_id=int(invoice_actor.id)
        )
        rejected_ex = inv_svc.request_exception_approval(
            int(rejected_ex.id), actor_user_id=int(invoice_actor.id)
        )
    if rejected_ex.approval_request_id is not None and str(rejected_ex.status) != "rejected":
        if str(rejected_ex.status) != "pending_exception_approval":
            rejected_ex.status = "pending_exception_approval"
            db.commit()
            rejected_ex = inv_svc.get(int(rejected_ex.id))
        task = _pending_approval_task_for_entity(
            db,
            entity_type=APPROVAL_ENTITY_TYPE,
            entity_id=int(rejected_ex.id),
        )
        if task is not None:
            engine.act_on_task(
                task_id=int(task.id),
                actor_user_id=int(finance_approver.id),
                action="reject",
                comment=f"[{PREFIX}] seeded exception rejection",
            )
    scenarios["rejected_exception"] = inv_svc.get(int(rejected_ex.id))

    paid = _create_blocked_invoice(
        db,
        inv_svc,
        work_order=wo_by_key["paid"],
        invoice_number=INVOICE_NUMBERS["paid"],
        actor_user_id=int(invoice_actor.id),
        note=f"[{PREFIX}] paid invoice scenario",
    )
    if paid.approval_request_id is None and str(paid.validation_status) == "blocked":
        paid = _ensure_exception_package(db, paid, actor_user_id=int(invoice_actor.id))
        paid = inv_svc.request_exception_approval(
            int(paid.id), actor_user_id=int(invoice_actor.id)
        )
    if paid.approval_request_id is not None and str(paid.status) not in {"approved", "paid"}:
        if str(paid.status) != "pending_exception_approval":
            paid.status = "pending_exception_approval"
            db.commit()
            paid = inv_svc.get(int(paid.id))
        task = _pending_approval_task_for_entity(
            db,
            entity_type=APPROVAL_ENTITY_TYPE,
            entity_id=int(paid.id),
        )
        if task is not None:
            engine.act_on_task(
                task_id=int(task.id),
                actor_user_id=int(finance_approver.id),
                action="approve",
                comment=f"[{PREFIX}] seeded payment-ready approval",
            )
    paid = _mark_invoice_status(
        db,
        inv_svc,
        invoice=inv_svc.get(int(paid.id)),
        status="paid",
        actor_user_id=int(finance_approver.id),
        action="PAID",
    )
    scenarios["paid"] = paid

    cancelled = _find_invoice(
        db,
        contractor_id=int(contractor.id),
        org_unit_id=int(plant.id),
        invoice_number=INVOICE_NUMBERS["cancelled"],
    )
    cancelled_line = _invoice_line_hint(inv_svc, work_order=wo_by_key["cancelled"])
    cancelled_qty = _clean_invoice_qty(cancelled_line, fraction=Decimal("0.25"))
    if cancelled is None or str(cancelled.status) in {"draft", "rejected"}:
        cancelled = _ensure_editable_invoice(
            db,
            inv_svc,
            work_order=wo_by_key["cancelled"],
            invoice_number=INVOICE_NUMBERS["cancelled"],
            actor_user_id=int(invoice_actor.id),
            quantity=cancelled_qty,
            note=f"[{PREFIX}] cancelled invoice scenario",
        )
    cancelled = _mark_invoice_status(
        db,
        inv_svc,
        invoice=cancelled,
        status="cancelled",
        actor_user_id=int(invoice_actor.id),
        action="CANCELLED",
    )
    scenarios["cancelled"] = cancelled

    return scenarios


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skip-base-seeds",
        action="store_true",
        help="Do not rerun the existing prerequisite seed scripts.",
    )
    args = parser.parse_args()

    if not args.skip_base_seeds:
        for script_name, _ in BASE_SCRIPTS:
            print(f"[seed] running {script_name}")
            _run_seed(script_name, _seed_script_args(script_name))

    db = SessionLocal()
    try:
        sync_all_modules_to_db(db)

        plant = _first_plant(db)
        contractor = _first_active_contractor(db)
        part = _invoice_friendly_part(db, plant_id=int(plant.id))

        creator = _pick_user(db, "negotiator", "ops_user", "super_demo", "plant_admin")
        wo_approver_l1 = _pick_user(db, "wo_approver1", "ops_approver", "rate_approver")
        wo_approver_l2 = _user_by_username(db, "wo_approver2")
        invoice_actor = _pick_user(db, "fin_user", "super_demo", "negotiator")
        finance_approver = _pick_user(db, "fin_approver", "rate_approver", "wo_approver1")

        wo_role_l1 = _pick_role(db, "Work Order Approver (L1)", "Ops Approver")
        wo_role_l2 = _role_by_name(db, "Work Order Approver (L2)")
        finance_role = _pick_role(db, "Finance Approver", "Procurement Approver")

        ensure_work_orders_create_workflow(
            db,
            approver_role_l1=wo_role_l1,
            approver_role_l2=wo_role_l2,
        )
        _ensure_invoice_exception_workflow(
            db,
            approver_role=finance_role,
            creator_user_id=int(creator.id),
        )

        work_orders = _ensure_work_order_status_matrix(
            db,
            plant=plant,
            contractor=contractor,
            part=part,
            actor_creator=creator,
            approver_l1=wo_approver_l1,
            approver_l2=wo_approver_l2,
            role_l1=wo_role_l1,
            role_l2=wo_role_l2,
        )
        invoices = _ensure_invoice_matrix(
            db,
            plant=plant,
            contractor=contractor,
            part=part,
            creator=creator,
            wo_approver_l1=wo_approver_l1,
            wo_approver_l2=wo_approver_l2,
            wo_role_l1=wo_role_l1,
            wo_role_l2=wo_role_l2,
            invoice_actor=invoice_actor,
            finance_approver=finance_approver,
            finance_role=finance_role,
        )

        print()
        print("=" * 84)
        print("Demo status matrix seed complete")
        print("=" * 84)
        print(f"Plant      : {plant.name} (id={plant.id})")
        print(f"Contractor : {contractor.name} (id={contractor.id})")
        print(f"Part       : {part.part_code} — {part.part_name} (id={part.id})")
        print()
        print("Work order scenarios")
        for key in ("draft", "pending", "rejected", "active", "closed", "cancelled"):
            row = work_orders[key]
            print(f"  {key:10}  {row.work_order_number:18}  status={row.status}")
        print()
        print("Invoice scenarios")
        for key in (
            "draft",
            "submitted",
            "blocked",
            "pending_exception",
            "approved_exception",
            "rejected_exception",
            "paid",
            "cancelled",
        ):
            row = invoices[key]
            print(
                f"  {key:18}  {row.invoice_number:22}  "
                f"status={row.status:26} validation={row.validation_status or '-'}"
            )
        print()
        print("Actors")
        print(f"  creator          : {creator.username}")
        print(f"  WO approver L1   : {wo_approver_l1.username}")
        print(f"  WO approver L2   : {wo_approver_l2.username if wo_approver_l2 else '-'}")
        print(f"  invoice actor    : {invoice_actor.username}")
        print(f"  finance approver : {finance_approver.username}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
