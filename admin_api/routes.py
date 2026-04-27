"""Aggregate admin (management) API routers — mounted at ``/admin``."""

from fastapi import APIRouter, Depends

from core.config import get_settings
from core.permissions import require_superuser
from modules.features.router import router as features_router
from modules.org_units.router import router as org_units_router
from modules.approvals.admin_router import router as approval_workflows_router
from modules.approvals.mappings_admin_router import router as workflow_mappings_router
from modules.emails.admin_router import router as email_templates_router
from modules.permissions.router import router as permissions_router
from modules.roles.router import router as roles_router
from modules.settings.router import router as settings_router
from modules.users.router import router as users_router

_admin_dependencies = []
if get_settings().enforce_superuser_on_admin:
    _admin_dependencies.append(Depends(require_superuser()))

router = APIRouter(dependencies=_admin_dependencies)
router.include_router(users_router)
router.include_router(org_units_router)
router.include_router(features_router)
router.include_router(approval_workflows_router)
router.include_router(workflow_mappings_router)
router.include_router(email_templates_router)
router.include_router(permissions_router)
router.include_router(roles_router)
router.include_router(settings_router)
