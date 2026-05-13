from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from modules.approvals.assignment_service import get_workflow_for_action
from modules.approvals.service import ApprovalEngineService
from modules.contractor.models import Contractor
from modules.errors import ConflictError, NotFoundError
from modules.invoices import audit as audit_helpers
from modules.invoices.line_format import rate_basis_label
from modules.invoices.models import (
    ContractorInvoiceCompliance,
    Invoice,
    InvoiceLine,
    InvoiceValidationIssue,
)
from modules.invoices.schema import InvoiceCreate, InvoiceIssueJustificationUpdate
from modules.invoices.validation import (
    InvoiceValidationEngine,
    STATUSES_COUNTING_TOWARD_CUMULATIVES,
    invoice_tolerance_percentage,
    raise_if_new_invoice_breaches_work_order_caps,
)
from modules.org_units.model import OrgUnit
from modules.part_master.pricing import pricing_snapshot_for_item
from modules.work_orders.models import WorkOrder, WorkOrderItem
from modules.work_orders.service import WorkOrderService


ACTION_CODE_SUBMIT = "invoices.submit"
ACTION_CODE_VALIDATE = "invoices.validate"
ACTION_CODE_EXCEPTION_APPROVE = "invoices.approve_exceptions"

APPROVAL_ENTITY_TYPE = "invoice_exception_approval"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _q2(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"))


def _dec(x) -> Decimal:
    if isinstance(x, Decimal):
        return x
    return Decimal(str(x))


class InvoiceService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def _ensure_contractor(self, contractor_id: int) -> Contractor:
        c = self._db.get(Contractor, int(contractor_id))
        if c is None:
            raise NotFoundError("Contractor", contractor_id)
        return c

    def _ensure_plant(self, org_unit_id: int) -> OrgUnit:
        org = self._db.get(OrgUnit, int(org_unit_id))
        if org is None:
            raise NotFoundError("OrgUnit", org_unit_id)
        if getattr(org, "type", None) and str(org.type).upper() != "PLANT":
            raise ConflictError("invoice must be associated to a plant (org_units.type=PLANT).")
        return org

    def get(self, invoice_id: int) -> Invoice:
        row = self._db.scalar(
            select(Invoice)
            .where(Invoice.id == int(invoice_id))
            .options(
                selectinload(Invoice.lines),
                selectinload(Invoice.issues),
                selectinload(Invoice.attachments),
            )
        )
        if row is None:
            raise NotFoundError("Invoice", invoice_id)
        return row

    def list(self, *, contractor_id: int | None = None, status: str | None = None, limit: int = 100) -> list[Invoice]:
        stmt = (
            select(Invoice)
            .options(
                selectinload(Invoice.lines),
                selectinload(Invoice.issues),
                selectinload(Invoice.attachments),
            )
            .order_by(Invoice.id.desc())
        )
        if contractor_id is not None:
            stmt = stmt.where(Invoice.contractor_id == int(contractor_id))
        if status:
            stmt = stmt.where(Invoice.status == status.strip().lower())
        stmt = stmt.limit(int(limit))
        return list(self._db.scalars(stmt).unique().all())

    def create(self, payload: InvoiceCreate, *, actor_user_id: int) -> Invoice:
        self._ensure_contractor(int(payload.contractor_id))
        self._ensure_plant(int(payload.org_unit_id))
        if not payload.lines:
            raise ConflictError("At least one invoice line is required.")

        inv = Invoice(
            contractor_id=int(payload.contractor_id),
            org_unit_id=int(payload.org_unit_id),
            invoice_number=payload.invoice_number.strip(),
            invoice_date=payload.invoice_date,
            status="draft",
            currency="INR",
            total_amount=Decimal("0.00"),
            created_by=actor_user_id,
        )
        self._db.add(inv)
        self._db.flush()

        total = Decimal("0")
        cap_checks: list[tuple[int, Decimal]] = []
        for ln in payload.lines:
            item = self._db.get(WorkOrderItem, int(ln.work_order_item_id))
            if item is None:
                raise NotFoundError("WorkOrderItem", int(ln.work_order_item_id))
            wo = self._db.get(WorkOrder, int(item.work_order_id))
            if wo is None:
                raise ConflictError("Work order is missing for the selected item.")
            if str(wo.status) != "active":
                raise ConflictError("Invoices may only reference active work orders.")
            if int(wo.org_unit_id) != int(inv.org_unit_id):
                raise ConflictError("Invoice plant does not match work order plant.")
            if int(wo.contractor_id) != int(inv.contractor_id):
                raise ConflictError("Invoice contractor does not match work order contractor.")

            rate = _dec(ln.rate) if ln.rate is not None else _dec(item.resolved_rate)
            try:
                amount = WorkOrderService.ex_tax_for_invoice_qty(item=item, invoice_quantity=_dec(ln.quantity))
            except ValueError as exc:
                raise ConflictError(str(exc)) from exc
            tax_pct = _dec(ln.tax_pct) if ln.tax_pct is not None else Decimal("0")
            gross = _q2(amount * (Decimal("1") + tax_pct / Decimal("100")))
            row = InvoiceLine(
                invoice_id=int(inv.id),
                work_order_item_id=int(item.id),
                quantity=_dec(ln.quantity),
                rate=_q2(rate),
                amount=amount,
                tax_pct=tax_pct if tax_pct != Decimal("0") else None,
                rate_source=item.rate_source,
                resolved_contractor_rate_id=int(item.contractor_rate_id) if item.contractor_rate_id is not None else None,
                resolved_part_master_id=int(item.part_master_id),
                notes=ln.notes or None,
            )
            self._db.add(row)
            total += gross
            cap_checks.append((int(item.id), _q2(amount)))

        self._db.flush()
        raise_if_new_invoice_breaches_work_order_caps(
            self._db,
            exclude_invoice_id=int(inv.id),
            item_amounts=cap_checks,
        )

        inv.total_amount = _q2(total)
        audit_helpers.write_audit(
            self._db,
            invoice_id=int(inv.id),
            action=audit_helpers.ACTION_CREATED,
            actor_user_id=actor_user_id,
            new_value={
                "invoice_number": inv.invoice_number,
                "invoice_date": inv.invoice_date.isoformat(),
                "contractor_id": int(inv.contractor_id),
                "org_unit_id": int(inv.org_unit_id),
            },
        )
        self._db.commit()
        return self.get(int(inv.id))

    def submit(self, invoice_id: int, *, actor_user_id: int) -> Invoice:
        inv = self.get(invoice_id)
        if inv.status not in ("draft", "rejected"):
            raise ConflictError("Only draft/rejected invoices can be submitted.")
        inv.status = "submitted"
        inv.submitted_by = actor_user_id
        inv.submitted_at = _now_utc()
        audit_helpers.write_audit(
            self._db,
            invoice_id=int(inv.id),
            action=audit_helpers.ACTION_SUBMITTED,
            actor_user_id=actor_user_id,
            new_value={"status": "submitted"},
        )
        self._db.commit()
        return self.get(int(inv.id))

    def validate(self, invoice_id: int, *, actor_user_id: int) -> Invoice:
        inv = self.get(invoice_id)
        if inv.status == "pending_exception_approval":
            raise ConflictError("Validation is paused while variance approval is in progress.")
        if inv.status not in ("submitted", "blocked"):
            raise ConflictError("Submit the invoice before validation.")

        engine = InvoiceValidationEngine(self._db)
        result = engine.validate_and_persist(inv)

        if result.status in ("blocked", "fail"):
            inv.status = "blocked"
        elif result.status == "warn":
            inv.status = "submitted"
        else:
            inv.status = "submitted"

        audit_helpers.write_audit(
            self._db,
            invoice_id=int(inv.id),
            action=audit_helpers.ACTION_VALIDATED,
            actor_user_id=actor_user_id,
            new_value={
                "validation_engine_status": result.status,
                "invoice_status": inv.status,
                "validation_score": str(result.score),
                "blockers": result.blocker_count,
                "errors": result.error_count,
                "warnings": result.warning_count,
            },
        )

        self._recompute_contractor_compliance(contractor_id=int(inv.contractor_id))
        self._db.commit()
        return self.get(int(inv.id))

    def request_exception_approval(self, invoice_id: int, *, actor_user_id: int) -> Invoice:
        inv = self.get(invoice_id)
        if inv.validation_status not in ("blocked", "fail"):
            raise ConflictError("Variance approval is only available when validation reports blockers or errors.")
        if inv.status not in ("blocked", "submitted"):
            raise ConflictError("Invoice cannot request variance approval in its current workflow state.")
        if inv.approval_request_id is not None:
            raise ConflictError("This invoice already has an approval request attached.")

        ready, errs = self._exception_package_ready(inv)
        if not ready:
            raise ConflictError("; ".join(errs))

        wf = get_workflow_for_action(self._db, ACTION_CODE_EXCEPTION_APPROVE)
        if wf is None:
            raise ConflictError(
                "No workflow is configured for invoices.approve_exceptions. Add a workflow before requesting variance approval."
            )
        req = ApprovalEngineService(self._db).create_request_for_entity(
            workflow=wf,
            entity_type=APPROVAL_ENTITY_TYPE,
            entity_id=int(inv.id),
            payload={
                "action_code": ACTION_CODE_EXCEPTION_APPROVE,
                "invoice_id": int(inv.id),
                "invoice_number": inv.invoice_number,
                "contractor_id": int(inv.contractor_id),
                "org_unit_id": int(inv.org_unit_id),
                "validation_status": inv.validation_status,
                "validation_score": str(inv.validation_score or ""),
            },
            created_by=actor_user_id,
        )
        inv.status = "pending_exception_approval"
        inv.approval_request_id = int(req.id)
        audit_helpers.write_audit(
            self._db,
            invoice_id=int(inv.id),
            action=audit_helpers.ACTION_EXCEPTION_APPROVAL_REQUESTED,
            actor_user_id=actor_user_id,
            new_value={"status": "pending_exception_approval"},
            metadata={"approval_request_id": int(req.id)},
        )
        self._recompute_contractor_compliance(contractor_id=int(inv.contractor_id))
        self._db.commit()
        return self.get(int(inv.id))

    def _exception_package_ready(self, inv: Invoice) -> tuple[bool, list[str]]:
        issues = list(inv.issues or [])
        msgs: list[str] = []
        for iss in issues:
            if iss.requires_justification and not (iss.justification and iss.justification.strip()):
                msgs.append(f"Provide justification for {iss.code}.")
        need_attachment = any(bool(i.requires_attachments) for i in issues)
        if need_attachment and len(inv.attachments or []) < 1:
            msgs.append("Upload at least one attachment for variance submission.")
        return len(msgs) == 0, msgs

    def preflight_billables(
        self,
        *,
        contractor_id: int,
        org_unit_id: int,
        work_order_ids: list[int] | None,
    ) -> dict[str, Any]:
        self._ensure_contractor(int(contractor_id))
        self._ensure_plant(int(org_unit_id))
        tol = invoice_tolerance_percentage(self._db)
        wo_svc = WorkOrderService(self._db)
        stmt = (
            select(WorkOrder)
            .where(
                WorkOrder.org_unit_id == int(org_unit_id),
                WorkOrder.status == "active",
                WorkOrder.is_active.is_(True),
                WorkOrder.contractor_id == int(contractor_id),
            )
            .options(selectinload(WorkOrder.items))
        )
        if work_order_ids:
            stmt = stmt.where(WorkOrder.id.in_(tuple({int(x) for x in work_order_ids if int(x) > 0})))
        wos = list(self._db.scalars(stmt).unique().all())
        out_lines: list[dict[str, Any]] = []
        for wo in wos:
            for it in wo.items or []:
                snap = it.pricing_snapshot or {}
                rut_raw = snap.get("rate_unit_type")
                rut = str(rut_raw).strip() if rut_raw not in (None, "") else None
                proj = wo_svc.item_completion_projection(it)
                prev_qty_raw = self._db.scalar(
                    select(func.coalesce(func.sum(InvoiceLine.quantity), 0))
                    .select_from(InvoiceLine)
                    .join(Invoice, Invoice.id == InvoiceLine.invoice_id)
                    .where(
                        InvoiceLine.work_order_item_id == int(it.id),
                        Invoice.status.in_(STATUSES_COUNTING_TOWARD_CUMULATIVES),
                    )
                )
                prev_amt_raw = self._db.scalar(
                    select(func.coalesce(func.sum(InvoiceLine.amount), 0))
                    .select_from(InvoiceLine)
                    .join(Invoice, Invoice.id == InvoiceLine.invoice_id)
                    .where(
                        InvoiceLine.work_order_item_id == int(it.id),
                        Invoice.status.in_(STATUSES_COUNTING_TOWARD_CUMULATIVES),
                    )
                )
                pq = Decimal(str(it.planned_quantity)) if it.planned_quantity is not None else None
                rate = Decimal(str(it.resolved_rate))
                planned_contract_val = _q2(Decimal(str(it.taxable_value)))
                basis_dec = WorkOrderService._taxable_qty_from_item(it)
                basis_float = float(basis_dec) if basis_dec > 0 else None
                perm_val = _q2(planned_contract_val * (Decimal("1") + tol / Decimal("100"))) if planned_contract_val > 0 else Decimal("0")
                prev_qty = Decimal(str(prev_qty_raw or 0))
                prev_amt = Decimal(str(prev_amt_raw or 0))
                remaining_val = perm_val - _q2(prev_amt)

                cq = Decimal(str(proj.get("completed_quantity") or "0"))
                aq = pq if pq is not None else cq
                rem_qty_based = aq - prev_qty if pq is not None else None

                eff_snap = pricing_snapshot_for_item(it)
                w_raw = eff_snap.get("weight_per_piece")
                try:
                    w_float = float(_dec(w_raw)) if w_raw not in (None, "") else None
                except Exception:
                    w_float = None

                out_lines.append(
                    {
                        "work_order_id": int(wo.id),
                        "work_order_number": wo.work_order_number,
                        "work_order_item_id": int(it.id),
                        "contractor_id": int(contractor_id),
                        "part_code": snap.get("part_code"),
                        "part_name": snap.get("part_name"),
                        "unit_type": snap.get("unit_type"),
                        "pricing_method": snap.get("pricing_method"),
                        "rate_unit_type": rut,
                        "rate_basis_label": rate_basis_label(rut),
                        "weight_per_piece": w_float,
                        "approved_line_taxable_ex_vat": float(planned_contract_val),
                        "approved_line_qty_basis": basis_float,
                        "progress_type": it.progress_type,
                        "approved_quantity": proj.get("approved_quantity"),
                        "approved_percentage": proj.get("approved_percentage"),
                        "completed_quantity": proj.get("completed_quantity"),
                        "completed_percentage": proj.get("completed_percentage"),
                        "remaining_quantity": proj.get("remaining_quantity"),
                        "previously_invoiced_qty": float(prev_qty),
                        "remaining_invoiceable_qty_hint": float(rem_qty_based) if rem_qty_based is not None else None,
                        "approved_rate": float(rate),
                        "planned_contract_value": float(planned_contract_val),
                        "permissible_value_with_tolerance": float(perm_val),
                        "previously_invoiced_value": float(prev_amt),
                        "remaining_invoiceable_value": float(max(remaining_val, Decimal("0"))) if planned_contract_val > 0 else None,
                        "completion_vs_billing_pct_hint": round(
                            (float(prev_amt) / float(perm_val) * 100.0), 2
                        )
                        if perm_val > 0
                        else None,
                        "near_tolerance_warning": bool(perm_val > 0 and prev_amt > perm_val * Decimal("0.85")),
                        "tolerance_pct": float(tol),
                    }
                )
        return {"tolerance_pct": float(tol), "lines": out_lines}

    def update_issue_justification(self, issue_id: int, payload: InvoiceIssueJustificationUpdate, *, actor_user_id: int) -> InvoiceValidationIssue:
        issue = self._db.get(InvoiceValidationIssue, int(issue_id))
        if issue is None:
            raise NotFoundError("InvoiceValidationIssue", issue_id)
        issue.justification = payload.justification.strip()
        self._db.commit()
        self._db.refresh(issue)
        return issue

    def _recompute_contractor_compliance(self, *, contractor_id: int) -> None:
        # Minimal rolling aggregation for now.
        agg = self._db.scalars(
            select(ContractorInvoiceCompliance).where(ContractorInvoiceCompliance.contractor_id == int(contractor_id))
        ).first()
        if agg is None:
            agg = ContractorInvoiceCompliance(contractor_id=int(contractor_id))
            self._db.add(agg)
            self._db.flush()

        total = int(
            self._db.scalar(select(func.count()).select_from(Invoice).where(Invoice.contractor_id == int(contractor_id))) or 0
        )
        blocked = int(
            self._db.scalar(
                select(func.count()).select_from(Invoice).where(Invoice.contractor_id == int(contractor_id), Invoice.status == "blocked")
            )
            or 0
        )
        pending_ex = int(
            self._db.scalar(
                select(func.count()).select_from(Invoice).where(Invoice.contractor_id == int(contractor_id), Invoice.status == "pending_exception_approval")
            )
            or 0
        )
        # overbilling attempts: any blocker issues
        overbilling = int(
            self._db.scalar(
                select(func.count()).select_from(InvoiceValidationIssue).join(Invoice, Invoice.id == InvoiceValidationIssue.invoice_id).where(
                    Invoice.contractor_id == int(contractor_id),
                    InvoiceValidationIssue.severity == "blocker",
                )
            )
            or 0
        )
        agg.invoices_total = total
        agg.invoices_blocked = blocked
        agg.overbilling_attempts = overbilling
        agg.tolerance_breaches = overbilling  # placeholder until we separate codes
        agg.exception_approvals = pending_ex  # will be updated on finalize hooks later

        # Score heuristic: 100 - penalties.
        score = Decimal("100")
        if total > 0:
            score -= Decimal(blocked) * Decimal("10")
            score -= Decimal(overbilling) * Decimal("5")
        if score < Decimal("0"):
            score = Decimal("0")
        agg.compliance_score = score.quantize(Decimal("0.01"))
        agg.last_computed_at = _now_utc()

