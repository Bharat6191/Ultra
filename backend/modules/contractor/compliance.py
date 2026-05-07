"""Compliance evaluation for contractors.

A contractor is **non_compliant** if any **active critical document type** (configured in
``contractor_compliance_configs``) is either:
  - missing entirely (no document with that type exists), or
  - present but its latest record has expired.

A contractor is in **warning** state if any document is expiring within ``warn_days``.

Verification is currently disabled product-wide (see
``ContractorService.DOCUMENT_AUTO_VERIFY``), so a non-zero ``pending_verification``
count is reported for visibility but **does not** push the contractor into
``warning``. If verification is re-enabled, simply restore the ``pending`` term in
the warning condition below.

The same evaluator is used to:
  * compute ``contractors.status`` after document changes
  * fill ``ContractorComplianceSummary`` for list / detail responses
"""

from __future__ import annotations

from datetime import date
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from modules.contractor.models import (
    Contractor,
    ContractorComplianceConfig,
    ContractorDocument,
)


@dataclass(frozen=True)
class ComplianceResult:
    state: str  # "compliant" | "warning" | "non_compliant" | "no_data"
    expired_documents: int
    expiring_soon: int
    pending_verification: int
    missing_critical_types: list[str]
    next_expiry: date | None


def _today() -> date:
    return date.today()


def _critical_doc_types(db: Session) -> list[ContractorComplianceConfig]:
    return list(
        db.scalars(
            select(ContractorComplianceConfig).where(
                ContractorComplianceConfig.is_active.is_(True),
                ContractorComplianceConfig.is_critical.is_(True),
            )
        ).all()
    )


def evaluate_contractor_compliance(db: Session, contractor_id: int) -> ComplianceResult:
    today = _today()
    docs = list(
        db.scalars(
            select(ContractorDocument).where(ContractorDocument.contractor_id == contractor_id)
        ).all()
    )
    critical_cfgs = _critical_doc_types(db)
    critical_types = {c.document_type for c in critical_cfgs}
    warn_by_type = {c.document_type: int(c.warn_days) for c in critical_cfgs}

    if not docs and not critical_types:
        return ComplianceResult(
            state="no_data",
            expired_documents=0,
            expiring_soon=0,
            pending_verification=0,
            missing_critical_types=[],
            next_expiry=None,
        )

    expired = 0
    expiring = 0
    pending = 0
    next_exp: date | None = None
    have_critical_types: set[str] = set()

    for d in docs:
        if d.document_type in critical_types:
            have_critical_types.add(d.document_type)
        if d.verification_status == "pending":
            pending += 1
        if d.expiry_date is None:
            continue
        if next_exp is None or d.expiry_date < next_exp:
            next_exp = d.expiry_date
        if d.expiry_date < today:
            expired += 1
            continue
        warn_days = warn_by_type.get(d.document_type, 7)
        delta = (d.expiry_date - today).days
        if 0 <= delta <= warn_days:
            expiring += 1

    missing_critical = sorted(critical_types - have_critical_types)

    state: str
    if (missing_critical and critical_types) or expired > 0:
        state = "non_compliant"
    elif expiring > 0:
        # Pending verifications are intentionally excluded — verification is not part
        # of the active product flow. Re-add ``or pending > 0`` to bring it back.
        state = "warning"
    elif not docs:
        state = "no_data"
    else:
        state = "compliant"

    return ComplianceResult(
        state=state,
        expired_documents=expired,
        expiring_soon=expiring,
        pending_verification=pending,
        missing_critical_types=list(missing_critical),
        next_expiry=next_exp,
    )


def recompute_contractor_status(db: Session, contractor: Contractor) -> bool:
    """Recompute and apply the lifecycle status based on compliance.

    Rules:
      * If status is ``draft|pending|suspended|blacklisted``, do not touch (manual lifecycle).
      * Otherwise (``active|non_compliant|expired``), promote/demote based on compliance.

    Returns True if status changed.
    """
    immutable = {"draft", "pending", "suspended", "blacklisted"}
    if contractor.status in immutable:
        return False
    result = evaluate_contractor_compliance(db, int(contractor.id))
    new_status = contractor.status
    if result.state == "non_compliant":
        new_status = "non_compliant"
    elif result.state in ("compliant", "warning", "no_data"):
        new_status = "active"
    if new_status != contractor.status:
        contractor.status = new_status
        return True
    return False
