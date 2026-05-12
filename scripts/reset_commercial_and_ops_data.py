#!/usr/bin/env python3
"""Wipe commercial + ops demo data, then re-seed clusters, plants, part master, rates, WOs, invoices.

Removes (in FK-safe order):

* Invoices and lines
* Work orders (items, progress, audit)
* Approval requests for work orders, rate negotiations, invoice exceptions (cascades linked tasks)
* Orphan unified ``approval_tasks`` (no ``request_id``) for those entity types
* Contractor rates (negotiations, audit, versions — cascaded from ``contractor_rates``)
* Part master (attachments, audit, versions, rows)
* Contractor–plant mappings for plants being removed
* User / role scoping rows pointing at removed org units
* All ``org_units`` of type ``PLANT`` or ``CLUSTER``

Then runs (in order):

1. ``scripts/seed_manual_test_contractors.py`` — two demo clusters, three plants, contractors + mappings
2. ``scripts/seed_manual_test_rates.py`` — part masters + negotiation demo rows
3. ``scripts/seed_demo_users.py`` — demo users (e.g. ``negotiator``) scoped to the first plant
4. ``scripts/seed_demo_work_orders.py`` — sample work orders + submissions
5. ``scripts/seed_demo_completions_and_invoices.py`` — completion % on lines + demo invoices

Prerequisites: migrations applied; ``DATABASE_URL`` set like other seed scripts.

Usage (from repo root)::

    ./venv/bin/python scripts/reset_commercial_and_ops_data.py --yes

``--yes`` is required (safety).
"""

from __future__ import annotations

import argparse
import subprocess
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


def _delete_orphan_tasks_for_invoices(session) -> None:
    """Tasks with ``request_id`` NULL can still reference invoices / work orders by ``entity_id``."""
    for child in ("task_audit_logs", "task_comments", "approval_actions"):
        _exec(
            session,
            f"""
            DELETE FROM {child}
            WHERE task_id IN (
              SELECT id FROM approval_tasks
              WHERE request_id IS NULL
                AND entity_type = 'invoice_exception_approval'
                AND entity_id IN (SELECT id FROM invoices)
            )
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


def _delete_orphan_tasks_for_contractor_rates(session) -> None:
    for child in ("task_audit_logs", "task_comments", "approval_actions"):
        _exec(
            session,
            f"""
            DELETE FROM {child}
            WHERE task_id IN (
              SELECT id FROM approval_tasks
              WHERE request_id IS NULL
                AND entity_type = 'contractor_rate_approval'
                AND entity_id IN (SELECT id FROM contractor_rates)
            )
            """,
        )
    _exec(
        session,
        """
        DELETE FROM approval_tasks
        WHERE request_id IS NULL
          AND entity_type = 'contractor_rate_approval'
          AND entity_id IN (SELECT id FROM contractor_rates)
        """,
    )


def _delete_orphan_tasks_for_work_orders(session) -> None:
    for child in ("task_audit_logs", "task_comments", "approval_actions"):
        _exec(
            session,
            f"""
            DELETE FROM {child}
            WHERE task_id IN (
              SELECT id FROM approval_tasks
              WHERE request_id IS NULL
                AND entity_type IN ('work_order_approval', 'work_order_rate_override')
                AND entity_id IN (SELECT id FROM work_orders)
            )
            """,
        )
    _exec(
        session,
        """
        DELETE FROM approval_tasks
        WHERE request_id IS NULL
          AND entity_type IN ('work_order_approval', 'work_order_rate_override')
          AND entity_id IN (SELECT id FROM work_orders)
        """,
    )


def clear_database(session) -> None:
    """Delete commercial / ops rows. Keeps users, roles, contractors, workflows."""
    _exec(
        session,
        """
        DELETE FROM approval_requests
        WHERE entity_type IN (
            'work_order_approval',
            'work_order_rate_override',
            'contractor_rate_approval',
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
    _exec(session, "DELETE FROM work_order_contractors")
    _exec(session, "DELETE FROM work_order_audit_logs")
    _exec(session, "DELETE FROM work_orders")

    _delete_orphan_tasks_for_contractor_rates(session)
    _exec(session, "DELETE FROM contractor_rates")

    _exec(session, "DELETE FROM part_master_attachments")
    _exec(session, "DELETE FROM part_master_audit_logs")
    _exec(session, "DELETE FROM part_master_versions")
    _exec(session, "DELETE FROM part_master")

    _exec(
        session,
        """
        DELETE FROM user_org_units
        WHERE org_unit_id IN (SELECT id FROM org_units WHERE type IN ('PLANT', 'CLUSTER'))
        """,
    )
    _exec(
        session,
        """
        DELETE FROM role_org_units
        WHERE org_unit_id IN (SELECT id FROM org_units WHERE type IN ('PLANT', 'CLUSTER'))
        """,
    )
    _exec(
        session,
        """
        DELETE FROM contractor_plants
        WHERE org_unit_id IN (SELECT id FROM org_units WHERE type IN ('PLANT', 'CLUSTER'))
        """,
    )
    _exec(session, "DELETE FROM org_units WHERE type IN ('PLANT', 'CLUSTER')")

    session.commit()


def _run_script(rel_path: str) -> int:
    script = _REPO_ROOT / rel_path
    if not script.is_file():
        print(f"error: missing script {script}", file=sys.stderr)
        return 1
    print(f"\n--- running {rel_path} ---")
    r = subprocess.run([sys.executable, str(script)], cwd=str(_REPO_ROOT))
    if r.returncode != 0:
        print(f"error: {rel_path} exited {r.returncode}", file=sys.stderr)
    return int(r.returncode or 0)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Confirm destructive wipe of plants, part master, negotiations, work orders, and invoices.",
    )
    args = parser.parse_args()
    if not args.yes:
        print("Refusing to run without --yes (this deletes PLANT/CLUSTER org units and related data).", file=sys.stderr)
        return 2

    db = SessionLocal()
    try:
        print("Clearing commercial + ops tables…")
        clear_database(db)
        print("Clear done.")
    except Exception as exc:
        db.rollback()
        print(f"error: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()

    steps = [
        "scripts/seed_manual_test_contractors.py",
        "scripts/seed_manual_test_rates.py",
        "scripts/seed_demo_users.py",
        "scripts/seed_demo_work_orders.py",
        "scripts/seed_demo_completions_and_invoices.py",
    ]
    for step in steps:
        rc = _run_script(step)
        if rc != 0:
            return rc

    print("\nReset + reseed finished.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
