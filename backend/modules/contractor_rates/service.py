"""Contractor rate / negotiation service layer.

All mutations go through these methods so audit logs, savings recomputation, and
approval-engine integration stay consistent.

Business invariants enforced here:

* Only one **negotiation thread** per ``(contractor_id, part_master_id)`` at a time:
  while a row exists in ``draft``, ``pending_approval``, ``rejected``, or a
  **current** ``approved`` window (``effective_to`` is null or not before today),
  ``create_rate`` is rejected — continue the existing record (new rounds, remarks,
  attachments) instead of inserting another negotiation.
* New ``contractor_rate`` rows for the same pair are allowed only after prior rows
  are ``cancelled``, ``expired``, or ``approved`` with an ``effective_to`` strictly
  before today (historical generation).
* Only one ACTIVE (``status='approved'``) ``contractor_rate`` can exist per
  ``(contractor_id, part_master_id)`` at a time.
* Approving a rate auto-deactivates any previously approved rate for the same
  ``(contractor_id, part_master_id)`` (sets ``status='expired'`` and writes
  ``RATE_DEACTIVATED`` + ``EXPIRED`` audit rows on it).
* ``effective_from <= effective_to`` for both part_master and contractor_rate.
* Overlapping date ranges are rejected at submission time.
* Audit log written on EVERY mutation (create / update / round / submit / approve /
  reject / cancel / activation / deactivation).
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from modules.approvals.assignment_service import get_workflow_for_action
from modules.approvals.service import ApprovalEngineService
from modules.contractor.models import Contractor
from modules.contractor_rates import audit as audit_helpers
from modules.contractor_rates.models import (
    ContractorRate,
    ContractorRateAuditLog,
    ContractorRateVersion,
    NegotiationAttachment,
    NegotiationLog,
)
from modules.contractor_rates.schema import ContractorRateCreate, ContractorRateUpdate, NegotiationRoundCreate
from modules.part_master.models import PartMaster
from modules.part_master.storage import negotiation_attachment_abs_path, save_negotiation_attachment
from modules.errors import ConflictError, NotFoundError
from modules.org_units.hierarchy import collect_plant_ids_under_scope
from modules.org_units.model import OrgUnit
from modules.users.model import User


# Action codes consumed by the approval engine for negotiated rates.
ACTION_CODE_CREATE = "contractor_rates.create"
ACTION_CODE_APPROVE = "contractor_rates.approve"

# Approval entity types.
APPROVAL_ENTITY_TYPE = "contractor_rate_approval"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _q2(value: Decimal) -> Decimal:
    """Round a money value to 2 decimal places (banker's-half-up)."""
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _q4(value: Decimal) -> Decimal:
    """Round a percentage to 2 decimal places."""
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# ---------- Contractor rate (negotiation) ----------


class ContractorRateService:
    def __init__(self, db: Session) -> None:
        self._db = db

    # --- helpers ---

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

    @staticmethod
    def _validate_dates(effective_from: date, effective_to: date | None) -> None:
        if effective_to is not None and effective_from > effective_to:
            raise ConflictError("effective_from must be on or before effective_to.")

    def _last_approved_rate(
        self, contractor_id: int, part_master_id: int, *, exclude_id: int | None = None
    ) -> ContractorRate | None:
        """Most recently approved rate for this (contractor, part_master) pair."""
        stmt = (
            select(ContractorRate)
            .where(
                ContractorRate.contractor_id == int(contractor_id),
                ContractorRate.part_master_id == int(part_master_id),
                ContractorRate.status.in_(("approved", "expired")),
            )
            .order_by(ContractorRate.approved_at.desc().nullslast(), ContractorRate.id.desc())
        )
        if exclude_id is not None:
            stmt = stmt.where(ContractorRate.id != int(exclude_id))
        return self._db.scalar(stmt)

    @staticmethod
    def _calc_savings(
        initial: Decimal | None, negotiated: Decimal
    ) -> tuple[Decimal | None, Decimal | None]:
        """Compute negotiation savings (amount, percentage).

        Anchored on ``initial_rate`` — the contractor's opening ask captured at
        ``create_rate`` time. The figure represents how much the company shaved
        off the contractor's first proposal through negotiation rounds.

        Always non-negative: if the final ``negotiated_rate`` is somehow above
        the opening ask (re-negotiation upward), savings is clamped to ``0``.

        ``base_rate`` is intentionally NOT used here — see
        ``aggregate_summary`` for the separate "vs base" KPI which can be
        negative ("premium paid above base").
        """
        if initial is None or Decimal(initial) == Decimal("0"):
            return None, None
        diff = Decimal(initial) - Decimal(negotiated)
        if diff < Decimal("0"):
            diff = Decimal("0")
        amount = _q2(diff)
        pct = _q4((amount / Decimal(initial)) * Decimal("100"))
        return amount, pct

    def _check_overlap(
        self,
        *,
        contractor_id: int,
        part_master_id: int,
        effective_from: date,
        effective_to: date | None,
        exclude_id: int | None = None,
    ) -> None:
        """Reject when a candidate window collides with an already-approved range
        for the same (contractor, part_master).

        Two intervals [a, b] and [c, d] overlap iff a <= d and c <= b. We treat
        an open-ended ``effective_to`` as "infinity".
        """
        from datetime import date as _date

        stmt = select(ContractorRate).where(
            ContractorRate.contractor_id == int(contractor_id),
            ContractorRate.part_master_id == int(part_master_id),
            ContractorRate.status == "approved",
        )
        if exclude_id is not None:
            stmt = stmt.where(ContractorRate.id != int(exclude_id))

        for other in self._db.scalars(stmt).all():
            other_to = other.effective_to or _date(9999, 12, 31)
            cand_to = effective_to or _date(9999, 12, 31)
            if effective_from <= other_to and other.effective_from <= cand_to:
                raise ConflictError(
                    "An approved rate already exists for this contractor/rate combination "
                    "in the requested date range."
                )

    _NEGOTIATION_THREAD_BLOCKING_STATUSES = frozenset({"draft", "pending_approval", "rejected"})

    def _active_negotiation_thread_for_part(
        self, contractor_id: int, part_master_id: int, *, today: date | None = None
    ) -> ContractorRate | None:
        """Return a ``ContractorRate`` row that must be continued instead of ``create_rate``.

        A thread is **active** when the row is not ``cancelled`` / ``expired``, and either
        it is in-flight (draft / pending / rejected) or it is ``approved`` with a rate
        window that still includes ``today`` (open-ended or ``effective_to`` >= today).
        """
        today = today or date.today()
        stmt = (
            select(ContractorRate)
            .where(
                ContractorRate.contractor_id == int(contractor_id),
                ContractorRate.part_master_id == int(part_master_id),
            )
            .order_by(ContractorRate.id.desc())
        )
        for row in self._db.scalars(stmt).all():
            st = str(row.status).lower()
            if st in ("cancelled", "expired"):
                continue
            if st in self._NEGOTIATION_THREAD_BLOCKING_STATUSES:
                return row
            if st == "approved":
                et = row.effective_to
                if et is None or et >= today:
                    return row
        return None

    # --- public-shape helper ---

    def to_public_dict(self, row: ContractorRate, *, include_rounds: bool = True) -> dict[str, Any]:
        """Build the shape returned by the API (joins contractor + part master + plant)."""
        contractor = self._db.get(Contractor, int(row.contractor_id))
        rm = self._db.get(PartMaster, int(row.part_master_id))
        org = self._db.get(OrgUnit, int(rm.org_unit_id)) if rm else None
        creator = self._db.get(User, int(row.created_by)) if row.created_by else None

        rounds_public: list[dict[str, Any]] = []
        if include_rounds:
            rounds_public = [
                {
                    "id": int(r.id),
                    "contractor_rate_id": int(r.contractor_rate_id),
                    "round_number": int(r.round_number),
                    "proposed_rate": r.proposed_rate,
                    "counter_rate": r.counter_rate,
                    "remarks": r.remarks,
                    "round_summary": r.round_summary,
                    "created_by": r.created_by,
                    "created_by_name": (
                        self._db.get(User, int(r.created_by)).full_name
                        if r.created_by
                        else None
                    ),
                    "created_at": r.created_at,
                    "attachments": [
                        {
                            "id": int(a.id),
                            "file_path": a.file_path,
                            "file_name": a.file_name,
                            "content_type": a.content_type,
                            "uploaded_by": a.uploaded_by,
                            "uploaded_at": a.uploaded_at,
                        }
                        for a in (r.attachments or [])
                    ],
                }
                for r in row.negotiation_logs
            ]

        return {
            "id": int(row.id),
            "contractor_id": int(row.contractor_id),
            "contractor_name": contractor.name if contractor else None,
            "part_master_id": int(row.part_master_id),
            "part_code": rm.part_code if rm else None,
            "part_name": rm.part_name if rm else None,
            "unit_type": rm.unit_type if rm else None,
            "pricing_method": rm.pricing_method if rm else None,
            "rate_unit_type": rm.rate_unit_type if rm else None,
            "weight_per_piece": Decimal(rm.weight_per_piece) if rm and rm.weight_per_piece is not None else None,
            "org_unit_id": int(rm.org_unit_id) if rm else None,
            "org_unit_name": org.name if org else None,
            "base_rate": Decimal(rm.base_rate) if rm else None,
            "negotiated_rate": Decimal(row.negotiated_rate),
            "initial_rate": row.initial_rate,
            "previous_rate": row.previous_rate,
            "savings_amount": row.savings_amount,
            "savings_percentage": row.savings_percentage,
            # vs-base metrics so the dashboard can show "premium paid above base".
            # Positive => company is paying above the procurement baseline.
            # Negative => company is paying below the baseline (rare in practice).
            "vs_base_amount": (
                Decimal(row.negotiated_rate) - Decimal(rm.base_rate)
                if rm is not None
                else None
            ),
            "vs_base_percentage": (
                _q4(
                    ((Decimal(row.negotiated_rate) - Decimal(rm.base_rate)) / Decimal(rm.base_rate))
                    * Decimal("100")
                )
                if rm is not None and Decimal(rm.base_rate) > Decimal("0")
                else None
            ),
            "effective_from": row.effective_from,
            "effective_to": row.effective_to,
            "status": row.status,
            "current_round": int(row.current_round),
            "remarks": row.remarks,
            "approval_request_id": row.approval_request_id,
            "approved_by": row.approved_by,
            "approved_at": row.approved_at,
            "rejected_by": row.rejected_by,
            "rejected_at": row.rejected_at,
            "created_by": row.created_by,
            "created_by_name": creator.full_name if creator else None,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
            "rounds": rounds_public,
        }

    # --- list / get ---

    def list_rates(
        self,
        *,
        contractor_id: int | None = None,
        status: str | None = None,
        part_master_id: int | None = None,
        org_unit_id: int | None = None,
        part_code: str | None = None,
    ) -> list[ContractorRate]:
        stmt = (
            select(ContractorRate)
            .options(selectinload(ContractorRate.negotiation_logs))
            .order_by(ContractorRate.created_at.desc())
        )
        if contractor_id is not None:
            stmt = stmt.where(ContractorRate.contractor_id == int(contractor_id))
        if status:
            stmt = stmt.where(ContractorRate.status == status.strip().lower())
        if part_master_id is not None:
            stmt = stmt.where(ContractorRate.part_master_id == int(part_master_id))
        if org_unit_id is not None or part_code:
            stmt = stmt.join(PartMaster, PartMaster.id == ContractorRate.part_master_id)
            if org_unit_id is not None:
                plant_ids = collect_plant_ids_under_scope(self._db, int(org_unit_id))
                if not plant_ids:
                    return []
                stmt = stmt.where(PartMaster.org_unit_id.in_(plant_ids))
            if part_code:
                q = part_code.strip().upper()
                stmt = stmt.where(
                    (PartMaster.part_code.ilike(f"%{q}%")) | (PartMaster.part_name.ilike(f"%{part_code.strip()}%"))
                )
        return list(self._db.scalars(stmt).unique().all())

    def get_rate(self, rate_id: int) -> ContractorRate:
        # ``populate_existing`` forces SQLAlchemy to overwrite any cached collection
        # state for the row, which matters when the calling test/session keeps the
        # session alive across multiple mutations (``expire_on_commit=False``).
        row = self._db.scalar(
            select(ContractorRate)
            .where(ContractorRate.id == int(rate_id))
            .options(selectinload(ContractorRate.negotiation_logs))
            .execution_options(populate_existing=True)
        )
        if row is None:
            raise NotFoundError("ContractorRate", rate_id)
        return row

    # --- create / update ---

    def create_rate(
        self, payload: ContractorRateCreate, *, actor_user_id: int | None = None
    ) -> ContractorRate:
        self._ensure_contractor(int(payload.contractor_id))
        rm = self._ensure_part_master(int(payload.part_master_id))
        self._validate_dates(payload.effective_from, payload.effective_to)

        clash = self._active_negotiation_thread_for_part(int(payload.contractor_id), int(rm.id))
        if clash is not None:
            raise ConflictError(
                "A negotiation already exists for this contractor and part "
                f"(rate #{int(clash.id)}, status {clash.status}). "
                "Open that negotiation to add rounds, remarks, and attachments, "
                "or wait until it is expired or cancelled before starting a new record."
            )

        prev = self._last_approved_rate(int(payload.contractor_id), int(rm.id))
        previous_rate: Decimal | None = (
            Decimal(prev.negotiated_rate) if prev is not None else None
        )

        # ``initial_rate`` is the contractor's opening ask. The first
        # ``negotiated_rate`` we receive at create time IS that opening ask;
        # subsequent rounds will negotiate it down without mutating this anchor.
        # An explicit override (``payload.initial_rate``) is allowed for cases
        # where procurement records the ask separately from a counter-offer.
        explicit_initial = getattr(payload, "initial_rate", None)
        initial_rate: Decimal = (
            Decimal(explicit_initial)
            if explicit_initial is not None
            else Decimal(payload.negotiated_rate)
        )
        savings_amount, savings_pct = self._calc_savings(
            initial_rate, Decimal(payload.negotiated_rate)
        )

        row = ContractorRate(
            contractor_id=int(payload.contractor_id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal(payload.negotiated_rate),
            initial_rate=initial_rate,
            previous_rate=previous_rate,
            savings_amount=savings_amount,
            savings_percentage=savings_pct,
            effective_from=payload.effective_from,
            effective_to=payload.effective_to,
            status="draft",
            current_round=0,
            remarks=payload.remarks,
            created_by=actor_user_id,
        )
        self._db.add(row)
        self._db.flush()
        audit_helpers.write_audit(
            self._db,
            contractor_rate_id=int(row.id),
            action=audit_helpers.ACTION_CREATED,
            actor_user_id=actor_user_id,
            new_value=audit_helpers.snapshot_rate(row),
            metadata={
                "contractor_id": int(row.contractor_id),
                "part_master_id": int(row.part_master_id),
                "base_rate": str(rm.base_rate),
                "initial_rate": str(initial_rate),
                "previous_rate": str(previous_rate) if previous_rate is not None else None,
            },
        )
        # v1 snapshot.
        audit_helpers.write_contractor_rate_version(
            self._db,
            rate=row,
            actor_user_id=actor_user_id,
            change_reason=audit_helpers.ACTION_CREATED,
        )
        audit_helpers.write_audit(
            self._db,
            contractor_rate_id=int(row.id),
            action=audit_helpers.ACTION_VERSION_CREATED,
            actor_user_id=actor_user_id,
            new_value={"version_number": 1},
            metadata={"reason": audit_helpers.ACTION_CREATED},
        )
        # Round 1 is the opening negotiation (evidence files attach here later).
        opening_log = NegotiationLog(
            contractor_rate_id=int(row.id),
            round_number=1,
            proposed_rate=Decimal(payload.negotiated_rate),
            counter_rate=None,
            remarks=payload.remarks,
            round_summary="Opening evidence",
            created_by=actor_user_id,
        )
        self._db.add(opening_log)
        row.current_round = 1
        self._db.commit()
        return self.get_rate(int(row.id))

    def update_rate(
        self,
        rate_id: int,
        payload: ContractorRateUpdate,
        *,
        actor_user_id: int | None = None,
    ) -> ContractorRate:
        row = self.get_rate(rate_id)
        if row.status not in ("draft", "rejected"):
            raise ConflictError(
                "Only rates in draft/rejected state can be edited. "
                "Add a negotiation round or create a new rate instead."
            )
        before = audit_helpers.snapshot_rate(row)

        upd = payload.model_dump(exclude_unset=True)
        if "negotiated_rate" in upd and upd["negotiated_rate"] is not None:
            row.negotiated_rate = Decimal(upd["negotiated_rate"])
        if "effective_from" in upd and upd["effective_from"] is not None:
            row.effective_from = upd["effective_from"]
        if "effective_to" in upd:
            row.effective_to = upd["effective_to"]
        if "remarks" in upd:
            row.remarks = upd["remarks"] or None
        self._validate_dates(row.effective_from, row.effective_to)

        # Recompute savings against the (immutable) initial ask now that the
        # negotiated rate may have changed.
        row.savings_amount, row.savings_percentage = self._calc_savings(
            row.initial_rate, Decimal(row.negotiated_rate)
        )

        after = audit_helpers.snapshot_rate(row)
        old_d, new_d = audit_helpers.diff_dicts(before, after)
        if old_d or new_d:
            audit_helpers.write_audit(
                self._db,
                contractor_rate_id=int(row.id),
                action=audit_helpers.ACTION_UPDATED,
                actor_user_id=actor_user_id,
                old_value=old_d or None,
                new_value=new_d or None,
                metadata={"fields": sorted((old_d | new_d).keys())},
            )
            validity_keys = {"effective_from", "effective_to"}
            if validity_keys & set(new_d.keys()):
                audit_helpers.write_audit(
                    self._db,
                    contractor_rate_id=int(row.id),
                    action=audit_helpers.ACTION_VALIDITY_CHANGED,
                    actor_user_id=actor_user_id,
                    old_value={k: old_d.get(k) for k in validity_keys if k in old_d},
                    new_value={k: new_d.get(k) for k in validity_keys if k in new_d},
                )
            ver = audit_helpers.write_contractor_rate_version(
                self._db,
                rate=row,
                actor_user_id=actor_user_id,
                change_reason=audit_helpers.ACTION_UPDATED,
            )
            audit_helpers.write_audit(
                self._db,
                contractor_rate_id=int(row.id),
                action=audit_helpers.ACTION_VERSION_CREATED,
                actor_user_id=actor_user_id,
                new_value={"version_number": int(ver.version_number)},
                metadata={"reason": audit_helpers.ACTION_UPDATED},
            )
        self._db.commit()
        return self.get_rate(int(row.id))

    # --- negotiation rounds ---

    def _round_one_log(self, row: ContractorRate) -> NegotiationLog | None:
        for log in row.negotiation_logs or []:
            if int(log.round_number or 0) == 1:
                return log
        return None

    def _in_place_negotiation_status(self, row: ContractorRate) -> bool:
        """Negotiate updates round 1 until the first approval cycle completes (rejection → round 2)."""
        return row.status in ("draft", "pending_approval")

    def _prune_extra_draft_rounds(self, row: ContractorRate) -> None:
        """Remove spurious round 2+ rows created before in-place draft edits were enforced."""
        if row.status != "draft":
            return
        for log in list(row.negotiation_logs or []):
            if int(log.round_number or 0) > 1:
                self._db.delete(log)
        row.current_round = 1

    def _revise_draft_round_one(
        self,
        row: ContractorRate,
        log: NegotiationLog,
        payload: NegotiationRoundCreate,
        *,
        actor_user_id: int | None,
    ) -> NegotiationLog:
        """Update round 1 in place during draft (not a new round)."""
        if payload.proposed_rate is None and payload.counter_rate is None:
            raise ConflictError(
                "At least one of proposed_rate or counter_rate is required for a round."
            )

        before_lift = audit_helpers.snapshot_rate(row)
        initial_lifted = False
        if (
            payload.proposed_rate is not None
            and (
                row.initial_rate is None
                or Decimal(payload.proposed_rate) > Decimal(row.initial_rate)
            )
        ):
            row.initial_rate = Decimal(payload.proposed_rate)
            initial_lifted = True

        if payload.proposed_rate is not None:
            log.proposed_rate = Decimal(payload.proposed_rate)
        if payload.counter_rate is not None:
            log.counter_rate = Decimal(payload.counter_rate)
        if payload.remarks is not None:
            log.remarks = payload.remarks or None
        if payload.round_summary and payload.round_summary.strip():
            log.round_summary = payload.round_summary.strip()

        rate_changed = False
        if payload.apply_to_negotiated_rate:
            new_rate = payload.counter_rate or payload.proposed_rate
            if new_rate is not None and Decimal(new_rate) != Decimal(row.negotiated_rate):
                row.negotiated_rate = Decimal(new_rate)
                rate_changed = True

        if rate_changed or initial_lifted:
            row.savings_amount, row.savings_percentage = self._calc_savings(
                row.initial_rate, Decimal(row.negotiated_rate)
            )
            after = audit_helpers.snapshot_rate(row)
            old_d, new_d = audit_helpers.diff_dicts(before_lift, after)
            if old_d or new_d:
                audit_helpers.write_audit(
                    self._db,
                    contractor_rate_id=int(row.id),
                    action=audit_helpers.ACTION_UPDATED,
                    actor_user_id=actor_user_id,
                    old_value=old_d or None,
                    new_value=new_d or None,
                    metadata={
                        "via": "draft_round_revision",
                        "round_number": 1,
                    },
                )
        row.current_round = 1
        self._prune_extra_draft_rounds(row)
        self._db.commit()
        return log

    def add_negotiation_round(
        self,
        rate_id: int,
        payload: NegotiationRoundCreate,
        *,
        actor_user_id: int | None = None,
    ) -> NegotiationLog:
        row = self.get_rate(rate_id)
        if row.status not in ("draft", "pending_approval", "rejected"):
            raise ConflictError(
                "Negotiation rounds can only be added while the rate is draft / "
                "pending_approval / rejected."
            )
        if payload.proposed_rate is None and payload.counter_rate is None:
            raise ConflictError(
                "At least one of proposed_rate or counter_rate is required for a round."
            )

        if self._in_place_negotiation_status(row):
            draft_round = self._round_one_log(row)
            if draft_round is not None:
                return self._revise_draft_round_one(
                    row, draft_round, payload, actor_user_id=actor_user_id
                )
            next_round = 1
        elif row.status == "rejected":
            next_round = max(int(row.current_round or 0) + 1, 2)
        else:
            raise ConflictError(
                "Negotiation rounds can only be added while draft, pending approval, or rejected."
            )

        log = NegotiationLog(
            contractor_rate_id=int(row.id),
            round_number=next_round,
            proposed_rate=payload.proposed_rate,
            counter_rate=payload.counter_rate,
            remarks=payload.remarks or None,
            round_summary=(payload.round_summary.strip() if payload.round_summary else None),
            created_by=actor_user_id,
        )
        self._db.add(log)
        row.current_round = next_round

        # On round 1, if the contractor's proposed rate is HIGHER than what
        # was recorded at create_rate as the initial ask, we treat it as the
        # true opening ask and lift ``initial_rate`` accordingly. This covers
        # the workflow where create_rate was used to seed an internal target,
        # and round 1 is the real first contractor proposal.
        initial_lifted = False
        before_lift = audit_helpers.snapshot_rate(row)
        if (
            next_round == 1
            and payload.proposed_rate is not None
            and (
                row.initial_rate is None
                or Decimal(payload.proposed_rate) > Decimal(row.initial_rate)
            )
        ):
            row.initial_rate = Decimal(payload.proposed_rate)
            initial_lifted = True

        # Optionally promote the new rate as the "agreed" negotiated rate.
        new_rate: Decimal | None = None
        if payload.apply_to_negotiated_rate:
            new_rate = payload.counter_rate or payload.proposed_rate
        rate_changed = new_rate is not None and new_rate != row.negotiated_rate
        if rate_changed:
            row.negotiated_rate = Decimal(new_rate)  # type: ignore[arg-type]

        # Recompute savings whenever EITHER the negotiated rate or the
        # initial-ask anchor changed. Without this, a round that only lifts
        # ``initial_rate`` (e.g. round-1 proposal above the recorded target)
        # would leave ``savings_amount`` stale.
        if rate_changed or initial_lifted:
            row.savings_amount, row.savings_percentage = self._calc_savings(
                row.initial_rate, Decimal(row.negotiated_rate)
            )
            after = audit_helpers.snapshot_rate(row)
            old_d, new_d = audit_helpers.diff_dicts(before_lift, after)
            audit_helpers.write_audit(
                self._db,
                contractor_rate_id=int(row.id),
                action=audit_helpers.ACTION_UPDATED,
                actor_user_id=actor_user_id,
                old_value=old_d or None,
                new_value=new_d or None,
                metadata={"via": "negotiation_round", "round_number": next_round},
            )

        audit_helpers.write_audit(
            self._db,
            contractor_rate_id=int(row.id),
            action=audit_helpers.ACTION_NEGOTIATION_ADDED,
            actor_user_id=actor_user_id,
            new_value={
                "round_number": next_round,
                "proposed_rate": str(payload.proposed_rate) if payload.proposed_rate else None,
                "counter_rate": str(payload.counter_rate) if payload.counter_rate else None,
                "remarks": payload.remarks,
            },
            metadata={"applied_to_negotiated_rate": bool(payload.apply_to_negotiated_rate)},
        )
        self._db.commit()
        return log

    def seed_opening_evidence_round(
        self, rate_id: int, *, actor_user_id: int | None = None
    ) -> NegotiationLog:
        """Return round 1 for opening evidence (created with the rate) or seed it for legacy rows."""
        row = self.get_rate(rate_id)
        if row.status != "draft":
            raise ConflictError(
                "Opening evidence can only be added to draft negotiations that have no rounds yet."
            )
        existing = self._opening_evidence_log_for_more_files(row)
        if existing is not None:
            return existing
        if row.negotiation_logs:
            raise ConflictError("This negotiation already has rounds.")
        payload = NegotiationRoundCreate(
            proposed_rate=Decimal(row.negotiated_rate),
            counter_rate=None,
            remarks=None,
            round_summary="Opening evidence",
            apply_to_negotiated_rate=False,
        )
        return self.add_negotiation_round(rate_id, payload, actor_user_id=actor_user_id)

    def _opening_evidence_log_for_more_files(self, row: ContractorRate) -> NegotiationLog | None:
        """If round 1 (opening evidence) already exists, return it so more files can attach."""
        if row.status != "draft":
            return None
        logs = list(row.negotiation_logs or [])
        if len(logs) != 1:
            return None
        log = logs[0]
        if int(log.round_number or 0) != 1:
            return None
        if (log.round_summary or "").strip() != "Opening evidence":
            return None
        return log

    def upload_opening_evidence(
        self,
        rate_id: int,
        files: list[tuple[str, bytes, str | None]],
        *,
        actor_user_id: int | None = None,
    ) -> tuple[NegotiationLog, list[NegotiationAttachment]]:
        if not files:
            raise ConflictError("At least one file is required for opening evidence.")
        row = self.get_rate(rate_id)
        if row.status != "draft":
            raise ConflictError(
                "Opening evidence can only be added to draft negotiations that have no rounds yet."
            )
        log = self._opening_evidence_log_for_more_files(row)
        if log is None:
            log = self.seed_opening_evidence_round(rate_id, actor_user_id=actor_user_id)
        saved: list[NegotiationAttachment] = []
        for filename, content, content_type in files:
            saved.append(
                self.add_negotiation_attachment(
                    rate_id,
                    int(log.id),
                    filename=filename,
                    content=content,
                    content_type=content_type,
                    actor_user_id=actor_user_id,
                )
            )
        return log, saved

    def add_negotiation_attachment(
        self,
        rate_id: int,
        log_id: int,
        *,
        filename: str,
        content: bytes,
        content_type: str | None,
        actor_user_id: int | None = None,
    ) -> NegotiationAttachment:
        row = self.get_rate(rate_id)
        log = self._db.get(NegotiationLog, int(log_id))
        if log is None or int(log.contractor_rate_id) != int(row.id):
            raise NotFoundError("NegotiationLog", log_id)

        path = save_negotiation_attachment(
            contractor_rate_id=int(row.id),
            round_id=int(log.id),
            filename=filename,
            content=content,
        )
        att = NegotiationAttachment(
            negotiation_log_id=int(log.id),
            file_path=path,
            file_name=filename,
            content_type=content_type,
            uploaded_by=actor_user_id,
        )
        self._db.add(att)
        self._db.commit()
        self._db.refresh(att)
        return att

    def get_negotiation_attachment_file(
        self, rate_id: int, log_id: int, attachment_id: int
    ) -> tuple[NegotiationAttachment, Path]:
        row = self.get_rate(rate_id)
        log = self._db.get(NegotiationLog, int(log_id))
        if log is None or int(log.contractor_rate_id) != int(row.id):
            raise NotFoundError("NegotiationLog", log_id)
        att = self._db.get(NegotiationAttachment, int(attachment_id))
        if att is None or int(att.negotiation_log_id) != int(log.id):
            raise NotFoundError("NegotiationAttachment", attachment_id)
        try:
            path = negotiation_attachment_abs_path(att.file_path)
        except ValueError as exc:
            raise NotFoundError("NegotiationAttachment", attachment_id) from exc
        if not path.is_file():
            raise NotFoundError("NegotiationAttachment", attachment_id)
        return att, path

    # --- submit / cancel ---

    def submit_for_approval(
        self, rate_id: int, *, actor_user_id: int | None = None
    ) -> ContractorRate:
        row = self.get_rate(rate_id)
        if row.status not in ("draft", "rejected"):
            raise ConflictError(
                "Only draft or rejected rates can be submitted for approval."
            )

        # Reject overlapping windows up-front so the user doesn't waste an approval cycle.
        self._check_overlap(
            contractor_id=int(row.contractor_id),
            part_master_id=int(row.part_master_id),
            effective_from=row.effective_from,
            effective_to=row.effective_to,
            exclude_id=int(row.id),
        )

        wf = get_workflow_for_action(self._db, ACTION_CODE_CREATE)
        approval_request_id: int | None = None

        if wf is not None:
            before_status = row.status
            row.status = "pending_approval"
            req = ApprovalEngineService(self._db).create_request_for_entity(
                workflow=wf,
                entity_type=APPROVAL_ENTITY_TYPE,
                entity_id=int(row.id),
                payload={
                    "action_code": ACTION_CODE_CREATE,
                    "contractor_rate_id": int(row.id),
                    "contractor_id": int(row.contractor_id),
                    "part_master_id": int(row.part_master_id),
                    "negotiated_rate": str(row.negotiated_rate),
                    "previous_rate": str(row.previous_rate)
                    if row.previous_rate is not None
                    else None,
                    "savings_amount": str(row.savings_amount)
                    if row.savings_amount is not None
                    else None,
                    "savings_percentage": str(row.savings_percentage)
                    if row.savings_percentage is not None
                    else None,
                    "effective_from": row.effective_from.isoformat(),
                    "effective_to": row.effective_to.isoformat() if row.effective_to else None,
                },
                created_by=actor_user_id,
            )
            approval_request_id = int(req.id) if req is not None else None
            row.approval_request_id = approval_request_id

            audit_helpers.write_audit(
                self._db,
                contractor_rate_id=int(row.id),
                action=audit_helpers.ACTION_SENT_FOR_APPROVAL,
                actor_user_id=actor_user_id,
                old_value={
                    "status": before_status,
                    "negotiated_rate": str(row.negotiated_rate),
                },
                new_value={
                    "status": "pending_approval",
                    "negotiated_rate": str(row.negotiated_rate),
                },
                metadata={"approval_request_id": approval_request_id},
            )
            self._db.commit()
            self._notify("CONTRACTOR_RATE_SUBMITTED", row)
            return self.get_rate(int(row.id))

        # No workflow configured -> auto-approve the rate.
        self._activate_rate(row, actor_user_id=actor_user_id, via="auto_approved")
        self._db.commit()
        self._notify("CONTRACTOR_RATE_APPROVED", row)
        return self.get_rate(int(row.id))

    def cancel_rate(
        self, rate_id: int, *, actor_user_id: int | None = None
    ) -> ContractorRate:
        row = self.get_rate(rate_id)
        if row.status not in ("draft", "pending_approval", "rejected"):
            raise ConflictError("Only draft/pending/rejected rates can be cancelled.")
        before_status = row.status
        row.status = "cancelled"
        audit_helpers.write_audit(
            self._db,
            contractor_rate_id=int(row.id),
            action=audit_helpers.ACTION_CANCELLED,
            actor_user_id=actor_user_id,
            old_value={"status": before_status},
            new_value={"status": "cancelled"},
        )
        self._db.commit()
        return self.get_rate(int(row.id))

    # --- finalize hooks (called by approval engine) ---

    def finalize_approval(
        self, rate_id: int, *, approver_user_id: int | None, approval_request_id: int | None
    ) -> ContractorRate:
        """Called by the approval engine when the final step approves the request."""
        row = self.get_rate(rate_id)
        if row.status != "pending_approval":
            # Idempotent: if it has already been activated, do nothing.
            return row
        self._activate_rate(
            row,
            actor_user_id=approver_user_id,
            via="approval_finalized",
            approval_request_id=approval_request_id,
        )
        self._db.commit()
        self._notify("CONTRACTOR_RATE_APPROVED", row)
        return self.get_rate(int(row.id))

    def finalize_rejection(
        self,
        rate_id: int,
        *,
        rejector_user_id: int | None,
        approval_request_id: int | None,
        comment: str | None,
    ) -> ContractorRate:
        """Called by the approval engine when an approver rejects the request."""
        row = self.get_rate(rate_id)
        if row.status != "pending_approval":
            return row
        before_status = row.status
        row.status = "rejected"
        row.rejected_by = rejector_user_id
        row.rejected_at = _now_utc()
        audit_helpers.write_audit(
            self._db,
            contractor_rate_id=int(row.id),
            action=audit_helpers.ACTION_REJECTED,
            actor_user_id=rejector_user_id,
            old_value={"status": before_status},
            new_value={"status": "rejected"},
            metadata={
                "approval_request_id": approval_request_id,
                "comment": comment,
                "via": "approval_rejected",
            },
        )
        self._db.commit()
        self._notify("CONTRACTOR_RATE_REJECTED", row, extra={"reason": comment})
        return self.get_rate(int(row.id))

    # --- internal: activate (and deactivate previous) ---

    def _activate_rate(
        self,
        row: ContractorRate,
        *,
        actor_user_id: int | None,
        via: str,
        approval_request_id: int | None = None,
    ) -> None:
        # Re-check overlap right before activation in case another rate landed in the meantime.
        self._check_overlap(
            contractor_id=int(row.contractor_id),
            part_master_id=int(row.part_master_id),
            effective_from=row.effective_from,
            effective_to=row.effective_to,
            exclude_id=int(row.id),
        )

        before_status = row.status
        row.status = "approved"
        row.approved_by = actor_user_id
        row.approved_at = _now_utc()
        if approval_request_id is not None:
            row.approval_request_id = int(approval_request_id)

        # Refresh previous_rate (informational, history-only) and re-anchor savings
        # on the contractor's initial ask. ``initial_rate`` is immutable from this
        # point on; we just recompute the derived figures.
        prev = self._last_approved_rate(
            int(row.contractor_id), int(row.part_master_id), exclude_id=int(row.id)
        )
        row.previous_rate = Decimal(prev.negotiated_rate) if prev is not None else row.previous_rate
        if row.initial_rate is None:
            row.initial_rate = Decimal(row.negotiated_rate)
        row.savings_amount, row.savings_percentage = self._calc_savings(
            row.initial_rate, Decimal(row.negotiated_rate)
        )

        audit_helpers.write_audit(
            self._db,
            contractor_rate_id=int(row.id),
            action=audit_helpers.ACTION_APPROVED,
            actor_user_id=actor_user_id,
            old_value={"status": before_status},
            new_value={"status": "approved"},
            metadata={
                "via": via,
                "approval_request_id": approval_request_id or row.approval_request_id,
            },
        )

        # Deactivate the previously active rate (if any) for the same combo.
        prev_active_stmt = select(ContractorRate).where(
            ContractorRate.id != row.id,
            ContractorRate.contractor_id == row.contractor_id,
            ContractorRate.part_master_id == row.part_master_id,
            ContractorRate.status == "approved",
        )
        for prev_active in self._db.scalars(prev_active_stmt).all():
            prev_active.status = "expired"
            audit_helpers.write_audit(
                self._db,
                contractor_rate_id=int(prev_active.id),
                action=audit_helpers.ACTION_RATE_DEACTIVATED,
                actor_user_id=actor_user_id,
                old_value={"status": "approved"},
                new_value={"status": "expired"},
                metadata={
                    "via": "superseded",
                    "superseded_by": int(row.id),
                    "approval_request_id": approval_request_id,
                },
            )
            audit_helpers.write_audit(
                self._db,
                contractor_rate_id=int(prev_active.id),
                action=audit_helpers.ACTION_EXPIRED,
                actor_user_id=actor_user_id,
                old_value={"status": "approved"},
                new_value={"status": "expired"},
                metadata={"superseded_by": int(row.id)},
            )
            # 3.4: log the takeover symmetrically on both sides.
            audit_helpers.write_audit(
                self._db,
                contractor_rate_id=int(prev_active.id),
                action=audit_helpers.ACTION_RATE_REPLACED,
                actor_user_id=actor_user_id,
                old_value={"contractor_rate_id": int(prev_active.id)},
                new_value={"replaced_by_contractor_rate_id": int(row.id)},
                metadata={"superseded_by": int(row.id)},
            )

        # Final activation marker on this row (separate from the APPROVED audit so the
        # timeline can show "approved -> active" cleanly).
        audit_helpers.write_audit(
            self._db,
            contractor_rate_id=int(row.id),
            action=audit_helpers.ACTION_RATE_ACTIVATED,
            actor_user_id=actor_user_id,
            new_value={
                "status": "approved",
                "negotiated_rate": str(row.negotiated_rate),
                "effective_from": row.effective_from.isoformat(),
                "effective_to": row.effective_to.isoformat() if row.effective_to else None,
            },
            metadata={"via": via},
        )
        # Take a fresh version snapshot at activation: the row's effective
        # numbers (previous_rate, savings, status) are now finalised.
        ver = audit_helpers.write_contractor_rate_version(
            self._db,
            rate=row,
            actor_user_id=actor_user_id,
            change_reason="RATE_ACTIVATED",
        )
        audit_helpers.write_audit(
            self._db,
            contractor_rate_id=int(row.id),
            action=audit_helpers.ACTION_VERSION_CREATED,
            actor_user_id=actor_user_id,
            new_value={"version_number": int(ver.version_number)},
            metadata={"reason": "RATE_ACTIVATED"},
        )

        # Align draft/active work order lines (and thus invoices) with this negotiated rate.
        from modules.work_orders.service import WorkOrderService  # noqa: PLC0415

        WorkOrderService(self._db).sync_resolved_rates_for_contractor_part(
            contractor_id=int(row.contractor_id),
            part_master_id=int(row.part_master_id),
        )

    # --- notifications (best-effort, non-blocking) ---

    def _notify(
        self, event_code: str, row: ContractorRate, *, extra: dict[str, Any] | None = None
    ) -> None:
        """Trigger an email event. Failures are swallowed so the API call still succeeds."""
        try:
            from modules.emails.service import EmailNotificationService

            payload: dict[str, Any] = {
                "contractor_rate_id": int(row.id),
                "contractor_id": int(row.contractor_id),
                "negotiated_rate": str(row.negotiated_rate),
                "previous_rate": str(row.previous_rate)
                if row.previous_rate is not None
                else "",
                "savings_amount": str(row.savings_amount)
                if row.savings_amount is not None
                else "",
                "savings_percentage": str(row.savings_percentage)
                if row.savings_percentage is not None
                else "",
                "effective_from": row.effective_from.isoformat(),
                "effective_to": row.effective_to.isoformat() if row.effective_to else "",
                "status": row.status,
            }
            if extra:
                payload.update(extra)
            EmailNotificationService(self._db).trigger_event(event_code=event_code, payload=payload)
        except Exception:
            # Non-fatal: missing template or transport must not break the workflow.
            pass

    # --- versions / status engine ---

    def list_versions(self, rate_id: int) -> list[ContractorRateVersion]:
        self.get_rate(rate_id)
        stmt = (
            select(ContractorRateVersion)
            .where(ContractorRateVersion.contractor_rate_id == int(rate_id))
            .order_by(ContractorRateVersion.version_number.asc())
        )
        return list(self._db.scalars(stmt).all())

    @staticmethod
    def derive_status(row: ContractorRate, *, today: date | None = None) -> str:
        """Lifecycle label that respects both ``status`` and the validity window."""
        d = today or date.today()
        if row.status == "approved":
            if row.effective_from and row.effective_from > d:
                return "upcoming"
            if row.effective_to is not None and row.effective_to < d:
                return "expired"
            return "active"
        return str(row.status)

    def mark_expired(self, *, today: date | None = None, actor_user_id: int | None = None) -> int:
        """Auto-flip approved rates whose ``effective_to`` is in the past to ``expired``.

        Returns the number of rates updated. Idempotent.
        """
        d = today or date.today()
        stmt = select(ContractorRate).where(
            ContractorRate.status == "approved",
            ContractorRate.effective_to.is_not(None),
            ContractorRate.effective_to < d,
        )
        rows = list(self._db.scalars(stmt).all())
        for row in rows:
            row.status = "expired"
            audit_helpers.write_audit(
                self._db,
                contractor_rate_id=int(row.id),
                action=audit_helpers.ACTION_EXPIRED,
                actor_user_id=actor_user_id,
                old_value={"status": "approved"},
                new_value={"status": "expired"},
                metadata={"reason": "auto_expired", "today": d.isoformat()},
            )
            audit_helpers.write_contractor_rate_version(
                self._db,
                rate=row,
                actor_user_id=actor_user_id,
                change_reason="AUTO_EXPIRED",
            )
        if rows:
            self._db.commit()
        return len(rows)

    # --- aggregations / dashboard ---

    def aggregate_summary(
        self, *, scope_contractor_id: int | None = None
    ) -> dict[str, Any]:
        """Return KPI counters for a single contractor or globally for the dashboard."""
        base = select(ContractorRate)
        if scope_contractor_id is not None:
            base = base.where(ContractorRate.contractor_id == int(scope_contractor_id))

        total = int(self._db.scalar(select(func.count()).select_from(base.subquery())) or 0)
        pending = int(
            self._db.scalar(
                select(func.count()).select_from(
                    base.where(ContractorRate.status == "pending_approval").subquery()
                )
            )
            or 0
        )
        approved = int(
            self._db.scalar(
                select(func.count()).select_from(
                    base.where(ContractorRate.status == "approved").subquery()
                )
            )
            or 0
        )
        rejected = int(
            self._db.scalar(
                select(func.count()).select_from(
                    base.where(ContractorRate.status == "rejected").subquery()
                )
            )
            or 0
        )
        # Total savings = sum of savings_amount for currently approved rates.
        savings_stmt = select(func.coalesce(func.sum(ContractorRate.savings_amount), 0)).where(
            ContractorRate.status == "approved",
            ContractorRate.savings_amount.is_not(None),
        )
        if scope_contractor_id is not None:
            savings_stmt = savings_stmt.where(
                ContractorRate.contractor_id == int(scope_contractor_id)
            )
        total_savings = self._db.scalar(savings_stmt) or 0
        try:
            total_savings_dec = Decimal(total_savings)
        except Exception:
            total_savings_dec = Decimal(str(total_savings))

        # Average savings % across approved rates that have one.
        avg_pct_stmt = select(func.coalesce(func.avg(ContractorRate.savings_percentage), 0)).where(
            ContractorRate.status == "approved",
            ContractorRate.savings_percentage.is_not(None),
        )
        if scope_contractor_id is not None:
            avg_pct_stmt = avg_pct_stmt.where(
                ContractorRate.contractor_id == int(scope_contractor_id)
            )
        avg_pct = self._db.scalar(avg_pct_stmt) or 0
        try:
            avg_pct_dec = Decimal(avg_pct)
        except Exception:
            avg_pct_dec = Decimal(str(avg_pct))

        # ---- vs-base metrics (separate from negotiation savings) ----
        #
        # `vs_base` = negotiated_rate - base_rate per approved row. Positive
        # means we're paying above the procurement baseline (a "premium"),
        # negative means below (rare). We sum the positives separately so the
        # dashboard can show "Premium paid above base" alongside negotiation
        # savings without one cancelling the other.
        approved_with_rm_stmt = (
            select(
                ContractorRate.id.label("rate_id"),
                ContractorRate.negotiated_rate,
                PartMaster.base_rate,
            )
            .join(PartMaster, PartMaster.id == ContractorRate.part_master_id)
            .where(ContractorRate.status == "approved")
        )
        if scope_contractor_id is not None:
            approved_with_rm_stmt = approved_with_rm_stmt.where(
                ContractorRate.contractor_id == int(scope_contractor_id)
            )
        approved_above_base = 0
        approved_below_base = 0
        approved_at_base = 0
        total_premium = Decimal("0")
        total_below = Decimal("0")
        for row in self._db.execute(approved_with_rm_stmt).all():
            negotiated = Decimal(row.negotiated_rate)
            base = Decimal(row.base_rate) if row.base_rate is not None else None
            if base is None:
                continue
            diff = negotiated - base
            if diff > Decimal("0"):
                approved_above_base += 1
                total_premium += diff
            elif diff < Decimal("0"):
                approved_below_base += 1
                total_below += diff  # negative
            else:
                approved_at_base += 1

        return {
            "total_negotiations": total,
            "pending_approvals": pending,
            "approved": approved,
            "rejected": rejected,
            "total_savings": _q2(total_savings_dec) if total_savings_dec else Decimal("0.00"),
            "avg_savings_percentage": _q4(avg_pct_dec) if avg_pct_dec else Decimal("0.00"),
            # New "vs base" KPIs — see docstring above.
            "total_premium_above_base": _q2(total_premium),
            "total_below_base_savings": _q2(total_below.copy_abs()),
            "approved_above_base": int(approved_above_base),
            "approved_below_base": int(approved_below_base),
            "approved_at_base": int(approved_at_base),
        }
