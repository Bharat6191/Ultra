from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from modules.errors import ConflictError
from modules.invoices.models import Invoice, InvoiceLine, InvoiceValidationIssue
from modules.work_orders.service import WorkOrderService
from modules.settings.lookup import get_setting
from modules.work_orders.models import WorkOrderItem, WorkOrderItemProgress, WorkOrder


def _q2(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"))


def _q3(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.001"))


def _dec(x) -> Decimal:
    if isinstance(x, Decimal):
        return x
    return Decimal(str(x))


STATUSES_COUNTING_TOWARD_CUMULATIVES = (
    "submitted",
    "pending_exception_approval",
    "approved",
    "paid",
)

# Draft invoices still consume the work-order value budget (prevents parallel drafts over-cap).
STATUSES_COUNTING_TOWARD_WO_VALUE_CAP = (
    "draft",
    "submitted",
    "pending_exception_approval",
    "approved",
    "paid",
    "blocked",
)


def _tolerance_pct(db: Session) -> Decimal:
    # Config key (admin editable): invoice.validation.tolerance_pct
    raw = get_setting("invoice.validation.tolerance_pct")
    if raw is None:
        return Decimal("5.00")
    try:
        return Decimal(str(raw)).quantize(Decimal("0.01"))
    except Exception:
        return Decimal("5.00")


def invoice_tolerance_percentage(db: Session) -> Decimal:
    """Public helper for callers that need tolerance without running full validation."""

    return _tolerance_pct(db)


def work_order_ex_vat_cap(db: Session, wo: WorkOrder) -> Decimal:
    """Frozen total at approval, or sum of line taxable values for legacy rows."""
    if wo.approved_value_total is not None:
        return _q2(_dec(wo.approved_value_total))
    tot = db.scalar(
        select(func.coalesce(func.sum(WorkOrderItem.taxable_value), 0)).where(
            WorkOrderItem.work_order_id == int(wo.id)
        )
    )
    return _q2(_dec(tot or 0))


def prior_invoiced_ex_vat_for_work_order(
    db: Session, *, work_order_id: int, exclude_invoice_id: int | None
) -> Decimal:
    """Sum of ex-VAT line amounts on invoices counted toward the WO cap."""
    stmt = (
        select(func.coalesce(func.sum(InvoiceLine.amount), 0))
        .select_from(InvoiceLine)
        .join(Invoice, Invoice.id == InvoiceLine.invoice_id)
        .join(WorkOrderItem, WorkOrderItem.id == InvoiceLine.work_order_item_id)
        .where(
            WorkOrderItem.work_order_id == int(work_order_id),
            Invoice.status.in_(STATUSES_COUNTING_TOWARD_WO_VALUE_CAP),
        )
    )
    if exclude_invoice_id is not None:
        stmt = stmt.where(Invoice.id != int(exclude_invoice_id))
    row = db.scalar(stmt)
    return _q2(_dec(row or 0))


def raise_if_new_invoice_breaches_work_order_caps(
    db: Session,
    *,
    exclude_invoice_id: int | None,
    item_amounts: list[tuple[int, Decimal]],
) -> None:
    """Reject create when ex-VAT totals would exceed the approved work order value (strict, no tolerance)."""
    by_wo: dict[int, Decimal] = defaultdict(Decimal)
    for item_id, amt in item_amounts:
        item = db.get(WorkOrderItem, int(item_id))
        if item is None:
            continue
        wo = db.get(WorkOrder, int(item.work_order_id))
        if wo is None or str(wo.status) != "active":
            continue
        by_wo[int(wo.id)] += _q2(amt)
    for wid, add_amt in by_wo.items():
        wo_row = db.get(WorkOrder, int(wid))
        if wo_row is None:
            continue
        cap = work_order_ex_vat_cap(db, wo_row)
        prev = prior_invoiced_ex_vat_for_work_order(
            db, work_order_id=int(wid), exclude_invoice_id=exclude_invoice_id
        )
        if _q2(prev + add_amt) > _q2(cap):
            raise ConflictError(
                f"Cumulative invoice amounts for work order {wo_row.work_order_number} would exceed "
                f"the approved work order value ({_q2(cap)} ex. tax; already invoiced {_q2(prev)} ex. tax)."
            )


@dataclass(frozen=True)
class ValidationResult:
    status: str  # pass|warn|fail|blocked
    score: Decimal  # 0..100
    blocker_count: int
    error_count: int
    warning_count: int


class InvoiceValidationEngine:
    def __init__(self, db: Session) -> None:
        self._db = db

    def validate_and_persist(self, invoice: Invoice) -> ValidationResult:
        # Preserve justifications across re-validation (same invoice / line / code).
        prior_justify: dict[tuple[int | None, str], str] = {}
        for old in invoice.issues or []:
            if old.justification and str(old.justification).strip():
                prior_justify[(old.line_id, old.code)] = str(old.justification).strip()
        self._db.query(InvoiceValidationIssue).filter(InvoiceValidationIssue.invoice_id == int(invoice.id)).delete()
        self._db.flush()

        tol = _tolerance_pct(self._db)

        wo_add_by_id: dict[int, Decimal] = defaultdict(Decimal)
        wo_first_line: dict[int, int] = {}

        blocker = 0
        errors = 0
        warnings = 0

        def add_issue(
            *,
            line_id: int | None,
            code: str,
            severity: str,
            message: str,
            allowed_value: Decimal | None = None,
            actual_value: Decimal | None = None,
            allowed_qty: Decimal | None = None,
            actual_qty: Decimal | None = None,
            requires_justification: bool = False,
            requires_attachments: bool = False,
            metadata: dict | None = None,
        ) -> None:
            nonlocal blocker, errors, warnings
            if severity == "blocker":
                blocker += 1
            elif severity == "error":
                errors += 1
            elif severity == "warning":
                warnings += 1
            _lid = int(line_id) if line_id is not None else None
            self._db.add(
                InvoiceValidationIssue(
                    invoice_id=int(invoice.id),
                    line_id=_lid,
                    code=code,
                    severity=severity,
                    message=message,
                    allowed_value=_q2(allowed_value) if allowed_value is not None else None,
                    actual_value=_q2(actual_value) if actual_value is not None else None,
                    allowed_qty=_q3(allowed_qty) if allowed_qty is not None else None,
                    actual_qty=_q3(actual_qty) if actual_qty is not None else None,
                    tolerance_pct=tol,
                    requires_justification=bool(requires_justification),
                    requires_attachments=bool(requires_attachments),
                    justification=prior_justify.get((_lid, code)),
                    metadata_json=metadata or None,
                )
            )

        # Validate each line.
        total = Decimal("0")
        for line in invoice.lines or []:
            item = self._db.get(WorkOrderItem, int(line.work_order_item_id))
            if item is None:
                add_issue(
                    line_id=int(line.id),
                    code="WO_ITEM_NOT_FOUND",
                    severity="blocker",
                    message="Work order item does not exist.",
                )
                continue

            wo = self._db.get(WorkOrder, int(item.work_order_id))

            if wo is None or wo.status not in ("active", "approved"):
                add_issue(
                    line_id=int(line.id),
                    code="WO_NOT_APPROVED",
                    severity="blocker",
                    message="Work order is not approved/active.",
                    metadata={"work_order_id": int(wo.id) if wo else None},
                    requires_justification=True,
                    requires_attachments=True,
                )
            # Contractor mismatch (invoice must match the work order contractor).
            if wo is not None and int(wo.contractor_id) != int(invoice.contractor_id):
                add_issue(
                    line_id=int(line.id),
                    code="CONTRACTOR_MISMATCH",
                    severity="blocker",
                    message="Invoice contractor does not match the work order contractor.",
                    requires_justification=True,
                    requires_attachments=True,
                )

            if wo is not None and str(wo.status) == "active":
                wid = int(wo.id)
                wo_add_by_id[wid] += _dec(line.amount)
                if wid not in wo_first_line:
                    wo_first_line[wid] = int(line.id)

            # Completion -> allowed quantity/value (latest approved snapshot per line; matches WO completion engine).
            allowed_qty: Decimal | None = None
            if item.progress_type == "quantity":
                latest_p = self._db.scalar(
                    select(WorkOrderItemProgress)
                    .where(WorkOrderItemProgress.work_order_item_id == int(item.id))
                    .order_by(WorkOrderItemProgress.created_at.desc(), WorkOrderItemProgress.id.desc())
                    .limit(1)
                )
                if latest_p is not None and latest_p.completed_quantity is not None:
                    allowed_qty = _dec(latest_p.completed_quantity)
                else:
                    allowed_qty = Decimal("0")
                # Apply tolerance.
                allowed_qty_tol = allowed_qty * (Decimal("1") + (tol / Decimal("100")))
                if _dec(line.quantity) > allowed_qty_tol:
                    add_issue(
                        line_id=int(line.id),
                        code="QTY_EXCEEDS_COMPLETION",
                        severity="warning",
                        message="Invoiced quantity is above recorded completion (informational).",
                        allowed_qty=allowed_qty,
                        actual_qty=_dec(line.quantity),
                        requires_justification=False,
                        requires_attachments=False,
                    )
            else:
                latest_p = self._db.scalar(
                    select(WorkOrderItemProgress)
                    .where(WorkOrderItemProgress.work_order_item_id == int(item.id))
                    .order_by(WorkOrderItemProgress.created_at.desc(), WorkOrderItemProgress.id.desc())
                    .limit(1)
                )
                pct_raw = latest_p.completed_percentage if latest_p is not None else None
                pct = _dec(pct_raw or 0)
                pct_tol = pct * (Decimal("1") + (tol / Decimal("100")))
                # For percentage items, quantity is treated as 1.0 "lot"; enforce quantity <= pct/100 with tolerance.
                allowed_qty = (pct / Decimal("100"))
                if _dec(line.quantity) > (pct_tol / Decimal("100")):
                    add_issue(
                        line_id=int(line.id),
                        code="PCT_EXCEEDS_COMPLETION",
                        severity="warning",
                        message="Invoiced quantity is above recorded completion % (informational).",
                        allowed_qty=allowed_qty,
                        actual_qty=_dec(line.quantity),
                        requires_justification=False,
                        requires_attachments=False,
                    )

            # Rate governance: must match work order resolved rate.
            expected_rate = _dec(item.resolved_rate)
            actual_rate = _dec(line.rate)
            if actual_rate != expected_rate:
                # Within tolerance? Rate mismatch is always an exception because it can be a manipulation attempt.
                add_issue(
                    line_id=int(line.id),
                    code="RATE_MISMATCH",
                    severity="error",
                    message="Invoice rate does not match approved work order rate.",
                    allowed_value=expected_rate,
                    actual_value=actual_rate,
                    requires_justification=True,
                    requires_attachments=True,
                    metadata={"rate_source": item.rate_source, "contractor_rate_id": item.contractor_rate_id},
                )

            # Cumulative invoicing cap: sum of previous invoice quantities for this work order item.
            prev_qty = self._db.scalar(
                select(func.coalesce(func.sum(InvoiceLine.quantity), 0))
                .select_from(InvoiceLine)
                .join(Invoice, Invoice.id == InvoiceLine.invoice_id)
                .where(
                    InvoiceLine.work_order_item_id == int(item.id),
                    Invoice.id != int(invoice.id),
                    Invoice.status.in_(STATUSES_COUNTING_TOWARD_CUMULATIVES),
                )
            )
            prev_qty_dec = _dec(prev_qty or 0)
            prev_amt = self._db.scalar(
                select(func.coalesce(func.sum(InvoiceLine.amount), 0))
                .select_from(InvoiceLine)
                .join(Invoice, Invoice.id == InvoiceLine.invoice_id)
                .where(
                    InvoiceLine.work_order_item_id == int(item.id),
                    Invoice.id != int(invoice.id),
                    Invoice.status.in_(STATUSES_COUNTING_TOWARD_CUMULATIVES),
                )
            )
            prev_amt_dec = _dec(prev_amt or 0)

            planned_contract_value = _q2(_dec(item.taxable_value))
            if planned_contract_value > 0:
                perm_value_line = planned_contract_value * (Decimal("1") + (tol / Decimal("100")))
                cumulative_value = prev_amt_dec + _dec(line.amount)
                if _q2(cumulative_value) > _q2(perm_value_line):
                    add_issue(
                        line_id=int(line.id),
                        code="VALUE_EXCEEDS_APPROVED_TOLERANCE",
                        severity="warning",
                        message="Cumulative invoice value for this line exceeds its line budget (informational).",
                        allowed_value=_q2(perm_value_line),
                        actual_value=_q2(cumulative_value),
                        requires_justification=False,
                        requires_attachments=False,
                        metadata={
                            "previous_invoiced_value": str(_q2(prev_amt_dec)),
                            "planned_contract_value_strict": str(_q2(planned_contract_value)),
                        },
                    )

            if allowed_qty is not None:
                allowed_cum = allowed_qty * (Decimal("1") + (tol / Decimal("100")))
                if prev_qty_dec + _dec(line.quantity) > allowed_cum:
                    add_issue(
                        line_id=int(line.id),
                        code="CUMULATIVE_QTY_EXCEEDS_ALLOWED",
                        severity="warning",
                        message="Cumulative invoiced quantity is above completion (informational).",
                        allowed_qty=allowed_qty,
                        actual_qty=prev_qty_dec + _dec(line.quantity),
                        requires_justification=False,
                        requires_attachments=False,
                        metadata={"previous_invoiced_qty": str(prev_qty_dec)},
                    )

            # Amount guardrail: stored line amount vs work-order-line proration.
            try:
                calc = WorkOrderService.ex_tax_for_invoice_qty(item=item, invoice_quantity=_dec(line.quantity))
            except ValueError:
                calc = None
            if calc is not None and _q2(_dec(line.amount)) != _q2(calc):
                add_issue(
                    line_id=int(line.id),
                    code="AMOUNT_MISMATCH",
                    severity="warning",
                    message="Line amount does not match the work order line (prorated from approved taxable value).",
                    allowed_value=_q2(calc),
                    actual_value=_q2(_dec(line.amount)),
                )

            tax_pct_ln = _dec(line.tax_pct or 0)
            gross_line = _q2(_dec(line.amount) * (Decimal("1") + tax_pct_ln / Decimal("100")))
            total += gross_line

        for wid, add_amt in wo_add_by_id.items():
            wo_row = self._db.get(WorkOrder, int(wid))
            if wo_row is None or str(wo_row.status) != "active":
                continue
            cap = work_order_ex_vat_cap(self._db, wo_row)
            prev = prior_invoiced_ex_vat_for_work_order(
                self._db, work_order_id=int(wid), exclude_invoice_id=int(invoice.id)
            )
            if _q2(prev + add_amt) > _q2(cap):
                lid = wo_first_line.get(int(wid))
                add_issue(
                    line_id=lid,
                    code="WO_INVOICE_TOTAL_EXCEEDED",
                    severity="blocker",
                    message=(
                        f"Cumulative invoice amounts for work order {wo_row.work_order_number} exceed "
                        f"the approved work order value ({_q2(cap)} ex. tax; "
                        f"including this invoice: {_q2(prev + add_amt)} ex. tax)."
                    ),
                    allowed_value=_q2(cap),
                    actual_value=_q2(prev + add_amt),
                    metadata={
                        "work_order_id": int(wid),
                        "previous_invoiced_ex_tax": str(_q2(prev)),
                        "approved_value_total": str(_q2(cap)),
                    },
                    requires_justification=True,
                    requires_attachments=True,
                )

        invoice.total_amount = _q2(total)

        # Compute final status/score.
        # Simple scoring: start at 100, subtract weighted penalties.
        score = Decimal("100")
        score -= Decimal(blocker) * Decimal("20")
        score -= Decimal(errors) * Decimal("10")
        score -= Decimal(warnings) * Decimal("3")
        if score < Decimal("0"):
            score = Decimal("0")

        if blocker > 0:
            status = "blocked"
        elif errors > 0:
            status = "fail"
        elif warnings > 0:
            status = "warn"
        else:
            status = "pass"

        invoice.validation_status = status
        invoice.validation_score = score.quantize(Decimal("0.01"))
        invoice.last_validated_at = datetime.now(timezone.utc)
        return ValidationResult(status=status, score=invoice.validation_score, blocker_count=blocker, error_count=errors, warning_count=warnings)

