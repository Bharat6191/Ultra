from __future__ import annotations

from pathlib import Path
import re

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from modules.approvals.assignment_service import get_workflow_for_action
from modules.approvals.service import ApprovalEngineService
from modules.contractor.models import Contractor, ContractorDocument
from modules.contractor.schema import ContractorCreate, ContractorDocumentCreate, ContractorUpdate
from modules.errors import NotFoundError


class ContractorService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def list_contractors(
        self,
        *,
        offset: int = 0,
        limit: int = 50,
        search: str | None = None,
        is_active: bool | None = None,
    ) -> list[Contractor]:
        stmt = (
            select(Contractor)
            .order_by(Contractor.created_at.desc())
            .offset(int(offset))
            .limit(int(limit))
        )
        if is_active is not None:
            stmt = stmt.where(Contractor.is_active.is_(bool(is_active)))
        if search and search.strip():
            q = f"%{search.strip().lower()}%"
            stmt = stmt.where(
                (Contractor.name.ilike(q))  # type: ignore[attr-defined]
                | (Contractor.email.ilike(q))  # type: ignore[attr-defined]
            )
        return list(self._db.scalars(stmt).all())

    def get_contractor(self, contractor_id: int) -> Contractor:
        row = self._db.scalar(
            select(Contractor)
            .where(Contractor.id == int(contractor_id))
            .options(selectinload(Contractor.documents))
        )
        if row is None:
            raise NotFoundError("Contractor", contractor_id)
        return row

    def create_contractor(self, payload: ContractorCreate, *, actor_user_id: int | None) -> Contractor:
        c = Contractor(
            name=payload.name.strip(),
            contact_person=payload.contact_person.strip() if payload.contact_person else None,
            email=str(payload.email).strip().lower() if payload.email else None,
            phone=payload.phone.strip() if payload.phone else None,
            address=str(payload.address) if payload.address else None,
            is_active=True,
            created_by=actor_user_id,
        )
        self._db.add(c)
        self._db.flush()

        wf = get_workflow_for_action(self._db, "contractor.create")
        if wf is not None:
            c.is_active = False
            ApprovalEngineService(self._db).create_request_for_entity(
                workflow=wf,
                entity_type="contractor_creation",
                entity_id=int(c.id),
                payload={
                    "action_code": "contractor.create",
                    "contractor_id": int(c.id),
                    "name": c.name,
                    "email": c.email,
                    "phone": c.phone,
                },
                created_by=actor_user_id,
            )

        self._db.commit()
        return self.get_contractor(int(c.id))

    def update_contractor(self, contractor_id: int, payload: ContractorUpdate) -> Contractor:
        c = self._db.get(Contractor, int(contractor_id))
        if c is None:
            raise NotFoundError("Contractor", contractor_id)

        upd = payload.model_dump(exclude_unset=True)
        if "name" in upd and upd["name"] is not None:
            c.name = str(upd["name"]).strip()
        if "contact_person" in upd:
            c.contact_person = str(upd["contact_person"]).strip() if upd["contact_person"] else None
        if "email" in upd:
            c.email = str(upd["email"]).strip().lower() if upd["email"] else None
        if "phone" in upd:
            c.phone = str(upd["phone"]).strip() if upd["phone"] else None
        if "address" in upd:
            c.address = str(upd["address"]) if upd["address"] else None
        if "is_active" in upd and upd["is_active"] is not None:
            c.is_active = bool(upd["is_active"])

        self._db.commit()
        return self.get_contractor(int(c.id))

    def add_document(self, contractor_id: int, payload: ContractorDocumentCreate) -> ContractorDocument:
        c = self._db.get(Contractor, int(contractor_id))
        if c is None:
            raise NotFoundError("Contractor", contractor_id)
        d = ContractorDocument(
            contractor_id=int(contractor_id),
            document_name=payload.document_name.strip(),
            document_type=payload.document_type.strip(),
            file_url=payload.file_url.strip(),
            issued_date=payload.issued_date,
            expiry_date=payload.expiry_date,
        )
        self._db.add(d)
        self._db.commit()
        self._db.refresh(d)
        return d

    def list_documents(self, contractor_id: int) -> list[ContractorDocument]:
        # Ensure contractor exists.
        if self._db.get(Contractor, int(contractor_id)) is None:
            raise NotFoundError("Contractor", contractor_id)
        stmt = (
            select(ContractorDocument)
            .where(ContractorDocument.contractor_id == int(contractor_id))
            .order_by(ContractorDocument.created_at.desc(), ContractorDocument.id.desc())
        )
        return list(self._db.scalars(stmt).all())

    @staticmethod
    def save_document_file(*, contractor_id: int, filename: str, content: bytes) -> str:
        """
        Save an uploaded contractor document and return a public URL under /uploads/*.
        """
        safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", filename or "document")
        root = Path(__file__).resolve().parents[2]  # backend/
        target_dir = root / "uploads" / "contractor_documents" / str(int(contractor_id))
        target_dir.mkdir(parents=True, exist_ok=True)
        path = target_dir / safe_name
        # Avoid collisions.
        if path.exists():
            stem = path.stem
            suffix = path.suffix
            i = 2
            while True:
                candidate = target_dir / f"{stem}_{i}{suffix}"
                if not candidate.exists():
                    path = candidate
                    break
                i += 1
        path.write_bytes(content)
        rel = path.relative_to(root / "uploads").as_posix()
        return f"/uploads/{rel}"

