"""Cron entry point for the Rate Master & Negotiation status engine.

What it does (idempotent):

* Marks any active ``rate_master`` row whose ``effective_to`` is in the past
  as ``is_active=False`` (writing a ``DEACTIVATED`` audit row + version).
* Marks any approved ``contractor_rates`` row whose ``effective_to`` is in
  the past as ``status='expired'`` (writing an ``EXPIRED`` audit row + version).

Run from the project root, e.g.::

    ./venv/bin/python -m app.jobs.rate_expiry_check

The job is safe to run repeatedly — ``mark_expired`` only updates rows whose
window has actually passed, so re-runs are no-ops.
"""

from __future__ import annotations

import logging
import sys
from datetime import date

from db.session import SessionLocal
from modules.contractor_rates.service import (
    ContractorRateService,
    RateMasterService,
)

import db.models  # noqa: F401  — register all ORM models

logger = logging.getLogger("rate_expiry_check")
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s %(message)s")


def run(*, today: date | None = None) -> dict[str, int]:
    """Execute one pass. Returns the number of rows updated per table."""
    today = today or date.today()
    counts: dict[str, int] = {"rate_master": 0, "contractor_rates": 0}
    session = SessionLocal()
    try:
        rm = RateMasterService(session)
        counts["rate_master"] = rm.mark_expired(today=today)
        cr = ContractorRateService(session)
        counts["contractor_rates"] = cr.mark_expired(today=today)
    finally:
        session.close()
    logger.info(
        "rate_expiry_check ran today=%s rate_master_expired=%s contractor_rates_expired=%s",
        today.isoformat(),
        counts["rate_master"],
        counts["contractor_rates"],
    )
    return counts


def main() -> int:
    counts = run()
    print(
        f"rate_master={counts['rate_master']} "
        f"contractor_rates={counts['contractor_rates']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
