#!/usr/bin/env python3
"""Seed a few contractors + documents for manual UI testing.

Run from project root:

    ./venv/bin/python scripts/seed_manual_test_contractors.py

Creates contractors with a mix of:
- active/inactive statuses
- documents with expiry_date: valid / expiring soon / expired / missing expiry
- contractor↔plant mappings (``contractor_plants``) for the Plants tab / picker demos
- ``contractor_audit_logs`` rows so the **Timeline** tab shows realistic vendor history

Ensures two demo ``CLUSTER`` org units (West / East) and three ``PLANT`` rows under them,
then maps selected contractors to those plants.

Also writes tiny placeholder files under backend/uploads so the "View" action works.
"""

from __future__ import annotations

import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from db.session import SessionLocal
from modules.contractor import audit as audit_helpers
from modules.contractor.models import (
    Contractor,
    ContractorAuditLog,
    ContractorDocument,
    ContractorDocumentVersion,
    ContractorPlant,
)
from modules.contractor.service import ContractorService
from modules.org_units.model import OrgUnit
from modules.users.model import User

import db.models  # noqa: F401


def _get_actor_user_id(db: Session) -> int | None:
    # Prefer the earliest user as "created_by" to avoid nulls in UI.
    u = db.scalars(select(User).order_by(User.id.asc())).first()
    return int(u.id) if u is not None else None


def _write_placeholder(*, contractor_id: int, filename: str) -> str:
    # Tiny "PDF-like" content so browser opens something.
    content = b"%PDF-1.4\n% TiMSuperPF placeholder\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
    return ContractorService.save_document_file(contractor_id=contractor_id, filename=filename, content=content)


def _upsert_contractor(db: Session, *, code: str, name: str, **kwargs) -> Contractor:
    existing = db.scalar(select(Contractor).where(Contractor.contractor_code == code))
    if existing is not None:
        return existing
    c = Contractor(contractor_code=code, name=name, **kwargs)
    db.add(c)
    db.flush()
    return c


CLUSTER_WEST = "TiM Demo Cluster — West"
CLUSTER_EAST = "TiM Demo Cluster — East"


def _ensure_two_demo_clusters(db: Session) -> tuple[OrgUnit, OrgUnit]:
    """Idempotently ensure two root CLUSTER org units exist (West / East)."""
    west = db.scalar(select(OrgUnit).where(OrgUnit.name == CLUSTER_WEST, OrgUnit.type == "CLUSTER"))
    if west is None:
        west = OrgUnit(name=CLUSTER_WEST, type="CLUSTER")
        db.add(west)
    east = db.scalar(select(OrgUnit).where(OrgUnit.name == CLUSTER_EAST, OrgUnit.type == "CLUSTER"))
    if east is None:
        east = OrgUnit(name=CLUSTER_EAST, type="CLUSTER")
        db.add(east)
    db.flush()
    west = db.scalar(select(OrgUnit).where(OrgUnit.name == CLUSTER_WEST, OrgUnit.type == "CLUSTER"))
    east = db.scalar(select(OrgUnit).where(OrgUnit.name == CLUSTER_EAST, OrgUnit.type == "CLUSTER"))
    assert west is not None and east is not None
    return west, east


def _ensure_plant_org_units(db: Session) -> list[OrgUnit]:
    """Idempotently ensure two demo clusters and named PLANT org units under them.

    North + South sit under **West**; Bengaluru Hub under **East**. Existing flat demo
    plants (``parent_id`` NULL) are linked to these clusters on re-run.
    """
    west, east = _ensure_two_demo_clusters(db)
    wid, eid = int(west.id), int(east.id)
    plant_specs: list[tuple[str, int]] = [
        ("TiM Demo Plant — North", wid),
        ("TiM Demo Plant — South", wid),
        ("TiM Demo Plant — Bengaluru Hub", eid),
    ]
    for name, parent_id in plant_specs:
        row = db.scalar(select(OrgUnit).where(OrgUnit.name == name, OrgUnit.type == "PLANT"))
        if row is None:
            db.add(OrgUnit(name=name, type="PLANT", parent_id=parent_id))
        elif row.parent_id is None:
            row.parent_id = parent_id
    db.flush()
    return list(db.scalars(select(OrgUnit).where(OrgUnit.type == "PLANT").order_by(OrgUnit.id.asc())).all())


def _ensure_plant_mapping(
    db: Session,
    *,
    contractor_id: int,
    org_unit_id: int,
    role: str,
    start_date: date | None,
    end_date: date | None,
    notes: str | None,
    created_by: int | None,
) -> None:
    existing = db.scalar(
        select(ContractorPlant).where(
            ContractorPlant.contractor_id == contractor_id,
            ContractorPlant.org_unit_id == org_unit_id,
            ContractorPlant.role == role,
        )
    )
    if existing is not None:
        return
    db.add(
        ContractorPlant(
            contractor_id=contractor_id,
            org_unit_id=org_unit_id,
            role=role,
            start_date=start_date,
            end_date=end_date,
            notes=notes,
            created_by=created_by,
        )
    )


def _ensure_doc(
    db: Session,
    *,
    contractor_id: int,
    document_name: str,
    document_type: str,
    issued_date: date | None,
    expiry_date: date | None,
    filename: str,
) -> ContractorDocument:
    # De-dupe by (contractor_id, document_name, document_type)
    existing = db.scalar(
        select(ContractorDocument).where(
            (ContractorDocument.contractor_id == contractor_id)
            & (ContractorDocument.document_name == document_name)
            & (ContractorDocument.document_type == document_type)
        )
    )
    if existing is not None:
        return existing

    file_url = _write_placeholder(contractor_id=contractor_id, filename=filename)
    d = ContractorDocument(
        contractor_id=contractor_id,
        document_name=document_name,
        document_type=document_type,
        file_path=file_url,
        file_url=file_url,
        issue_date=issued_date,
        issued_date=issued_date,
        expiry_date=expiry_date,
        verification_status="verified",
        verified_at=datetime.now(timezone.utc),
        current_version=1,
    )
    db.add(d)
    db.flush()
    db.add(
        ContractorDocumentVersion(
            document_id=int(d.id),
            version_number=1,
            file_path=file_url,
            issue_date=issued_date,
            expiry_date=expiry_date,
            remarks="Seeded manual-test document.",
            uploaded_by=None,
        )
    )
    return d


TIMELINE_SEED_TAG = "manual_test_contractors_timeline"


def _contractor_timeline_demo_seeded(db: Session, contractor_id: int) -> bool:
    rows = db.scalars(
        select(ContractorAuditLog).where(ContractorAuditLog.contractor_id == contractor_id)
    ).all()
    return any((r.metadata_json or {}).get("seed_tag") == TIMELINE_SEED_TAG for r in rows)


def _utc_days_ago(days: int, *, hour: int = 12, minute: int = 0) -> datetime:
    base = datetime.now(timezone.utc) - timedelta(days=days)
    return base.replace(hour=hour, minute=minute, second=0, microsecond=0)


def _seed_vendor_timeline_demo(
    db: Session,
    *,
    contractor: Contractor,
    actor_user_id: int | None,
) -> None:
    """Append synthetic audit rows for the contractor Timeline (idempotent per contractor)."""
    cid = int(contractor.id)
    if _contractor_timeline_demo_seeded(db, cid):
        return

    db.refresh(contractor)
    snap = audit_helpers.snapshot_contractor(contractor)
    base_meta: dict = {"seed_tag": TIMELINE_SEED_TAG}

    def m(extra: dict | None = None) -> dict:
        if not extra:
            return dict(base_meta)
        return {**base_meta, **extra}

    logs: list[ContractorAuditLog] = []

    logs.append(
        ContractorAuditLog(
            contractor_id=cid,
            action=audit_helpers.ACTION_CREATED,
            changed_by=actor_user_id,
            old_value=None,
            new_value=snap,
            metadata_json=m(),
            created_at=_utc_days_ago(180, hour=9),
        )
    )
    logs.append(
        ContractorAuditLog(
            contractor_id=cid,
            action=audit_helpers.ACTION_STATUS_CHANGED,
            changed_by=actor_user_id,
            old_value={"status": "draft"},
            new_value={"status": "active"},
            metadata_json=m(),
            created_at=_utc_days_ago(178, hour=11),
        )
    )
    logs.append(
        ContractorAuditLog(
            contractor_id=cid,
            action=audit_helpers.ACTION_UPDATED,
            changed_by=actor_user_id,
            old_value={"notes": None},
            new_value={"notes": (contractor.notes or "Onboarding notes (seed).")[:200]},
            metadata_json=m(),
            created_at=_utc_days_ago(160, hour=15),
        )
    )

    docs = list(
        db.scalars(select(ContractorDocument).where(ContractorDocument.contractor_id == cid)).all()
    )
    work_doc = next((d for d in docs if d.document_type == "agreement"), docs[0] if docs else None)
    ins_doc = next((d for d in docs if d.document_type == "insurance"), None)

    if work_doc is not None:
        logs.append(
            ContractorAuditLog(
                contractor_id=cid,
                action=audit_helpers.ACTION_DOCUMENT_UPLOADED,
                changed_by=actor_user_id,
                old_value=None,
                new_value={
                    "document_name": work_doc.document_name,
                    "document_type": work_doc.document_type,
                    "expiry_date": str(work_doc.expiry_date) if work_doc.expiry_date else None,
                },
                metadata_json=m(
                    {
                        "document_id": int(work_doc.id),
                        "document_type": work_doc.document_type,
                        "version_number": 1,
                    }
                ),
                created_at=_utc_days_ago(140, hour=10),
            )
        )

    if ins_doc is not None:
        logs.append(
            ContractorAuditLog(
                contractor_id=cid,
                action=audit_helpers.ACTION_DOCUMENT_UPLOADED,
                changed_by=actor_user_id,
                old_value=None,
                new_value={
                    "document_name": ins_doc.document_name,
                    "document_type": ins_doc.document_type,
                    "expiry_date": str(ins_doc.expiry_date) if ins_doc.expiry_date else None,
                },
                metadata_json=m(
                    {
                        "document_id": int(ins_doc.id),
                        "document_type": ins_doc.document_type,
                        "version_number": 1,
                    }
                ),
                created_at=_utc_days_ago(138, hour=14),
            )
        )
        logs.append(
            ContractorAuditLog(
                contractor_id=cid,
                action=audit_helpers.ACTION_DOCUMENT_VERIFIED,
                changed_by=actor_user_id,
                old_value={"verification_status": "pending"},
                new_value={"verification_status": "verified"},
                metadata_json=m(
                    {
                        "document_id": int(ins_doc.id),
                        "document_type": ins_doc.document_type,
                        "remarks": "Seed: annual renewal on file.",
                    }
                ),
                created_at=_utc_days_ago(135, hour=9),
            )
        )

    mappings = list(
        db.scalars(
            select(ContractorPlant)
            .where(ContractorPlant.contractor_id == cid)
            .order_by(ContractorPlant.id.asc())
        ).all()
    )
    day_offsets = [95, 88, 80, 72, 64]
    for i, cp in enumerate(mappings):
        org = db.get(OrgUnit, int(cp.org_unit_id))
        org_name = org.name if org is not None else f"Plant #{cp.org_unit_id}"
        days = day_offsets[i] if i < len(day_offsets) else 55 - i * 5
        logs.append(
            ContractorAuditLog(
                contractor_id=cid,
                action=audit_helpers.ACTION_PLANT_MAPPING_ADDED,
                changed_by=actor_user_id,
                old_value=None,
                new_value={
                    "org_unit_id": int(cp.org_unit_id),
                    "org_unit_name": org_name,
                    "role": cp.role,
                    "start_date": str(cp.start_date) if cp.start_date else None,
                    "end_date": str(cp.end_date) if cp.end_date else None,
                },
                metadata_json=m({"mapping_id": int(cp.id), "org_unit_name": org_name, "org_unit_id": int(cp.org_unit_id)}),
                created_at=_utc_days_ago(days, hour=16),
            )
        )

    if len(mappings) >= 1:
        cp = mappings[-1]
        org = db.get(OrgUnit, int(cp.org_unit_id))
        org_name = org.name if org is not None else None
        logs.append(
            ContractorAuditLog(
                contractor_id=cid,
                action=audit_helpers.ACTION_PLANT_MAPPING_UPDATED,
                changed_by=actor_user_id,
                old_value={"end_date": None, "notes": cp.notes},
                new_value={
                    "end_date": str(cp.end_date) if cp.end_date else None,
                    "notes": (cp.notes or "Engagement window refined (seed).")[:200],
                },
                metadata_json=m(
                    {"mapping_id": int(cp.id), "org_unit_id": int(cp.org_unit_id), "org_unit_name": org_name}
                ),
                created_at=_utc_days_ago(22, hour=11),
            )
        )

    if str(contractor.contractor_code or "") == "CTR-NOVA-005":
        logs.append(
            ContractorAuditLog(
                contractor_id=cid,
                action=audit_helpers.ACTION_COMPLIANCE_FLAGGED,
                changed_by=None,
                old_value={"state": "compliant"},
                new_value={"state": "non_compliant", "reason": "Critical document expired or missing expiry (seed)."},
                metadata_json=m({"source": "compliance_engine_demo"}),
                created_at=_utc_days_ago(12, hour=8),
            )
        )

    for row in logs:
        db.add(row)
    db.flush()


def main() -> int:
    today = date.today()
    actor_user_id = None

    db = SessionLocal()
    try:
        actor_user_id = _get_actor_user_id(db)

        seeds = [
            {
                "code": "CTR-ACME-001",
                "name": "Acme Industrial Services Pvt Ltd",
                "contact_person": "Rohit Sharma",
                "contact_person_title": "Operations Manager",
                "email": "ops@acme-industrial.test",
                "alternate_email": "accounts@acme-industrial.test",
                "phone": "+91-90000-00001",
                "alternate_phone": "+91-90000-00011",
                "address": "Plot 12, Industrial Area Phase II",
                "city": "Pune",
                "state": "Maharashtra",
                "country": "India",
                "postal_code": "411001",
                "gst_number": "27AAECA1234F1Z5",
                "pan_number": "AAECA1234F",
                "registration_number": "U29100PN2020PTC000001",
                "website": "https://acme-industrial.example",
                "notes": "Preferred vendor for mechanical maintenance.\nRequires quarterly compliance review.",
                "is_active": True,
            },
            {
                "code": "CTR-ZEN-002",
                "name": "Zenith Electrical Contractors",
                "contact_person": "Neha Verma",
                "contact_person_title": "Owner",
                "email": "contact@zenith-electrical.test",
                "phone": "+91-90000-00002",
                "address": "Shop 3, Market Road",
                "city": "Nagpur",
                "state": "Maharashtra",
                "country": "India",
                "postal_code": "440001",
                "gst_number": "27AAACZ6789L1Z2",
                "pan_number": "AAACZ6789L",
                "registration_number": "REG-NGP-2018-00991",
                "website": "https://zenith-electrical.example",
                "notes": "Small team; schedule work with 48h notice.",
                "is_active": True,
            },
            {
                "code": "CTR-ORION-003",
                "name": "Orion Safety & Compliance LLP",
                "contact_person": "Vikram Singh",
                "contact_person_title": "Compliance Lead",
                "email": "support@orion-safety.test",
                "phone": "+91-90000-00003",
                "address": "Tower B, Business Park",
                "city": "Mumbai",
                "state": "Maharashtra",
                "country": "India",
                "postal_code": "400001",
                "gst_number": "27AAEFO1111P1Z9",
                "pan_number": "AAEFO1111P",
                "registration_number": "LLP-ORION-2019-777",
                "website": "https://orion-safety.example",
                "notes": "Used for audits; keep documents updated at all times.",
                "is_active": True,
            },
            {
                "code": "CTR-DELTA-004",
                "name": "Delta Manpower Solutions",
                "contact_person": "Amit Patel",
                "contact_person_title": "HR Coordinator",
                "email": "hr@delta-manpower.test",
                "phone": "+91-90000-00004",
                "address": "Opp. City Mall, Ring Road",
                "city": "Surat",
                "state": "Gujarat",
                "country": "India",
                "postal_code": "395003",
                "gst_number": "24AAACD2222Q1Z1",
                "pan_number": "AAACD2222Q",
                "registration_number": "MS-SUR-2021-1001",
                "website": "https://delta-manpower.example",
                "notes": "Currently inactive (paused contract).",
                "is_active": False,
            },
            {
                "code": "CTR-NOVA-005",
                "name": "Nova HVAC Engineering Co.",
                "contact_person": "Priya Iyer",
                "contact_person_title": "Service Head",
                "email": None,  # test 'contractor without email' edge case
                "phone": "+91-90000-00005",
                "address": "Sector 21, Service Lane",
                "city": "Bengaluru",
                "state": "Karnataka",
                "country": "India",
                "postal_code": "560001",
                "gst_number": None,
                "pan_number": None,
                "registration_number": "HVAC-KA-2017-8877",
                "website": "https://nova-hvac.example",
                "notes": "No email on file. Should skip contractor-email notifications.",
                "is_active": True,
            },
        ]

        created_contractors: list[Contractor] = []
        for s in seeds:
            code = s.pop("code")
            name = s.pop("name")
            c = _upsert_contractor(db, code=code, name=name, created_by=actor_user_id, **s)
            created_contractors.append(c)

        plants = _ensure_plant_org_units(db)
        by_code = {str(c.contractor_code): c for c in created_contractors if c.contractor_code}

        def pid(index: int) -> int:
            return int(plants[index % len(plants)].id)

        # Plant mappings: mix of open-ended, bounded, and expired engagements for UI states.
        if plants:
            if acme := by_code.get("CTR-ACME-001"):
                _ensure_plant_mapping(
                    db,
                    contractor_id=int(acme.id),
                    org_unit_id=pid(0),
                    role="approved_vendor",
                    start_date=today - timedelta(days=400),
                    end_date=None,
                    notes="Primary mechanical maintenance site.",
                    created_by=actor_user_id,
                )
                _ensure_plant_mapping(
                    db,
                    contractor_id=int(acme.id),
                    org_unit_id=pid(1),
                    role="temporary",
                    start_date=today - timedelta(days=45),
                    end_date=today + timedelta(days=120),
                    notes="Short-term outage support.",
                    created_by=actor_user_id,
                )
            if zen := by_code.get("CTR-ZEN-002"):
                _ensure_plant_mapping(
                    db,
                    contractor_id=int(zen.id),
                    org_unit_id=pid(0),
                    role="approved_vendor",
                    start_date=today - timedelta(days=180),
                    end_date=None,
                    notes=None,
                    created_by=actor_user_id,
                )
            if orion := by_code.get("CTR-ORION-003"):
                _ensure_plant_mapping(
                    db,
                    contractor_id=int(orion.id),
                    org_unit_id=pid(2),
                    role="restricted",
                    start_date=today - timedelta(days=90),
                    end_date=None,
                    notes="Compliance / audit visits only.",
                    created_by=actor_user_id,
                )
            if delta := by_code.get("CTR-DELTA-004"):
                _ensure_plant_mapping(
                    db,
                    contractor_id=int(delta.id),
                    org_unit_id=pid(1),
                    role="approved_vendor",
                    start_date=today - timedelta(days=700),
                    end_date=today - timedelta(days=30),
                    notes="Engagement ended when contract paused.",
                    created_by=actor_user_id,
                )
            if nova := by_code.get("CTR-NOVA-005"):
                _ensure_plant_mapping(
                    db,
                    contractor_id=int(nova.id),
                    org_unit_id=pid(0),
                    role="approved_vendor",
                    start_date=today - timedelta(days=300),
                    end_date=None,
                    notes="HVAC AMC — main campus.",
                    created_by=actor_user_id,
                )
                _ensure_plant_mapping(
                    db,
                    contractor_id=int(nova.id),
                    org_unit_id=pid(2),
                    role="approved_vendor",
                    start_date=today - timedelta(days=60),
                    end_date=today + timedelta(days=14),
                    notes="Second site — engagement ending soon (demo).",
                    created_by=actor_user_id,
                )

        # Add documents.
        for c in created_contractors:
            # Mix of doc states for Compliance tab.
            _ensure_doc(
                db,
                contractor_id=int(c.id),
                document_name="Work Agreement",
                document_type="agreement",
                issued_date=today - timedelta(days=200),
                expiry_date=today + timedelta(days=90),
                filename="work_agreement.pdf",
            )
            _ensure_doc(
                db,
                contractor_id=int(c.id),
                document_name="Insurance Certificate",
                document_type="insurance",
                issued_date=today - timedelta(days=350),
                expiry_date=today + timedelta(days=5),  # expiring soon
                filename="insurance_certificate.pdf",
            )
            _ensure_doc(
                db,
                contractor_id=int(c.id),
                document_name="Safety Training Record",
                document_type="training",
                issued_date=today - timedelta(days=500),
                expiry_date=today - timedelta(days=2),  # expired
                filename="safety_training_record.pdf",
            )
            _ensure_doc(
                db,
                contractor_id=int(c.id),
                document_name="KYC - Address Proof",
                document_type="kyc",
                issued_date=today - timedelta(days=30),
                expiry_date=None,  # missing expiry edge case
                filename="kyc_address_proof.pdf",
            )

        for c in created_contractors:
            _seed_vendor_timeline_demo(db, contractor=c, actor_user_id=actor_user_id)

        db.commit()

        print("Seeded contractors (upsert by contractor_code):")
        for c in created_contractors:
            print(f"- id={c.id}  code={c.contractor_code}  name={c.name}  active={bool(c.is_active)}")
        print()
        print(
            f"Ensured demo clusters {CLUSTER_WEST!r} and {CLUSTER_EAST!r}; "
            f"{len(plants)} PLANT org unit(s) (North/South under West, Bengaluru Hub under East)."
        )
        n_maps = db.scalar(select(func.count()).select_from(ContractorPlant))
        print(f"Total contractor_plants rows in DB after seed: {int(n_maps or 0)}")
        print()
        print("Each contractor has 4 documents: valid + expiring soon (+5d) + expired (-2d) + missing expiry.")
        print("Placeholder files were written under backend/uploads/contractor_documents/<contractor_id>/")
        demo_audits = 0
        for c in created_contractors:
            for r in db.scalars(
                select(ContractorAuditLog).where(ContractorAuditLog.contractor_id == int(c.id))
            ).all():
                if (r.metadata_json or {}).get("seed_tag") == TIMELINE_SEED_TAG:
                    demo_audits += 1
        print(
            f"Timeline audit rows tagged '{TIMELINE_SEED_TAG}': {demo_audits} "
            "(vendor history on the Timeline tab)."
        )
    finally:
        db.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
