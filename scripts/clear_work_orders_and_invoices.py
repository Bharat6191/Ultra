#!/usr/bin/env python3
"""Delete all work orders and invoices (and related rows only).

Removes in FK-safe order:

* Approval requests for work orders, line rate overrides, and invoice exceptions
* Orphan ``approval_tasks`` (no ``request_id``) tied to those entities
* Invoice validation issues, lines, audit logs, attachments, invoices
* ``contractor_invoice_compliance`` rows (rolling aggregates; safe to clear)
* Work order item progress, items, audit logs, work orders

Does **not** delete: part master, contractor rates, org units, contractors, users, or
``contractor_rate_approval`` approval requests.

Usage (from repo root, requires DATABASE_URL in .env)::

    ./venv/bin/python scripts/clear_work_orders_and_invoices.py --yes

``--yes`` is required.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_SCRIPTS_ROOT = Path(__file__).resolve().parent
_REPO_ROOT = _SCRIPTS_ROOT.parent
_BACKEND_ROOT = _REPO_ROOT / "backend"
for _p in (_BACKEND_ROOT, _SCRIPTS_ROOT):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from sqlalchemy import text

import db.models  # noqa: F401
from db.session import SessionLocal


def _exec(session, sql: str, params: dict | None = None) -> None:
    session.execute(text(sql), params or {})


def _delete_task_children(session, *, task_ids_sql: str) -> None:
    for child in ("task_audit_logs", "task_comments", "approval_actions"):
        _exec(session, f"DELETE FROM {child} WHERE task_id IN ({task_ids_sql})")


def _delete_orphan_tasks_for_invoices(session) -> None:
    _delete_task_children(
        session,
        task_ids_sql="""
            SELECT id FROM approval_tasks
            WHERE request_id IS NULL
              AND entity_type = 'invoice_exception_approval'
              AND entity_id IN (SELECT id FROM invoices)
        """,
    )
    _exec(
        session,
        """
        DELETE FROM approval_tasks
        WHERE request_id IS NULL
          AND entity_type = 'invoice_exception_approval'
          AND entity_id IN (SELECT id FROM invoices)
        """,
    )


def _delete_orphan_tasks_for_work_orders(session) -> None:
    _delete_task_children(
        session,
        task_ids_sql="""
            SELECT id FROM approval_tasks
            WHERE request_id IS NULL
              AND entity_type IN ('work_order_approval', 'work_order_rate_override')
              AND (
                (entity_type = 'work_order_approval' AND entity_id IN (SELECT id FROM work_orders))
                OR (entity_type = 'work_order_rate_override' AND entity_id IN (SELECT id FROM work_order_items))
              )
        """,
    )
    _exec(
        session,
        """
        DELETE FROM approval_tasks
        WHERE request_id IS NULL
          AND entity_type IN ('work_order_approval', 'work_order_rate_override')
          AND (
            (entity_type = 'work_order_approval' AND entity_id IN (SELECT id FROM work_orders))
            OR (entity_type = 'work_order_rate_override' AND entity_id IN (SELECT id FROM work_order_items))
          )
        """,
    )


def clear_work_orders_and_invoices(session) -> None:
    # Break FKs from operational rows to approval_requests before deleting requests.
    _exec(session, "UPDATE work_orders SET approval_request_id = NULL WHERE approval_request_id IS NOT NULL")
    _exec(session, "UPDATE invoices SET approval_request_id = NULL WHERE approval_request_id IS NOT NULL")
    _exec(
        session,
        "UPDATE work_order_items SET override_approval_request_id = NULL WHERE override_approval_request_id IS NOT NULL",
    )

    _exec(
        session,
        """
        DELETE FROM approval_requests
        WHERE entity_type IN (
            'work_order_approval',
            'work_order_rate_override',
            'invoice_exception_approval'
        )
        """,
    )

    _delete_orphan_tasks_for_invoices(session)

    _exec(session, "DELETE FROM invoice_validation_issues")
    _exec(session, "DELETE FROM invoice_lines")
    _exec(session, "DELETE FROM invoice_audit_logs")
    _exec(session, "DELETE FROM invoice_attachments")
    _exec(session, "DELETE FROM invoices")
    _exec(session, "DELETE FROM contractor_invoice_compliance")

    _delete_orphan_tasks_for_work_orders(session)

    _exec(session, "DELETE FROM work_order_item_progress")
    _exec(session, "DELETE FROM work_order_items")
    _exec(session, "DELETE FROM work_order_audit_logs")
    _exec(session, "DELETE FROM work_orders")

    session.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Confirm deletion of all work orders and invoices.",
    )
    args = parser.parse_args()
    if not args.yes:
        print("Refusing to run without --yes.", file=sys.stderr)
        return 2

    db = SessionLocal()
    try:
        print("Deleting all work orders and invoices…")
        clear_work_orders_and_invoices(db)
        print("Done.")
        return 0
    except Exception as exc:
        db.rollback()
        print(f"error: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
