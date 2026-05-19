from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

import db.models  # noqa: F401
from db.session import SessionLocal
from modules.contractor.models import Contractor
from modules.part_master.models import PartMaster
from modules.org_units.model import OrgUnit
from modules.users.model import User
from modules.work_orders.schema import (
    WorkOrderCreate,
    WorkOrderDraftUpdate,
    WorkOrderItemCreate,
    WorkOrderItemProgressCreate,
)
from modules.work_orders.service import WorkOrderService
from modules.invoices.schema import InvoiceCreate, InvoiceLineCreate
from modules.invoices.service import InvoiceService
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
