"""Admin re-mount for the negotiation workflow.

Re-uses the same APIRouter as ``router_app`` so handlers / dependencies stay
identical; superuser enforcement is applied at the admin top-level router
(see ``backend/admin_api/routes.py``).
"""

from __future__ import annotations

from fastapi import APIRouter

from modules.contractor_rates.router_app import router as app_router


router = APIRouter()
router.include_router(app_router)
