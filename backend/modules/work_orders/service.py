from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, selectinload

from modules.approvals.assignment_service import get_workflow_for_action
from modules.approvals.service import ApprovalEngineService
from modules.contractor.models import Contractor
from modules.contractor_rates.models import ContractorRate
from modules.part_master.models import PartMaster
from modules.part_master.pricing import commercial_snapshot_from_part_row, amount_from_snapshot, pricing_snapshot_for_item
from modules.errors import ConflictError, NotFoundError
from modules.org_units.hierarchy import collect_plant_ids_under_scope
from modules.org_units.model import OrgUnit
from modules.users.model import User
from modules.work_orders import audit as audit_helpers
from modules.work_orders.models import (
    WORK_ORDER_ITEM_PROGRESS_TYPES,
    WORK_ORDER_STATUSES,
    WorkOrder,
    WorkOrderItem,
    WorkOrderItemProgress,
)
from modules.invoices.models import Invoice, InvoiceLine
from modules.work_orders.schema import (
    WorkOrderCreate,
    WorkOrderDraftUpdate,
    WorkOrderItemCreate,
    WorkOrderItemProgressCreate,
    WorkOrderRateOverrideRequest,
)


ACTION_CODE_CREATE = "work_orders.create"
ACTION_CODE_APPROVE = "work_orders.approve"
ACTION_CODE_OVERRIDE_RATE = "work_orders.override_rate"

APPROVAL_ENTITY_TYPE = "work_order_approval"
OVERRIDE_APPROVAL_ENTITY_TYPE = "work_order_rate_override"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _pricing_date_for(wo: WorkOrder) -> date:
    """Pricing anchor for negotiated-rate lookup.

    Draft / rejected work orders should resolve against today's commercial rate so edits and
    resubmissions pick up the latest approved negotiation. Once a work order is approved and
    operational, freeze the anchor to its approval date (or creation date as a legacy fallback).
    """
    status = str(getattr(wo, "status", "") or "").strip().lower()
    if status in ("draft", "rejected", "pending_approval"):
        return date.today()
    if wo.approved_at is not None:
        return wo.approved_at.date()
    ts = wo.created_at
    if ts is not None:
        return ts.date()
    return date.today()


def _q2(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"))


def _q6(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.000001"))


def _q3(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.001"))


def _dec(x: Any) -> Decimal:
    return x if isinstance(x, Decimal) else Decimal(str(x))


def _json_decimal(v: Decimal | None) -> str | None:
    if v is None:
        return None
    return str(_q2(Decimal(str(v))))


class WorkOrderService:
    def __init__(self, db: Session) -> None:
        self._db = db

    @staticmethod
    def approved_total_from_items(wo: WorkOrder) -> Decimal:
        """Approved commercial total = sum of line taxable values (ex tax)."""
        return _q2(sum(_dec(it.taxable_value) for it in (wo.items or [])))

    def _sync_approved_value_total_from_lines(self, wo: WorkOrder) -> None:
        """Refresh header cap after governed line changes (e.g. approved rate override)."""
        if str(wo.status) != "active":
            return
        wo.approved_value_total = WorkOrderService.approved_total_from_items(wo)

    def _ensure_plant(self, org_unit_id: int) -> OrgUnit:
        org = self._db.get(OrgUnit, int(org_unit_id))
        if org is None:
            raise NotFoundError("OrgUnit", org_unit_id)
        if getattr(org, "type", None) and str(org.type).upper() != "PLANT":
            raise ConflictError("work_order can only be created for plants (org_units.type=PLANT).")
        return org

    def _ensure_contractor(self, contractor_id: int) -> Contractor:
        c = self._db.get(Contractor, int(contractor_id))
        if c is None:
            raise NotFoundError("Contractor", contractor_id)
        return c

    def _ensure_part_master(self, part_master_id: int) -> PartMaster:
        rm = self._db.get(PartMaster, int(part_master_id))
        if rm is None:
            raise NotFoundError("PartMaster", part_master_id)
        return rm

    def _resolve_rate_for(
        self,
        *,
        contractor_id: int,
        part_master_id: int,
        pricing_date: date,
    ) -> tuple[Decimal, str, int | None]:
        """Return (rate, source, contractor_rate_id).

        Uses the supplied pricing date: the latest **approved** negotiated rate whose
        ``[effective_from, effective_to]`` window contains that date wins; otherwise the
        active Part Master baseline applies.
        """
        # Prefer an approved negotiated rate whose validity window covers pricing_date.
        # Order by effective_from (newest window first), then approval time, then id.
        stmt = (
            select(ContractorRate)
            .where(
                ContractorRate.contractor_id == int(contractor_id),
                ContractorRate.part_master_id == int(part_master_id),
                ContractorRate.status == "approved",
                ContractorRate.effective_from <= pricing_date,
                func.coalesce(ContractorRate.effective_to, date(9999, 12, 31)) >= pricing_date,
            )
            .order_by(
                ContractorRate.effective_from.desc(),
                ContractorRate.approved_at.desc().nullslast(),
                ContractorRate.id.desc(),
            )
        )
        cr = self._db.scalar(stmt)
        if cr is not None:
            return Decimal(cr.negotiated_rate), "negotiated", int(cr.id)

        # Fallback to active Part Master baseline.
        rm = self._ensure_part_master(int(part_master_id))
        if not bool(rm.is_active):
            raise ConflictError("Selected part master row is not active.")
        if rm.effective_from and rm.effective_from > pricing_date:
            raise ConflictError("Selected part master is not yet effective for the creation date.")
        if rm.effective_to is not None and rm.effective_to < pricing_date:
            raise ConflictError("Selected part master is expired for the creation date.")
        return Decimal(rm.base_rate), "master", None

    def preview_resolved_line_rate(
        self,
        *,
        contractor_id: int,
        part_master_id: int,
        pricing_date: date,
    ) -> dict[str, Any]:
        """Same resolution as persisted WO lines; for UI preview while drafting."""
        self._ensure_contractor(int(contractor_id))
        rate, src, cr_id = self._resolve_rate_for(
            contractor_id=int(contractor_id),
            part_master_id=int(part_master_id),
            pricing_date=pricing_date,
        )
        return {
            "resolved_rate": str(rate),
            "rate_source": src,
            "contractor_rate_id": cr_id,
        }

    def _next_number(self, *, org_unit_id: int) -> str:
        # Deterministic, readable numbering. Not gapless (safe under concurrency).
        # Format: WO-<plantId>-<YYYYMMDD>-<sequence>
        day = date.today().strftime("%Y%m%d")
        prefix = f"WO-{int(org_unit_id)}-{day}-"
        last = self._db.scalar(
            select(WorkOrder.work_order_number)
            .where(WorkOrder.work_order_number.like(f"{prefix}%"))
            .order_by(WorkOrder.id.desc())
            .limit(1)
        )
        if last and str(last).startswith(prefix):
            tail = str(last).replace(prefix, "")
            try:
                n = int(tail)
            except Exception:
                n = 0
        else:
            n = 0
        return f"{prefix}{n + 1:04d}"

    def get(self, work_order_id: int) -> WorkOrder:
        # Session uses expire_on_commit=False; merged rows must overwrite identity-map instances
        # (e.g. after draft line replacement) so callers always see current DB state.
        stmt = (
            select(WorkOrder)
            .where(WorkOrder.id == int(work_order_id))
            .options(
                selectinload(WorkOrder.items).selectinload(WorkOrderItem.progress),
            )
        )
        wo = self._db.execute(stmt, execution_options={"populate_existing": True}).scalars().first()
        if wo is None:
            raise NotFoundError("WorkOrder", work_order_id)
        return wo

    def list_invoices_for_work_order(self, work_order_id: int) -> list[Invoice]:
        """Distinct invoices that reference any line item on this work order."""
        self.get(work_order_id)
        subq = (
            select(InvoiceLine.invoice_id)
            .join(WorkOrderItem, WorkOrderItem.id == InvoiceLine.work_order_item_id)
            .where(WorkOrderItem.work_order_id == int(work_order_id))
            .distinct()
        )
        stmt = (
            select(Invoice)
            .where(Invoice.id.in_(subq))
            .options(selectinload(Invoice.lines))
            .order_by(Invoice.id.desc())
        )
        return list(self._db.scalars(stmt).unique().all())

    def _list_filters(
        self,
        stmt: Select[Any],
        *,
        org_unit_id: int | None = None,
        contractor_id: int | None = None,
        status: str | None = None,
        statuses: list[str] | None = None,
        active: bool | None = True,
    ) -> Select[Any] | None:
        """Apply list filters. Returns ``None`` when plant scope is empty (no rows)."""
        if active is not None:
            stmt = stmt.where(WorkOrder.is_active.is_(bool(active)))
        if org_unit_id is not None:
            plant_ids = collect_plant_ids_under_scope(self._db, int(org_unit_id))
            if not plant_ids:
                return None
            stmt = stmt.where(WorkOrder.org_unit_id.in_(plant_ids))
        if contractor_id is not None:
            stmt = stmt.where(WorkOrder.contractor_id == int(contractor_id))
        if statuses:
            normalized = [s.strip().lower() for s in statuses if s and str(s).strip()]
            if normalized:
                stmt = stmt.where(WorkOrder.status.in_(normalized))
        elif status:
            stmt = stmt.where(WorkOrder.status == status.strip().lower())
        return stmt

    def count_list(
        self,
        *,
        org_unit_id: int | None = None,
        contractor_id: int | None = None,
        status: str | None = None,
        statuses: list[str] | None = None,
        active: bool | None = True,
    ) -> int:
        stmt = select(func.count()).select_from(WorkOrder)
        filtered = self._list_filters(
            stmt,
            org_unit_id=org_unit_id,
            contractor_id=contractor_id,
            status=status,
            statuses=statuses,
            active=active,
        )
        if filtered is None:
            return 0
        return int(self._db.scalar(filtered) or 0)

    def list(
        self,
        *,
        org_unit_id: int | None = None,
        contractor_id: int | None = None,
        status: str | None = None,
        statuses: list[str] | None = None,
        active: bool | None = True,
        offset: int = 0,
        limit: int = 100,
    ) -> list[WorkOrder]:
        stmt = select(WorkOrder).options(selectinload(WorkOrder.items)).order_by(WorkOrder.id.desc())
        filtered = self._list_filters(
            stmt,
            org_unit_id=org_unit_id,
            contractor_id=contractor_id,
            status=status,
            statuses=statuses,
            active=active,
        )
        if filtered is None:
            return []
        stmt = filtered.offset(int(offset)).limit(int(limit))
        return list(self._db.scalars(stmt).unique().all())

    def archive(self, work_order_id: int, *, actor_user_id: int) -> WorkOrder:
        wo = self.get(work_order_id)
        if not bool(wo.is_active):
            return wo
        # Block archiving if it has downstream invoices in the future (we can enforce later).
        wo.is_active = False
        if wo.status not in ("cancelled", "closed"):
            wo.status = "cancelled"
        audit_helpers.write_audit(
            self._db,
            work_order_id=int(wo.id),
            action=audit_helpers.ACTION_CANCELLED,
            actor_user_id=actor_user_id,
            new_value={"is_active": False, "status": wo.status},
        )
        self._db.commit()
        return wo

    def close_active_work_order(self, work_order_id: int, *, actor_user_id: int) -> WorkOrder:
        """Mark an active work order as closed after every line reports 100% completion."""
        wo = self.get(work_order_id)
        if str(wo.status) != "active":
            raise ConflictError('Only an "active" work order can be completed (closed).')
        items = list(wo.items or [])
        if not items:
            raise ConflictError("Work order has no line items.")
        for it in items:
            proj = self.item_completion_projection(it)
            cp = proj.get("completed_percentage")
            if cp is None or float(cp) < 99.99:
                raise ConflictError(
                    "Every line item must be saved at 100% completion before you can complete the work order."
                )
        old_status = str(wo.status)
        wo.status = "closed"
        audit_helpers.write_audit(
            self._db,
            work_order_id=int(wo.id),
            action=audit_helpers.ACTION_CLOSED,
            actor_user_id=actor_user_id,
            old_value={"status": old_status},
            new_value={"status": "closed"},
        )
        self._db.commit()
        return self.get(work_order_id)

    def hard_delete(self, work_order_id: int, *, actor_user_id: int) -> None:
        """
        Permanently remove a work order and its children from the database.

        Safety: blocked if any invoices exist for items under this work order.
        """
        wo = self.get(work_order_id)

        item_ids = [
            int(x)
            for x in self._db.scalars(
                select(WorkOrderItem.id).where(WorkOrderItem.work_order_id == int(work_order_id))
            ).all()
        ]
        if item_ids:
            inv_cnt = int(
                self._db.scalar(
                    select(func.count())
                    .select_from(InvoiceLine)
                    .where(InvoiceLine.work_order_item_id.in_([int(x) for x in item_ids]))
                )
                or 0
            )
            if inv_cnt > 0:
                raise ConflictError(
                    "Cannot delete this work order because invoices exist against its items."
                )

        # Audit record (best-effort; will be deleted by cascade when the WO is deleted, but useful in logs if replicated).
        audit_helpers.write_audit(
            self._db,
            work_order_id=int(wo.id),
            action="HARD_DELETED",
            actor_user_id=actor_user_id,
            old_value=audit_helpers.snapshot_work_order(wo),
        )
        self._db.flush()
        self._db.delete(wo)
        self._db.commit()

    @staticmethod
    def _taxable_qty_from_create(it: WorkOrderItemCreate) -> Decimal:
        pt = it.progress_type.strip().lower()
        if pt == "quantity" and it.planned_quantity is not None:
            return _dec(it.planned_quantity)
        if pt == "percentage":
            if it.planned_percentage is not None:
                return _dec(it.planned_percentage) / Decimal("100")
            return Decimal("1")
        return Decimal("0")

    @staticmethod
    def _taxable_qty_from_item(item: WorkOrderItem) -> Decimal:
        pt = str(item.progress_type).strip().lower()
        if pt == "quantity" and item.planned_quantity is not None:
            return _dec(item.planned_quantity)
        if pt == "percentage":
            if item.planned_percentage is not None:
                return _dec(item.planned_percentage) / Decimal("100")
            return Decimal("1")
        return Decimal("0")

    @staticmethod
    def ex_tax_for_invoice_qty(*, item: WorkOrderItem, invoice_quantity: Decimal) -> Decimal:
        """Ex-VAT amount from the work order line's stored ``taxable_value``, linearly prorated by invoice quantity.

        Uses the same billing basis as when the line was valued (planned quantity or planned % as 0..1).
        If that basis is missing (legacy row), falls back to the commercial snapshot engine.
        """
        inv_q = _dec(invoice_quantity)
        if inv_q <= 0:
            raise ValueError("Invoice quantity must be positive.")
        basis = WorkOrderService._taxable_qty_from_item(item)
        if basis <= 0:
            try:
                return amount_from_snapshot(
                    quantity=inv_q,
                    resolved_rate=_dec(item.resolved_rate),
                    snapshot=pricing_snapshot_for_item(item),
                )
            except ValueError as exc:
                raise ValueError(str(exc)) from exc
        tv = _q2(_dec(item.taxable_value))
        return _q2((inv_q * tv) / basis)

    def _build_item_from_create(
        self,
        wo: WorkOrder,
        *,
        contractor_id: int,
        it: WorkOrderItemCreate,
        pricing_date: date,
    ) -> WorkOrderItem:
        rm = self._ensure_part_master(int(it.part_master_id))
        rate, src, cr_id = self._resolve_rate_for(
            contractor_id=int(contractor_id),
            part_master_id=int(rm.id),
            pricing_date=pricing_date,
        )
        pt = it.progress_type.strip().lower()
        if pt not in WORK_ORDER_ITEM_PROGRESS_TYPES:
            raise ConflictError(f"Invalid progress_type '{pt}'.")

        pm = str(rm.pricing_method or "").strip().lower()
        ru = str(rm.rate_unit_type or "").strip().lower()
        w_eff: Decimal | None = None
        if it.weight_per_piece is not None:
            w_eff = _q6(Decimal(str(it.weight_per_piece)))
        elif rm.weight_per_piece is not None:
            w_eff = _q6(Decimal(str(rm.weight_per_piece)))

        if pm == "weight_based" and ru == "per_kg":
            if w_eff is None or w_eff <= 0:
                raise ConflictError(
                    "Weight per piece is required for weight-based parts (per kg). "
                    "Set it on the Part Master or enter it on the line."
                )

        snap: dict[str, Any] = dict(commercial_snapshot_from_part_row(rm))
        if w_eff is not None:
            snap["weight_per_piece"] = str(w_eff)

        qty_basis = WorkOrderService._taxable_qty_from_create(it)
        try:
            taxable = amount_from_snapshot(
                quantity=qty_basis,
                resolved_rate=_q2(Decimal(rate)),
                snapshot=snap,
            )
        except ValueError as exc:
            raise ConflictError(str(exc)) from exc

        snap["calculation_breakdown"] = {
            "formula": "qty × weight_per_piece × rate_per_kg"
            if pm == "weight_based" and ru == "per_kg"
            else "qty × unit_rate",
            "quantity": str(qty_basis),
            "weight_per_piece": str(w_eff) if w_eff is not None else None,
            "resolved_rate": str(_q2(Decimal(rate))),
            "taxable_value": str(taxable),
        }

        return WorkOrderItem(
            work_order_id=int(wo.id),
            part_master_id=int(rm.id),
            pricing_snapshot=snap,
            progress_type=pt,
            planned_quantity=it.planned_quantity,
            planned_percentage=it.planned_percentage,
            resolved_rate=_q2(Decimal(rate)),
            rate_source=src,
            contractor_rate_id=cr_id,
            weight_per_piece_snapshot=w_eff,
            taxable_value=taxable,
            notes=it.notes or None,
        )

    def _replace_line_items(
        self,
        wo: WorkOrder,
        *,
        contractor_id: int,
        items: list[WorkOrderItemCreate],
        pricing_date: date,
    ) -> None:
        if not items:
            raise ConflictError("At least one line item is required.")
        self._ensure_contractor(int(contractor_id))
        for row in list(wo.items or []):
            self._db.delete(row)
        self._db.flush()
        for it in items:
            self._db.add(
                self._build_item_from_create(
                    wo, contractor_id=int(contractor_id), it=it, pricing_date=pricing_date
                )
            )

    def _recompute_taxable_for_item(self, item: WorkOrderItem) -> Decimal:
        qty_basis = WorkOrderService._taxable_qty_from_item(item)
        try:
            taxable = amount_from_snapshot(
                quantity=qty_basis,
                resolved_rate=_dec(item.resolved_rate),
                snapshot=pricing_snapshot_for_item(item),
            )
        except ValueError as exc:
            raise ConflictError(str(exc)) from exc
        item.taxable_value = taxable
        ps = dict(item.pricing_snapshot or {})
        bd = dict(ps.get("calculation_breakdown") or {})
        bd["quantity"] = str(qty_basis)
        bd["taxable_value"] = str(taxable)
        bd["resolved_rate"] = str(item.resolved_rate)
        ps["calculation_breakdown"] = bd
        item.pricing_snapshot = ps
        return taxable

    def _work_order_item_ids(self, work_order_id: int) -> list[int]:
        return [
            int(x)
            for x in self._db.scalars(
                select(WorkOrderItem.id).where(WorkOrderItem.work_order_id == int(work_order_id))
            ).all()
        ]

    def _invoice_line_count_for_work_order(self, work_order_id: int) -> int:
        item_ids = self._work_order_item_ids(int(work_order_id))
        if not item_ids:
            return 0
        return int(
            self._db.scalar(
                select(func.count())
                .select_from(InvoiceLine)
                .where(InvoiceLine.work_order_item_id.in_(item_ids))
            )
            or 0
        )

    def _reprice_items_after_contractor_change(self, wo: WorkOrder, *, pricing_date: date) -> None:
        """Re-resolve negotiated/master rates for each line (contractor or work-date change)."""
        self._ensure_contractor(int(wo.contractor_id))
        for item in list(wo.items or []):
            rate, src, cr_id = self._resolve_rate_for(
                contractor_id=int(wo.contractor_id),
                part_master_id=int(item.part_master_id),
                pricing_date=pricing_date,
            )
            item.resolved_rate = _q2(Decimal(rate))
            item.rate_source = src
            item.contractor_rate_id = cr_id
            self._recompute_taxable_for_item(item)

    def sync_resolved_rates_for_contractor_part(self, *, contractor_id: int, part_master_id: int) -> int:
        """Re-resolve rates on draft/active work orders after a negotiated rate becomes active.

        Uses the same :meth:`_resolve_rate_for` rules as new work order lines (editable drafts use
        today's commercial date; approved/active rows stay anchored to approval date, then fall back
        to creation date). Skips lines that already use an **approved** manual override.

        Invoice lines inherit ``resolved_rate`` from the work order item, so this keeps WO and
        invoicing aligned with the latest negotiated price for that contractor + part.
        """
        wo_ids_sq = (
            select(WorkOrderItem.work_order_id)
            .join(WorkOrder, WorkOrder.id == WorkOrderItem.work_order_id)
            .where(
                WorkOrder.contractor_id == int(contractor_id),
                WorkOrderItem.part_master_id == int(part_master_id),
                WorkOrder.status.in_(("draft", "active")),
                WorkOrder.is_active.is_(True),
            )
            .distinct()
        )
        stmt = select(WorkOrder).where(WorkOrder.id.in_(wo_ids_sq)).options(selectinload(WorkOrder.items))
        wos = list(self._db.scalars(stmt).unique().all())
        touched = 0
        for wo in wos:
            changed = False
            for item in list(wo.items or []):
                if int(item.part_master_id) != int(part_master_id):
                    continue
                if (
                    item.override_rate is not None
                    and str(item.rate_source or "") == "override"
                    and str(item.override_status or "").strip().lower() == "approved"
                ):
                    continue
                rate, src, cr_id = self._resolve_rate_for(
                    contractor_id=int(wo.contractor_id),
                    part_master_id=int(item.part_master_id),
                    pricing_date=_pricing_date_for(wo),
                )
                new_r = _q2(Decimal(rate))
                new_src = str(src)
                cr_same = (item.contractor_rate_id is None and cr_id is None) or (
                    item.contractor_rate_id is not None
                    and cr_id is not None
                    and int(item.contractor_rate_id) == int(cr_id)
                )
                if item.resolved_rate == new_r and str(item.rate_source) == new_src and cr_same:
                    continue
                item.resolved_rate = new_r
                item.rate_source = new_src
                item.contractor_rate_id = cr_id
                self._recompute_taxable_for_item(item)
                changed = True
            if changed:
                touched += 1
                self._sync_approved_value_total_from_lines(wo)
        return touched

    def create(self, payload: WorkOrderCreate, *, actor_user_id: int) -> WorkOrder:
        self._ensure_plant(int(payload.org_unit_id))
        if not payload.items:
            raise ConflictError("At least one line item is required.")

        number = self._next_number(org_unit_id=int(payload.org_unit_id))
        wo = WorkOrder(
            work_order_number=number,
            org_unit_id=int(payload.org_unit_id),
            contractor_id=int(payload.contractor_id),
            title=payload.title.strip(),
            description=(payload.description or None),
            status="draft",
            created_by=actor_user_id,
        )
        self._db.add(wo)
        self._db.flush()

        self._replace_line_items(
            wo,
            contractor_id=int(payload.contractor_id),
            items=list(payload.items),
            pricing_date=_pricing_date_for(wo),
        )

        audit_helpers.write_audit(
            self._db,
            work_order_id=int(wo.id),
            action=audit_helpers.ACTION_CREATED,
            actor_user_id=actor_user_id,
            new_value=audit_helpers.snapshot_work_order(wo),
        )
        self._db.commit()
        return self.get(int(wo.id))

    def _approval_payload_snapshot(self, wo: WorkOrder) -> dict[str, Any]:
        """Structured snapshot for approvals / inbox (JSON-serializable)."""
        org = self._db.get(OrgUnit, int(wo.org_unit_id))
        org_unit_name = getattr(org, "name", None) if org is not None else None
        ctr = self._db.get(Contractor, int(wo.contractor_id))
        contractor_name = getattr(ctr, "name", None) if ctr is not None else None
        lines_out: list[dict[str, Any]] = []
        for it in list(wo.items or []):
            rm_row = self._db.get(PartMaster, int(it.part_master_id))
            master_rate_s = str(rm_row.base_rate) if rm_row is not None else None
            ps = it.pricing_snapshot or {}
            lines_out.append(
                {
                    "contractor_id": int(wo.contractor_id),
                    "contractor_name": contractor_name,
                    "part_master_id": int(it.part_master_id),
                    "part_code": ps.get("part_code"),
                    "part_name": ps.get("part_name"),
                    "pricing_method": ps.get("pricing_method"),
                    "rate_unit_type": ps.get("rate_unit_type"),
                    "unit_type": ps.get("unit_type"),
                    "pricing_snapshot": it.pricing_snapshot,
                    "progress_type": str(it.progress_type),
                    "planned_quantity": _json_decimal(it.planned_quantity),
                    "planned_percentage": _json_decimal(it.planned_percentage),
                    "weight_per_piece_snapshot": str(it.weight_per_piece_snapshot)
                    if it.weight_per_piece_snapshot is not None
                    else None,
                    "taxable_value": str(it.taxable_value),
                    "resolved_rate": str(it.resolved_rate),
                    "master_rate": master_rate_s,
                    "rate_source": str(it.rate_source),
                    "notes": it.notes,
                    "invoice_value_est": str(it.taxable_value),
                }
            )

        return {
            "action_code": ACTION_CODE_CREATE,
            "work_order_id": int(wo.id),
            "work_order_number": wo.work_order_number,
            "org_unit_id": int(wo.org_unit_id),
            "org_unit_name": org_unit_name,
            "contractor_id": int(wo.contractor_id),
            "contractor_name": contractor_name,
            "title": wo.title,
            "description": wo.description,
            "created_at": wo.created_at.isoformat() if wo.created_at else None,
            "approved_at": wo.approved_at.isoformat() if wo.approved_at else None,
            "execution_lines": lines_out,
            "execution_line_count": len(lines_out),
        }

    def update_draft(self, work_order_id: int, payload: WorkOrderDraftUpdate, *, actor_user_id: int) -> WorkOrder:
        wo = self.get(work_order_id)
        if wo.status not in ("draft", "rejected"):
            raise ConflictError("Only draft or rejected work orders can be edited.")
        incoming = payload.model_dump(exclude_unset=True)
        if not incoming:
            return wo

        before_snap = audit_helpers.snapshot_work_order(wo)

        if "title" in incoming:
            t = (payload.title or "").strip()
            if not t:
                raise ConflictError("Title cannot be empty.")
            wo.title = t

        if "description" in incoming:
            wo.description = (
                payload.description.strip()
                if payload.description and str(payload.description).strip()
                else None
            )

        if "org_unit_id" in incoming and payload.org_unit_id is not None:
            ou = self._ensure_plant(int(payload.org_unit_id))
            if int(ou.id) != int(wo.org_unit_id):
                wo.org_unit_id = int(ou.id)
                wo.work_order_number = self._next_number(org_unit_id=int(wo.org_unit_id))

        if "contractor_id" in incoming and payload.contractor_id is not None:
            if int(payload.contractor_id) != int(wo.contractor_id):
                if self._invoice_line_count_for_work_order(int(wo.id)) > 0:
                    raise ConflictError(
                        "Cannot change contractor while invoices exist against this work order."
                    )
                self._ensure_contractor(int(payload.contractor_id))
                wo.contractor_id = int(payload.contractor_id)
                if "items" not in incoming:
                    self._reprice_items_after_contractor_change(wo, pricing_date=_pricing_date_for(wo))
                    self._db.flush()

        if "items" in incoming:
            if payload.items is None:
                raise ConflictError("Provide an items list when updating line items.")
            if self._invoice_line_count_for_work_order(int(wo.id)) > 0:
                raise ConflictError("Cannot edit lines while invoices exist against this work order.")
            self._replace_line_items(
                wo,
                contractor_id=int(wo.contractor_id),
                items=list(payload.items),
                pricing_date=_pricing_date_for(wo),
            )

        audit_helpers.write_audit(
            self._db,
            work_order_id=int(wo.id),
            action=audit_helpers.ACTION_UPDATED,
            actor_user_id=actor_user_id,
            old_value=before_snap,
            new_value=audit_helpers.snapshot_work_order(wo),
            metadata={"fields": sorted(incoming.keys())},
        )
        self._db.commit()
        return self.get(int(wo.id))

    def submit_for_approval(self, work_order_id: int, *, actor_user_id: int) -> WorkOrder:
        wo = self.get(work_order_id)
        if wo.status not in ("draft", "rejected"):
            raise ConflictError("Only draft/rejected work orders can be submitted for approval.")
        if not list(wo.items or []):
            raise ConflictError("Work order must have at least one line item before submission.")
        prior_status = str(wo.status)

        wf = get_workflow_for_action(self._db, ACTION_CODE_CREATE)
        if wf is None:
            # No workflow configured: auto-approve and activate.
            wo.approved_value_total = WorkOrderService.approved_total_from_items(wo)
            wo.status = "approved"
            wo.approved_by = actor_user_id
            wo.approved_at = _now_utc()
            audit_helpers.write_audit(
                self._db,
                work_order_id=int(wo.id),
                action=audit_helpers.ACTION_APPROVED,
                actor_user_id=actor_user_id,
                new_value={"status": "approved", "via": "auto"},
            )
            wo.status = "active"
            audit_helpers.write_audit(
                self._db,
                work_order_id=int(wo.id),
                action=audit_helpers.ACTION_ACTIVATED,
                actor_user_id=actor_user_id,
                new_value={"status": "active"},
            )
            self._db.commit()
            return self.get(int(wo.id))

        approval_engine = ApprovalEngineService(self._db)
        payload = self._approval_payload_snapshot(wo)
        wo.status = "pending_approval"
        if prior_status == "rejected" and wo.approval_request_id is not None:
            req, _new_task_id = approval_engine.resubmit_rejected_request(
                request_id=int(wo.approval_request_id),
                actor_user_id=actor_user_id,
                payload=payload,
                allow_pending=True,
            )
        else:
            req = approval_engine.create_request_for_entity(
                workflow=wf,
                entity_type=APPROVAL_ENTITY_TYPE,
                entity_id=int(wo.id),
                payload=payload,
                created_by=actor_user_id,
            )
        wo.approval_request_id = int(req.id)
        audit_helpers.write_audit(
            self._db,
            work_order_id=int(wo.id),
            action=audit_helpers.ACTION_SENT_FOR_APPROVAL,
            actor_user_id=actor_user_id,
            new_value={"status": "pending_approval"},
            metadata={"approval_request_id": int(req.id)},
        )
        self._db.commit()
        return self.get(int(wo.id))

    # ---- approval finalize hooks ----

    def finalize_approval(self, work_order_id: int, *, approver_user_id: int | None, approval_request_id: int | None) -> WorkOrder:
        wo = self.get(work_order_id)
        if wo.status != "pending_approval":
            return wo
        wo.approved_value_total = WorkOrderService.approved_total_from_items(wo)
        wo.status = "approved"
        wo.approved_by = approver_user_id
        wo.approved_at = _now_utc()
        wo.approval_request_id = approval_request_id or wo.approval_request_id
        audit_helpers.write_audit(
            self._db,
            work_order_id=int(wo.id),
            action=audit_helpers.ACTION_APPROVED,
            actor_user_id=approver_user_id,
            old_value={"status": "pending_approval"},
            new_value={"status": "approved"},
            metadata={"approval_request_id": wo.approval_request_id, "via": "approval_finalized"},
        )
        # Only approved work orders are operationally active.
        wo.status = "active"
        audit_helpers.write_audit(
            self._db,
            work_order_id=int(wo.id),
            action=audit_helpers.ACTION_ACTIVATED,
            actor_user_id=approver_user_id,
            new_value={"status": "active"},
        )
        self._db.commit()
        return self.get(int(wo.id))

    def finalize_rejection(self, work_order_id: int, *, rejector_user_id: int | None, approval_request_id: int | None, comment: str | None) -> WorkOrder:
        wo = self.get(work_order_id)
        if wo.status != "pending_approval":
            return wo
        wo.status = "rejected"
        wo.rejected_by = rejector_user_id
        wo.rejected_at = _now_utc()
        audit_helpers.write_audit(
            self._db,
            work_order_id=int(wo.id),
            action=audit_helpers.ACTION_REJECTED,
            actor_user_id=rejector_user_id,
            old_value={"status": "pending_approval"},
            new_value={"status": "rejected"},
            metadata={"approval_request_id": approval_request_id, "comment": comment, "via": "approval_rejected"},
        )
        self._db.commit()
        return self.get(int(wo.id))

    # ---- completion tracking ----

    def _latest_item_progress(self, work_order_item_id: int) -> WorkOrderItemProgress | None:
        return self._db.scalar(
            select(WorkOrderItemProgress)
            .where(WorkOrderItemProgress.work_order_item_id == int(work_order_item_id))
            .order_by(WorkOrderItemProgress.created_at.desc(), WorkOrderItemProgress.id.desc())
            .limit(1)
        )

    def _user_display_name(self, user_id: int | None) -> str | None:
        if user_id is None:
            return None
        u = self._db.get(User, int(user_id))
        if u is None:
            return None
        return str(u.full_name or u.username or f"User #{user_id}")

    @staticmethod
    def _resolve_completion_pair(item: WorkOrderItem, payload: WorkOrderItemProgressCreate) -> tuple[Decimal | None, Decimal]:
        """
        Returns (completed_quantity, completed_percentage) snapshot for this update.
        Quantity-mode lines always get both; percentage-only lines may leave quantity None.
        """
        pq_in = item.planned_quantity
        has_pq = pq_in is not None and _dec(pq_in) > 0
        base_qty = _dec(pq_in) if has_pq else None

        cq_in = payload.completed_quantity
        cp_in = payload.completed_percentage
        pct_tol = Decimal("0.05")

        def _pct_from_qty(cq_val: Decimal) -> Decimal:
            assert base_qty is not None
            return _q2((cq_val / base_qty) * Decimal("100"))

        def _qty_from_pct(cp_val: Decimal) -> Decimal:
            assert base_qty is not None
            return _q3((cp_val / Decimal("100")) * base_qty)

        if item.progress_type == "quantity":
            if not has_pq or base_qty is None:
                raise ConflictError("Approved quantity is required on the line item before entering completion.")

            if cq_in is not None and cp_in is not None:
                cq = _q3(Decimal(str(cq_in)))
                cp = _q2(Decimal(str(cp_in)))
                if cq < 0:
                    raise ConflictError("Completion quantity cannot be negative.")
                if cq > base_qty:
                    raise ConflictError("Completion cannot exceed approved quantity.")
                expected = _pct_from_qty(cq)
                if abs(cp - expected) > pct_tol:
                    raise ConflictError("Completed quantity and completion % must match approved quantity baseline.")
                if cp > Decimal("100.01"):
                    raise ConflictError("Completion % cannot exceed 100%.")
                return cq, cp

            if cq_in is not None:
                cq = _q3(Decimal(str(cq_in)))
                if cq < 0:
                    raise ConflictError("Completion quantity cannot be negative.")
                if cq > base_qty:
                    raise ConflictError("Completion cannot exceed approved quantity.")
                return cq, _pct_from_qty(cq)

            if cp_in is not None:
                cp = _q2(Decimal(str(cp_in)))
                if cp < 0:
                    raise ConflictError("Completion percentage cannot be negative.")
                if cp > Decimal("100"):
                    raise ConflictError("Completion % cannot exceed 100%.")
                return _qty_from_pct(cp), cp

            raise ConflictError("Provide completed quantity and/or completed percentage.")

        # progress_type percentage
        if has_pq and base_qty is not None:
            if cq_in is not None and cp_in is not None:
                cq = _q3(Decimal(str(cq_in)))
                cp = _q2(Decimal(str(cp_in)))
                if cq < 0 or cq > base_qty:
                    raise ConflictError("Completion quantity must be between 0 and approved quantity.")
                expected = _pct_from_qty(cq)
                if abs(cp - expected) > pct_tol:
                    raise ConflictError("Completed quantity and completion % must match.")
                return cq, cp
            if cq_in is not None:
                cq = _q3(Decimal(str(cq_in)))
                if cq < 0 or cq > base_qty:
                    raise ConflictError("Completion quantity must be between 0 and approved quantity.")
                return cq, _pct_from_qty(cq)
            if cp_in is not None:
                cp = _q2(Decimal(str(cp_in)))
                if cp < 0 or cp > Decimal("100"):
                    raise ConflictError("Completion % must be between 0 and 100.")
                return _qty_from_pct(cp), cp
            raise ConflictError("Provide completed quantity and/or completion %.")

        if cp_in is None:
            raise ConflictError("completed_percentage is required for lines without approved quantity denominator.")
        if cq_in is not None:
            raise ConflictError("completed_quantity is only supported when the line has planned quantity.")

        cp = _q2(Decimal(str(cp_in)))
        if cp < 0 or cp > Decimal("100"):
            raise ConflictError("Completion % must be between 0 and 100.")
        return None, cp

    def item_completion_projection(self, item: WorkOrderItem) -> dict[str, Any]:
        approved_qty = float(item.planned_quantity) if item.planned_quantity is not None else None
        planned_pct_raw = float(item.planned_percentage) if item.planned_percentage is not None else None
        latest = self._latest_item_progress(int(item.id))
        cq = float(latest.completed_quantity) if latest and latest.completed_quantity is not None else None
        cp = float(latest.completed_percentage) if latest and latest.completed_percentage is not None else None

        remaining: float | None = None
        if approved_qty is not None and cq is not None:
            remaining = max(approved_qty - cq, 0.0)

        ps = item.pricing_snapshot or {}
        qty_unit = "qty" if item.planned_quantity is not None else str(ps.get("unit_type") or "qty")
        return {
            "progress_type": str(item.progress_type),
            "unit_type": qty_unit,
            "quantity_unit": qty_unit,
            "approved_quantity": approved_qty,
            "approved_percentage": planned_pct_raw,
            "completed_quantity": cq,
            "completed_percentage": cp,
            "remaining_quantity": remaining,
            "last_updated_at": latest.created_at.isoformat() if latest and latest.created_at else None,
            "last_updated_by": int(latest.created_by) if latest and latest.created_by is not None else None,
            "last_updated_by_name": self._user_display_name(int(latest.created_by)) if latest and latest.created_by else None,
        }

    def list_item_progress_history(self, work_order_item_id: int) -> list[dict[str, Any]]:
        item = self._db.get(WorkOrderItem, int(work_order_item_id))
        if item is None:
            raise NotFoundError("WorkOrderItem", work_order_item_id)

        stmt = (
            select(WorkOrderItemProgress)
            .where(WorkOrderItemProgress.work_order_item_id == int(work_order_item_id))
            .order_by(WorkOrderItemProgress.created_at.asc(), WorkOrderItemProgress.id.asc())
        )
        rows = list(self._db.scalars(stmt).all())
        out: list[dict[str, Any]] = []
        prev_cq: Decimal | None = None
        prev_cp: Decimal | None = None
        for r in rows:
            cq_cur = Decimal(str(r.completed_quantity)) if r.completed_quantity is not None else None
            cp_cur = Decimal(str(r.completed_percentage)) if r.completed_percentage is not None else None
            out.append(
                {
                    "id": int(r.id),
                    "completed_quantity": float(cq_cur) if cq_cur is not None else None,
                    "completed_percentage": float(cp_cur) if cp_cur is not None else None,
                    "remarks": r.remarks,
                    "updated_by": int(r.created_by) if r.created_by is not None else None,
                    "updated_by_name": self._user_display_name(int(r.created_by)) if r.created_by else None,
                    "updated_at": r.created_at.isoformat() if r.created_at else None,
                    "previous_completed_quantity": float(prev_cq) if prev_cq is not None else None,
                    "previous_completed_percentage": float(prev_cp) if prev_cp is not None else None,
                }
            )
            prev_cq, prev_cp = cq_cur, cp_cur
        return out

    def add_progress(self, work_order_item_id: int, payload: WorkOrderItemProgressCreate, *, actor_user_id: int) -> WorkOrderItemProgress:
        item = self._db.get(WorkOrderItem, int(work_order_item_id))
        if item is None:
            raise NotFoundError("WorkOrderItem", work_order_item_id)
        wo = self._db.get(WorkOrder, int(item.work_order_id))
        if wo is None:
            raise ConflictError("Work order not found for this line item.")
        if str(wo.status) != "active":
            raise ConflictError('Completion updates are only allowed while the work order is "Active".')

        prev = self._latest_item_progress(int(item.id))
        old_snapshot = {
            "work_order_item_id": int(item.id),
            "completed_quantity": str(_q3(Decimal(str(prev.completed_quantity)))) if prev and prev.completed_quantity is not None else None,
            "completed_percentage": _json_decimal(Decimal(str(prev.completed_percentage))) if prev and prev.completed_percentage is not None else None,
        }

        cq, cp = WorkOrderService._resolve_completion_pair(item, payload)

        row = WorkOrderItemProgress(
            work_order_item_id=int(item.id),
            completed_quantity=cq,
            completed_percentage=cp,
            remarks=payload.remarks or None,
            created_by=actor_user_id,
        )
        self._db.add(row)
        self._db.flush()

        wo_id = int(wo.id)
        audit_helpers.write_audit(
            self._db,
            work_order_id=wo_id,
            action=audit_helpers.ACTION_COMPLETION_UPDATED,
            actor_user_id=actor_user_id,
            old_value=old_snapshot,
            new_value={
                "work_order_item_id": int(item.id),
                "completed_quantity": str(_q3(cq)) if cq is not None else None,
                "completed_percentage": _json_decimal(cp),
                "remarks": payload.remarks,
            },
        )
        self._db.commit()
        self._db.refresh(row)
        return row

    # ---- rate override governance ----

    def request_rate_override(self, work_order_item_id: int, payload: WorkOrderRateOverrideRequest, *, actor_user_id: int) -> WorkOrderItem:
        item = self._db.get(WorkOrderItem, int(work_order_item_id))
        if item is None:
            raise NotFoundError("WorkOrderItem", work_order_item_id)
        if payload.override_rate <= Decimal("0"):
            raise ConflictError("override_rate must be positive.")
        if not payload.override_reason.strip():
            raise ConflictError("override_reason is required.")

        # Create (or reuse) approval workflow mapping.
        wf = get_workflow_for_action(self._db, ACTION_CODE_OVERRIDE_RATE)
        item.override_rate = _q2(Decimal(payload.override_rate))
        item.override_reason = payload.override_reason.strip()
        item.override_status = "pending" if wf is not None else "approved"

        wo = self._db.get(WorkOrder, int(item.work_order_id))
        if wo is None:
            raise ConflictError("Work order not found for this line item.")
        wo_id = int(wo.id)

        if wf is not None:
            org = self._db.get(OrgUnit, int(wo.org_unit_id)) if wo is not None else None
            org_unit_name = getattr(org, "name", None) if org is not None else None
            ctr_body = self._db.get(Contractor, int(wo.contractor_id)) if wo is not None else None
            contractor_name = getattr(ctr_body, "name", None) if ctr_body is not None else None

            ov_payload = {
                "action_code": ACTION_CODE_OVERRIDE_RATE,
                "work_order_item_id": int(item.id),
                "work_order_id": wo_id,
                "work_order_number": wo.work_order_number if wo is not None else None,
                "work_order_title": wo.title if wo is not None else None,
                "org_unit_id": int(wo.org_unit_id) if wo is not None else None,
                "org_unit_name": org_unit_name,
                "created_at": wo.created_at.isoformat() if wo is not None and wo.created_at else None,
                "approved_at": wo.approved_at.isoformat() if wo is not None and wo.approved_at else None,
                "contractor_id": int(wo.contractor_id) if wo is not None else None,
                "contractor_name": contractor_name,
                "line": {
                    "part_master_id": int(item.part_master_id),
                    "pricing_snapshot": item.pricing_snapshot,
                    "progress_type": str(item.progress_type),
                    "planned_quantity": _json_decimal(item.planned_quantity),
                    "planned_percentage": _json_decimal(item.planned_percentage),
                    "governed_resolved_rate": str(item.resolved_rate),
                    "rate_source": str(item.rate_source),
                },
                "override_rate": str(item.override_rate),
                "override_reason": item.override_reason,
            }
            req = ApprovalEngineService(self._db).create_request_for_entity(
                workflow=wf,
                entity_type=OVERRIDE_APPROVAL_ENTITY_TYPE,
                entity_id=int(item.id),
                payload=ov_payload,
                created_by=actor_user_id,
            )
            item.override_approval_request_id = int(req.id)
        else:
            # Auto-approve override when no workflow exists, but still auditable.
            item.rate_source = "override"
            item.resolved_rate = _q2(Decimal(item.override_rate or item.resolved_rate))
            self._recompute_taxable_for_item(item)
            if wo is not None:
                self._sync_approved_value_total_from_lines(wo)

        if wo_id is not None:
            audit_helpers.write_audit(
                self._db,
                work_order_id=wo_id,
                action=audit_helpers.ACTION_RATE_OVERRIDE_REQUESTED,
                actor_user_id=actor_user_id,
                new_value={
                    "work_order_item_id": int(item.id),
                    "override_rate": str(item.override_rate),
                    "override_reason": item.override_reason,
                    "override_status": item.override_status,
                    "override_approval_request_id": item.override_approval_request_id,
                },
            )
        self._db.commit()
        self._db.refresh(item)
        return item

    def finalize_override_approval(self, work_order_item_id: int, *, approver_user_id: int | None, approval_request_id: int | None) -> WorkOrderItem:
        item = self._db.get(WorkOrderItem, int(work_order_item_id))
        if item is None:
            raise NotFoundError("WorkOrderItem", work_order_item_id)
        if item.override_status != "pending":
            return item
        item.override_status = "approved"
        item.override_approval_request_id = approval_request_id or item.override_approval_request_id
        wo_id = int(item.work_order_id)
        if item.override_rate is not None:
            item.rate_source = "override"
            item.resolved_rate = _q2(Decimal(item.override_rate))
            self._recompute_taxable_for_item(item)
        wo_hdr = self._db.get(WorkOrder, wo_id)
        if wo_hdr is not None:
            self._sync_approved_value_total_from_lines(wo_hdr)
        if wo_id is not None:
            audit_helpers.write_audit(
                self._db,
                work_order_id=wo_id,
                action=audit_helpers.ACTION_RATE_OVERRIDE_APPROVED,
                actor_user_id=approver_user_id,
                new_value={
                    "work_order_item_id": int(item.id),
                    "override_rate": str(item.override_rate) if item.override_rate is not None else None,
                    "taxable_value": str(item.taxable_value),
                    "approval_request_id": item.override_approval_request_id,
                },
            )
        self._db.commit()
        self._db.refresh(item)
        return item

    def finalize_override_rejection(self, work_order_item_id: int, *, rejector_user_id: int | None, approval_request_id: int | None, comment: str | None) -> WorkOrderItem:
        item = self._db.get(WorkOrderItem, int(work_order_item_id))
        if item is None:
            raise NotFoundError("WorkOrderItem", work_order_item_id)
        if item.override_status != "pending":
            return item
        item.override_status = "rejected"
        item.override_approval_request_id = approval_request_id or item.override_approval_request_id
        wo_id = int(item.work_order_id)
        if wo_id is not None:
            audit_helpers.write_audit(
                self._db,
                work_order_id=wo_id,
                action=audit_helpers.ACTION_RATE_OVERRIDE_REJECTED,
                actor_user_id=rejector_user_id,
                new_value={
                    "work_order_item_id": int(item.id),
                    "approval_request_id": item.override_approval_request_id,
                    "comment": comment,
                },
            )
        self._db.commit()
        self._db.refresh(item)
        return item
