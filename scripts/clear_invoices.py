#!/usr/bin/env python3
"""Delete all invoices and related rows (keeps work orders and commercial master data).

Removes in FK-safe order:

* Approval requests for invoice exceptions
* Orphan approval tasks tied to invoices
* Invoice validation issues, lines, audit logs, attachments, invoices
* ``contractor_invoice_compliance`` rolling aggregates

Does **not** delete work orders, part master, contractor rates, or users.

Usage (from repo root, requires DATABASE_URL in .env)::

    ./venv/bin/python scripts/clear_invoices.py --yes
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

from clear_work_orders_and_invoices import (  # noqa: E402
    _delete_orphan_tasks_for_invoices,
    _exec,
)
from db.session import SessionLocal  # noqa: E402


def clear_invoices(session) -> None:
    _exec(session, "UPDATE invoices SET approval_request_id = NULL WHERE approval_request_id IS NOT NULL")
    _exec(
        session,
        """
        DELETE FROM approval_requests
        WHERE entity_type = 'invoice_exception_approval'
        """,
    )
    _delete_orphan_tasks_for_invoices(session)
    _exec(session, "DELETE FROM invoice_validation_issues")
    _exec(session, "DELETE FROM invoice_lines")
    _exec(session, "DELETE FROM invoice_audit_logs")
    _exec(session, "DELETE FROM invoice_attachments")
    _exec(session, "DELETE FROM invoices")
    _exec(session, "DELETE FROM contractor_invoice_compliance")
    session.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--yes", action="store_true", help="Confirm deletion of all invoices.")
    args = parser.parse_args()
    if not args.yes:
        print("Refusing to run without --yes.", file=sys.stderr)
        return 2

    db = SessionLocal()
    try:
        print("Deleting all invoices…")
        clear_invoices(db)
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
