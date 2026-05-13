#!/usr/bin/env python3
"""Delete all work orders, invoices, negotiated rates, and part master rows.

Order respects FKs: invoices (and related approvals) first, then work orders,
contractor rates (and rate approvals), then part master (cascades audit/versions).

Run from project root:

    ./venv/bin/python scripts/clear_wo_invoice_parts.py --yes

Requires DATABASE_URL in .env.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_SCRIPTS_ROOT = Path(__file__).resolve().parent
_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
for _p in (_BACKEND_ROOT, _SCRIPTS_ROOT):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from decimal import Decimal
from sqlalchemy import delete, select, update

import db.models  # noqa: F401 — register metadata
from db.session import SessionLocal
from modules.approvals.model import ApprovalRequest
from modules.contractor_rates.models import ContractorRate
from modules.invoices.models import ContractorInvoiceCompliance, Invoice
from modules.part_master.models import PartMaster
from modules.work_orders.models import WorkOrder, WorkOrderItem


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--yes",
        action="store_true",
        help="Required: confirms you intend to wipe WO / invoice / rate / part data.",
    )
    args = p.parse_args()
    if not args.yes:
        p.error("Refusing to run without --yes (destructive).")

    db = SessionLocal()
    try:
        # 1) Invoice-related approval requests (entity_id = invoice id)
        db.execute(delete(ApprovalRequest).where(ApprovalRequest.entity_type == "invoice_exception_approval"))

        # 2) All invoices (cascades lines, issues, attachments, audit logs)
        inv_n = db.execute(delete(Invoice)).rowcount or 0

        # 3) Work-order-related approval requests
        wo_ids = [int(x) for x in db.scalars(select(WorkOrder.id)).all()]
        item_ids = [int(x) for x in db.scalars(select(WorkOrderItem.id)).all()]
        if item_ids:
            db.execute(
                delete(ApprovalRequest).where(
                    ApprovalRequest.entity_type == "work_order_rate_override",
                    ApprovalRequest.entity_id.in_(item_ids),
                )
            )
        if wo_ids:
            db.execute(
                delete(ApprovalRequest).where(
                    ApprovalRequest.entity_type == "work_order_approval",
                    ApprovalRequest.entity_id.in_(wo_ids),
                )
            )

        # 4) Work orders (cascades items, progress, WO audit logs)
        wo_n = db.execute(delete(WorkOrder)).rowcount or 0

        # 5) Negotiated rates + their approval requests
        rate_ids = [int(x) for x in db.scalars(select(ContractorRate.id)).all()]
        if rate_ids:
            db.execute(
                delete(ApprovalRequest).where(
                    ApprovalRequest.entity_type == "contractor_rate_approval",
                    ApprovalRequest.entity_id.in_(rate_ids),
                )
            )
        rate_n = db.execute(delete(ContractorRate)).rowcount or 0

        # 6) Part master (cascades part audit, versions, attachments)
        pm_n = db.execute(delete(PartMaster)).rowcount or 0

        # 7) Reset contractor invoice compliance aggregates (keep rows)
        db.execute(
            update(ContractorInvoiceCompliance).values(
                invoices_total=0,
                invoices_blocked=0,
                tolerance_breaches=0,
                exception_approvals=0,
                overbilling_attempts=0,
                compliance_score=Decimal("100"),
                last_computed_at=None,
            )
        )

        db.commit()
        print(f"Cleared: invoices={inv_n}, work_orders={wo_n}, contractor_rates={rate_n}, part_master={pm_n}")
        print("Contractor invoice compliance counters reset to defaults.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
