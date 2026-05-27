"""Map RBAC action codes (permission codes) to approval workflows."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from modules.approvals.model import ApprovalWorkflow, ApprovalWorkflowMapping
from modules.errors import ConflictError, NotFoundError
from modules.features.model import Feature
from modules.permissions.model import Permission


def _permission_code_variants(required: str) -> set[str]:
    variants = {required}
    if "." in required:
        variants.add(required.replace(".", ":", 1))
    if ":" in required:
        variants.add(required.replace(":", ".", 1))
    return variants


def resolve_registered_action_code(db: Session, action_code: str) -> str | None:
    """
    Return the persisted ``permissions.code`` value for this action, if it exists.

    Permission rows are the catalog of valid actions and are tied to ``features``.
    """
    raw = action_code.strip()
    if not raw:
        return None
    for v in _permission_code_variants(raw):
        row = db.scalar(select(Permission.code).where(Permission.code == v))
        if row is not None:
            return str(row)
    return None


def get_workflow_for_action(db: Session, action_code: str) -> ApprovalWorkflow | None:
    """
    Resolve the active workflow for an RBAC action code.

    1. Active ``approval_workflow_mappings`` row for the canonical permission code, linked
       to an **active** workflow.
    2. Else legacy fallback for user creation via ``entity_type = user_creation`` workflows.
    3. Else ``None``.
    """
    raw = action_code.strip()
    canonical = resolve_registered_action_code(db, action_code)
    users_create_variants = _permission_code_variants("users.create")

    if canonical is not None:
        mapping = db.scalar(
            select(ApprovalWorkflowMapping)
            .where(
                ApprovalWorkflowMapping.action_code == canonical,
                ApprovalWorkflowMapping.is_active.is_(True),
            )
        )
        if mapping is not None:
            wf = db.scalar(
                select(ApprovalWorkflow)
                .where(
                    ApprovalWorkflow.id == mapping.workflow_id,
                    ApprovalWorkflow.is_active.is_(True),
                )
                .options(selectinload(ApprovalWorkflow.steps))
            )
            if wf is not None:
                return wf

    # Backward compatibility: old deployments used entity_type workflows for user creation.
    if (canonical is not None and canonical in users_create_variants) or raw in users_create_variants:
        from modules.approvals.service import ApprovalWorkflowService

        return ApprovalWorkflowService(db).get_active_workflow_for_entity("user_creation")

    return None


class WorkflowMappingService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def list_action_codes(self) -> list[dict[str, str]]:
        """All permission codes with their owning feature (for admin UI dropdowns)."""
        rows = self._db.execute(
            select(Permission.code, Permission.feature_id)
            .order_by(Permission.code.asc())
        ).all()
        out: list[dict[str, str]] = []
        for code, fid in rows:
            if not code:
                continue
            feat = self._db.get(Feature, fid)
            fk = str(feat.key) if feat is not None else str(fid)
            fn = str(feat.name) if feat is not None else ""
            out.append({"code": str(code), "feature_key": fk, "feature_name": fn})
        return out

    def list_mappings(self, *, active_only: bool = False) -> list[ApprovalWorkflowMapping]:
        stmt = select(ApprovalWorkflowMapping).options(
            selectinload(ApprovalWorkflowMapping.workflow)
        )
        if active_only:
            stmt = stmt.where(ApprovalWorkflowMapping.is_active.is_(True))
        stmt = stmt.order_by(ApprovalWorkflowMapping.id.desc())
        return list(self._db.scalars(stmt).unique().all())

    def create_mapping(self, *, action_code: str, workflow_id: int) -> ApprovalWorkflowMapping:
        canonical = resolve_registered_action_code(self._db, action_code)
        if canonical is None:
            raise ConflictError(
                "Unknown action_code: no matching permission exists (check features/permissions catalog)."
            )
        wf = self._db.scalar(
            select(ApprovalWorkflow)
            .where(ApprovalWorkflow.id == workflow_id)
            .options(selectinload(ApprovalWorkflow.steps))
        )
        if wf is None:
            raise NotFoundError("ApprovalWorkflow", workflow_id)
        if not wf.is_active:
            raise ConflictError("Workflow must be active before it can be assigned.")
        if not wf.steps:
            raise ConflictError("Workflow has no steps; activate only after steps exist.")

        self._db.execute(
            ApprovalWorkflowMapping.__table__.update()
            .where(
                ApprovalWorkflowMapping.action_code == canonical,
                ApprovalWorkflowMapping.is_active.is_(True),
            )
            .values(is_active=False)
        )
        row = ApprovalWorkflowMapping(
            action_code=canonical,
            workflow_id=workflow_id,
            is_active=True,
        )
        self._db.add(row)
        self._db.commit()
        reloaded = self._db.scalar(
            select(ApprovalWorkflowMapping)
            .where(ApprovalWorkflowMapping.id == row.id)
            .options(selectinload(ApprovalWorkflowMapping.workflow))
        )
        assert reloaded is not None
        return reloaded

    def deactivate_mapping(self, mapping_id: int) -> ApprovalWorkflowMapping:
        row = self._db.scalar(
            select(ApprovalWorkflowMapping)
            .where(ApprovalWorkflowMapping.id == mapping_id)
            .options(selectinload(ApprovalWorkflowMapping.workflow))
        )
        if row is None:
            raise NotFoundError("ApprovalWorkflowMapping", mapping_id)
        row.is_active = False
        self._db.commit()
        reloaded = self._db.scalar(
            select(ApprovalWorkflowMapping)
            .where(ApprovalWorkflowMapping.id == mapping_id)
            .options(selectinload(ApprovalWorkflowMapping.workflow))
        )
        assert reloaded is not None
        return reloaded
