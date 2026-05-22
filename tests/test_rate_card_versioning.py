"""3.4 Part Master & benchmark control tests.

Covers the gaps closed in this slice:

  * versioning: every update writes a new ``part_master_versions`` /
    ``contractor_rate_versions`` snapshot
  * strict overlap rejection on part_master + contractor_rates
  * benchmark calculation (vs base + vs previous)
  * auto-expiry job (part_master + contractor_rates)
  * unified rate card aggregation
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from db.base import Base
from modules.approvals.model import (  # noqa: F401
    ApprovalAction,
    ApprovalRequest,
    ApprovalStep,
    ApprovalTask,
    ApprovalWorkflow,
    ApprovalWorkflowMapping,
    TaskAuditLog,
    TaskComment,
)
from modules.auth.model import UserSession  # noqa: F401
from modules.contractor.models import Contractor  # noqa: F401
from modules.contractor.schema import ContractorCreate
from modules.contractor.service import ContractorService
from modules.contractor_rates.audit import standard_diff
from modules.contractor_rates.models import (
    ContractorRate,
    ContractorRateVersion,
)
from modules.contractor_rates.rate_card import RateCardService
from modules.contractor_rates.schema import (
    ContractorRateCreate,
)
from modules.contractor_rates.service import (
    ContractorRateService,
)
from modules.part_master.models import PartMaster, PartMasterVersion
from modules.part_master.schema import PartMasterCreate, PartMasterUpdate
from modules.part_master.service import PartMasterService
from modules.errors import ConflictError
from modules.features.model import Feature  # noqa: F401
from modules.org_units.model import OrgUnit
from modules.permissions.model import Permission  # noqa: F401
from modules.roles.model import Role  # noqa: F401
from modules.users.model import User


# ---------- Fixtures ----------


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(
        bind=engine, autocommit=False, autoflush=False, expire_on_commit=False
    )
    with SessionLocal() as session:
        yield session


@pytest.fixture()
def actor(db: Session) -> User:
    user = User(
        full_name="Op Admin",
        username="op.admin",
        phone="+15550100100",
        email="op@example.com",
        hashed_password="x",
        password_changed_at=date.today(),
    )
    db.add(user)
    db.commit()
    return user


@pytest.fixture()
def plant(db: Session) -> OrgUnit:
    p = OrgUnit(name="Plant Alpha", type="PLANT")
    db.add(p)
    db.commit()
    return p


@pytest.fixture()
def contractor(db: Session, actor: User) -> Contractor:
    return ContractorService(db).create_contractor(
        ContractorCreate(
            contractor_code="CTR-TEST-ACME",
            name="Acme Vendor",
            contractor_type="vendor",
        ),
        actor_user_id=actor.id,
    )


def _map_unit_commercial(unit: str) -> tuple[str, str, str]:
    u = unit.strip().lower()
    if u == "kg":
        return "kg", "weight_based", "per_kg"
    if u == "job":
        return "pcs", "piece_based", "per_piece"
    if u in ("hour", "hr"):
        return "hr", "piece_based", "per_piece"
    if u == "day":
        return "day", "piece_based", "per_piece"
    return u, "piece_based", "per_piece"


def _make_part(
    db: Session,
    *,
    plant_id: int,
    actor_id: int,
    base_rate: str = "100.00",
    job_type: str = "Welder",
    skill_type: str = "skilled",
    unit: str = "hour",
    effective_from: date | None = None,
    effective_to: date | None = None,
    is_active: bool = True,
) -> PartMaster:
    j = job_type.strip().upper().replace(" ", "-")
    sk = skill_type.strip().upper().replace(" ", "-")
    u = unit.strip().upper()
    part_code = f"{j}-{sk}-{u}"[:64]
    unit_type, pricing_method, rate_unit_type = _map_unit_commercial(unit)
    part_name = f"{job_type.strip()} ({skill_type.replace('_', ' ').strip()})"
    return PartMasterService(db).create_part_master(
        PartMasterCreate(
            part_code=part_code,
            part_name=part_name,
            description=None,
            unit_type=unit_type,
            pricing_method=pricing_method,
            weight_per_piece=None,
            base_rate=Decimal(base_rate),
            rate_unit_type=rate_unit_type,
            org_unit_id=plant_id,
            effective_from=effective_from or date.today(),
            effective_to=effective_to,
            is_active=is_active,
        ),
        actor_user_id=actor_id,
    )


# ---------- Versioning ----------


def test_rate_master_create_writes_v1_snapshot(
    db: Session, actor: User, plant: OrgUnit
) -> None:
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    versions = list(
        db.scalars(
            select(PartMasterVersion).where(PartMasterVersion.part_master_id == int(rm.id))
        ).all()
    )
    assert [v.version_number for v in versions] == [1]
    snap = versions[0].snapshot_json
    assert snap["part_code"] == "WELDER-SKILLED-HOUR"
    assert str(snap["base_rate"]) == "100.00"


def test_rate_master_update_appends_immutable_version(
    db: Session, actor: User, plant: OrgUnit
) -> None:
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    PartMasterService(db).update_part_master(
        int(rm.id),
        PartMasterUpdate(base_rate=Decimal("120")),
        actor_user_id=int(actor.id),
    )
    versions = list(
        db.scalars(
            select(PartMasterVersion)
            .where(PartMasterVersion.part_master_id == int(rm.id))
            .order_by(PartMasterVersion.version_number.asc())
        ).all()
    )
    assert [v.version_number for v in versions] == [1, 2]
    # v1 is immutable: still records the original 100 rate.
    assert Decimal(str(versions[0].snapshot_json["base_rate"])) == Decimal("100")
    assert Decimal(str(versions[1].snapshot_json["base_rate"])) == Decimal("120")
    # Standard diff format check (field key + old + new keys present).
    diff = standard_diff(versions[0].snapshot_json, versions[1].snapshot_json)
    base_diff = next((d for d in diff if d["field"] == "base_rate"), None)
    assert base_diff is not None
    assert Decimal(str(base_diff["old"])) == Decimal("100")
    assert Decimal(str(base_diff["new"])) == Decimal("120")


def test_contractor_rate_create_and_update_writes_versions(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            effective_from=date.today(),
        ),
        actor_user_id=int(actor.id),
    )
    from modules.contractor_rates.schema import ContractorRateUpdate

    svc.update_rate(
        int(rate.id),
        ContractorRateUpdate(negotiated_rate=Decimal("88")),
        actor_user_id=int(actor.id),
    )
    versions = list(
        db.scalars(
            select(ContractorRateVersion)
            .where(ContractorRateVersion.contractor_rate_id == int(rate.id))
            .order_by(ContractorRateVersion.version_number.asc())
        ).all()
    )
    assert [v.version_number for v in versions] == [1, 2]
    assert Decimal(str(versions[0].snapshot_json["negotiated_rate"])) == Decimal("90")
    assert Decimal(str(versions[1].snapshot_json["negotiated_rate"])) == Decimal("88")


# ---------- Strict validity / overlap ----------


def test_rate_master_overlap_rejected(
    db: Session, actor: User, plant: OrgUnit
) -> None:
    """Two active part_master rows with overlapping windows for the same combo
    must be rejected (3.4 strict validity)."""
    today = date.today()
    _make_part(
        db,
        plant_id=int(plant.id),
        actor_id=int(actor.id),
        effective_from=today + timedelta(days=30),
        effective_to=today + timedelta(days=120),
    )
    # Candidate window [today, today+60] overlaps with the future row.
    with pytest.raises(ConflictError):
        _make_part(
            db,
            plant_id=int(plant.id),
            actor_id=int(actor.id),
            base_rate="110.00",
            effective_from=today,
            effective_to=today + timedelta(days=60),
        )


def test_rate_master_supersession_still_allowed(
    db: Session, actor: User, plant: OrgUnit
) -> None:
    """Strict overlap rejection must NOT break the historical pattern of
    activating a *successor* row for a combo whose previous row was open-ended.
    """
    today = date.today()
    rm_old = _make_part(
        db,
        plant_id=int(plant.id),
        actor_id=int(actor.id),
        effective_from=today - timedelta(days=30),
    )
    rm_new = _make_part(
        db,
        plant_id=int(plant.id),
        actor_id=int(actor.id),
        base_rate="125.00",
        effective_from=today,
    )
    db.refresh(rm_old)
    assert rm_old.is_active is False
    assert rm_new.is_active is True


# ---------- Status engine + auto-expiry ----------


def test_rate_master_auto_expiry_job(
    db: Session, actor: User, plant: OrgUnit
) -> None:
    today = date.today()
    rm_expired = _make_part(
        db,
        plant_id=int(plant.id),
        actor_id=int(actor.id),
        effective_from=today - timedelta(days=60),
        effective_to=today - timedelta(days=1),
    )
    # Note: a future row with the same combo is allowed because rm_expired's
    # window doesn't overlap it. The job below should flip rm_expired only.
    n = PartMasterService(db).mark_expired(today=today, actor_user_id=int(actor.id))
    assert n == 1
    db.refresh(rm_expired)
    assert rm_expired.is_active is False
    # Status engine label.
    assert PartMasterService.derive_status(rm_expired, today=today) == "inactive"


def test_contractor_rate_auto_expiry_job(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    today = date.today()
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    svc = ContractorRateService(db)
    rate = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            effective_from=today - timedelta(days=60),
            effective_to=today - timedelta(days=1),
        ),
        actor_user_id=int(actor.id),
    )
    svc.submit_for_approval(int(rate.id), actor_user_id=int(actor.id))
    # No workflow → auto-approved → status='approved'. Now run the cron.
    n = svc.mark_expired(today=today, actor_user_id=int(actor.id))
    assert n == 1
    refreshed = svc.get_rate(int(rate.id))
    assert refreshed.status == "expired"


def test_derive_status_upcoming_and_active(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    today = date.today()
    rm_active = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    rm_future = _make_part(
        db,
        plant_id=int(plant.id),
        actor_id=int(actor.id),
        job_type="Painter",
        effective_from=today + timedelta(days=10),
    )
    assert PartMasterService.derive_status(rm_active, today=today) == "active"
    assert PartMasterService.derive_status(rm_future, today=today) == "upcoming"


# ---------- Rate Card + Benchmark ----------


def test_rate_card_aggregates_base_current_previous(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    today = date.today()
    rm = _make_part(
        db, plant_id=int(plant.id), actor_id=int(actor.id), base_rate="100.00"
    )
    svc = ContractorRateService(db)

    # First approved rate (the "previous").
    first = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("95"),
            effective_from=today - timedelta(days=180),
            effective_to=today - timedelta(days=91),
        ),
        actor_user_id=int(actor.id),
    )
    svc.submit_for_approval(int(first.id), actor_user_id=int(actor.id))

    # Second approved rate (the "current").
    second = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            effective_from=today - timedelta(days=90),
        ),
        actor_user_id=int(actor.id),
    )
    svc.submit_for_approval(int(second.id), actor_user_id=int(actor.id))

    rows = RateCardService(db).get_rate_card(
        plant_id=int(plant.id), contractor_id=int(contractor.id)
    )
    assert len(rows) == 1
    rc = rows[0]
    assert rc.base_rate == Decimal("100.00")
    assert rc.contractor_rate == Decimal("90.00")
    assert rc.previous_rate == Decimal("95.00")
    assert rc.contractor_rate_status == "active"
    # vs base: 90 - 100 = -10 (saving 10%)
    assert rc.vs_base_amount == Decimal("-10.00")
    assert rc.vs_base_percentage == Decimal("-10.00")
    # vs previous: 90 - 95 = -5
    assert rc.vs_previous_amount == Decimal("-5.00")
    assert round(float(rc.vs_previous_percentage or 0), 2) == -5.26


def test_rate_card_without_contractor_rate_returns_blank_negotiated(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id))
    rows = RateCardService(db).get_rate_card(
        plant_id=int(plant.id), contractor_id=int(contractor.id)
    )
    assert len(rows) == 1
    assert rows[0].contractor_rate is None
    assert rows[0].previous_rate is None
    assert rows[0].vs_base_amount is None


def test_rate_card_filter_by_rate_master_id(db: Session, actor: User, plant: OrgUnit) -> None:
    rm = _make_part(db, plant_id=int(plant.id), actor_id=int(actor.id), base_rate="100.00")
    rows = RateCardService(db).get_rate_card(part_master_id=int(rm.id))
    assert len(rows) == 1
    assert rows[0].part_master_id == int(rm.id)
    assert rows[0].base_rate == Decimal("100.00")


def test_rate_card_without_contractor_filter_lists_negotiations_per_vendor(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    today = date.today()
    rm = _make_part(
        db, plant_id=int(plant.id), actor_id=int(actor.id), base_rate="100.00"
    )
    beta = ContractorService(db).create_contractor(
        ContractorCreate(
            contractor_code="CTR-TEST-BETA-1",
            name="Beta Vendor",
            contractor_type="vendor",
        ),
        actor_user_id=int(actor.id),
    )
    svc = ContractorRateService(db)
    svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            effective_from=today,
        ),
        actor_user_id=int(actor.id),
    )
    svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(beta.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("95"),
            effective_from=today,
        ),
        actor_user_id=int(actor.id),
    )

    rows = RateCardService(db).get_rate_card(plant_id=int(plant.id))
    assert len(rows) == 1
    assert rows[0].contractor_rate is None
    assert rows[0].negotiations is not None
    assert len(rows[0].negotiations) == 2
    by_name = {n.contractor_name: n.negotiated_rate for n in rows[0].negotiations}
    assert by_name["Acme Vendor"] == Decimal("90.00")
    assert by_name["Beta Vendor"] == Decimal("95.00")


def test_benchmark_without_contractor_counts_all_negotiations(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    today = date.today()
    rm = _make_part(
        db, plant_id=int(plant.id), actor_id=int(actor.id), base_rate="100.00"
    )
    beta = ContractorService(db).create_contractor(
        ContractorCreate(
            contractor_code="CTR-TEST-BETA-2",
            name="Beta Vendor",
            contractor_type="vendor",
        ),
        actor_user_id=int(actor.id),
    )
    svc = ContractorRateService(db)
    svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("90"),
            effective_from=today,
        ),
        actor_user_id=int(actor.id),
    )
    svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(beta.id),
            part_master_id=int(rm.id),
            negotiated_rate=Decimal("110"),
            effective_from=today,
        ),
        actor_user_id=int(actor.id),
    )

    kpis = RateCardService(db).benchmark(plant_id=int(plant.id))
    assert kpis["total_rates"] == 2
    assert kpis["below_base"] == 1
    assert kpis["above_base"] == 1


def test_rate_card_benchmark_kpis(
    db: Session, actor: User, plant: OrgUnit, contractor: Contractor
) -> None:
    today = date.today()
    # Two distinct base rates so we have two rate-card rows.
    rm1 = _make_part(
        db, plant_id=int(plant.id), actor_id=int(actor.id), base_rate="100.00"
    )
    rm2 = _make_part(
        db,
        plant_id=int(plant.id),
        actor_id=int(actor.id),
        base_rate="200.00",
        job_type="Painter",
    )
    svc = ContractorRateService(db)

    # Below-base rate.
    cr1 = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm1.id),
            negotiated_rate=Decimal("90"),
            effective_from=today,
        ),
        actor_user_id=int(actor.id),
    )
    svc.submit_for_approval(int(cr1.id), actor_user_id=int(actor.id))

    # Above-base rate.
    cr2 = svc.create_rate(
        ContractorRateCreate(
            contractor_id=int(contractor.id),
            part_master_id=int(rm2.id),
            negotiated_rate=Decimal("220"),
            effective_from=today,
        ),
        actor_user_id=int(actor.id),
    )
    svc.submit_for_approval(int(cr2.id), actor_user_id=int(actor.id))

    kpis = RateCardService(db).benchmark(
        plant_id=int(plant.id), contractor_id=int(contractor.id)
    )
    assert kpis["total_rates"] == 2
    assert kpis["active"] == 2
    assert kpis["below_base"] == 1
    assert kpis["above_base"] == 1
    assert kpis["total_premium_above_base"] == Decimal("20.00")
    assert kpis["total_savings_below_base"] == Decimal("10.00")
    # Net vs base = +20 (premium) - 10 (saving) = +10
    assert kpis["net_vs_base"] == Decimal("10.00")
