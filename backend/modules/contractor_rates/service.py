"""Contractor rate / negotiation service layer.

All mutations go through these methods so audit logs, savings recomputation, and
approval-engine integration stay consistent.

Business invariants enforced here:

* Only one ACTIVE (``status='approved'``) ``contractor_rate`` can exist per
  ``(contractor_id, rate_master_id)`` at a time.
* Approving a rate auto-deactivates any previously approved rate for the same
  ``(contractor_id, rate_master_id)`` (sets ``status='expired'`` and writes
  ``RATE_DEACTIVATED`` + ``EXPIRED`` audit rows on it).
* ``effective_from <= effective_to`` for both rate_master and contractor_rate.
* Overlapping date ranges are rejected at submission time.
* Audit log written on EVERY mutation (create / update / round / submit / approve /
  reject / cancel / activation / deactivation).
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
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
    NegotiationLog,
    RateMaster,
    RateMasterAuditLog,
    RateMasterVersion,
)
from modules.contractor_rates.schema import (
    ContractorRateCreate,
    ContractorRateUpdate,
    NegotiationRoundCreate,
    RateMasterCreate,
    RateMasterUpdate,
)
from modules.errors import ConflictError, NotFoundError
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


# ---------- Rate master ----------


class RateMasterService:
    def __init__(self, db: Session) -> None:
        self._db = db

    # --- helpers ---

    def _ensure_plant(self, org_unit_id: int) -> OrgUnit:
        org = self._db.get(OrgUnit, int(org_unit_id))
        if org is None:
            raise NotFoundError("OrgUnit", org_unit_id)
        if getattr(org, "type", None) and str(org.type).upper() != "PLANT":
            raise ConflictError("rate_master can only be defined for org_units with type=PLANT.")
        return org

    @staticmethod
    def _validate_dates(effective_from: date, effective_to: date | None) -> None:
        if effective_to is not None and effective_from > effective_to:
            raise ConflictError("effective_from must be on or before effective_to.")

    def _check_overlap(
        self,
        *,
        job_type: str,
        skill_type: str,
        unit: str,
        org_unit_id: int,
        effective_from: date,
        effective_to: date | None,
        exclude_id: int | None = None,
    ) -> None:
        """Strict 3.4 validity rule for **rate_master**.

        Overlap is rejected for the same (job_type, skill_type, unit, plant) when
        a candidate window collides with an existing **active** row's window.
        Two intervals [a, b] and [c, d] overlap iff a <= d and c <= b. An
        open-ended ``effective_to`` is treated as infinity.
        """
        from datetime import date as _date

        stmt = select(RateMaster).where(
            RateMaster.job_type == job_type.strip(),
            RateMaster.skill_type == skill_type,
            RateMaster.unit == unit,
            RateMaster.org_unit_id == int(org_unit_id),
            RateMaster.is_active.is_(True),
        )
        if exclude_id is not None:
            stmt = stmt.where(RateMaster.id != int(exclude_id))

        for other in self._db.scalars(stmt).all():
            other_to = other.effective_to or _date(9999, 12, 31)
            cand_to = effective_to or _date(9999, 12, 31)
            if effective_from <= other_to and other.effective_from <= cand_to:
                raise ConflictError(
                    "An active base rate already exists for this "
                    "job/skill/unit/plant in the requested date range."
                )

    def _public_dict(self, row: RateMaster) -> dict[str, Any]:
        org = self._db.get(OrgUnit, int(row.org_unit_id)) if row.org_unit_id else None
        return {
            "id": int(row.id),
            "job_type": row.job_type,
            "skill_type": row.skill_type,
            "unit": row.unit,
            "base_rate": Decimal(row.base_rate or 0),
            "org_unit_id": int(row.org_unit_id),
            "org_unit_name": org.name if org else None,
            "effective_from": row.effective_from,
            "effective_to": row.effective_to,
            "is_active": bool(row.is_active),
            "notes": row.notes,
            "created_by": row.created_by,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    # --- CRUD ---

    def list_rate_masters(
        self,
        *,
        org_unit_id: int | None = None,
        job_type: str | None = None,
        skill_type: str | None = None,
        unit: str | None = None,
        active_only: bool = False,
    ) -> list[RateMaster]:
        stmt = select(RateMaster)
        if org_unit_id is not None:
            stmt = stmt.where(RateMaster.org_unit_id == int(org_unit_id))
        if job_type:
            stmt = stmt.where(RateMaster.job_type.ilike(f"%{job_type.strip()}%"))
        if skill_type:
            stmt = stmt.where(RateMaster.skill_type == skill_type.strip().lower())
        if unit:
            stmt = stmt.where(RateMaster.unit == unit.strip().lower())
        if active_only:
            stmt = stmt.where(RateMaster.is_active.is_(True))
        stmt = stmt.order_by(RateMaster.created_at.desc())
        return list(self._db.scalars(stmt).all())

    def get_rate_master(self, rate_master_id: int) -> RateMaster:
        row = self._db.get(RateMaster, int(rate_master_id))
        if row is None:
            raise NotFoundError("RateMaster", rate_master_id)
        return row

    def list_audit_logs(self, rate_master_id: int) -> list[dict[str, Any]]:
        """Return audit rows for one base rate, oldest → newest, with actor names."""
        # Touch the row first so we get a 404 for unknown ids rather than ``[]``.
        self.get_rate_master(rate_master_id)
        stmt = (
            select(RateMasterAuditLog)
            .where(RateMasterAuditLog.rate_master_id == int(rate_master_id))
            .order_by(RateMasterAuditLog.created_at.asc(), RateMasterAuditLog.id.asc())
        )
        rows = list(self._db.scalars(stmt).all())
        out: list[dict[str, Any]] = []
        for r in rows:
            actor_name: str | None = None
            if r.changed_by is not None:
                user = self._db.get(User, int(r.changed_by))
                actor_name = getattr(user, "full_name", None) if user else None
            out.append(
                {
                    "id": int(r.id),
                    "rate_master_id": int(r.rate_master_id),
                    "action": r.action,
                    "changed_by": r.changed_by,
                    "changed_by_name": actor_name,
                    "old_value": r.old_value,
                    "new_value": r.new_value,
                    "metadata_json": r.metadata_json,
                    "created_at": r.created_at,
                }
            )
        return out

    def create_rate_master(
        self, payload: RateMasterCreate, *, actor_user_id: int | None = None
    ) -> RateMaster:
        self._ensure_plant(int(payload.org_unit_id))
        self._validate_dates(payload.effective_from, payload.effective_to)

        # Strict 3.4 validity: when activating, the candidate window cannot
        # overlap any active row for the same combo. Existing active rows for
        # the same combo are superseded (deactivated) below to satisfy "only
        # one active rate at a time" — overlap is checked against ranges, not
        # just ``effective_from``.
        if payload.is_active:
            # Pre-check: find an *active* row for the same combo whose window
            # collides with [payload.effective_from, payload.effective_to].
            # Note: when the new row's effective_from > previous row's range we
            # still allow this (the previous row is superseded below). The only
            # truly invalid case is when a future row's range starts BEFORE
            # the new range begins and extends INTO it — which is the literal
            # definition of overlap that we reject here.
            from datetime import date as _date
            stmt = select(RateMaster).where(
                RateMaster.job_type == payload.job_type.strip(),
                RateMaster.skill_type == payload.skill_type,
                RateMaster.unit == payload.unit,
                RateMaster.org_unit_id == int(payload.org_unit_id),
                RateMaster.is_active.is_(True),
                RateMaster.effective_from > payload.effective_from,
            )
            for fut in self._db.scalars(stmt).all():
                fut_to = fut.effective_to or _date(9999, 12, 31)
                cand_to = payload.effective_to or _date(9999, 12, 31)
                if payload.effective_from <= fut_to and fut.effective_from <= cand_to:
                    raise ConflictError(
                        "Overlapping base rate exists for this "
                        "job/skill/unit/plant in the requested date range."
                    )

        # Deactivate any existing active row for the same combo so that
        # "is_active=True" remains unique per combo. Each superseded row gets
        # its own audit entry so the timeline is complete.
        superseded_ids: list[int] = []
        if payload.is_active:
            stmt = select(RateMaster).where(
                RateMaster.job_type == payload.job_type.strip(),
                RateMaster.skill_type == payload.skill_type,
                RateMaster.unit == payload.unit,
                RateMaster.org_unit_id == int(payload.org_unit_id),
                RateMaster.is_active.is_(True),
            )
            for prev in self._db.scalars(stmt).all():
                before = audit_helpers.snapshot_rate_master(prev)
                prev.is_active = False
                self._db.flush()
                after = audit_helpers.snapshot_rate_master(prev)
                old_d, new_d = audit_helpers.diff_dicts(before, after)
                audit_helpers.write_rate_master_audit(
                    self._db,
                    rate_master_id=int(prev.id),
                    action=audit_helpers.RM_ACTION_SUPERSEDED,
                    actor_user_id=actor_user_id,
                    old_value=old_d,
                    new_value=new_d,
                )
                superseded_ids.append(int(prev.id))

        row = RateMaster(
            job_type=payload.job_type.strip(),
            skill_type=payload.skill_type,
            unit=payload.unit,
            base_rate=Decimal(payload.base_rate),
            org_unit_id=int(payload.org_unit_id),
            effective_from=payload.effective_from,
            effective_to=payload.effective_to,
            is_active=bool(payload.is_active),
            notes=(payload.notes or None),
            created_by=actor_user_id,
        )
        self._db.add(row)
        self._db.flush()

        audit_helpers.write_rate_master_audit(
            self._db,
            rate_master_id=int(row.id),
            action=audit_helpers.RM_ACTION_CREATED,
            actor_user_id=actor_user_id,
            new_value=audit_helpers.snapshot_rate_master(row),
            metadata={"superseded_ids": superseded_ids} if superseded_ids else None,
        )
        # v1 snapshot for the time-travel UI.
        audit_helpers.write_rate_master_version(
            self._db,
            rate=row,
            actor_user_id=actor_user_id,
            change_reason=audit_helpers.RM_ACTION_CREATED,
        )
        audit_helpers.write_rate_master_audit(
            self._db,
            rate_master_id=int(row.id),
            action=audit_helpers.ACTION_VERSION_CREATED,
            actor_user_id=actor_user_id,
            new_value={"version_number": 1},
            metadata={"reason": audit_helpers.RM_ACTION_CREATED},
        )
        # If we superseded a previously-active row for the same combo, log
        # RATE_REPLACED on the new row so the standardised diff timeline is
        # explicit about the takeover.
        if superseded_ids:
            audit_helpers.write_rate_master_audit(
                self._db,
                rate_master_id=int(row.id),
                action=audit_helpers.ACTION_RATE_REPLACED,
                actor_user_id=actor_user_id,
                new_value={"replaced_rate_master_ids": superseded_ids},
                metadata={"superseded_ids": superseded_ids},
            )

        self._db.commit()
        self._db.refresh(row)
        return row

    def update_rate_master(
        self,
        rate_master_id: int,
        payload: RateMasterUpdate,
        *,
        actor_user_id: int | None = None,
    ) -> RateMaster:
        row = self.get_rate_master(rate_master_id)
        before = audit_helpers.snapshot_rate_master(row)
        upd = payload.model_dump(exclude_unset=True)
        activation_change: str | None = None  # "ACTIVATED" / "DEACTIVATED"
        superseded_ids: list[int] = []

        if "base_rate" in upd and upd["base_rate"] is not None:
            row.base_rate = Decimal(upd["base_rate"])
        if "effective_from" in upd and upd["effective_from"] is not None:
            row.effective_from = upd["effective_from"]
        if "effective_to" in upd:
            row.effective_to = upd["effective_to"]
        if "notes" in upd:
            row.notes = upd["notes"] or None
        if "is_active" in upd and upd["is_active"] is not None:
            new_active = bool(upd["is_active"])
            # Activating? Deactivate other actives for the same combo first.
            if new_active and not row.is_active:
                activation_change = audit_helpers.RM_ACTION_ACTIVATED
                stmt = select(RateMaster).where(
                    RateMaster.id != row.id,
                    RateMaster.job_type == row.job_type,
                    RateMaster.skill_type == row.skill_type,
                    RateMaster.unit == row.unit,
                    RateMaster.org_unit_id == row.org_unit_id,
                    RateMaster.is_active.is_(True),
                )
                for prev in self._db.scalars(stmt).all():
                    prev_before = audit_helpers.snapshot_rate_master(prev)
                    prev.is_active = False
                    self._db.flush()
                    prev_after = audit_helpers.snapshot_rate_master(prev)
                    old_d, new_d = audit_helpers.diff_dicts(prev_before, prev_after)
                    audit_helpers.write_rate_master_audit(
                        self._db,
                        rate_master_id=int(prev.id),
                        action=audit_helpers.RM_ACTION_SUPERSEDED,
                        actor_user_id=actor_user_id,
                        old_value=old_d,
                        new_value=new_d,
                    )
                    superseded_ids.append(int(prev.id))
            elif not new_active and row.is_active:
                activation_change = audit_helpers.RM_ACTION_DEACTIVATED
            row.is_active = new_active

        self._validate_dates(row.effective_from, row.effective_to)

        # Re-check overlap if the candidate window changed AND the row remains
        # active. Strict 3.4 validity rule.
        if row.is_active and (
            "effective_from" in upd or "effective_to" in upd or activation_change == audit_helpers.RM_ACTION_ACTIVATED
        ):
            self._check_overlap(
                job_type=row.job_type,
                skill_type=row.skill_type,
                unit=row.unit,
                org_unit_id=int(row.org_unit_id),
                effective_from=row.effective_from,
                effective_to=row.effective_to,
                exclude_id=int(row.id),
            )

        self._db.flush()

        after = audit_helpers.snapshot_rate_master(row)
        old_d, new_d = audit_helpers.diff_dicts(before, after)
        if old_d or new_d:
            audit_helpers.write_rate_master_audit(
                self._db,
                rate_master_id=int(row.id),
                action=audit_helpers.RM_ACTION_UPDATED,
                actor_user_id=actor_user_id,
                old_value=old_d,
                new_value=new_d,
            )
            # If the validity window was the (only) thing that changed, also
            # log VALIDITY_CHANGED so reports / filters can pick it up cleanly.
            validity_keys = {"effective_from", "effective_to"}
            if validity_keys & set(new_d.keys()):
                audit_helpers.write_rate_master_audit(
                    self._db,
                    rate_master_id=int(row.id),
                    action=audit_helpers.ACTION_VALIDITY_CHANGED,
                    actor_user_id=actor_user_id,
                    old_value={k: old_d.get(k) for k in validity_keys if k in old_d},
                    new_value={k: new_d.get(k) for k in validity_keys if k in new_d},
                )
            # Snapshot the new state. Snapshots are immutable; this guarantees
            # full time-travel even when audit diffs are field-scoped.
            ver = audit_helpers.write_rate_master_version(
                self._db,
                rate=row,
                actor_user_id=actor_user_id,
                change_reason=audit_helpers.RM_ACTION_UPDATED,
            )
            audit_helpers.write_rate_master_audit(
                self._db,
                rate_master_id=int(row.id),
                action=audit_helpers.ACTION_VERSION_CREATED,
                actor_user_id=actor_user_id,
                new_value={"version_number": int(ver.version_number)},
                metadata={"reason": audit_helpers.RM_ACTION_UPDATED},
            )
        if activation_change is not None:
            audit_helpers.write_rate_master_audit(
                self._db,
                rate_master_id=int(row.id),
                action=activation_change,
                actor_user_id=actor_user_id,
                new_value={"is_active": row.is_active},
                metadata={"superseded_ids": superseded_ids} if superseded_ids else None,
            )
            if superseded_ids:
                audit_helpers.write_rate_master_audit(
                    self._db,
                    rate_master_id=int(row.id),
                    action=audit_helpers.ACTION_RATE_REPLACED,
                    actor_user_id=actor_user_id,
                    new_value={"replaced_rate_master_ids": superseded_ids},
                    metadata={"superseded_ids": superseded_ids},
                )

        self._db.commit()
        self._db.refresh(row)
        return row

    # --- versions / status engine ---

    def list_versions(self, rate_master_id: int) -> list[RateMasterVersion]:
        self.get_rate_master(rate_master_id)
        stmt = (
            select(RateMasterVersion)
            .where(RateMasterVersion.rate_master_id == int(rate_master_id))
            .order_by(RateMasterVersion.version_number.asc())
        )
        return list(self._db.scalars(stmt).all())

    @staticmethod
    def derive_status(row: RateMaster, *, today: date | None = None) -> str:
        """Derive a human-friendly lifecycle status without overwriting ``is_active``.

        Returns one of ``upcoming`` / ``active`` / ``expired`` / ``inactive``.
        """
        d = today or date.today()
        if not bool(row.is_active):
            return "inactive"
        if row.effective_from and row.effective_from > d:
            return "upcoming"
        if row.effective_to is not None and row.effective_to < d:
            return "expired"
        return "active"

    def mark_expired(self, *, today: date | None = None, actor_user_id: int | None = None) -> int:
        """Auto-flip rows whose ``effective_to`` is in the past to ``is_active=False``.

        Returns the number of rows updated. Idempotent — safe to run on a cron.
        """
        d = today or date.today()
        stmt = select(RateMaster).where(
            RateMaster.is_active.is_(True),
            RateMaster.effective_to.is_not(None),
            RateMaster.effective_to < d,
        )
        rows = list(self._db.scalars(stmt).all())
        for row in rows:
            before = audit_helpers.snapshot_rate_master(row)
            row.is_active = False
            self._db.flush()
            after = audit_helpers.snapshot_rate_master(row)
            old_d, new_d = audit_helpers.diff_dicts(before, after)
            audit_helpers.write_rate_master_audit(
                self._db,
                rate_master_id=int(row.id),
                action=audit_helpers.RM_ACTION_DEACTIVATED,
                actor_user_id=actor_user_id,
                old_value=old_d,
                new_value=new_d,
                metadata={"reason": "auto_expired", "today": d.isoformat()},
            )
            audit_helpers.write_rate_master_version(
                self._db,
                rate=row,
                actor_user_id=actor_user_id,
                change_reason="AUTO_EXPIRED",
            )
        if rows:
            self._db.commit()
        return len(rows)


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

    def _ensure_rate_master(self, rate_master_id: int) -> RateMaster:
        rm = self._db.get(RateMaster, int(rate_master_id))
        if rm is None:
            raise NotFoundError("RateMaster", rate_master_id)
        return rm

    @staticmethod
    def _validate_dates(effective_from: date, effective_to: date | None) -> None:
        if effective_to is not None and effective_from > effective_to:
            raise ConflictError("effective_from must be on or before effective_to.")

    def _last_approved_rate(
        self, contractor_id: int, rate_master_id: int, *, exclude_id: int | None = None
    ) -> ContractorRate | None:
        """Most recently approved rate for this (contractor, rate_master) pair."""
        stmt = (
            select(ContractorRate)
            .where(
                ContractorRate.contractor_id == int(contractor_id),
                ContractorRate.rate_master_id == int(rate_master_id),
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
        rate_master_id: int,
        effective_from: date,
        effective_to: date | None,
        exclude_id: int | None = None,
    ) -> None:
        """Reject when a candidate window collides with an already-approved range
        for the same (contractor, rate_master).

        Two intervals [a, b] and [c, d] overlap iff a <= d and c <= b. We treat
        an open-ended ``effective_to`` as "infinity".
        """
        from datetime import date as _date

        stmt = select(ContractorRate).where(
            ContractorRate.contractor_id == int(contractor_id),
            ContractorRate.rate_master_id == int(rate_master_id),
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

    # --- public-shape helper ---

    def to_public_dict(self, row: ContractorRate, *, include_rounds: bool = True) -> dict[str, Any]:
        """Build the shape returned by the API (joins contractor + rate master + plant)."""
        contractor = self._db.get(Contractor, int(row.contractor_id))
        rm = self._db.get(RateMaster, int(row.rate_master_id))
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
                    "created_by": r.created_by,
                    "created_by_name": (
                        self._db.get(User, int(r.created_by)).full_name
                        if r.created_by
                        else None
                    ),
                    "created_at": r.created_at,
                }
                for r in row.negotiation_logs
            ]

        return {
            "id": int(row.id),
            "contractor_id": int(row.contractor_id),
            "contractor_name": contractor.name if contractor else None,
            "rate_master_id": int(row.rate_master_id),
            "job_type": rm.job_type if rm else None,
            "skill_type": rm.skill_type if rm else None,
            "unit": rm.unit if rm else None,
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
        rate_master_id: int | None = None,
        org_unit_id: int | None = None,
        job_type: str | None = None,
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
        if rate_master_id is not None:
            stmt = stmt.where(ContractorRate.rate_master_id == int(rate_master_id))
        if org_unit_id is not None or job_type:
            stmt = stmt.join(RateMaster, RateMaster.id == ContractorRate.rate_master_id)
            if org_unit_id is not None:
                stmt = stmt.where(RateMaster.org_unit_id == int(org_unit_id))
            if job_type:
                stmt = stmt.where(RateMaster.job_type.ilike(f"%{job_type.strip()}%"))
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
        rm = self._ensure_rate_master(int(payload.rate_master_id))
        self._validate_dates(payload.effective_from, payload.effective_to)

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
            rate_master_id=int(rm.id),
            negotiated_rate=Decimal(payload.negotiated_rate),
            initial_rate=initial_rate,
            previous_rate=previous_rate,
            savings_amount=savings_amount,
            savings_percentage=savings_pct,
            effective_from=payload.effective_from,
            effective_to=payload.effective_to,
            status="draft",
            current_round=0,
            remarks=(payload.remarks or None),
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
                "rate_master_id": int(row.rate_master_id),
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

        next_round = int(row.current_round or 0) + 1
        log = NegotiationLog(
            contractor_rate_id=int(row.id),
            round_number=next_round,
            proposed_rate=payload.proposed_rate,
            counter_rate=payload.counter_rate,
            remarks=payload.remarks or None,
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
            rate_master_id=int(row.rate_master_id),
            effective_from=row.effective_from,
            effective_to=row.effective_to,
            exclude_id=int(row.id),
        )

        wf = get_workflow_for_action(self._db, ACTION_CODE_CREATE)
        approval_request_id: int | None = None

        if wf is not None:
            row.status = "pending_approval"
            req = ApprovalEngineService(self._db).create_request_for_entity(
                workflow=wf,
                entity_type=APPROVAL_ENTITY_TYPE,
                entity_id=int(row.id),
                payload={
                    "action_code": ACTION_CODE_CREATE,
                    "contractor_rate_id": int(row.id),
                    "contractor_id": int(row.contractor_id),
                    "rate_master_id": int(row.rate_master_id),
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
                new_value={"status": "pending_approval"},
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
            rate_master_id=int(row.rate_master_id),
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
            int(row.contractor_id), int(row.rate_master_id), exclude_id=int(row.id)
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
            ContractorRate.rate_master_id == row.rate_master_id,
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
                RateMaster.base_rate,
            )
            .join(RateMaster, RateMaster.id == ContractorRate.rate_master_id)
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
