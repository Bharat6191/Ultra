"""Admin-mounted contractor router.

This wraps the same handlers exposed by ``router_app`` but is mounted under ``/admin``
so admin tooling can call ``/admin/contractors/*`` consistently with other admin APIs.
The handlers themselves use RBAC permission codes; superuser enforcement is applied at
the admin top-level router (see ``backend/admin_api/routes.py``).
"""

from __future__ import annotations

from fastapi import APIRouter

from modules.contractor.router_app import router as app_router


router = APIRouter()
# Re-mount the same APIRouter (path/dependencies preserved) under the admin prefix.
router.include_router(app_router)
