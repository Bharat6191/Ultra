"""Aggregate public / app API routers — mounted at ``/``."""

from fastapi import APIRouter

from modules.auth.routes import router as auth_router
from modules.auth.mfa_routes import router as mfa_router
from modules.approvals.router import router as approvals_router
from modules.audit.router import router as audit_router
from modules.dashboard.app_router import router as dashboard_router
from modules.tasks.router import router as tasks_router
from modules.contractor.router_app import router as contractors_router
from modules.contractor_rates.router_app import router as contractor_rates_router
from modules.work_orders.router_app import router as work_orders_router
from modules.invoices.router_app import router as invoices_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(mfa_router)
router.include_router(approvals_router)
router.include_router(audit_router)
router.include_router(dashboard_router)
router.include_router(tasks_router)
router.include_router(contractors_router)
router.include_router(contractor_rates_router)
router.include_router(work_orders_router)
router.include_router(invoices_router)
