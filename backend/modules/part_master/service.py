"""Part Master CRUD + audit/versioning."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from modules.errors import ConflictError, NotFoundError
from modules.org_units.hierarchy import collect_plant_ids_under_scope
from modules.org_units.model import OrgUnit
from modules.part_master import audit as audit_helpers
from modules.part_master.models import PartMaster, PartMasterAuditLog, PartMasterVersion
from modules.part_master.pricing import derive_rate_per_kg_from_labour
from modules.part_master.schema import PartMasterCreate, PartMasterUpdate
from modules.users.model import User


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


class PartMasterService:
    def __init__(self, db: Session) -> None:
        self._db = db

    @staticmethod
    def _finalize_part_master_commercial(row: PartMaster) -> None:
        """Normalize billing flags and derive weight-based rate per kg when inputs allow."""
        row.allow_manual_amount_override = False
        row.billing_basis = "WEIGHT" if row.pricing_method == "weight_based" else "PCS"
        if row.pricing_method != "weight_based":
            return
        w = row.weight_per_piece
        lc = row.labour_cost
        md = row.man_days
        if w is None or lc is None or md is None:
            return
        if w <= 0 or lc <= 0 or md <= 0:
            return
        row.base_rate = derive_rate_per_kg_from_labour(labour_cost=lc, man_days=md, weight_kg=w)

    def _ensure_plant(self, org_unit_id: int) -> OrgUnit:
        org = self._db.get(OrgUnit, int(org_unit_id))
        if org is None:
            raise NotFoundError("OrgUnit", org_unit_id)
        if getattr(org, "type", None) and str(org.type).upper() != "PLANT":
            raise ConflictError("part_master can only be defined for org_units with type=PLANT.")
        return org

    @staticmethod
    def _validate_dates(effective_from: date, effective_to: date | None) -> None:
        if effective_to is not None and effective_from > effective_to:
            raise ConflictError("effective_from must be on or before effective_to.")

    def _check_overlap(
        self,
        *,
        part_code: str,
        org_unit_id: int,
        effective_from: date,
        effective_to: date | None,
        exclude_id: int | None = None,
    ) -> None:
        from datetime import date as _date

        stmt = select(PartMaster).where(
            PartMaster.part_code == part_code.strip().upper(),
            PartMaster.org_unit_id == int(org_unit_id),
            PartMaster.is_active.is_(True),
        )
        if exclude_id is not None:
            stmt = stmt.where(PartMaster.id != int(exclude_id))

        for other in self._db.scalars(stmt).all():
            other_to = other.effective_to or _date(9999, 12, 31)
            cand_to = effective_to or _date(9999, 12, 31)
            if effective_from <= other_to and other.effective_from <= cand_to:
                raise ConflictError(
                    "An active part master already exists for this part code and plant in the requested date range."
                )

    def _public_dict(self, row: PartMaster) -> dict[str, Any]:
        org = self._db.get(OrgUnit, int(row.org_unit_id)) if row.org_unit_id else None
        return {
            "id": int(row.id),
            "part_code": row.part_code,
            "part_name": row.part_name,
            "description": row.description,
            "unit_type": row.unit_type,
            "pricing_method": row.pricing_method,
            "billing_basis": str(row.billing_basis or "PCS").upper(),
            "allow_manual_amount_override": bool(row.allow_manual_amount_override),
            "weight_per_piece": Decimal(row.weight_per_piece) if row.weight_per_piece is not None else None,
            "labour_cost": Decimal(row.labour_cost) if row.labour_cost is not None else None,
            "man_days": Decimal(row.man_days) if row.man_days is not None else None,
            "labour_headcount": int(row.labour_headcount) if row.labour_headcount is not None else None,
            "standard_man_hours": Decimal(row.standard_man_hours) if row.standard_man_hours is not None else None,
            "base_rate": Decimal(row.base_rate or 0),
            "rate_unit_type": row.rate_unit_type,
            "org_unit_id": int(row.org_unit_id),
            "org_unit_name": org.name if org else None,
            "effective_from": row.effective_from,
            "effective_to": row.effective_to,
            "is_active": bool(row.is_active),
            "status": row.status,
            "notes": row.notes,
            "created_by": row.created_by,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    def list_part_masters(
        self,
        *,
        org_unit_id: int | None = None,
        search: str | None = None,
        active_only: bool = False,
    ) -> list[PartMaster]:
        stmt = select(PartMaster)
        if org_unit_id is not None:
            plant_ids = collect_plant_ids_under_scope(self._db, int(org_unit_id))
            if not plant_ids:
                return []
            stmt = stmt.where(PartMaster.org_unit_id.in_(plant_ids))
        if search:
            needle = search.strip()
            if needle:
                like = f"%{needle}%"
                stmt = stmt.where(
                    or_(
                        PartMaster.part_code.ilike(like),
                        PartMaster.part_name.ilike(like),
                    )
                )
        if active_only:
            stmt = stmt.where(PartMaster.is_active.is_(True))
        stmt = stmt.order_by(PartMaster.created_at.desc())
        return list(self._db.scalars(stmt).all())

    def get_part_master(self, part_master_id: int) -> PartMaster:
        row = self._db.get(PartMaster, int(part_master_id))
        if row is None:
            raise NotFoundError("PartMaster", part_master_id)
        return row

    def list_audit_logs(self, part_master_id: int) -> list[dict[str, Any]]:
        self.get_part_master(part_master_id)
        stmt = (
            select(PartMasterAuditLog)
            .where(PartMasterAuditLog.part_master_id == int(part_master_id))
            .order_by(PartMasterAuditLog.created_at.desc(), PartMasterAuditLog.id.desc())
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
                    "part_master_id": int(r.part_master_id),
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

    def create_part_master(self, payload: PartMasterCreate, *, actor_user_id: int | None = None) -> PartMaster:
        self._ensure_plant(int(payload.org_unit_id))
        self._validate_dates(payload.effective_from, payload.effective_to)
        code = payload.part_code.strip().upper()

        superseded_ids: list[int] = []
        if payload.is_active:
            from datetime import date as _date

            stmt = select(PartMaster).where(
                PartMaster.part_code == code,
                PartMaster.org_unit_id == int(payload.org_unit_id),
                PartMaster.is_active.is_(True),
                PartMaster.effective_from > payload.effective_from,
            )
            for fut in self._db.scalars(stmt).all():
                fut_to = fut.effective_to or _date(9999, 12, 31)
                cand_to = payload.effective_to or _date(9999, 12, 31)
                if payload.effective_from <= fut_to and fut.effective_from <= cand_to:
                    raise ConflictError("Overlapping part master exists for this part code and plant.")

        if payload.is_active:
            stmt = select(PartMaster).where(
                PartMaster.part_code == code,
                PartMaster.org_unit_id == int(payload.org_unit_id),
                PartMaster.is_active.is_(True),
            )
            for prev in self._db.scalars(stmt).all():
                before = audit_helpers.snapshot_part_master(prev)
                prev.is_active = False
                prev.status = "superseded"
                self._db.flush()
                after = audit_helpers.snapshot_part_master(prev)
                old_d, new_d = audit_helpers.diff_dicts(before, after)
                audit_helpers.write_part_master_audit(
                    self._db,
                    part_master_id=int(prev.id),
                    action=audit_helpers.PM_ACTION_SUPERSEDED,
                    actor_user_id=actor_user_id,
                    old_value=old_d,
                    new_value=new_d,
                )
                superseded_ids.append(int(prev.id))

        row = PartMaster(
            part_code=code,
            part_name=payload.part_name.strip(),
            description=(payload.description or None),
            unit_type=payload.unit_type.strip().lower(),
            pricing_method=payload.pricing_method,
            billing_basis="PCS",
            allow_manual_amount_override=False,
            weight_per_piece=Decimal(payload.weight_per_piece) if payload.weight_per_piece is not None else None,
            labour_cost=Decimal(payload.labour_cost) if payload.labour_cost is not None else None,
            man_days=Decimal(payload.man_days) if payload.man_days is not None else None,
            labour_headcount=int(payload.labour_headcount) if payload.labour_headcount is not None else None,
            standard_man_hours=Decimal(payload.standard_man_hours)
            if payload.standard_man_hours is not None
            else None,
            base_rate=Decimal(payload.base_rate),
            rate_unit_type=payload.rate_unit_type,
            org_unit_id=int(payload.org_unit_id),
            effective_from=payload.effective_from,
            effective_to=payload.effective_to,
            is_active=bool(payload.is_active),
            status=payload.status,
            notes=(payload.notes or None),
            created_by=actor_user_id,
        )
        self._db.add(row)
        self._db.flush()
        self._finalize_part_master_commercial(row)
        self._db.flush()

        audit_helpers.write_part_master_audit(
            self._db,
            part_master_id=int(row.id),
            action=audit_helpers.PM_ACTION_CREATED,
            actor_user_id=actor_user_id,
            new_value=audit_helpers.snapshot_part_master(row),
            metadata={"superseded_ids": superseded_ids} if superseded_ids else None,
        )
        audit_helpers.write_part_master_version(
            self._db, part=row, actor_user_id=actor_user_id, change_reason=audit_helpers.PM_ACTION_CREATED
        )
        audit_helpers.write_part_master_audit(
            self._db,
            part_master_id=int(row.id),
            action=audit_helpers.ACTION_VERSION_CREATED,
            actor_user_id=actor_user_id,
            new_value={"version_number": 1},
            metadata={"reason": audit_helpers.PM_ACTION_CREATED},
        )
        if superseded_ids:
            audit_helpers.write_part_master_audit(
                self._db,
                part_master_id=int(row.id),
                action=audit_helpers.ACTION_RATE_REPLACED,
                actor_user_id=actor_user_id,
                new_value={"replaced_part_master_ids": superseded_ids},
                metadata={"superseded_ids": superseded_ids},
            )

        self._db.commit()
        self._db.refresh(row)
        return row

    def update_part_master(
        self,
        part_master_id: int,
        payload: PartMasterUpdate,
        *,
        actor_user_id: int | None = None,
    ) -> PartMaster:
        row = self.get_part_master(part_master_id)
        before = audit_helpers.snapshot_part_master(row)
        upd = payload.model_dump(exclude_unset=True)
        superseded_ids: list[int] = []
        activation_change: str | None = None

        if "org_unit_id" in upd and upd["org_unit_id"] is not None:
            self._ensure_plant(int(upd["org_unit_id"]))
            row.org_unit_id = int(upd["org_unit_id"])
        if "part_code" in upd and upd["part_code"] is not None:
            row.part_code = str(upd["part_code"]).strip().upper()

        if "part_name" in upd and upd["part_name"] is not None:
            row.part_name = str(upd["part_name"]).strip()
        if "description" in upd:
            row.description = upd["description"] or None
        if "unit_type" in upd and upd["unit_type"] is not None:
            row.unit_type = str(upd["unit_type"]).strip().lower()
        if "pricing_method" in upd and upd["pricing_method"] is not None:
            row.pricing_method = str(upd["pricing_method"]).strip().lower()
        if "weight_per_piece" in upd:
            w = upd["weight_per_piece"]
            row.weight_per_piece = None if w is None else Decimal(str(w))
        if "labour_headcount" in upd:
            lh = upd["labour_headcount"]
            row.labour_headcount = None if lh is None else int(lh)
        if "standard_man_hours" in upd:
            sm = upd["standard_man_hours"]
            row.standard_man_hours = None if sm is None else Decimal(str(sm))
        if "labour_cost" in upd:
            lc = upd["labour_cost"]
            row.labour_cost = None if lc is None else Decimal(str(lc))
        if "man_days" in upd:
            md = upd["man_days"]
            row.man_days = None if md is None else Decimal(str(md))
        if "base_rate" in upd and upd["base_rate"] is not None:
            row.base_rate = Decimal(str(upd["base_rate"]))
        if "rate_unit_type" in upd and upd["rate_unit_type"] is not None:
            row.rate_unit_type = str(upd["rate_unit_type"]).strip().lower()
        if "effective_from" in upd and upd["effective_from"] is not None:
            row.effective_from = upd["effective_from"]
        if "effective_to" in upd:
            row.effective_to = upd["effective_to"]
        if "notes" in upd:
            row.notes = upd["notes"] or None
        if "status" in upd and upd["status"] is not None:
            row.status = str(upd["status"]).strip().lower()
        self._finalize_part_master_commercial(row)
        if row.pricing_method == "weight_based" and row.rate_unit_type != "per_kg":
            raise ConflictError("weight_based parts must use rate_unit_type per_kg (rate per kg).")
        if row.pricing_method == "piece_based" and row.rate_unit_type == "per_kg":
            raise ConflictError("piece_based parts cannot use per_kg; use weight_based or a different rate unit.")

        if "is_active" in upd and upd["is_active"] is not None:
            new_active = bool(upd["is_active"])
            if new_active and not row.is_active:
                activation_change = audit_helpers.PM_ACTION_ACTIVATED
                stmt = select(PartMaster).where(
                    PartMaster.id != row.id,
                    PartMaster.part_code == row.part_code,
                    PartMaster.org_unit_id == row.org_unit_id,
                    PartMaster.is_active.is_(True),
                )
                for prev in self._db.scalars(stmt).all():
                    pb = audit_helpers.snapshot_part_master(prev)
                    prev.is_active = False
                    prev.status = "superseded"
                    self._db.flush()
                    pa = audit_helpers.snapshot_part_master(prev)
                    o, n = audit_helpers.diff_dicts(pb, pa)
                    audit_helpers.write_part_master_audit(
                        self._db,
                        part_master_id=int(prev.id),
                        action=audit_helpers.PM_ACTION_SUPERSEDED,
                        actor_user_id=actor_user_id,
                        old_value=o,
                        new_value=n,
                    )
                    superseded_ids.append(int(prev.id))
            elif not new_active and row.is_active:
                activation_change = audit_helpers.PM_ACTION_DEACTIVATED
            row.is_active = new_active

        self._validate_dates(row.effective_from, row.effective_to)
        if row.is_active and (
            "effective_from" in upd
            or "effective_to" in upd
            or activation_change == audit_helpers.PM_ACTION_ACTIVATED
            or "part_code" in upd
            or "org_unit_id" in upd
        ):
            self._check_overlap(
                part_code=row.part_code,
                org_unit_id=int(row.org_unit_id),
                effective_from=row.effective_from,
                effective_to=row.effective_to,
                exclude_id=int(row.id),
            )

        self._db.flush()
        after = audit_helpers.snapshot_part_master(row)
        old_d, new_d = audit_helpers.diff_dicts(before, after)
        if old_d or new_d:
            audit_helpers.write_part_master_audit(
                self._db,
                part_master_id=int(row.id),
                action=audit_helpers.PM_ACTION_UPDATED,
                actor_user_id=actor_user_id,
                old_value=old_d,
                new_value=new_d,
            )
            validity_keys = {"effective_from", "effective_to"}
            if validity_keys & set(new_d.keys()):
                audit_helpers.write_part_master_audit(
                    self._db,
                    part_master_id=int(row.id),
                    action=audit_helpers.ACTION_VALIDITY_CHANGED,
                    actor_user_id=actor_user_id,
                    old_value={k: old_d.get(k) for k in validity_keys if k in old_d},
                    new_value={k: new_d.get(k) for k in validity_keys if k in new_d},
                )
            ver = audit_helpers.write_part_master_version(
                self._db, part=row, actor_user_id=actor_user_id, change_reason=audit_helpers.PM_ACTION_UPDATED
            )
            audit_helpers.write_part_master_audit(
                self._db,
                part_master_id=int(row.id),
                action=audit_helpers.ACTION_VERSION_CREATED,
                actor_user_id=actor_user_id,
                new_value={"version_number": int(ver.version_number)},
                metadata={"reason": audit_helpers.PM_ACTION_UPDATED},
            )
        if activation_change is not None:
            audit_helpers.write_part_master_audit(
                self._db,
                part_master_id=int(row.id),
                action=activation_change,
                actor_user_id=actor_user_id,
                new_value={"is_active": row.is_active},
                metadata={"superseded_ids": superseded_ids} if superseded_ids else None,
            )
            if superseded_ids:
                audit_helpers.write_part_master_audit(
                    self._db,
                    part_master_id=int(row.id),
                    action=audit_helpers.ACTION_RATE_REPLACED,
                    actor_user_id=actor_user_id,
                    new_value={"replaced_part_master_ids": superseded_ids},
                    metadata={"superseded_ids": superseded_ids},
                )

        self._db.commit()
        self._db.refresh(row)
        return row

    def list_versions(self, part_master_id: int) -> list[PartMasterVersion]:
        self.get_part_master(part_master_id)
        stmt = (
            select(PartMasterVersion)
            .where(PartMasterVersion.part_master_id == int(part_master_id))
            .order_by(PartMasterVersion.version_number.asc())
        )
        return list(self._db.scalars(stmt).all())

    @staticmethod
    def derive_status(row: PartMaster, *, today: date | None = None) -> str:
        d = today or date.today()
        if not bool(row.is_active):
            return "inactive"
        if row.effective_from and row.effective_from > d:
            return "upcoming"
        if row.effective_to is not None and row.effective_to < d:
            return "expired"
        return "active"

    def mark_expired(self, *, today: date | None = None, actor_user_id: int | None = None) -> int:
        d = today or date.today()
        stmt = select(PartMaster).where(
            PartMaster.is_active.is_(True),
            PartMaster.effective_to.is_not(None),
            PartMaster.effective_to < d,
        )
        rows = list(self._db.scalars(stmt).all())
        for row in rows:
            before = audit_helpers.snapshot_part_master(row)
            row.is_active = False
            row.status = "inactive"
            self._db.flush()
            after = audit_helpers.snapshot_part_master(row)
            old_d, new_d = audit_helpers.diff_dicts(before, after)
            audit_helpers.write_part_master_audit(
                self._db,
                part_master_id=int(row.id),
                action=audit_helpers.PM_ACTION_DEACTIVATED,
                actor_user_id=actor_user_id,
                old_value=old_d,
                new_value=new_d,
                metadata={"reason": "auto_expired", "today": d.isoformat()},
            )
            audit_helpers.write_part_master_version(
                self._db, part=row, actor_user_id=actor_user_id, change_reason="AUTO_EXPIRED"
            )
        if rows:
            self._db.commit()
        return len(rows)
