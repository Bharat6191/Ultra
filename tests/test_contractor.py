"""Contractor enterprise upgrade tests.

Covers:
  * compliance evaluator (critical-doc rules, expiry warning thresholds)
  * field-level audit log entries on create / update / status change
  * document upload + verify/reject lifecycle and audit trail
  * plant mapping CRUD and audit trail
  * approval workflow gating (contractor.create) — request created, status held,
    finalization activates the contractor and writes a STATUS_CHANGED audit row
"""

from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

# Make sure all models are registered on Base.metadata before create_all() runs.
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
from modules.approvals.service import ApprovalEngineService, ApprovalWorkflowService
from modules.auth.model import UserSession  # noqa: F401
from modules.contractor.compliance import evaluate_contractor_compliance
from modules.contractor.models import (
    Contractor,
    ContractorAuditLog,
    ContractorComplianceConfig,
    ContractorDocument,
    ContractorDocumentVersion,
    ContractorPlant,
)
from modules.contractor.schema import (
    ContractorCreate,
    ContractorDocumentCreate,
    ContractorDocumentUpdate,
    ContractorDocumentVerifyRequest,
    ContractorPlantCreate,
    ContractorPlantUpdate,
    ContractorStatusChange,
    ContractorUpdate,
)
from modules.contractor.router_app import _parse_status_filter
from modules.contractor.service import ContractorService
from modules.errors import ConflictError
from modules.features.model import Feature  # noqa: F401
from modules.org_units.model import OrgUnit
from modules.permissions.model import Permission
from modules.roles.model import Role
from modules.users.model import User


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
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


def _make_contractor(db: Session, *, actor_id: int | None = None, name: str = "Acme Pvt Ltd") -> Contractor:
    svc = ContractorService(db)
    payload = ContractorCreate(
        contractor_code=f"CTR-{uuid4().hex[:8].upper()}",
        name=name,
        legal_name=f"{name} Legal",
        pan="ABCDE1234F",
        gstin="22ABCDE1234F1Z5",
        contractor_type="vendor",
        contact_person="Ops Admin",
        email=f"{uuid4().hex[:8]}@example.com",
        phone="9876543210",
        address="123 Market Road",
        city="Mumbai",
        state="Maharashtra",
        country="India",
        postal_code="400001",
    )
    return svc.create_contractor(payload, actor_user_id=actor_id)


def test_create_rejects_duplicate_contractor_code(db: Session, actor: User) -> None:
    svc = ContractorService(db)
    svc.create_contractor(
        ContractorCreate(
            contractor_code="CTR-DUP-001",
            name="Acme Pvt Ltd",
            legal_name="Acme Pvt Ltd Legal",
            pan="ABCDE1234F",
            gstin="22ABCDE1234F1Z5",
            contractor_type="vendor",
            contact_person="Ops Admin",
            email="acme@example.com",
            phone="9876543210",
            address="123 Market Road",
            city="Mumbai",
            state="Maharashtra",
            country="India",
            postal_code="400001",
        ),
        actor_user_id=actor.id,
    )

    with pytest.raises(
        ConflictError,
        match="Contractor Code already exists. Please enter a unique Contractor Code.",
    ):
        svc.create_contractor(
            ContractorCreate(
                contractor_code="ctr-dup-001",
                name="Beta Pvt Ltd",
                legal_name="Beta Pvt Ltd Legal",
                pan="BBBBB1111B",
                gstin="27BBBBB1111B1Z6",
                contractor_type="vendor",
                contact_person="Ops Admin",
                email="beta@example.com",
                phone="9876543211",
                address="456 Industrial Estate",
                city="Pune",
                state="Maharashtra",
                country="India",
                postal_code="411001",
            ),
            actor_user_id=actor.id,
        )


def test_update_rejects_duplicate_contractor_code(db: Session, actor: User) -> None:
    first = _make_contractor(db, actor_id=actor.id, name="Alpha Pvt Ltd")
    second = _make_contractor(db, actor_id=actor.id, name="Beta Pvt Ltd")
    svc = ContractorService(db)

    with pytest.raises(
        ConflictError,
        match="Contractor Code already exists. Please enter a unique Contractor Code.",
    ):
        svc.update_contractor(
            int(second.id),
            ContractorUpdate(contractor_code=str(first.contractor_code).lower()),
            actor_user_id=actor.id,
        )


def test_status_active_filter_uses_lifecycle_status_not_active_flag(db: Session, actor: User) -> None:
    active = _make_contractor(db, actor_id=actor.id, name="Active Contractor")
    flagged = _make_contractor(db, actor_id=actor.id, name="Non-compliant Contractor")
    flagged.status = "non_compliant"
    flagged.is_active = True
    db.commit()

    svc = ContractorService(db)
    parsed_status, parsed_active = _parse_status_filter("active")
    rows, total = svc.list_contractors(status=parsed_status, is_active=parsed_active)

    assert (parsed_status, parsed_active) == ("active", None)
    assert [row.id for row in rows] == [int(active.id)]
    assert rows[0].status == "active"
    assert total == 1
    assert _parse_status_filter("true") == (None, True)
    assert _parse_status_filter("inactive") == (None, False)


# ---------- Compliance ----------


def test_compliance_no_critical_no_documents_yields_no_data(db: Session, actor: User) -> None:
    contractor = _make_contractor(db, actor_id=actor.id)
    result = evaluate_contractor_compliance(db, int(contractor.id))
    # No critical configs and no documents -> no_data
    assert result.state == "no_data"
    assert result.expired_documents == 0


def test_compliance_missing_critical_doc_marks_non_compliant(db: Session, actor: User) -> None:
    db.add(
        ContractorComplianceConfig(
            document_type="kyc_address_proof",
            label="KYC",
            is_critical=True,
            warn_days=7,
            is_active=True,
        )
    )
    db.commit()
    contractor = _make_contractor(db, actor_id=actor.id)
    result = evaluate_contractor_compliance(db, int(contractor.id))
    assert result.state == "non_compliant"
    assert "kyc_address_proof" in result.missing_critical_types


def test_compliance_expired_document_marks_non_compliant(db: Session, actor: User) -> None:
    contractor = _make_contractor(db, actor_id=actor.id)
    svc = ContractorService(db)
    svc.add_or_version_document(
        int(contractor.id),
        ContractorDocumentCreate(
            document_name="Insurance",
            document_type="insurance_certificate",
            file_url="/uploads/x.pdf",
            issue_date=date.today() - timedelta(days=400),
            expiry_date=date.today() - timedelta(days=10),
        ),
        actor_user_id=actor.id,
    )
    result = evaluate_contractor_compliance(db, int(contractor.id))
    assert result.expired_documents == 1
    assert result.state == "non_compliant"


def test_compliance_warning_within_warn_days(db: Session, actor: User) -> None:
    db.add(
        ContractorComplianceConfig(
            document_type="insurance_certificate",
            label="Insurance",
            is_critical=True,
            warn_days=14,
            is_active=True,
        )
    )
    db.commit()
    contractor = _make_contractor(db, actor_id=actor.id)
    svc = ContractorService(db)
    svc.add_or_version_document(
        int(contractor.id),
        ContractorDocumentCreate(
            document_name="Insurance",
            document_type="insurance_certificate",
            file_url="/uploads/i.pdf",
            issue_date=date.today() - timedelta(days=300),
            expiry_date=date.today() + timedelta(days=5),
        ),
        actor_user_id=actor.id,
    )
    r = evaluate_contractor_compliance(db, int(contractor.id))
    assert r.expiring_soon == 1
    # Status should reflect warning while no critical types are missing.
    assert r.state in ("warning", "non_compliant")


# ---------- Audit logs ----------


def test_create_writes_audit_log(db: Session, actor: User) -> None:
    contractor = _make_contractor(db, actor_id=actor.id)
    rows = list(
        db.scalars(
            select(ContractorAuditLog).where(ContractorAuditLog.contractor_id == contractor.id)
        ).all()
    )
    assert any(r.action == "CREATED" for r in rows)


def test_update_writes_field_level_diff(db: Session, actor: User) -> None:
    contractor = _make_contractor(db, actor_id=actor.id)
    svc = ContractorService(db)
    svc.update_contractor(
        int(contractor.id),
        ContractorUpdate(name="Acme New", pan="ZZZZZ9999Z"),
        actor_user_id=actor.id,
    )
    log = db.scalar(
        select(ContractorAuditLog)
        .where(
            ContractorAuditLog.contractor_id == contractor.id,
            ContractorAuditLog.action == "UPDATED",
        )
        .order_by(ContractorAuditLog.id.desc())
    )
    assert log is not None
    assert log.new_value is not None
    assert "name" in log.new_value
    assert log.new_value["name"] == "Acme New"
    assert log.old_value is not None
    assert log.old_value.get("name") == "Acme Pvt Ltd"


def test_status_change_writes_audit_log(db: Session, actor: User) -> None:
    contractor = _make_contractor(db, actor_id=actor.id)
    svc = ContractorService(db)
    svc.change_status(
        int(contractor.id), ContractorStatusChange(status="suspended", reason="missing docs"),
        actor_user_id=actor.id,
    )
    refreshed = db.get(Contractor, int(contractor.id))
    assert refreshed is not None and refreshed.status == "suspended"
    log = db.scalar(
        select(ContractorAuditLog)
        .where(
            ContractorAuditLog.contractor_id == contractor.id,
            ContractorAuditLog.action == "STATUS_CHANGED",
        )
        .order_by(ContractorAuditLog.id.desc())
    )
    assert log is not None
    assert log.new_value == {"status": "suspended"}
    assert log.metadata_json == {"reason": "missing docs"}


# ---------- Document workflow ----------


def test_document_upload_and_versioning(db: Session, actor: User) -> None:
    contractor = _make_contractor(db, actor_id=actor.id)
    svc = ContractorService(db)
    payload = ContractorDocumentCreate(
        document_name="Insurance",
        document_type="insurance_certificate",
        file_url="/uploads/v1.pdf",
        issue_date=date.today() - timedelta(days=10),
        expiry_date=date.today() + timedelta(days=30),
    )
    svc.add_or_version_document(int(contractor.id), payload, actor_user_id=actor.id)
    # Re-upload same name+type creates a new version.
    payload2 = ContractorDocumentCreate(
        document_name="Insurance",
        document_type="insurance_certificate",
        file_url="/uploads/v2.pdf",
        issue_date=date.today(),
        expiry_date=date.today() + timedelta(days=365),
    )
    svc.add_or_version_document(int(contractor.id), payload2, actor_user_id=actor.id)
    docs = list(db.scalars(select(ContractorDocument).where(ContractorDocument.contractor_id == contractor.id)).all())
    assert len(docs) == 1
    assert docs[0].current_version == 2
    versions = list(db.scalars(select(ContractorDocumentVersion).where(ContractorDocumentVersion.document_id == docs[0].id)).all())
    assert len(versions) == 2


def test_document_upload_is_auto_verified(db: Session, actor: User) -> None:
    """Verification workflow is disabled (DOCUMENT_AUTO_VERIFY=True): new uploads come
    in as ``verified`` so they don't show up as pending in the UI. The verify endpoint
    is still callable and is exercised by ``test_document_verify_endpoint_still_works``.
    """
    contractor = _make_contractor(db, actor_id=actor.id)
    svc = ContractorService(db)
    doc = svc.add_or_version_document(
        int(contractor.id),
        ContractorDocumentCreate(
            document_name="KYC",
            document_type="kyc_address_proof",
            file_url="/uploads/kyc.pdf",
            issue_date=date.today(),
            expiry_date=date.today() + timedelta(days=365),
        ),
        actor_user_id=actor.id,
    )
    assert doc.verification_status == "verified"
    assert doc.verified_by == actor.id
    assert doc.verified_at is not None


def test_document_metadata_edit_updates_fields_and_audits(db: Session, actor: User) -> None:
    """PATCH-style metadata edit changes name/dates/remarks without re-uploading and writes
    a DOCUMENT_UPDATED audit row with a field-level diff."""
    contractor = _make_contractor(db, actor_id=actor.id)
    svc = ContractorService(db)
    doc = svc.add_or_version_document(
        int(contractor.id),
        ContractorDocumentCreate(
            document_name="KYC v1",
            document_type="kyc_address_proof",
            file_url="/uploads/kyc.pdf",
            issue_date=date.today() - timedelta(days=5),
            expiry_date=date.today() + timedelta(days=180),
            remarks="original",
        ),
        actor_user_id=actor.id,
    )
    new_expiry = date.today() + timedelta(days=400)
    updated = svc.update_document_metadata(
        contractor_id=int(contractor.id),
        document_id=int(doc.id),
        payload=ContractorDocumentUpdate(
            document_name="KYC (renewed)",
            expiry_date=new_expiry,
            remarks="renewed in board meeting",
        ),
        actor_user_id=actor.id,
    )
    assert updated.document_name == "KYC (renewed)"
    assert updated.expiry_date == new_expiry
    # File path is untouched (no new version created).
    assert updated.current_version == 1
    assert updated.file_path == "/uploads/kyc.pdf"

    log = db.scalar(
        select(ContractorAuditLog)
        .where(
            ContractorAuditLog.contractor_id == contractor.id,
            ContractorAuditLog.action == "DOCUMENT_UPDATED",
        )
        .order_by(ContractorAuditLog.id.desc())
    )
    assert log is not None
    assert "document_name" in (log.new_value or {})
    assert "expiry_date" in (log.new_value or {})


def test_document_metadata_edit_rejects_inverted_dates(db: Session, actor: User) -> None:
    from modules.errors import ConflictError

    contractor = _make_contractor(db, actor_id=actor.id)
    svc = ContractorService(db)
    doc = svc.add_or_version_document(
        int(contractor.id),
        ContractorDocumentCreate(
            document_name="KYC",
            document_type="kyc_address_proof",
            file_url="/uploads/kyc.pdf",
            issue_date=date.today(),
            expiry_date=date.today() + timedelta(days=180),
        ),
        actor_user_id=actor.id,
    )
    with pytest.raises(ConflictError):
        svc.update_document_metadata(
            contractor_id=int(contractor.id),
            document_id=int(doc.id),
            payload=ContractorDocumentUpdate(
                issue_date=date.today() + timedelta(days=10),
                expiry_date=date.today() + timedelta(days=5),
            ),
            actor_user_id=actor.id,
        )


def test_compliance_ignores_pending_verification(db: Session, actor: User) -> None:
    """Auto-verify is on, but compliance must also tolerate manually pending docs:
    a pending verification on its own should NOT push the contractor to ``warning``.
    Only expiry-related signals do."""
    db.add(
        ContractorComplianceConfig(
            document_type="kyc_address_proof",
            label="KYC",
            is_critical=True,
            warn_days=7,
            is_active=True,
        )
    )
    db.commit()
    contractor = _make_contractor(db, actor_id=actor.id)
    svc = ContractorService(db)
    doc = svc.add_or_version_document(
        int(contractor.id),
        ContractorDocumentCreate(
            document_name="KYC",
            document_type="kyc_address_proof",
            file_url="/uploads/kyc.pdf",
            issue_date=date.today() - timedelta(days=5),
            expiry_date=date.today() + timedelta(days=365),
        ),
        actor_user_id=actor.id,
    )
    # Force the doc into pending (simulating the workflow being re-enabled mid-life).
    doc.verification_status = "pending"
    doc.verified_by = None
    doc.verified_at = None
    db.commit()
    result = evaluate_contractor_compliance(db, int(contractor.id))
    assert result.pending_verification == 1
    assert result.state == "compliant"


def test_document_verify_endpoint_still_works(db: Session, actor: User) -> None:
    """Even with auto-verify on, the explicit verify endpoint remains available so
    the workflow can be re-enabled in the future without breaking clients."""
    contractor = _make_contractor(db, actor_id=actor.id)
    svc = ContractorService(db)
    doc = svc.add_or_version_document(
        int(contractor.id),
        ContractorDocumentCreate(
            document_name="KYC",
            document_type="kyc_address_proof",
            file_url="/uploads/kyc.pdf",
            issue_date=date.today(),
            expiry_date=date.today() + timedelta(days=365),
        ),
        actor_user_id=actor.id,
    )
    svc.verify_document(
        contractor_id=int(contractor.id),
        document_id=int(doc.id),
        payload=ContractorDocumentVerifyRequest(decision="rejected", remarks="bad scan"),
        actor_user_id=actor.id,
    )
    refreshed = db.get(ContractorDocument, int(doc.id))
    assert refreshed is not None and refreshed.verification_status == "rejected"
    log = db.scalar(
        select(ContractorAuditLog).where(
            ContractorAuditLog.contractor_id == contractor.id,
            ContractorAuditLog.action == "DOCUMENT_REJECTED",
        )
    )
    assert log is not None


# ---------- Plant mapping ----------


def test_plant_mapping_add_remove_writes_audit(db: Session, actor: User) -> None:
    plant = OrgUnit(name="Plant A", type="PLANT")
    db.add(plant)
    db.commit()
    contractor = _make_contractor(db, actor_id=actor.id)
    svc = ContractorService(db)
    mapping = svc.add_plant_mapping(
        int(contractor.id),
        ContractorPlantCreate(org_unit_id=int(plant.id), role="approved_vendor"),
        actor_user_id=actor.id,
    )
    assert mapping.org_unit_id == plant.id
    svc.update_plant_mapping(
        contractor_id=int(contractor.id),
        mapping_id=int(mapping.id),
        payload=ContractorPlantUpdate(role="restricted"),
        actor_user_id=actor.id,
    )
    svc.remove_plant_mapping(
        contractor_id=int(contractor.id),
        mapping_id=int(mapping.id),
        actor_user_id=actor.id,
    )

    actions = [
        r.action
        for r in db.scalars(
            select(ContractorAuditLog).where(ContractorAuditLog.contractor_id == contractor.id)
        ).all()
    ]
    assert "PLANT_MAPPING_ADDED" in actions
    assert "PLANT_MAPPING_UPDATED" in actions
    assert "PLANT_MAPPING_REMOVED" in actions


def test_plant_mapping_audit_includes_org_unit_name(db: Session, actor: User) -> None:
    plant = OrgUnit(name="Plant Gamma", type="PLANT")
    db.add(plant)
    db.commit()
    contractor = _make_contractor(db, actor_id=actor.id)
    svc = ContractorService(db)
    mapping = svc.add_plant_mapping(
        int(contractor.id),
        ContractorPlantCreate(org_unit_id=int(plant.id), role="approved_vendor"),
        actor_user_id=actor.id,
    )
    add_log = db.scalar(
        select(ContractorAuditLog)
        .where(
            ContractorAuditLog.contractor_id == contractor.id,
            ContractorAuditLog.action == "PLANT_MAPPING_ADDED",
        )
        .order_by(ContractorAuditLog.id.desc())
    )
    assert add_log is not None
    assert (add_log.new_value or {}).get("org_unit_name") == "Plant Gamma"
    assert (add_log.metadata_json or {}).get("org_unit_name") == "Plant Gamma"

    svc.remove_plant_mapping(
        contractor_id=int(contractor.id),
        mapping_id=int(mapping.id),
        actor_user_id=actor.id,
    )
    rem_log = db.scalar(
        select(ContractorAuditLog)
        .where(
            ContractorAuditLog.contractor_id == contractor.id,
            ContractorAuditLog.action == "PLANT_MAPPING_REMOVED",
        )
        .order_by(ContractorAuditLog.id.desc())
    )
    assert rem_log is not None
    assert (rem_log.old_value or {}).get("org_unit_name") == "Plant Gamma"


def test_plant_mapping_rejects_inverted_dates(db: Session, actor: User) -> None:
    from modules.errors import ConflictError

    plant = OrgUnit(name="Plant B", type="PLANT")
    db.add(plant)
    db.commit()
    contractor = _make_contractor(db, actor_id=actor.id)
    svc = ContractorService(db)
    with pytest.raises(ConflictError):
        svc.add_plant_mapping(
            int(contractor.id),
            ContractorPlantCreate(
                org_unit_id=int(plant.id),
                role="approved_vendor",
                start_date=date(2026, 6, 1),
                end_date=date(2026, 1, 1),
            ),
            actor_user_id=actor.id,
        )


def test_plant_mapping_rejects_non_plant_org_unit(db: Session, actor: User) -> None:
    from modules.errors import ConflictError

    division = OrgUnit(name="Sales Division", type="DIVISION")
    db.add(division)
    db.commit()
    contractor = _make_contractor(db, actor_id=actor.id)
    svc = ContractorService(db)
    with pytest.raises(ConflictError) as exc_info:
        svc.add_plant_mapping(
            int(contractor.id),
            ContractorPlantCreate(org_unit_id=int(division.id), role="approved_vendor"),
            actor_user_id=actor.id,
        )
    assert "plant" in str(exc_info.value).lower()


def test_plant_mapping_blocks_duplicate_plant_even_with_different_role(db: Session, actor: User) -> None:
    from modules.errors import ConflictError

    plant = OrgUnit(name="Plant C", type="PLANT")
    db.add(plant)
    db.commit()
    contractor = _make_contractor(db, actor_id=actor.id)
    svc = ContractorService(db)
    svc.add_plant_mapping(
        int(contractor.id),
        ContractorPlantCreate(org_unit_id=int(plant.id), role="approved_vendor"),
        actor_user_id=actor.id,
    )
    with pytest.raises(ConflictError):
        svc.add_plant_mapping(
            int(contractor.id),
            ContractorPlantCreate(org_unit_id=int(plant.id), role="approved_vendor"),
            actor_user_id=actor.id,
        )
    with pytest.raises(ConflictError):
        svc.add_plant_mapping(
            int(contractor.id),
            ContractorPlantCreate(org_unit_id=int(plant.id), role="restricted"),
            actor_user_id=actor.id,
        )


def test_plant_mapping_soft_end_via_update_keeps_row(db: Session, actor: User) -> None:
    """Setting ``end_date`` via update is the canonical 'end engagement' path: the
    row stays for audit/history while the lifecycle helpers will mark it expired."""
    plant = OrgUnit(name="Plant D", type="PLANT")
    db.add(plant)
    db.commit()
    contractor = _make_contractor(db, actor_id=actor.id)
    svc = ContractorService(db)
    mapping = svc.add_plant_mapping(
        int(contractor.id),
        ContractorPlantCreate(
            org_unit_id=int(plant.id),
            role="approved_vendor",
            start_date=date.today() - timedelta(days=30),
        ),
        actor_user_id=actor.id,
    )
    today = date.today()
    updated = svc.update_plant_mapping(
        contractor_id=int(contractor.id),
        mapping_id=int(mapping.id),
        payload=ContractorPlantUpdate(end_date=today),
        actor_user_id=actor.id,
    )
    assert updated.end_date == today
    # Row is still present and an UPDATED audit row exists (no REMOVED row).
    actions = [
        r.action
        for r in db.scalars(
            select(ContractorAuditLog).where(ContractorAuditLog.contractor_id == contractor.id)
        ).all()
    ]
    assert "PLANT_MAPPING_UPDATED" in actions
    assert "PLANT_MAPPING_REMOVED" not in actions
    still_there = db.get(ContractorPlant, int(mapping.id))
    assert still_there is not None


# ---------- Approval flow ----------


def _setup_workflow_for(db: Session, *, action_code: str, actor_id: int) -> tuple[ApprovalWorkflow, Role]:
    role = Role(name=f"Approver-{action_code}", description=None)
    db.add(role)
    db.commit()
    # Add an active approver user so role-based tasks can be created.
    approver = User(
        full_name="Approver",
        username="approver",
        phone="+15550100200",
        email="approver@example.com",
        hashed_password="x",
        password_changed_at=date.today(),
    )
    db.add(approver)
    db.commit()
    approver.roles = [role]
    db.commit()

    svc = ApprovalWorkflowService(db)
    wf = svc.create_workflow(
        name=f"Workflow {action_code}",
        entity_type="contractor_creation" if action_code == "contractor.create" else action_code,
        created_by=actor_id,
        is_active=False,
    )
    svc.add_step(
        workflow_id=wf.id, step_order=1, approver_role_id=role.id, required_approvals=1
    )
    # The session caches relationship collections; expire so steps reload before activation.
    db.expire_all()
    svc.activate_workflow(wf.id, actor_user_id=actor_id)

    # Register the canonical permission so assignment service can resolve it.
    feat = Feature(key="contractor", name="Contractor")
    db.add(feat)
    db.commit()
    db.add(Permission(feature_id=feat.id, action="create", code=action_code))
    db.commit()

    # Map the action code to the workflow.
    from modules.approvals.assignment_service import WorkflowMappingService

    WorkflowMappingService(db).create_mapping(action_code=action_code, workflow_id=wf.id)
    return wf, role


def test_create_contractor_with_workflow_holds_pending(db: Session, actor: User) -> None:
    _setup_workflow_for(db, action_code="contractor.create", actor_id=actor.id)
    svc = ContractorService(db)
    contractor = svc.create_contractor(
        ContractorCreate(name="Pending Co"),
        actor_user_id=actor.id,
    )
    assert contractor.status == "pending"
    assert contractor.is_active is False
    # Approval request created.
    req = db.scalar(
        select(ApprovalRequest).where(
            ApprovalRequest.entity_type == "contractor_creation",
            ApprovalRequest.entity_id == contractor.id,
        )
    )
    assert req is not None
    assert req.status == "pending"


def test_approval_finalization_activates_contractor(db: Session, actor: User) -> None:
    wf, role = _setup_workflow_for(db, action_code="contractor.create", actor_id=actor.id)
    svc = ContractorService(db)
    contractor = svc.create_contractor(
        ContractorCreate(name="Pending Co 2"),
        actor_user_id=actor.id,
    )
    req = db.scalar(
        select(ApprovalRequest).where(ApprovalRequest.entity_id == contractor.id)
    )
    assert req is not None
    task = req.tasks[0]
    # Approver approves the task.
    approver = db.scalar(select(User).where(User.username == "approver"))
    assert approver is not None
    engine = ApprovalEngineService(db)
    engine.act_on_task(
        task_id=int(task.id),
        actor_user_id=int(approver.id),
        action="approve",
        comment="OK",
    )
    refreshed = db.get(Contractor, int(contractor.id))
    assert refreshed is not None
    assert refreshed.status == "active"
    assert refreshed.is_active is True
    # Audit log records STATUS_CHANGED via approval_finalized.
    log = db.scalar(
        select(ContractorAuditLog)
        .where(
            ContractorAuditLog.contractor_id == contractor.id,
            ContractorAuditLog.action == "STATUS_CHANGED",
        )
        .order_by(ContractorAuditLog.id.desc())
    )
    assert log is not None
    assert (log.metadata_json or {}).get("via") == "approval_finalized"
