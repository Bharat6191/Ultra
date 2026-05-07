"""Unified Rate Card view (3.4 Rate Master & Benchmark Control).

This is intentionally a derived view (no new table). Each row joins:

* one ``rate_master`` (the plant + job/skill/unit baseline)
* an optional active or most-recent ``contractor_rates`` row for the requested
  contractor
* the previous approved ``contractor_rates`` row for the pair (for variance)

Returned shape mirrors the spec:

  base_rate, contractor_rate (current_active_rate), previous_rate,
  variance % / amount, effective dates, status

Status engine:

  * ``active``   – approved + today is inside the validity window
  * ``upcoming`` – approved but ``effective_from`` is in the future
  * ``expired`` – ``effective_to`` is in the past (or status='expired')
  * ``inactive`` – everything else (no contractor rate, draft, rejected, etc.)
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from modules.contractor.models import Contractor
from modules.contractor_rates.models import ContractorRate, RateMaster
from modules.contractor_rates.service import ContractorRateService, RateMasterService
from modules.errors import NotFoundError
from modules.org_units.model import OrgUnit


def _q2(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _pick_current_contractor_rate_from_rows(
    rates: list[ContractorRate], today: date
) -> ContractorRate | None:
    """Mirror ``_current_contractor_rate`` selection using in-memory rows."""
    if not rates:
        return None
    active = [
        r
        for r in rates
        if r.status == "approved"
        and r.effective_from <= today
        and (r.effective_to is None or r.effective_to >= today)
    ]
    if active:
        return sorted(active, key=lambda r: (r.effective_from, r.id), reverse=True)[0]
    hist = [r for r in rates if r.status in ("approved", "expired")]
    if hist:
        return sorted(hist, key=lambda r: (r.effective_from, r.id), reverse=True)[0]
    return sorted(rates, key=lambda r: (r.updated_at, r.id), reverse=True)[0]


def _pick_previous_contractor_rate_from_rows(
    rates: list[ContractorRate], current: ContractorRate | None
) -> ContractorRate | None:
    """Mirror ``_previous_contractor_rate`` ordering using in-memory rows."""
    if current is None:
        return None
    cands = [r for r in rates if r.status in ("approved", "expired") and r.id != current.id]
    if not cands:
        return None

    def key(r: ContractorRate) -> tuple:
        ap = r.approved_at
        # Prefer approved_at (newest first); NULLs sort last vs dated rows.
        if ap is None:
            return (0, datetime.min.replace(tzinfo=timezone.utc), r.effective_from, r.id)
        return (1, ap, r.effective_from, r.id)

    return max(cands, key=key)


@dataclass
class NegotiatedRateSummary:
    """One contractor's current negotiated slot against a single rate master."""

    contractor_id: int
    contractor_name: str
    contractor_rate_id: int
    negotiated_rate: Decimal
    previous_rate: Decimal | None
    contractor_rate_status: str | None
    contractor_rate_effective_from: date | None
    contractor_rate_effective_to: date | None
    vs_base_amount: Decimal | None
    vs_base_percentage: Decimal | None
    vs_previous_amount: Decimal | None
    vs_previous_percentage: Decimal | None


@dataclass
class RateCardRow:
    rate_master_id: int
    job_type: str
    skill_type: str
    unit: str
    org_unit_id: int
    org_unit_name: str | None
    base_rate: Decimal
    base_rate_status: str
    base_rate_is_active: bool
    base_rate_effective_from: date
    base_rate_effective_to: date | None
    notes: str | None

    contractor_id: int | None
    contractor_name: str | None
    contractor_rate_id: int | None
    contractor_rate: Decimal | None
    previous_rate: Decimal | None
    contractor_rate_status: str | None
    contractor_rate_effective_from: date | None
    contractor_rate_effective_to: date | None

    # Benchmarks (signed):
    #   negative => below the comparator (saving)
    #   positive => above the comparator (premium / increase)
    vs_base_amount: Decimal | None
    vs_base_percentage: Decimal | None
    vs_previous_amount: Decimal | None
    vs_previous_percentage: Decimal | None

    negotiations: list[NegotiatedRateSummary] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d.pop("negotiations", None)
        out: dict[str, Any] = {}
        for k, v in d.items():
            if isinstance(v, Decimal):
                out[k] = str(v)
            else:
                out[k] = v
        serial_negs: list[dict[str, Any]] = []
        for n in self.negotiations:
            nd = asdict(n)
            for nk, nv in nd.items():
                if isinstance(nv, Decimal):
                    nd[nk] = str(nv)
            serial_negs.append(nd)
        out["negotiations"] = serial_negs
        return out


class RateCardService:
    """Builds the derived Rate Card view from existing tables."""

    def __init__(self, db: Session) -> None:
        self._db = db
        self._rm_svc = RateMasterService(db)
        self._rate_svc = ContractorRateService(db)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _current_contractor_rate(
        self, contractor_id: int, rate_master_id: int, today: date
    ) -> ContractorRate | None:
        """Most relevant contractor rate for a (contractor, rate_master).

        Preference order:
          1. ``approved`` row whose validity window contains ``today``.
          2. ``approved`` row whose ``effective_from`` is the latest in the past.
          3. Most recently updated row of any status.
        """
        # 1) currently active
        active_stmt = (
            select(ContractorRate)
            .where(
                ContractorRate.contractor_id == int(contractor_id),
                ContractorRate.rate_master_id == int(rate_master_id),
                ContractorRate.status == "approved",
                ContractorRate.effective_from <= today,
                or_(
                    ContractorRate.effective_to.is_(None),
                    ContractorRate.effective_to >= today,
                ),
            )
            .order_by(ContractorRate.effective_from.desc(), ContractorRate.id.desc())
            .limit(1)
        )
        row = self._db.scalar(active_stmt)
        if row is not None:
            return row

        # 2) most recent approved (past or future)
        approved_stmt = (
            select(ContractorRate)
            .where(
                ContractorRate.contractor_id == int(contractor_id),
                ContractorRate.rate_master_id == int(rate_master_id),
                ContractorRate.status.in_(("approved", "expired")),
            )
            .order_by(ContractorRate.effective_from.desc(), ContractorRate.id.desc())
            .limit(1)
        )
        row = self._db.scalar(approved_stmt)
        if row is not None:
            return row

        # 3) anything
        any_stmt = (
            select(ContractorRate)
            .where(
                ContractorRate.contractor_id == int(contractor_id),
                ContractorRate.rate_master_id == int(rate_master_id),
            )
            .order_by(ContractorRate.updated_at.desc(), ContractorRate.id.desc())
            .limit(1)
        )
        return self._db.scalar(any_stmt)

    def _previous_contractor_rate(
        self,
        contractor_id: int,
        rate_master_id: int,
        *,
        before_id: int | None,
    ) -> ContractorRate | None:
        stmt = (
            select(ContractorRate)
            .where(
                ContractorRate.contractor_id == int(contractor_id),
                ContractorRate.rate_master_id == int(rate_master_id),
                ContractorRate.status.in_(("approved", "expired")),
            )
            .order_by(
                ContractorRate.approved_at.desc().nullslast(),
                ContractorRate.effective_from.desc(),
                ContractorRate.id.desc(),
            )
        )
        if before_id is not None:
            stmt = stmt.where(ContractorRate.id != int(before_id))
        return self._db.scalar(stmt.limit(1))

    @staticmethod
    def _variance(
        negotiated: Decimal | None, baseline: Decimal | None
    ) -> tuple[Decimal | None, Decimal | None]:
        if negotiated is None or baseline is None or Decimal(baseline) == Decimal("0"):
            return None, None
        amount = _q2(Decimal(negotiated) - Decimal(baseline))
        pct = _q2((amount / Decimal(baseline)) * Decimal("100"))
        return amount, pct

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_rate_card(
        self,
        *,
        plant_id: int | None = None,
        contractor_id: int | None = None,
        rate_master_id: int | None = None,
        job_type: str | None = None,
        skill_type: str | None = None,
        unit: str | None = None,
        active_base_only: bool = True,
        today: date | None = None,
    ) -> list[RateCardRow]:
        """Build the unified rate card.

        Filters:
            plant_id        – limit to one plant
            contractor_id   – join the named contractor's negotiated rate
            rate_master_id  – return exactly this base rate row (ignores ``active_base_only``)
            job_type        – ``ilike '%...%'``
            skill_type      – exact (lower-cased)
            unit            – exact (lower-cased)
            active_base_only– only include base rates that are currently active
                              (default True; pass False to also see retired bases)
        """
        d = today or date.today()

        # Contractor existence check (so the API can return 404 cleanly).
        contractor_obj: Contractor | None = None
        if contractor_id is not None:
            contractor_obj = self._db.get(Contractor, int(contractor_id))
            if contractor_obj is None:
                raise NotFoundError("Contractor", contractor_id)

        rm_stmt = select(RateMaster)
        if rate_master_id is not None:
            rm_stmt = rm_stmt.where(RateMaster.id == int(rate_master_id))
        else:
            if plant_id is not None:
                rm_stmt = rm_stmt.where(RateMaster.org_unit_id == int(plant_id))
            if job_type:
                rm_stmt = rm_stmt.where(RateMaster.job_type.ilike(f"%{job_type.strip()}%"))
            if skill_type:
                rm_stmt = rm_stmt.where(RateMaster.skill_type == skill_type.strip().lower())
            if unit:
                rm_stmt = rm_stmt.where(RateMaster.unit == unit.strip().lower())
            if active_base_only:
                rm_stmt = rm_stmt.where(RateMaster.is_active.is_(True))
        rm_stmt = rm_stmt.order_by(
            RateMaster.org_unit_id.asc(),
            RateMaster.job_type.asc(),
            RateMaster.skill_type.asc(),
            RateMaster.unit.asc(),
            RateMaster.effective_from.desc(),
        )
        rate_masters = list(self._db.scalars(rm_stmt).all())

        rm_ids = [int(rm.id) for rm in rate_masters]
        cr_bucket: dict[int, dict[int, list[ContractorRate]]] = {}
        contractor_names: dict[int, str] = {}
        if contractor_obj is None and rm_ids:
            stmt = (
                select(ContractorRate, Contractor.name)
                .join(Contractor, ContractorRate.contractor_id == Contractor.id)
                .where(ContractorRate.rate_master_id.in_(rm_ids))
            )
            for cr, cname in self._db.execute(stmt).all():
                cid = int(cr.contractor_id)
                contractor_names[cid] = str(cname)
                cr_bucket.setdefault(int(cr.rate_master_id), {}).setdefault(cid, []).append(cr)

        plant_cache: dict[int, OrgUnit] = {}

        out: list[RateCardRow] = []
        for rm in rate_masters:
            org = plant_cache.get(int(rm.org_unit_id))
            if org is None:
                org = self._db.get(OrgUnit, int(rm.org_unit_id))
                if org is not None:
                    plant_cache[int(rm.org_unit_id)] = org

            cr: ContractorRate | None = None
            cr_status: str | None = None
            cr_rate: Decimal | None = None
            cr_prev: Decimal | None = None
            cr_id: int | None = None
            cr_from: date | None = None
            cr_to: date | None = None
            contractor_name: str | None = None

            if contractor_obj is not None:
                cr = self._current_contractor_rate(int(contractor_obj.id), int(rm.id), d)
                if cr is not None:
                    cr_id = int(cr.id)
                    cr_rate = Decimal(cr.negotiated_rate)
                    cr_status = self._rate_svc.derive_status(cr, today=d)
                    cr_from = cr.effective_from
                    cr_to = cr.effective_to
                    contractor_name = contractor_obj.name
                    prev = self._previous_contractor_rate(
                        int(contractor_obj.id), int(rm.id), before_id=int(cr.id)
                    )
                    cr_prev = (
                        Decimal(prev.negotiated_rate) if prev is not None else cr.previous_rate
                    )
                else:
                    contractor_name = contractor_obj.name

            negotiations: list[NegotiatedRateSummary] = []
            if contractor_obj is None:
                bucket = cr_bucket.get(int(rm.id), {})
                for cid in sorted(bucket.keys(), key=lambda i: contractor_names.get(i, "").lower()):
                    rates_list = bucket[cid]
                    cr_pick = _pick_current_contractor_rate_from_rows(rates_list, d)
                    if cr_pick is None:
                        continue
                    prev_pick = _pick_previous_contractor_rate_from_rows(rates_list, cr_pick)
                    if prev_pick is not None:
                        cr_prev_neg = Decimal(prev_pick.negotiated_rate)
                    elif cr_pick.previous_rate is not None:
                        cr_prev_neg = Decimal(cr_pick.previous_rate)
                    else:
                        cr_prev_neg = None
                    cr_rate_neg = Decimal(cr_pick.negotiated_rate)
                    st_neg = self._rate_svc.derive_status(cr_pick, today=d)
                    vb_amt, vb_pct = self._variance(cr_rate_neg, Decimal(rm.base_rate))
                    vp_amt, vp_pct = self._variance(cr_rate_neg, cr_prev_neg)
                    negotiations.append(
                        NegotiatedRateSummary(
                            contractor_id=cid,
                            contractor_name=contractor_names.get(cid, f"Contractor #{cid}"),
                            contractor_rate_id=int(cr_pick.id),
                            negotiated_rate=cr_rate_neg,
                            previous_rate=cr_prev_neg,
                            contractor_rate_status=st_neg,
                            contractor_rate_effective_from=cr_pick.effective_from,
                            contractor_rate_effective_to=cr_pick.effective_to,
                            vs_base_amount=vb_amt,
                            vs_base_percentage=vb_pct,
                            vs_previous_amount=vp_amt,
                            vs_previous_percentage=vp_pct,
                        )
                    )

            vs_base_amt, vs_base_pct = self._variance(cr_rate, Decimal(rm.base_rate))
            vs_prev_amt, vs_prev_pct = self._variance(cr_rate, cr_prev)

            out.append(
                RateCardRow(
                    rate_master_id=int(rm.id),
                    job_type=rm.job_type,
                    skill_type=rm.skill_type,
                    unit=rm.unit,
                    org_unit_id=int(rm.org_unit_id),
                    org_unit_name=org.name if org else None,
                    base_rate=Decimal(rm.base_rate),
                    base_rate_status=self._rm_svc.derive_status(rm, today=d),
                    base_rate_is_active=bool(rm.is_active),
                    base_rate_effective_from=rm.effective_from,
                    base_rate_effective_to=rm.effective_to,
                    notes=rm.notes,
                    contractor_id=int(contractor_obj.id) if contractor_obj else None,
                    contractor_name=contractor_name,
                    contractor_rate_id=cr_id,
                    contractor_rate=cr_rate,
                    previous_rate=cr_prev,
                    contractor_rate_status=cr_status,
                    contractor_rate_effective_from=cr_from,
                    contractor_rate_effective_to=cr_to,
                    vs_base_amount=vs_base_amt,
                    vs_base_percentage=vs_base_pct,
                    vs_previous_amount=vs_prev_amt,
                    vs_previous_percentage=vs_prev_pct,
                    negotiations=negotiations,
                )
            )
        return out

    def benchmark(
        self,
        *,
        plant_id: int | None = None,
        contractor_id: int | None = None,
        rate_master_id: int | None = None,
        job_type: str | None = None,
        skill_type: str | None = None,
        unit: str | None = None,
        active_base_only: bool = True,
        today: date | None = None,
    ) -> dict[str, Any]:
        """Aggregate benchmark KPIs across the rate-card rows that match the filters."""
        rows = self.get_rate_card(
            plant_id=plant_id,
            contractor_id=contractor_id,
            rate_master_id=rate_master_id,
            job_type=job_type,
            skill_type=skill_type,
            unit=unit,
            active_base_only=active_base_only,
            today=today,
        )
        total = 0
        below_base = 0
        above_base = 0
        at_base = 0
        active = 0
        upcoming = 0
        expired = 0
        sum_premium = Decimal("0")
        sum_savings_below_base = Decimal("0")
        sum_vs_previous = Decimal("0")
        comparable_vs_prev = 0
        for r in rows:
            slices: list[
                tuple[
                    Decimal | None,
                    str | None,
                    Decimal | None,
                    Decimal | None,
                ]
            ] = []
            if r.contractor_rate is not None:
                slices.append(
                    (
                        r.contractor_rate,
                        r.contractor_rate_status,
                        r.vs_base_amount,
                        r.vs_previous_amount,
                    )
                )
            for n in r.negotiations:
                slices.append(
                    (
                        n.negotiated_rate,
                        n.contractor_rate_status,
                        n.vs_base_amount,
                        n.vs_previous_amount,
                    )
                )
            for cr_amt, cr_st, vs_b, vs_p in slices:
                if cr_amt is None:
                    continue
                total += 1
                if cr_st == "active":
                    active += 1
                elif cr_st == "upcoming":
                    upcoming += 1
                elif cr_st == "expired":
                    expired += 1
                if vs_b is not None:
                    if vs_b > Decimal("0"):
                        above_base += 1
                        sum_premium += Decimal(vs_b)
                    elif vs_b < Decimal("0"):
                        below_base += 1
                        sum_savings_below_base += Decimal(vs_b).copy_abs()
                    else:
                        at_base += 1
                if vs_p is not None:
                    comparable_vs_prev += 1
                    sum_vs_previous += Decimal(vs_p)

        return {
            "total_rates": total,
            "active": active,
            "upcoming": upcoming,
            "expired": expired,
            "above_base": above_base,
            "below_base": below_base,
            "at_base": at_base,
            "total_premium_above_base": _q2(sum_premium),
            "total_savings_below_base": _q2(sum_savings_below_base),
            "rates_with_previous": comparable_vs_prev,
            "net_vs_previous": _q2(sum_vs_previous),
            # Convenience: net "saving across the portfolio" vs base rate.
            #   negative => the company is saving overall
            #   positive => the company is paying a premium overall
            "net_vs_base": _q2(sum_premium - sum_savings_below_base),
        }
