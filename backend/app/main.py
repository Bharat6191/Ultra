import logging
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware

from admin_api.routes import router as admin_api_router
from app_api.routes import router as app_api_router
from modules.audit import AdminAuditMiddleware

logger = logging.getLogger(__name__)

app = FastAPI()
app.add_middleware(AdminAuditMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        os.getenv("FRONTEND_ORIGIN", "http://localhost:5173"),
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/admin", include_in_schema=False)
@app.get("/admin/", include_in_schema=False)
def admin_root_redirect() -> RedirectResponse:
    """
    Convenience redirect for humans in a browser.

    The admin UI is served by the frontend app; the backend mounts JSON APIs at /admin/*.
    """
    target = os.getenv("FRONTEND_ADMIN_URL", "http://localhost:5173/admin")
    return RedirectResponse(url=target, status_code=307)


@app.get("/admin/login", include_in_schema=False)
@app.get("/admin/login/", include_in_schema=False)
def admin_login_redirect() -> RedirectResponse:
    target = os.getenv("FRONTEND_ADMIN_URL", "http://localhost:5173/admin")
    return RedirectResponse(url=f"{target.rstrip('/')}/login", status_code=307)


app.include_router(app_api_router)
app.include_router(admin_api_router, prefix="/admin")


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled application error", exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})

# Serve local uploads (dev/simple deployments).
_uploads_dir = Path(__file__).resolve().parents[1] / "uploads"
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")
