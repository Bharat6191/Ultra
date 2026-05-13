#!/usr/bin/env python3
"""Insert five Part Master rows with full commercial and labour fields.

Uses the first PLANT org unit. Idempotent: skips any part_code that already exists
for that plant (active row).

Run from project root:

    ./venv/bin/python scripts/seed_five_parts.py
"""

from __future__ import annotations

import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from sqlalchemy import select

import db.models  # noqa: F401
from db.session import SessionLocal
from modules.org_units.model import OrgUnit
from modules.part_master.models import PartMaster
from modules.part_master.schema import PartMasterCreate
from modules.part_master.service import PartMasterService
from modules.users.model import User


def _first_plant_id(db) -> int:
    org = db.scalars(select(OrgUnit).where(OrgUnit.type == "PLANT").order_by(OrgUnit.id.asc())).first()
    if org is None:
        org = db.scalars(select(OrgUnit).order_by(OrgUnit.id.asc())).first()
    if org is None:
        raise RuntimeError("No org_units in database. Create a plant first.")
    if str(getattr(org, "type", "") or "").upper() != "PLANT":
        raise RuntimeError(f"First org unit id={org.id} is not type=PLANT. Add a plant org unit.")
    return int(org.id)


def _first_user_id(db) -> int | None:
    u = db.scalars(select(User).order_by(User.id.asc())).first()
    return int(u.id) if u else None


def main() -> None:
    today = date.today()
    db = SessionLocal()
    try:
        plant_id = _first_plant_id(db)
        actor = _first_user_id(db)
        svc = PartMasterService(db)

        parts: list[PartMasterCreate] = [
            PartMasterCreate(
                part_code="P-SEED-001",
                part_name="Galvanized duct elbow 600×400",
                description="90° rectangular duct section; zinc-coated steel. Used in HVAC distribution mains.",
                unit_type="kg",
                pricing_method="weight_based",
                weight_per_piece=Decimal("42.350"),
                labour_headcount=2,
                standard_man_hours=Decimal("3.25"),
                base_rate=Decimal("118.50"),
                rate_unit_type="per_kg",
                org_unit_id=plant_id,
                effective_from=today,
                effective_to=None,
                is_active=True,
                status="active",
                notes="Default catalog weight for standard elbow; weigh actual piece on site if variance >3%.",
            ),
            PartMasterCreate(
                part_code="P-SEED-002",
                part_name="LT distribution panel 250A",
                description="Factory-assembled LT panel with incomer, MCCB, and outgoing ways per SLD.",
                unit_type="nos",
                pricing_method="piece_based",
                weight_per_piece=None,
                labour_headcount=4,
                standard_man_hours=Decimal("16.00"),
                base_rate=Decimal("87500.00"),
                rate_unit_type="per_piece",
                org_unit_id=plant_id,
                effective_from=today,
                effective_to=None,
                is_active=True,
                status="active",
                notes="Includes FAT at OEM; installation labour priced separately on WO if needed.",
            ),
            PartMasterCreate(
                part_code="P-SEED-003",
                part_name="Perforated cable tray ladder 300mm",
                description="Hot-dip galvanized ladder tray, 3m sticks, including couplers.",
                unit_type="m",
                pricing_method="piece_based",
                weight_per_piece=None,
                labour_headcount=1,
                standard_man_hours=Decimal("0.45"),
                base_rate=Decimal("2850.00"),
                rate_unit_type="per_unit",
                org_unit_id=plant_id,
                effective_from=today,
                effective_to=None,
                is_active=True,
                status="active",
                notes="Unit = linear metre; rate is per metre installed supply scope.",
            ),
            PartMasterCreate(
                part_code="P-SEED-004",
                part_name="Rockwool pipe section kit DN150",
                description="Pre-cut sections, wire mesh, aluminium jacketing tape — one box covers ~12m run.",
                unit_type="box",
                pricing_method="piece_based",
                weight_per_piece=None,
                labour_headcount=2,
                standard_man_hours=Decimal("6.50"),
                base_rate=Decimal("14200.00"),
                rate_unit_type="per_box",
                org_unit_id=plant_id,
                effective_from=today,
                effective_to=None,
                is_active=True,
                status="active",
                notes="One box = one invoice line; do not split partial boxes on commercial baseline.",
            ),
            PartMasterCreate(
                part_code="P-SEED-005",
                part_name="A325 structural bolt M20×70",
                description="Heavy hex structural bolt with nut and washer, lot traceable.",
                unit_type="nos",
                pricing_method="piece_based",
                weight_per_piece=None,
                labour_headcount=0,
                standard_man_hours=Decimal("0.02"),
                base_rate=Decimal("48.75"),
                rate_unit_type="per_nos",
                org_unit_id=plant_id,
                effective_from=today,
                effective_to=None,
                is_active=True,
                status="active",
                notes="Rate per each (per_nos); standard_man_hours is per 100 pieces for estimating only.",
            ),
        ]

        created = 0
        skipped = 0
        for payload in parts:
            exists = db.scalar(
                select(PartMaster.id).where(
                    PartMaster.part_code == payload.part_code.strip().upper(),
                    PartMaster.org_unit_id == plant_id,
                    PartMaster.is_active.is_(True),
                )
            )
            if exists is not None:
                print(f"Skip (exists): {payload.part_code}")
                skipped += 1
                continue
            row = svc.create_part_master(payload, actor_user_id=actor)
            print(f"Created: {row.part_code} id={row.id} plant={plant_id}")
            created += 1

        print(f"Done. created={created} skipped={skipped} plant_id={plant_id}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
