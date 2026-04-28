import os

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from starlette.middleware.cors import CORSMiddleware

from admin_api.routes import router as admin_api_router
from app_api.routes import router as app_api_router
from modules.audit import AdminAuditMiddleware

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
