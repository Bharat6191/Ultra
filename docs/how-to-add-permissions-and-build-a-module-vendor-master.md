# How to add permissions + create a new module (Vendor Master)

This repo uses **DB-backed RBAC** (permissions live in the database) with a **declarative catalog** in `backend/modules/module_config.py` that can be synced into the DB using `scripts/sync_modules.py`.

This document shows the **end-to-end flow** to:

- add a new permission / module permissions
- build a new module called **Vendor Master** (DB table → FastAPI CRUD → RBAC guards → Admin/User UI screens)

---

## What “permission” means in this repo

- **Backend enforcement is the source of truth**:
  - `core/permissions.py`
  - Route handlers add guards like `Depends(require_permission("users.view"))`.
- **Frontend uses a cached snapshot** only to show/hide UI:
  - `frontend/src/lib/permissions.ts` stores `permissions[]` from `GET /me` into `localStorage`
  - `frontend/src/components/admin/require-permission.tsx` gates pages/components

Permission codes are **dotted** strings like:

- `users.view`
- `org_units.create`
- `approval.manage`

Legacy `module:action` is still accepted for the **first separator only** (both backend + frontend treat `users.view` and `users:view` as equivalent).

---

## A) Add permissions (the “correct” flow)

In this codebase, the recommended way is:

1. Add your module + actions to `backend/modules/module_config.py`
2. Run `python scripts/sync_modules.py`
3. Assign permissions to roles in the UI or via the Roles API

### A1) Add your module to `backend/modules/module_config.py`

`MODULE_CONFIG` is the canonical catalog.

For Vendor Master, add something like:

- module key: `vendor_master`
- actions: usually CRUD → `view/create/update/delete`

You’ll end up with permission codes like:

- `vendor_master.view`
- `vendor_master.create`
- `vendor_master.update`
- `vendor_master.delete`

### A2) Sync the catalog into the database

Run from repo root (same DB as your app uses):

```bash
./venv/bin/python scripts/sync_modules.py
```

This will create (if missing):

- a `features` row for the module
- `permissions` rows for each action with the correct `code`

### A3) Assign permissions to a role

Options:

- **UI**: Admin → Roles → choose role → check permissions → save
- **API**: `PATCH /admin/roles/{role_id}` with `permission_ids`

### A4) Verify

- Call `GET /me` and confirm `permissions[]` includes your new codes.
- Try the API endpoint guarded with your permission:
  - missing permission → **403**
  - with permission → **200/201**

---

## B) Create a new backend module: Vendor Master (FastAPI + SQLAlchemy)

This repo’s module shape is consistent (see `backend/modules/org_units/*` and `backend/modules/users/*`):

- `backend/modules/<module>/model.py` (SQLAlchemy table)
- `backend/modules/<module>/schema.py` (Pydantic request/response)
- `backend/modules/<module>/service.py` (business logic)
- `backend/modules/<module>/router.py` (FastAPI endpoints)

### B0) Decide the API surface + permission mapping

Suggested endpoints (admin namespace):

- `GET /admin/vendors` → requires `vendor_master.view`
- `POST /admin/vendors` → requires `vendor_master.create`
- `PATCH /admin/vendors/{id}` → requires `vendor_master.update`
- `DELETE /admin/vendors/{id}` → requires `vendor_master.delete` (optional)

### B1) Create the DB model (`backend/modules/vendor_master/model.py`)

Typical patterns in this repo:

- inherit from `db.base.Base`
- use `mapped_column(...)`
- use `created_at` / `updated_at` server timestamps if the data is “master data”

Common Vendor fields:

- `code` (unique)
- `name`
- `email` (optional)
- `phone` (optional)
- `is_active` (boolean)

### B2) Add schemas (`backend/modules/vendor_master/schema.py`)

Follow the existing style:

- `VendorCreate`
- `VendorUpdate` (all optional fields)
- `VendorPublic` (response model)

### B3) Implement the service (`backend/modules/vendor_master/service.py`)

Keep DB access here:

- list with pagination
- create
- update
- delete (or soft-delete / `is_active=false`)

Raise repo-standard errors if needed (see `modules/errors.py` usage in other modules).

### B4) Add the router (`backend/modules/vendor_master/router.py`)

Follow `modules/org_units/router.py` pattern:

- `router = APIRouter(prefix="/vendors", tags=["admin", "vendor-master"])`
- `Depends(require_permission("vendor_master.view"))` etc.

### B5) Register the router under `/admin`

Add an include in `backend/admin_api/routes.py`:

- `from modules.vendor_master.router import router as vendor_master_router`
- `router.include_router(vendor_master_router)`

### B6) Make sure Alembic sees the new model (important)

This repo registers models by importing `db.models` (with `backend/` on the import path).

So you must ensure your new model is imported somewhere under `db/models/__init__.py` (directly or indirectly), otherwise:

- `alembic revision --autogenerate` won’t see the table (use `alembic -c backend/alembic.ini ...`)
- metadata might not include your model in certain scripts/tests

### B7) Create & run a migration

Create migration (autogenerate is recommended after model registration):

```bash
alembic -c backend/alembic.ini revision --autogenerate -m "add vendor master"
alembic -c backend/alembic.ini upgrade head
```

Then confirm the table exists in your DB.

---

## C) Add Vendor Master to the UI (React)

This repo has two shells:

- **Admin console**: `/admin/*`
- **User workspace**: `/dashboard/*`

Both can host the same module screens; you decide which shell should show it.

### C1) API calls

Frontend API calls typically go through `frontend/src/lib/api.ts` (adds the Bearer token).

Create API helpers:

- `listVendors()`
- `createVendor()`
- `updateVendor()`

### C2) Create a page

Suggested file:

- `frontend/src/pages/vendors.tsx`

Implement:

- table list
- create dialog or full-page create route
- edit dialog or full-page edit route

### C3) Add the route

Routes are defined in `frontend/src/App.tsx`.

Add:

- `/admin/vendors` (Admin console) and/or
- `/dashboard/vendors` (User workspace)

Wrap the page with `RequirePermission`:

- `code="vendor_master.view"` for the list screen
- buttons for create/update should also check `vendor_master.create` / `vendor_master.update`

### C4) Add the nav item (sidebar)

- Admin sidebar: `frontend/src/components/layout/admin-layout.tsx`
- Workspace sidebar: `frontend/src/components/layout/app-shell-layout.tsx`

Show/hide based on:

- `hasPermission("vendor_master.view")` (or broader checks if you want)

---

## D) Quick end-to-end checklist (Vendor Master)

- **DB**
  - [ ] add `Vendor` model
  - [ ] register it under `db.models`
  - [ ] create migration + upgrade
- **RBAC**
  - [ ] add `vendor_master` module in `modules/module_config.py`
  - [ ] run `python scripts/sync_modules.py`
  - [ ] assign permissions to a role
  - [ ] verify `GET /me` includes the permission codes
- **Backend**
  - [ ] create `modules/vendor_master/{schema,service,router}.py`
  - [ ] include router in `admin_api/routes.py`
  - [ ] verify endpoints in Swagger (`/docs`)
- **Frontend**
  - [ ] add `frontend/src/pages/vendors.tsx`
  - [ ] add route(s) in `frontend/src/App.tsx`
  - [ ] add sidebar link(s)
  - [ ] wrap with `RequirePermission`

---

## Common mistakes (and how to avoid them)

- **“I added the model but Alembic didn’t generate a table.”**
  - You probably didn’t import the model via `db.models` / `db/models/__init__.py`.

- **“UI shows the menu but API returns 403.”**
  - UI permission checks are only a snapshot; the backend enforces the real DB permissions.
  - Make sure your user actually has a role with `vendor_master.*` permissions.

- **“I added module_config but permissions don’t appear in Roles UI.”**
  - Run `python scripts/sync_modules.py` against the same DB your app is using.

