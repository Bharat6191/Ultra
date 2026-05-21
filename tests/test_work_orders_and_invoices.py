from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

import db.models  # noqa: F401
from db.session import SessionLocal
from modules.approvals.assignment_service import WorkflowMappingService, resolve_registered_action_code
from modules.approvals.model import ApprovalRequest, ApprovalTask
from modules.approvals.service import ApprovalEngineService, ApprovalWorkflowService
from modules.contractor.models import Contractor
from modules.features.model import Feature
from modules.part_master.models import PartMaster
from modules.org_units.model import OrgUnit
from modules.permissions.model import Permission
from modules.roles.model import Role
from modules.users.model import User
from modules.work_orders.schema import (
    WorkOrderCreate,
    WorkOrderDraftUpdate,
    WorkOrderItemCreate,
    WorkOrderItemProgressCreate,
)
from modules.work_orders.service import WorkOrderService
from modules.invoices.schema import InvoiceCreate, InvoiceLineCreate
from modules.invoices.service import ACTION_CODE_EXCEPTION_APPROVE, APPROVAL_ENTITY_TYPE, InvoiceService
from modules.errors import ConflictError


@pytest.fixture()
def db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _first_user(db) -> int:
    u = db.scalars(select(User).order_by(User.id.asc())).first()
    if u is None:
        pytest.skip("No users seeded in DB")
    return int(u.id)


def _first_plant(db) -> OrgUnit:
    org = db.scalars(select(OrgUnit).order_by(OrgUnit.id.asc())).first()
    if org is None:
        pytest.skip("No org units seeded in DB")
    return org


def _first_contractor(db) -> Contractor:
    c = db.scalars(select(Contractor).order_by(Contractor.id.asc())).first()
    if c is None:
        pytest.skip("No contractors seeded in DB")
    return c


def _first_part_master_for_org(db, org_unit_id: int) -> PartMaster:
    pm = db.scalars(
        select(PartMaster)
        .where(PartMaster.org_unit_id == int(org_unit_id), PartMaster.is_active.is_(True))
        .order_by(PartMaster.id.asc())
    ).first()
    if pm is None:
        pytest.skip("No active part master seeded in DB for this org unit")
    return pm


def _pending_invoice_exception_task(db, *, invoice_id: int) -> ApprovalTask | None:
    return db.scalars(
        select(ApprovalTask)
        .join(ApprovalRequest, ApprovalRequest.id == ApprovalTask.request_id)
        .where(
            ApprovalRequest.entity_type == APPROVAL_ENTITY_TYPE,
            ApprovalRequest.entity_id == int(invoice_id),
            ApprovalRequest.status == "pending",
            ApprovalTask.task_type == "approval",
            ApprovalTask.status == "pending",
        )
        .order_by(ApprovalTask.id.asc())
        .limit(1)
    ).first()


def _setup_invoice_exception_two_step_workflow(db, *, actor_id: int) -> tuple[Role, Role, User, User]:
    canonical = resolve_registered_action_code(db, ACTION_CODE_EXCEPTION_APPROVE)
    if canonical is None:
        feat = db.scalar(select(Feature).where(Feature.key == "invoices"))
        if feat is None:
            feat = Feature(key="invoices", name="Invoices")
            db.add(feat)
            db.commit()
        db.add(
            Permission(
                feature_id=int(feat.id),
                action="approve_exceptions",
                code=ACTION_CODE_EXCEPTION_APPROVE,
            )
        )
        db.commit()

    suffix = uuid.uuid4().hex[:8]
    role_l1 = Role(name=f"Finance Approver L1 {suffix}", description=None)
    role_l2 = Role(name=f"Finance Approver L2 {suffix}", description=None)
    db.add_all([role_l1, role_l2])
    db.commit()

    user_l1 = User(
        full_name=f"Finance L1 {suffix}",
        username=f"finl1_{suffix}",
        phone=f"+1555{suffix[:6]}01",
        email=f"finl1_{suffix}@example.test",
        hashed_password="x",
        password_changed_at=date.today(),
        is_active=True,
    )
    user_l2 = User(
        full_name=f"Finance L2 {suffix}",
        username=f"finl2_{suffix}",
        phone=f"+1666{suffix[:6]}02",
        email=f"finl2_{suffix}@example.test",
        hashed_password="x",
        password_changed_at=date.today(),
        is_active=True,
    )
    user_l1.roles = [role_l1]
    user_l2.roles = [role_l2]
    db.add_all([user_l1, user_l2])
    db.commit()

    svc = ApprovalWorkflowService(db)
    wf = svc.create_workflow(
        name=f"Invoice exception workflow {suffix}",
        entity_type=APPROVAL_ENTITY_TYPE,
        created_by=actor_id,
        is_active=False,
    )
    svc.add_step(workflow_id=wf.id, step_order=1, approver_role_id=role_l1.id, required_approvals=1)
    svc.add_step(workflow_id=wf.id, step_order=2, approver_role_id=role_l2.id, required_approvals=1)
    db.expire_all()
    svc.activate_workflow(wf.id, actor_user_id=actor_id)
    WorkflowMappingService(db).create_mapping(action_code=ACTION_CODE_EXCEPTION_APPROVE, workflow_id=wf.id)
    return role_l1, role_l2, user_l1, user_l2


def test_work_order_create_and_invoice_validate(db):
    actor = _first_user(db)
    org = _first_plant(db)
    contractor = _first_contractor(db)
    pm = _first_part_master_for_org(db, int(org.id))

    wo = WorkOrderService(db).create(
        WorkOrderCreate(
            org_unit_id=int(org.id),
            contractor_id=int(contractor.id),
            title="Test WO",
            description=None,
            items=[
                WorkOrderItemCreate(
                    part_master_id=int(pm.id),
                    progress_type="quantity",
                    planned_quantity=Decimal("10"),
                    planned_percentage=None,
                    weight_per_piece=Decimal("1"),
                    notes=None,
                )
            ],
        ),
        actor_user_id=actor,
    )
    assert wo.id > 0
    svc_w = WorkOrderService(db)
    wo2 = svc_w.submit_for_approval(int(wo.id), actor_user_id=actor)
    if str(wo2.status) == "pending_approval":
        wo2 = svc_w.finalize_approval(int(wo2.id), approver_user_id=actor, approval_request_id=wo2.approval_request_id)
    assert str(wo2.status) == "active"
    assert wo2.approved_value_total is not None
    assert Decimal(str(wo2.approved_value_total)) == WorkOrderService.approved_total_from_items(wo2)
    item_id = int(wo2.items[0].id)

    # Snapshot completion (eligible invoice qty follows latest cumulative snapshot).
    WorkOrderService(db).add_progress(
        item_id,
        WorkOrderItemProgressCreate(
            completed_quantity=Decimal("5"), completed_percentage=None, remarks="done"
        ),
        actor_user_id=actor,
    )

    inv = InvoiceService(db).create(
        InvoiceCreate(
            contractor_id=int(contractor.id),
            org_unit_id=int(org.id),
            invoice_number=f"INV-{date.today().strftime('%Y%m%d')}-TEST-{uuid.uuid4().hex[:8]}",
            invoice_date=date.today(),
            lines=[
                InvoiceLineCreate(work_order_item_id=item_id, quantity=Decimal("5"), rate=None, notes=None)
            ],
        ),
        actor_user_id=actor,
    )
    assert str(inv.status) == "submitted"
    assert inv.validation_status in ("pass", "warn")
    assert inv.approved_at is None


def test_work_order_draft_update_replaces_lines(db):
    actor = _first_user(db)
    org = _first_plant(db)
    contractor = _first_contractor(db)
    pm = _first_part_master_for_org(db, int(org.id))

    svc = WorkOrderService(db)
    wo = svc.create(
        WorkOrderCreate(
            org_unit_id=int(org.id),
            contractor_id=int(contractor.id),
            title="Draft lines",
            description="ref1",
            items=[
                WorkOrderItemCreate(
                    part_master_id=int(pm.id),
                    progress_type="quantity",
                    planned_quantity=Decimal("1"),
                    planned_percentage=None,
                    weight_per_piece=Decimal("1"),
                    notes=None,
                )
            ],
        ),
        actor_user_id=actor,
    )
    assert len(wo.items) == 1

    updated = svc.update_draft(
        int(wo.id),
        WorkOrderDraftUpdate(
            title="Draft lines 2",
            description="ref2",
            items=[
                WorkOrderItemCreate(
                    part_master_id=int(pm.id),
                    progress_type="quantity",
                    planned_quantity=Decimal("3"),
                    planned_percentage=None,
                    weight_per_piece=Decimal("1"),
                    notes="note a",
                ),
                WorkOrderItemCreate(
                    part_master_id=int(pm.id),
                    progress_type="quantity",
                    planned_quantity=Decimal("5"),
                    planned_percentage=None,
                    weight_per_piece=Decimal("1"),
                    notes="note b",
                ),
            ],
        ),
        actor_user_id=actor,
    )
    assert updated.title == "Draft lines 2"
    assert updated.description == "ref2"
    assert len(updated.items) == 2
    assert updated.items[0].notes == "note a"


def test_second_invoice_blocked_when_exceeding_work_order_total(db):
    actor = _first_user(db)
    org = _first_plant(db)
    contractor = _first_contractor(db)
    pm = _first_part_master_for_org(db, int(org.id))

    wo = WorkOrderService(db).create(
        WorkOrderCreate(
            org_unit_id=int(org.id),
            contractor_id=int(contractor.id),
            title="WO invoice cap",
            description=None,
            items=[
                WorkOrderItemCreate(
                    part_master_id=int(pm.id),
                    progress_type="quantity",
                    planned_quantity=Decimal("10"),
                    planned_percentage=None,
                    weight_per_piece=Decimal("1"),
                    notes=None,
                ),
            ],
        ),
        actor_user_id=actor,
    )
    svc_w = WorkOrderService(db)
    wo2 = svc_w.submit_for_approval(int(wo.id), actor_user_id=actor)
    if str(wo2.status) == "pending_approval":
        wo2 = svc_w.finalize_approval(int(wo2.id), approver_user_id=actor, approval_request_id=wo2.approval_request_id)
    assert str(wo2.status) == "active"
    cap = Decimal(str(wo2.approved_value_total))
    assert cap > 0
    item_id = int(wo2.items[0].id)

    WorkOrderService(db).add_progress(
        item_id,
        WorkOrderItemProgressCreate(
            completed_quantity=Decimal("10"), completed_percentage=None, remarks="done"
        ),
        actor_user_id=actor,
    )

    inv_svc = InvoiceService(db)
    n1 = f"INV-{date.today().strftime('%Y%m%d')}-C1-{uuid.uuid4().hex[:8]}"
    inv_svc.create(
        InvoiceCreate(
            contractor_id=int(contractor.id),
            org_unit_id=int(org.id),
            invoice_number=n1,
            invoice_date=date.today(),
            lines=[
                InvoiceLineCreate(work_order_item_id=item_id, quantity=Decimal("9"), rate=None, notes=None),
            ],
        ),
        actor_user_id=actor,
    )

    n2 = f"INV-{date.today().strftime('%Y%m%d')}-C2-{uuid.uuid4().hex[:8]}"
    inv_svc.create(
        InvoiceCreate(
            contractor_id=int(contractor.id),
            org_unit_id=int(org.id),
            invoice_number=n2,
            invoice_date=date.today(),
            lines=[
                InvoiceLineCreate(work_order_item_id=item_id, quantity=Decimal("1"), rate=None, notes=None),
            ],
        ),
        actor_user_id=actor,
    )

    n3 = f"INV-{date.today().strftime('%Y%m%d')}-C3-{uuid.uuid4().hex[:8]}"
    with pytest.raises(ConflictError):
        inv_svc.create(
            InvoiceCreate(
                contractor_id=int(contractor.id),
                org_unit_id=int(org.id),
                invoice_number=n3,
                invoice_date=date.today(),
                lines=[
                    InvoiceLineCreate(
                        work_order_item_id=item_id,
                        quantity=Decimal("0.51"),
                        rate=None,
                        notes=None,
                    ),
                ],
            ),
            actor_user_id=actor,
        )


def test_close_work_order_requires_full_completion(db):
    actor = _first_user(db)
    org = _first_plant(db)
    contractor = _first_contractor(db)
    pm = _first_part_master_for_org(db, int(org.id))

    wo = WorkOrderService(db).create(
        WorkOrderCreate(
            org_unit_id=int(org.id),
            contractor_id=int(contractor.id),
            title="Close test WO",
            description=None,
            items=[
                WorkOrderItemCreate(
                    part_master_id=int(pm.id),
                    progress_type="quantity",
                    planned_quantity=Decimal("2"),
                    planned_percentage=None,
                    weight_per_piece=Decimal("1"),
                    notes=None,
                )
            ],
        ),
        actor_user_id=actor,
    )
    svc_w = WorkOrderService(db)
    wo2 = svc_w.submit_for_approval(int(wo.id), actor_user_id=actor)
    if str(wo2.status) == "pending_approval":
        wo2 = svc_w.finalize_approval(int(wo2.id), approver_user_id=actor, approval_request_id=wo2.approval_request_id)
    assert str(wo2.status) == "active"
    item_id = int(wo2.items[0].id)

    with pytest.raises(ConflictError, match="100%"):
        svc_w.close_active_work_order(int(wo2.id), actor_user_id=actor)

    svc_w.add_progress(
        item_id,
        WorkOrderItemProgressCreate(completed_quantity=None, completed_percentage=Decimal("100"), remarks=None),
        actor_user_id=actor,
    )
    closed = svc_w.close_active_work_order(int(wo2.id), actor_user_id=actor)
    assert str(closed.status) == "closed"


def test_invoice_rejects_lines_from_multiple_work_orders(db):
    actor = _first_user(db)
    org = _first_plant(db)
    contractor = _first_contractor(db)
    pm = _first_part_master_for_org(db, int(org.id))

    svc_w = WorkOrderService(db)
    item_ids: list[int] = []
    for title in ("WO-A", "WO-B"):
        wo = svc_w.create(
            WorkOrderCreate(
                org_unit_id=int(org.id),
                contractor_id=int(contractor.id),
                title=title,
                description=None,
                items=[
                    WorkOrderItemCreate(
                        part_master_id=int(pm.id),
                        progress_type="quantity",
                        planned_quantity=Decimal("2"),
                        planned_percentage=None,
                        weight_per_piece=Decimal("1"),
                        notes=None,
                    )
                ],
            ),
            actor_user_id=actor,
        )
        wo2 = svc_w.submit_for_approval(int(wo.id), actor_user_id=actor)
        if str(wo2.status) == "pending_approval":
            wo2 = svc_w.finalize_approval(
                int(wo2.id), approver_user_id=actor, approval_request_id=wo2.approval_request_id
            )
        assert str(wo2.status) == "active"
        item_ids.append(int(wo2.items[0].id))

    inv_svc = InvoiceService(db)
    with pytest.raises(ConflictError, match="exactly one work order"):
        inv_svc.create(
            InvoiceCreate(
                contractor_id=int(contractor.id),
                org_unit_id=int(org.id),
                invoice_number=f"INV-MULTI-WO-{uuid.uuid4().hex[:8]}",
                invoice_date=date.today(),
                lines=[
                    InvoiceLineCreate(work_order_item_id=item_ids[0], quantity=Decimal("1"), rate=None, notes=None),
                    InvoiceLineCreate(work_order_item_id=item_ids[1], quantity=Decimal("1"), rate=None, notes=None),
                ],
            ),
            actor_user_id=actor,
        )


def test_extra_charge_overage_submits_into_two_step_finance_approval(db):
    actor = _first_user(db)
    org = _first_plant(db)
    contractor = _first_contractor(db)
    pm = _first_part_master_for_org(db, int(org.id))
    role_l1, role_l2, approver_l1, approver_l2 = _setup_invoice_exception_two_step_workflow(
        db, actor_id=actor
    )

    svc_w = WorkOrderService(db)
    wo = svc_w.create(
        WorkOrderCreate(
            org_unit_id=int(org.id),
            contractor_id=int(contractor.id),
            title=f"WO invoice extra cap {uuid.uuid4().hex[:6]}",
            description=None,
            items=[
                WorkOrderItemCreate(
                    part_master_id=int(pm.id),
                    progress_type="quantity",
                    planned_quantity=Decimal("10"),
                    planned_percentage=None,
                    weight_per_piece=Decimal("1"),
                    notes=None,
                )
            ],
        ),
        actor_user_id=actor,
    )
    wo = svc_w.submit_for_approval(int(wo.id), actor_user_id=actor)
    if str(wo.status) == "pending_approval":
        wo = svc_w.finalize_approval(int(wo.id), approver_user_id=actor, approval_request_id=wo.approval_request_id)
    item = wo.items[0]
    svc_w.add_progress(
        int(item.id),
        WorkOrderItemProgressCreate(completed_quantity=Decimal(str(item.planned_quantity)), completed_percentage=None, remarks="done"),
        actor_user_id=actor,
    )

    inv = InvoiceService(db).create(
        InvoiceCreate(
            contractor_id=int(contractor.id),
            org_unit_id=int(org.id),
            invoice_number=f"INV-EXTRA-{uuid.uuid4().hex[:8]}",
            invoice_date=date.today(),
            lines=[
                InvoiceLineCreate(
                    work_order_item_id=int(item.id),
                    quantity=Decimal(str(item.planned_quantity)),
                    rate=None,
                    notes="full WO line",
                )
            ],
            extra_amount_ex_vat=Decimal("10.00"),
        ),
        actor_user_id=actor,
    )
    inv = InvoiceService(db).submit(int(inv.id), actor_user_id=actor)

    assert str(inv.status) == "pending_exception_approval"
    assert str(inv.validation_status) == "blocked"
    assert inv.approval_request_id is not None

    task_l1 = _pending_invoice_exception_task(db, invoice_id=int(inv.id))
    assert task_l1 is not None
    assert int(task_l1.assigned_role_id) == int(role_l1.id)

    engine = ApprovalEngineService(db)
    engine.act_on_task(
        task_id=int(task_l1.id),
        actor_user_id=int(approver_l1.id),
        action="approve",
        comment="L1 ok",
    )

    after_l1 = InvoiceService(db).get(int(inv.id))
    assert str(after_l1.status) == "pending_exception_approval"
    task_l2 = _pending_invoice_exception_task(db, invoice_id=int(inv.id))
    assert task_l2 is not None
    assert int(task_l2.assigned_role_id) == int(role_l2.id)

    engine.act_on_task(
        task_id=int(task_l2.id),
        actor_user_id=int(approver_l2.id),
        action="approve",
        comment="L2 ok",
    )

    approved = InvoiceService(db).get(int(inv.id))
    assert str(approved.status) == "approved"
    assert str(approved.validation_status) == "pass"
    assert approved.approved_by == int(approver_l2.id)


def test_extra_charge_overage_second_level_rejects_invoice(db):
    actor = _first_user(db)
    org = _first_plant(db)
    contractor = _first_contractor(db)
    pm = _first_part_master_for_org(db, int(org.id))
    _role_l1, role_l2, approver_l1, approver_l2 = _setup_invoice_exception_two_step_workflow(
        db, actor_id=actor
    )

    svc_w = WorkOrderService(db)
    wo = svc_w.create(
        WorkOrderCreate(
            org_unit_id=int(org.id),
            contractor_id=int(contractor.id),
            title=f"WO invoice extra reject {uuid.uuid4().hex[:6]}",
            description=None,
            items=[
                WorkOrderItemCreate(
                    part_master_id=int(pm.id),
                    progress_type="quantity",
                    planned_quantity=Decimal("10"),
                    planned_percentage=None,
                    weight_per_piece=Decimal("1"),
                    notes=None,
                )
            ],
        ),
        actor_user_id=actor,
    )
    wo = svc_w.submit_for_approval(int(wo.id), actor_user_id=actor)
    if str(wo.status) == "pending_approval":
        wo = svc_w.finalize_approval(int(wo.id), approver_user_id=actor, approval_request_id=wo.approval_request_id)
    item = wo.items[0]
    svc_w.add_progress(
        int(item.id),
        WorkOrderItemProgressCreate(completed_quantity=Decimal(str(item.planned_quantity)), completed_percentage=None, remarks="done"),
        actor_user_id=actor,
    )

    inv = InvoiceService(db).create(
        InvoiceCreate(
            contractor_id=int(contractor.id),
            org_unit_id=int(org.id),
            invoice_number=f"INV-EXTRA-REJ-{uuid.uuid4().hex[:8]}",
            invoice_date=date.today(),
            lines=[
                InvoiceLineCreate(
                    work_order_item_id=int(item.id),
                    quantity=Decimal(str(item.planned_quantity)),
                    rate=None,
                    notes="full WO line",
                )
            ],
            extra_amount_ex_vat=Decimal("10.00"),
        ),
        actor_user_id=actor,
    )
    inv = InvoiceService(db).submit(int(inv.id), actor_user_id=actor)

    engine = ApprovalEngineService(db)
    task_l1 = _pending_invoice_exception_task(db, invoice_id=int(inv.id))
    assert task_l1 is not None
    engine.act_on_task(
        task_id=int(task_l1.id),
        actor_user_id=int(approver_l1.id),
        action="approve",
        comment="L1 ok",
    )

    task_l2 = _pending_invoice_exception_task(db, invoice_id=int(inv.id))
    assert task_l2 is not None
    assert int(task_l2.assigned_role_id) == int(role_l2.id)
    engine.act_on_task(
        task_id=int(task_l2.id),
        actor_user_id=int(approver_l2.id),
        action="reject",
        comment="L2 rejected",
    )

    rejected = InvoiceService(db).get(int(inv.id))
    assert str(rejected.status) == "rejected"
    assert rejected.rejected_by == int(approver_l2.id)
