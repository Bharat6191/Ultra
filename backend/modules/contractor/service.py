"""Contractor master service layer.

Encapsulates all business logic and is the single place that:
  * mutates contractor / document / plant rows
  * writes ``contractor_audit_logs`` field-level diffs
  * triggers approval workflow requests for ``contractors.create / update / activate``
  * recomputes compliance + lifecycle status after document changes

Routes are thin wrappers around these methods.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
import re
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from modules.approvals.assignment_service import get_workflow_for_action
from modules.approvals.service import ApprovalEngineService
from modules.contractor import audit as audit_helpers
from modules.contractor.compliance import (
    ComplianceResult,
    evaluate_contractor_compliance,
    recompute_contractor_status,
)
from modules.contractor.models import (
    CONTRACTOR_PLANT_ROLES,
    CONTRACTOR_STATUSES,
    Contractor,
    ContractorAuditLog,
    ContractorComplianceConfig,
    ContractorDocument,
    ContractorDocumentVersion,
    ContractorPlant,
    DOCUMENT_VERIFICATION_STATUSES,
)
from modules.invoices.models import ContractorInvoiceCompliance, Invoice, InvoiceValidationIssue
from modules.invoices.validation import invoice_tolerance_percentage
from modules.contractor.schema import (
    ComplianceConfigCreate,
    ComplianceConfigUpdate,
    ContractorComplianceSummary,
    ContractorCreate,
    ContractorDocumentCreate,
    ContractorDocumentUpdate,
    ContractorDocumentVerifyRequest,
    ContractorPlantCreate,
    ContractorPlantUpdate,
    ContractorStatusChange,
    ContractorUpdate,
)
from modules.errors import ConflictError, NotFoundError
from modules.org_units.hierarchy import collect_plant_ids_under_scope
from modules.org_units.model import OrgUnit


CRITICAL_DOC_DEFAULT_WARN_DAYS = 7

# Action codes consumed by the approval engine.
ACTION_CODE_CREATE = "contractor.create"
ACTION_CODE_UPDATE = "contractor.update"
ACTION_CODE_ACTIVATE = "contractor.activate"

# Verification workflow is currently disabled product-wide: every uploaded document
# is treated as accepted. The verification_status column and the verify endpoint are
# preserved so the workflow can be re-enabled by flipping this flag back to ``False``
# without a schema or API change.
DOCUMENT_AUTO_VERIFY = True
DEFAULT_NEW_DOCUMENT_STATUS = "verified" if DOCUMENT_AUTO_VERIFY else "pending"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _strip_or_none(value: str | None, *, lower: bool = False) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    return s.lower() if lower else s


class ContractorService:
    def __init__(self, db: Session) -> None:
        self._db = db

    # ---------- Read ----------

    def list_contractors(
        self,
        *,
        offset: int = 0,
        limit: int = 50,
        search: str | None = None,
        status: str | None = None,
        contractor_type: str | None = None,
        plant_id: int | None = None,
        is_active: bool | None = None,
    ) -> tuple[list[Contractor], int]:
        stmt = select(Contractor)
        count_stmt = select(func.count()).select_from(Contractor)

        conditions = []
        if status:
            conditions.append(Contractor.status == status.strip().lower())
        if contractor_type:
            conditions.append(Contractor.contractor_type == contractor_type.strip().lower())
        if is_active is not None:
            conditions.append(Contractor.is_active.is_(bool(is_active)))
        if search and search.strip():
            q = f"%{search.strip().lower()}%"
            conditions.append(
                or_(
                    func.lower(Contractor.name).like(q),
                    func.lower(Contractor.legal_name).like(q),
                    func.lower(Contractor.contractor_code).like(q),
                    func.lower(Contractor.pan).like(q),
                    func.lower(Contractor.gstin).like(q),
                    func.lower(Contractor.email).like(q),
                )
            )
        if plant_id is not None:
            plant_ids = collect_plant_ids_under_scope(self._db, int(plant_id))
            if not plant_ids:
                return [], 0
            stmt = stmt.join(ContractorPlant, ContractorPlant.contractor_id == Contractor.id)
            count_stmt = count_stmt.join(
                ContractorPlant, ContractorPlant.contractor_id == Contractor.id
            )
            conditions.append(ContractorPlant.org_unit_id.in_(plant_ids))

        for cond in conditions:
            stmt = stmt.where(cond)
            count_stmt = count_stmt.where(cond)

        stmt = (
            stmt.options(
                selectinload(Contractor.plants),
                selectinload(Contractor.documents),
            )
            .order_by(Contractor.created_at.desc())
            .offset(int(offset))
            .limit(int(limit))
        )
        rows = list(self._db.scalars(stmt).unique().all())
        total = int(self._db.scalar(count_stmt) or 0)
        return rows, total

    def get_contractor(self, contractor_id: int) -> Contractor:
        row = self._db.scalar(
            select(Contractor)
            .where(Contractor.id == int(contractor_id))
            .options(
                selectinload(Contractor.documents).selectinload(ContractorDocument.versions),
                selectinload(Contractor.plants),
            )
        )
        if row is None:
            raise NotFoundError("Contractor", contractor_id)
        return row

    # ---------- Create ----------

    def create_contractor(
        self, payload: ContractorCreate, *, actor_user_id: int | None
    ) -> Contractor:
        # Resolve canonical statutory IDs from either canonical or legacy fields.
        pan = _strip_or_none(payload.pan) or _strip_or_none(payload.pan_number)
        gstin = _strip_or_none(payload.gstin) or _strip_or_none(payload.gst_number)
        cin = _strip_or_none(payload.cin)
        contractor_type = _strip_or_none(payload.contractor_type, lower=True)

        contractor_code = _strip_or_none(payload.contractor_code)
        if not contractor_code:
            raise ConflictError("contractor_code is required.")
        c = Contractor(
            contractor_code=contractor_code,
            name=payload.name.strip(),
            legal_name=_strip_or_none(payload.legal_name),
            trade_name=_strip_or_none(payload.trade_name),
            pan=pan,
            gstin=gstin,
            cin=cin,
            contractor_type=contractor_type,
            status="draft",
            contact_person=_strip_or_none(payload.contact_person),
            contact_person_title=_strip_or_none(payload.contact_person_title),
            email=_strip_or_none(str(payload.email) if payload.email else None, lower=True),
            alternate_email=_strip_or_none(
                str(payload.alternate_email) if payload.alternate_email else None, lower=True
            ),
            phone=_strip_or_none(payload.phone),
            alternate_phone=_strip_or_none(payload.alternate_phone),
            address=str(payload.address) if payload.address else None,
            city=_strip_or_none(payload.city),
            state=_strip_or_none(payload.state),
            country=_strip_or_none(payload.country),
            postal_code=_strip_or_none(payload.postal_code),
            gst_number=gstin,
            pan_number=pan,
            registration_number=_strip_or_none(payload.registration_number),
            website=_strip_or_none(payload.website),
            notes=str(payload.notes) if payload.notes else None,
            is_active=True,
            created_by=actor_user_id,
            updated_by=actor_user_id,
        )
        self._db.add(c)
        self._db.flush()

        # If a workflow exists for ``contractor.create``, hold contractor in pending state.
        wf = get_workflow_for_action(self._db, ACTION_CODE_CREATE)
        approval_request_id: int | None = None
        if wf is not None:
            c.is_active = False
            c.status = "pending"
            req = ApprovalEngineService(self._db).create_request_for_entity(
                workflow=wf,
                entity_type="contractor_creation",
                entity_id=int(c.id),
                payload={
                    "action_code": ACTION_CODE_CREATE,
                    "contractor_id": int(c.id),
                    "name": c.name,
                    "legal_name": c.legal_name,
                    "pan": c.pan,
                    "gstin": c.gstin,
                    "contractor_type": c.contractor_type,
                },
                created_by=actor_user_id,
            )
            approval_request_id = int(req.id) if req is not None else None
        else:
            # Promote draft directly to active when no workflow gates creation.
            c.status = "active"

        audit_helpers.write_audit(
            self._db,
            contractor_id=int(c.id),
            action=audit_helpers.ACTION_CREATED,
            actor_user_id=actor_user_id,
            new_value=audit_helpers.snapshot_contractor(c),
            metadata={"approval_request_id": approval_request_id} if approval_request_id else None,
        )

        self._db.commit()
        return self.get_contractor(int(c.id))

    # ---------- Update ----------

    def update_contractor(
        self,
        contractor_id: int,
        payload: ContractorUpdate,
        *,
        actor_user_id: int | None = None,
    ) -> Contractor:
        c = self._db.get(Contractor, int(contractor_id))
        if c is None:
            raise NotFoundError("Contractor", contractor_id)

        before = audit_helpers.snapshot_contractor(c)

        upd = payload.model_dump(exclude_unset=True)
        if "contractor_code" in upd:
            contractor_code = _strip_or_none(upd["contractor_code"])
            if not contractor_code:
                raise ConflictError("contractor_code is required.")
            c.contractor_code = contractor_code
        if "name" in upd and upd["name"] is not None:
            c.name = str(upd["name"]).strip()
        if "legal_name" in upd:
            c.legal_name = _strip_or_none(upd.get("legal_name"))
        if "trade_name" in upd:
            c.trade_name = _strip_or_none(upd.get("trade_name"))
        if "pan" in upd or "pan_number" in upd:
            new_pan = _strip_or_none(upd.get("pan")) or _strip_or_none(upd.get("pan_number"))
            c.pan = new_pan
            c.pan_number = new_pan
        if "gstin" in upd or "gst_number" in upd:
            new_gstin = _strip_or_none(upd.get("gstin")) or _strip_or_none(upd.get("gst_number"))
            c.gstin = new_gstin
            c.gst_number = new_gstin
        if "cin" in upd:
            c.cin = _strip_or_none(upd.get("cin"))
        if "contractor_type" in upd:
            c.contractor_type = _strip_or_none(upd.get("contractor_type"), lower=True)
        if "contact_person" in upd:
            c.contact_person = _strip_or_none(upd.get("contact_person"))
        if "contact_person_title" in upd:
            c.contact_person_title = _strip_or_none(upd.get("contact_person_title"))
        if "email" in upd:
            v = upd.get("email")
            c.email = _strip_or_none(str(v) if v else None, lower=True)
        if "alternate_email" in upd:
            v = upd.get("alternate_email")
            c.alternate_email = _strip_or_none(str(v) if v else None, lower=True)
        if "phone" in upd:
            c.phone = _strip_or_none(upd.get("phone"))
        if "alternate_phone" in upd:
            c.alternate_phone = _strip_or_none(upd.get("alternate_phone"))
        if "address" in upd:
            v = upd.get("address")
            c.address = str(v) if v else None
        if "city" in upd:
            c.city = _strip_or_none(upd.get("city"))
        if "state" in upd:
            c.state = _strip_or_none(upd.get("state"))
        if "country" in upd:
            c.country = _strip_or_none(upd.get("country"))
        if "postal_code" in upd:
            c.postal_code = _strip_or_none(upd.get("postal_code"))
        if "registration_number" in upd:
            c.registration_number = _strip_or_none(upd.get("registration_number"))
        if "website" in upd:
            c.website = _strip_or_none(upd.get("website"))
        if "notes" in upd:
            v = upd.get("notes")
            c.notes = str(v) if v else None
        if "is_active" in upd and upd["is_active"] is not None:
            c.is_active = bool(upd["is_active"])

        c.updated_by = actor_user_id

        after = audit_helpers.snapshot_contractor(c)
        old, new = audit_helpers.diff_dicts(before, after)
        if old or new:
            audit_helpers.write_audit(
                self._db,
                contractor_id=int(c.id),
                action=audit_helpers.ACTION_UPDATED,
                actor_user_id=actor_user_id,
                old_value=old,
                new_value=new,
            )

            # Fire optional approval flow on update only when meaningful business fields change.
            sensitive_fields = {"name", "legal_name", "pan", "gstin", "cin", "contractor_type"}
            if sensitive_fields & set(new.keys()):
                wf = get_workflow_for_action(self._db, ACTION_CODE_UPDATE)
                if wf is not None:
                    ApprovalEngineService(self._db).create_request_for_entity(
                        workflow=wf,
                        entity_type="contractor_update",
                        entity_id=int(c.id),
                        payload={
                            "action_code": ACTION_CODE_UPDATE,
                            "contractor_id": int(c.id),
                            "old": old,
                            "new": new,
                        },
                        created_by=actor_user_id,
                    )

        self._db.commit()
        return self.get_contractor(int(c.id))

    # ---------- Lifecycle ----------

    def change_status(
        self,
        contractor_id: int,
        payload: ContractorStatusChange,
        *,
        actor_user_id: int | None,
    ) -> Contractor:
        c = self._db.get(Contractor, int(contractor_id))
        if c is None:
            raise NotFoundError("Contractor", contractor_id)
        new_status = payload.status.strip().lower()
        if new_status not in CONTRACTOR_STATUSES:
            raise ConflictError(
                f"Invalid status '{new_status}'. Allowed: {', '.join(CONTRACTOR_STATUSES)}"
            )
        if new_status == c.status:
            return self.get_contractor(int(c.id))

        # Activation may be approval-gated.
        if new_status == "active":
            wf = get_workflow_for_action(self._db, ACTION_CODE_ACTIVATE)
            if wf is not None:
                # Hold in pending until approved.
                c.status = "pending"
                c.is_active = False
                c.updated_by = actor_user_id
                ApprovalEngineService(self._db).create_request_for_entity(
                    workflow=wf,
                    entity_type="contractor_activation",
                    entity_id=int(c.id),
                    payload={
                        "action_code": ACTION_CODE_ACTIVATE,
                        "contractor_id": int(c.id),
                        "name": c.name,
                        "requested_status": new_status,
                        "reason": payload.reason,
                    },
                    created_by=actor_user_id,
                )
                audit_helpers.write_audit(
                    self._db,
                    contractor_id=int(c.id),
                    action=audit_helpers.ACTION_STATUS_CHANGED,
                    actor_user_id=actor_user_id,
                    old_value={"status": c.status},
                    new_value={"status": "pending", "requested_status": new_status},
                    metadata={"reason": payload.reason} if payload.reason else None,
                )
                self._db.commit()
                return self.get_contractor(int(c.id))

        old_status = c.status
        c.status = new_status
        c.is_active = new_status in ("active",)
        c.updated_by = actor_user_id

        audit_helpers.write_audit(
            self._db,
            contractor_id=int(c.id),
            action=audit_helpers.ACTION_STATUS_CHANGED,
            actor_user_id=actor_user_id,
            old_value={"status": old_status},
            new_value={"status": new_status},
            metadata={"reason": payload.reason} if payload.reason else None,
        )

        self._db.commit()
        return self.get_contractor(int(c.id))

    # ---------- Documents ----------

    def list_documents(self, contractor_id: int) -> list[ContractorDocument]:
        if self._db.get(Contractor, int(contractor_id)) is None:
            raise NotFoundError("Contractor", contractor_id)
        rows = self._db.scalars(
            select(ContractorDocument)
            .where(ContractorDocument.contractor_id == int(contractor_id))
            .options(selectinload(ContractorDocument.versions))
            .order_by(ContractorDocument.created_at.desc(), ContractorDocument.id.desc())
        ).all()
        return list(rows)

    def add_or_version_document(
        self,
        contractor_id: int,
        payload: ContractorDocumentCreate,
        *,
        actor_user_id: int | None,
    ) -> ContractorDocument:
        contractor = self._db.get(Contractor, int(contractor_id))
        if contractor is None:
            raise NotFoundError("Contractor", contractor_id)

        document_type = payload.document_type.strip().lower()
        document_name = payload.document_name.strip()
        file_path = payload.file_url.strip()
        issue_date = payload.issue_date or payload.issued_date

        # If a document of the same type+name already exists, create a new version.
        existing = self._db.scalar(
            select(ContractorDocument).where(
                ContractorDocument.contractor_id == int(contractor_id),
                ContractorDocument.document_type == document_type,
                ContractorDocument.document_name == document_name,
            )
        )
        if existing is not None:
            new_version = int(existing.current_version) + 1
            existing.current_version = new_version
            existing.file_path = file_path
            existing.file_url = file_path
            existing.issue_date = issue_date
            existing.issued_date = issue_date
            existing.expiry_date = payload.expiry_date
            # Verification workflow is disabled (DOCUMENT_AUTO_VERIFY); new uploads are
            # treated as managed-by-uploader. If the workflow is re-enabled later, this
            # falls back to "pending" and ContractorService.verify_document() runs again.
            existing.verification_status = DEFAULT_NEW_DOCUMENT_STATUS
            existing.verified_by = actor_user_id if DOCUMENT_AUTO_VERIFY else None
            existing.verified_at = _now_utc() if DOCUMENT_AUTO_VERIFY else None
            existing.remarks = payload.remarks
            self._db.add(
                ContractorDocumentVersion(
                    document_id=int(existing.id),
                    version_number=new_version,
                    file_path=file_path,
                    issue_date=issue_date,
                    expiry_date=payload.expiry_date,
                    remarks=payload.remarks,
                    uploaded_by=actor_user_id,
                )
            )
            doc = existing
            audit_action_metadata = {
                "document_id": int(existing.id),
                "document_type": document_type,
                "version_number": new_version,
            }
        else:
            doc = ContractorDocument(
                contractor_id=int(contractor_id),
                document_name=document_name,
                document_type=document_type,
                file_path=file_path,
                file_url=file_path,
                issue_date=issue_date,
                issued_date=issue_date,
                expiry_date=payload.expiry_date,
                verification_status=DEFAULT_NEW_DOCUMENT_STATUS,
                verified_by=actor_user_id if DOCUMENT_AUTO_VERIFY else None,
                verified_at=_now_utc() if DOCUMENT_AUTO_VERIFY else None,
                remarks=payload.remarks,
                current_version=1,
                created_by=actor_user_id,
            )
            self._db.add(doc)
            self._db.flush()
            self._db.add(
                ContractorDocumentVersion(
                    document_id=int(doc.id),
                    version_number=1,
                    file_path=file_path,
                    issue_date=issue_date,
                    expiry_date=payload.expiry_date,
                    remarks=payload.remarks,
                    uploaded_by=actor_user_id,
                )
            )
            audit_action_metadata = {
                "document_id": int(doc.id),
                "document_type": document_type,
                "version_number": 1,
            }

        audit_helpers.write_audit(
            self._db,
            contractor_id=int(contractor_id),
            action=audit_helpers.ACTION_DOCUMENT_UPLOADED,
            actor_user_id=actor_user_id,
            new_value={
                "document_name": document_name,
                "document_type": document_type,
                "expiry_date": str(payload.expiry_date) if payload.expiry_date else None,
            },
            metadata=audit_action_metadata,
        )

        recompute_contractor_status(self._db, contractor)
        self._db.commit()
        self._db.refresh(doc)
        return doc

    def update_document_metadata(
        self,
        *,
        contractor_id: int,
        document_id: int,
        payload: ContractorDocumentUpdate,
        actor_user_id: int | None,
    ) -> ContractorDocument:
        """Edit document metadata (name / dates / remarks) without re-uploading the file.

        File replacement still goes through ``add_or_version_document`` which creates a
        new immutable version row. This method only mutates descriptive fields on the
        latest record and writes an ``UPDATED`` audit log scoped to the document.
        """
        doc = self._db.get(ContractorDocument, int(document_id))
        if doc is None or int(doc.contractor_id) != int(contractor_id):
            raise NotFoundError("ContractorDocument", document_id)

        before = {
            "document_name": doc.document_name,
            "issue_date": str(doc.issue_date) if doc.issue_date else None,
            "expiry_date": str(doc.expiry_date) if doc.expiry_date else None,
            "remarks": doc.remarks,
        }
        upd = payload.model_dump(exclude_unset=True)
        if "document_name" in upd and upd["document_name"]:
            doc.document_name = str(upd["document_name"]).strip()
        if "issue_date" in upd or "issued_date" in upd:
            issue = upd.get("issue_date") or upd.get("issued_date")
            doc.issue_date = issue
            doc.issued_date = issue
        if "expiry_date" in upd:
            doc.expiry_date = upd.get("expiry_date")
        if "remarks" in upd:
            doc.remarks = upd.get("remarks")

        # Validate ordering when both are present.
        if doc.issue_date and doc.expiry_date and doc.issue_date > doc.expiry_date:
            raise ConflictError("expiry_date must be on or after issue_date.")

        after = {
            "document_name": doc.document_name,
            "issue_date": str(doc.issue_date) if doc.issue_date else None,
            "expiry_date": str(doc.expiry_date) if doc.expiry_date else None,
            "remarks": doc.remarks,
        }
        old, new = audit_helpers.diff_dicts(before, after)
        if old or new:
            audit_helpers.write_audit(
                self._db,
                contractor_id=int(contractor_id),
                action=audit_helpers.ACTION_DOCUMENT_UPDATED,
                actor_user_id=actor_user_id,
                old_value=old,
                new_value=new,
                metadata={
                    "document_id": int(doc.id),
                    "document_type": doc.document_type,
                },
            )
            # Expiry change can flip compliance even without a new file.
            contractor = self._db.get(Contractor, int(contractor_id))
            if contractor is not None:
                recompute_contractor_status(self._db, contractor)
        self._db.commit()
        self._db.refresh(doc)
        return doc

    def verify_document(
        self,
        *,
        contractor_id: int,
        document_id: int,
        payload: ContractorDocumentVerifyRequest,
        actor_user_id: int | None,
    ) -> ContractorDocument:
        doc = self._db.get(ContractorDocument, int(document_id))
        if doc is None or int(doc.contractor_id) != int(contractor_id):
            raise NotFoundError("ContractorDocument", document_id)
        if payload.decision not in DOCUMENT_VERIFICATION_STATUSES:
            raise ConflictError(
                f"Invalid decision '{payload.decision}'. Allowed: {', '.join(DOCUMENT_VERIFICATION_STATUSES)}"
            )
        if payload.decision == "pending":
            raise ConflictError("Verifiers cannot reset a document to pending.")

        old_status = doc.verification_status
        doc.verification_status = payload.decision
        doc.verified_by = actor_user_id
        doc.verified_at = _now_utc()
        doc.remarks = payload.remarks or doc.remarks

        action = (
            audit_helpers.ACTION_DOCUMENT_VERIFIED
            if payload.decision == "verified"
            else audit_helpers.ACTION_DOCUMENT_REJECTED
        )
        audit_helpers.write_audit(
            self._db,
            contractor_id=int(contractor_id),
            action=action,
            actor_user_id=actor_user_id,
            old_value={"verification_status": old_status},
            new_value={"verification_status": doc.verification_status},
            metadata={
                "document_id": int(doc.id),
                "document_type": doc.document_type,
                "remarks": payload.remarks,
            },
        )

        contractor = self._db.get(Contractor, int(contractor_id))
        if contractor is not None:
            recompute_contractor_status(self._db, contractor)
        self._db.commit()
        self._db.refresh(doc)
        return doc

    def delete_document(
        self,
        contractor_id: int,
        document_id: int,
        *,
        actor_user_id: int | None,
    ) -> None:
        doc = self._db.get(ContractorDocument, int(document_id))
        if doc is None or int(doc.contractor_id) != int(contractor_id):
            raise NotFoundError("ContractorDocument", document_id)

        snapshot = {
            "document_id": int(doc.id),
            "document_name": doc.document_name,
            "document_type": doc.document_type,
            "expiry_date": str(doc.expiry_date) if doc.expiry_date else None,
        }
        self._db.delete(doc)
        self._db.flush()

        audit_helpers.write_audit(
            self._db,
            contractor_id=int(contractor_id),
            action=audit_helpers.ACTION_DOCUMENT_DELETED,
            actor_user_id=actor_user_id,
            old_value=snapshot,
        )

        contractor = self._db.get(Contractor, int(contractor_id))
        if contractor is not None:
            recompute_contractor_status(self._db, contractor)
        self._db.commit()

    # ---------- Plant mapping ----------

    def list_plants(self, contractor_id: int) -> list[ContractorPlant]:
        if self._db.get(Contractor, int(contractor_id)) is None:
            raise NotFoundError("Contractor", contractor_id)
        return list(
            self._db.scalars(
                select(ContractorPlant)
                .where(ContractorPlant.contractor_id == int(contractor_id))
                .order_by(ContractorPlant.created_at.desc())
            ).all()
        )

    def list_contractors_for_plant(
        self, org_unit_id: int, *, only_active: bool = False
    ) -> list[Contractor]:
        plant_ids = collect_plant_ids_under_scope(self._db, int(org_unit_id))
        if not plant_ids:
            return []
        stmt = (
            select(Contractor)
            .join(ContractorPlant, ContractorPlant.contractor_id == Contractor.id)
            .where(ContractorPlant.org_unit_id.in_(plant_ids))
        )
        if only_active:
            stmt = stmt.where(Contractor.status == "active")
        stmt = stmt.options(selectinload(Contractor.plants), selectinload(Contractor.documents))
        return list(self._db.scalars(stmt).unique().all())

    def add_plant_mapping(
        self,
        contractor_id: int,
        payload: ContractorPlantCreate,
        *,
        actor_user_id: int | None,
    ) -> ContractorPlant:
        if self._db.get(Contractor, int(contractor_id)) is None:
            raise NotFoundError("Contractor", contractor_id)
        org = self._db.get(OrgUnit, int(payload.org_unit_id))
        if org is None:
            raise NotFoundError("OrgUnit", payload.org_unit_id)
        # Restrict plant mapping to actual plant org-units. Treat unknown/legacy types
        # leniently so existing seed data without a strict ``type`` doesn't break.
        org_type = (getattr(org, "type", None) or "").strip().upper() or None
        if org_type not in (None, "PLANT"):
            raise ConflictError(
                f"Org unit '{org.name}' is a {org_type.lower()}, not a plant. "
                "Only plants can be mapped to contractors."
            )
        role = (payload.role or "approved_vendor").strip().lower()
        if role not in CONTRACTOR_PLANT_ROLES:
            raise ConflictError(
                f"Invalid plant role '{role}'. Allowed: {', '.join(CONTRACTOR_PLANT_ROLES)}"
            )
        if (
            payload.start_date is not None
            and payload.end_date is not None
            and payload.start_date > payload.end_date
        ):
            raise ConflictError("end_date must be on or after start_date.")
        existing = self._db.scalar(
            select(ContractorPlant).where(
                ContractorPlant.contractor_id == int(contractor_id),
                ContractorPlant.org_unit_id == int(payload.org_unit_id),
                ContractorPlant.role == role,
            )
        )
        if existing is not None:
            raise ConflictError("This contractor is already mapped to that plant for that role.")

        row = ContractorPlant(
            contractor_id=int(contractor_id),
            org_unit_id=int(payload.org_unit_id),
            role=role,
            start_date=payload.start_date,
            end_date=payload.end_date,
            notes=_strip_or_none(payload.notes),
            created_by=actor_user_id,
        )
        self._db.add(row)
        self._db.flush()

        audit_helpers.write_audit(
            self._db,
            contractor_id=int(contractor_id),
            action=audit_helpers.ACTION_PLANT_MAPPING_ADDED,
            actor_user_id=actor_user_id,
            new_value={
                "org_unit_id": int(row.org_unit_id),
                "org_unit_name": org.name,
                "role": row.role,
                "start_date": str(row.start_date) if row.start_date else None,
                "end_date": str(row.end_date) if row.end_date else None,
            },
            metadata={"mapping_id": int(row.id), "org_unit_name": org.name},
        )
        self._db.commit()
        self._db.refresh(row)
        return row

    def update_plant_mapping(
        self,
        *,
        contractor_id: int,
        mapping_id: int,
        payload: ContractorPlantUpdate,
        actor_user_id: int | None,
    ) -> ContractorPlant:
        row = self._db.get(ContractorPlant, int(mapping_id))
        if row is None or int(row.contractor_id) != int(contractor_id):
            raise NotFoundError("ContractorPlant", mapping_id)
        before = {
            "role": row.role,
            "start_date": str(row.start_date) if row.start_date else None,
            "end_date": str(row.end_date) if row.end_date else None,
            "notes": row.notes,
        }
        upd = payload.model_dump(exclude_unset=True)
        if "role" in upd and upd["role"]:
            new_role = str(upd["role"]).strip().lower()
            if new_role not in CONTRACTOR_PLANT_ROLES:
                raise ConflictError(
                    f"Invalid plant role '{new_role}'. Allowed: {', '.join(CONTRACTOR_PLANT_ROLES)}"
                )
            row.role = new_role
        if "start_date" in upd:
            row.start_date = upd.get("start_date")
        if "end_date" in upd:
            row.end_date = upd.get("end_date")
        # Validate date ordering after applying both fields so partial updates work.
        if (
            row.start_date is not None
            and row.end_date is not None
            and row.start_date > row.end_date
        ):
            raise ConflictError("end_date must be on or after start_date.")
        if "notes" in upd:
            row.notes = _strip_or_none(upd.get("notes"))

        after = {
            "role": row.role,
            "start_date": str(row.start_date) if row.start_date else None,
            "end_date": str(row.end_date) if row.end_date else None,
            "notes": row.notes,
        }
        old, new = audit_helpers.diff_dicts(before, after)
        if old or new:
            org = self._db.get(OrgUnit, int(row.org_unit_id))
            org_name = org.name if org is not None else None
            audit_helpers.write_audit(
                self._db,
                contractor_id=int(contractor_id),
                action=audit_helpers.ACTION_PLANT_MAPPING_UPDATED,
                actor_user_id=actor_user_id,
                old_value=old,
                new_value=new,
                metadata={
                    "mapping_id": int(row.id),
                    "org_unit_id": int(row.org_unit_id),
                    "org_unit_name": org_name,
                },
            )
        self._db.commit()
        self._db.refresh(row)
        return row

    def remove_plant_mapping(
        self,
        *,
        contractor_id: int,
        mapping_id: int,
        actor_user_id: int | None,
    ) -> None:
        row = self._db.get(ContractorPlant, int(mapping_id))
        if row is None or int(row.contractor_id) != int(contractor_id):
            raise NotFoundError("ContractorPlant", mapping_id)
        org = self._db.get(OrgUnit, int(row.org_unit_id))
        org_name = org.name if org is not None else None
        snapshot = {
            "org_unit_id": int(row.org_unit_id),
            "org_unit_name": org_name,
            "role": row.role,
            "start_date": str(row.start_date) if row.start_date else None,
            "end_date": str(row.end_date) if row.end_date else None,
        }
        self._db.delete(row)
        self._db.flush()
        audit_helpers.write_audit(
            self._db,
            contractor_id=int(contractor_id),
            action=audit_helpers.ACTION_PLANT_MAPPING_REMOVED,
            actor_user_id=actor_user_id,
            old_value=snapshot,
            metadata={"mapping_id": int(mapping_id), "org_unit_name": org_name},
        )
        self._db.commit()

    # ---------- Compliance ----------

    def get_compliance(self, contractor_id: int) -> ComplianceResult:
        if self._db.get(Contractor, int(contractor_id)) is None:
            raise NotFoundError("Contractor", contractor_id)
        return evaluate_contractor_compliance(self._db, int(contractor_id))

    def get_compliance_summary(self, contractor_id: int) -> ContractorComplianceSummary:
        r = self.get_compliance(contractor_id)
        return ContractorComplianceSummary(
            state=r.state if r.state in ("compliant", "warning", "non_compliant", "no_data") else "no_data",  # type: ignore[arg-type]
            expired_documents=r.expired_documents,
            expiring_soon=r.expiring_soon,
            pending_verification=r.pending_verification,
            missing_critical_types=r.missing_critical_types,
            next_expiry=r.next_expiry,
        )

    # ---------- Compliance config ----------

    def list_compliance_configs(self) -> list[ContractorComplianceConfig]:
        return list(
            self._db.scalars(
                select(ContractorComplianceConfig).order_by(
                    ContractorComplianceConfig.document_type.asc()
                )
            ).all()
        )

    def upsert_compliance_config(
        self, payload: ComplianceConfigCreate
    ) -> ContractorComplianceConfig:
        document_type = payload.document_type.strip().lower()
        existing = self._db.scalar(
            select(ContractorComplianceConfig).where(
                ContractorComplianceConfig.document_type == document_type
            )
        )
        if existing is None:
            existing = ContractorComplianceConfig(
                document_type=document_type,
                label=_strip_or_none(payload.label),
                is_critical=bool(payload.is_critical),
                warn_days=int(payload.warn_days),
                is_active=bool(payload.is_active),
            )
            self._db.add(existing)
        else:
            existing.label = _strip_or_none(payload.label)
            existing.is_critical = bool(payload.is_critical)
            existing.warn_days = int(payload.warn_days)
            existing.is_active = bool(payload.is_active)
        self._db.commit()
        self._db.refresh(existing)
        return existing

    def update_compliance_config(
        self, config_id: int, payload: ComplianceConfigUpdate
    ) -> ContractorComplianceConfig:
        row = self._db.get(ContractorComplianceConfig, int(config_id))
        if row is None:
            raise NotFoundError("ContractorComplianceConfig", config_id)
        upd = payload.model_dump(exclude_unset=True)
        if "label" in upd:
            row.label = _strip_or_none(upd.get("label"))
        if "is_critical" in upd and upd["is_critical"] is not None:
            row.is_critical = bool(upd["is_critical"])
        if "warn_days" in upd and upd["warn_days"] is not None:
            row.warn_days = int(upd["warn_days"])
        if "is_active" in upd and upd["is_active"] is not None:
            row.is_active = bool(upd["is_active"])
        self._db.commit()
        self._db.refresh(row)
        return row

    # ---------- Audit / timeline ----------

    def list_audit(
        self,
        contractor_id: int,
        *,
        offset: int = 0,
        limit: int = 100,
    ) -> list[ContractorAuditLog]:
        if self._db.get(Contractor, int(contractor_id)) is None:
            raise NotFoundError("Contractor", contractor_id)
        rows = self._db.scalars(
            select(ContractorAuditLog)
            .where(ContractorAuditLog.contractor_id == int(contractor_id))
            .order_by(ContractorAuditLog.created_at.desc(), ContractorAuditLog.id.desc())
            .offset(int(offset))
            .limit(int(limit))
        ).all()
        return list(rows)

    # ---------- File save ----------

    @staticmethod
    def save_document_file(
        *, contractor_id: int, filename: str, content: bytes, version: int = 1
    ) -> str:
        """Save an uploaded contractor document, returning a public URL under /uploads/*."""
        safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", filename or "document")
        root = Path(__file__).resolve().parents[2]  # backend/
        target_dir = root / "uploads" / "contractor_documents" / str(int(contractor_id))
        target_dir.mkdir(parents=True, exist_ok=True)
        # Embed version in the stored filename for traceability while keeping URL stable.
        stem = Path(safe_name).stem
        suffix = Path(safe_name).suffix
        stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
        candidate = target_dir / f"{stem}_v{int(version)}_{stamp}{suffix}"
        candidate.write_bytes(content)
        rel = candidate.relative_to(root / "uploads").as_posix()
        return f"/uploads/{rel}"

    # ---------- Public projection ----------

    def contractor_invoice_analytics(self, contractor_id: int) -> dict[str, Any]:
        cid = int(contractor_id)
        tol = float(invoice_tolerance_percentage(self._db))
        invoices_total = int(self._db.scalar(select(func.count()).select_from(Invoice).where(Invoice.contractor_id == cid)) or 0)
        invoices_blocked = int(
            self._db.scalar(select(func.count()).select_from(Invoice).where(Invoice.contractor_id == cid, Invoice.status == "blocked"))
            or 0
        )
        pending_variance = int(
            self._db.scalar(
                select(func.count()).select_from(Invoice).where(Invoice.contractor_id == cid, Invoice.status == "pending_exception_approval")
            )
            or 0
        )

        pct_list: list[float] = []
        rows = (
            self._db.execute(
                select(InvoiceValidationIssue.actual_value, InvoiceValidationIssue.allowed_value)
                .join(Invoice, Invoice.id == InvoiceValidationIssue.invoice_id)
                .where(
                    Invoice.contractor_id == cid,
                    InvoiceValidationIssue.actual_value.is_not(None),
                    InvoiceValidationIssue.allowed_value.is_not(None),
                    InvoiceValidationIssue.allowed_value != 0,
                )
            )
        ).all()
        for av_raw, lv_raw in rows:
            av = Decimal(str(av_raw))
            lv = Decimal(str(lv_raw))
            if lv == 0:
                continue
            pct_list.append(abs(float(av - lv)) / float(lv) * 100.0)
        avg_var = sum(pct_list) / len(pct_list) if pct_list else None

        over_ids = (
            self._db.scalars(
                select(InvoiceValidationIssue.invoice_id)
                .join(Invoice, Invoice.id == InvoiceValidationIssue.invoice_id)
                .where(
                    Invoice.contractor_id == cid,
                    InvoiceValidationIssue.severity == "blocker",
                )
                .distinct()
            )
            .all()
        )
        overbilling_invoice_count = len(set(over_ids))

        invc = self._db.scalar(
            select(ContractorInvoiceCompliance).where(ContractorInvoiceCompliance.contractor_id == cid)
        )
        accuracy = float(invc.compliance_score) if invc is not None and invc.compliance_score is not None else None

        approval_dependency = None
        if invoices_total > 0:
            approval_dependency = float(pending_variance + invoices_blocked) / float(invoices_total)

        tolerance_pressure = None
        if invoices_total > 0:
            tolerance_pressure = float(invoices_blocked) / float(invoices_total) * 100.0

        return {
            "tolerance_pct_config": tol,
            "invoices_total": invoices_total,
            "invoices_blocked": invoices_blocked,
            "pending_variance_approvals": pending_variance,
            "variance_issues_tracked": len(pct_list),
            "average_variance_pct": avg_var,
            "overbilling_invoice_count": overbilling_invoice_count,
            "invoice_accuracy_score": accuracy,
            "approval_dependency_rate": approval_dependency,
            "tolerance_usage_pressure_pct": tolerance_pressure,
        }

    def to_public_dict(self, contractor: Contractor) -> dict[str, Any]:
        plant_count = len(list(contractor.plants or []))
        compliance = self.get_compliance_summary(int(contractor.id))
        invc = self._db.scalar(
            select(ContractorInvoiceCompliance).where(
                ContractorInvoiceCompliance.contractor_id == int(contractor.id)
            )
        )
        data: dict[str, Any] = {
            "id": int(contractor.id),
            "contractor_code": contractor.contractor_code,
            "name": contractor.name,
            "legal_name": contractor.legal_name,
            "trade_name": contractor.trade_name,
            "pan": contractor.pan,
            "gstin": contractor.gstin,
            "cin": contractor.cin,
            "contractor_type": contractor.contractor_type,
            "status": contractor.status,
            "contact_person": contractor.contact_person,
            "contact_person_title": contractor.contact_person_title,
            "email": contractor.email,
            "alternate_email": contractor.alternate_email,
            "phone": contractor.phone,
            "alternate_phone": contractor.alternate_phone,
            "address": contractor.address,
            "city": contractor.city,
            "state": contractor.state,
            "country": contractor.country,
            "postal_code": contractor.postal_code,
            "gst_number": contractor.gst_number,
            "pan_number": contractor.pan_number,
            "registration_number": contractor.registration_number,
            "website": contractor.website,
            "notes": contractor.notes,
            "is_active": bool(contractor.is_active),
            "plant_count": plant_count,
            "compliance": compliance.model_dump() if compliance else None,
            "invoice_compliance_score": float(invc.compliance_score)
            if invc is not None and invc.compliance_score is not None
            else None,
            "invoice_analytics": self.contractor_invoice_analytics(int(contractor.id)),
            "created_by": contractor.created_by,
            "updated_by": contractor.updated_by,
            "created_at": contractor.created_at,
            "updated_at": contractor.updated_at,
        }
        return data

    def plant_mapping_to_public_dict(self, mapping: ContractorPlant) -> dict[str, Any]:
        org = self._db.get(OrgUnit, int(mapping.org_unit_id))
        is_expired = bool(mapping.end_date and mapping.end_date < date.today())
        return {
            "id": int(mapping.id),
            "contractor_id": int(mapping.contractor_id),
            "org_unit_id": int(mapping.org_unit_id),
            "org_unit_name": org.name if org is not None else None,
            "role": mapping.role,
            "start_date": mapping.start_date,
            "end_date": mapping.end_date,
            "notes": mapping.notes,
            "is_expired": is_expired,
            "created_at": mapping.created_at,
            "updated_at": mapping.updated_at,
        }
