# TiMSuperPF — Admin RBAC + UI

This repo contains:

- **Backend**: FastAPI + SQLAlchemy + Alembic, JWT auth, RBAC (features → permissions → roles → users), audit logging, DB-backed settings (password policy).
- **Frontend**: Vite + React + TypeScript + Tailwind v4 + **shadcn/ui**
  - **User app**: `/login` → `/dashboard`
  - **Admin app**: `/admin/login` → `/admin/*`

---

## Project structure

### Backend (Python)

- `app/main.py`
  - FastAPI app entrypoint
  - Mounts:
    - **App API** at `/` (e.g. `/login`, `/me`)
    - **Admin API** at `/admin/*` (e.g. `/admin/users`)
  - Adds:
    - **AdminAuditMiddleware**
    - **CORS** middleware (dev-friendly)
  - Convenience redirects:
    - `GET /admin` → frontend admin UI
    - `GET /admin/login` → frontend login UI

- `app_api/`  
  Public app routes (currently auth).

- `admin_api/`  
  Admin/management routes aggregating module routers (users, roles, permissions, features, settings).

- `modules/`
  Domain modules:
  - `modules/auth/`: login/refresh/me, session-backed refresh tokens (`user_sessions`)
  - `modules/users/`: users CRUD + roles assignment endpoint
  - `modules/features/`: features (used to group permissions)
  - `modules/permissions/`: permissions
  - `modules/roles/`: roles with permission assignment (PATCH with `permission_ids`)
  - `modules/settings/`: DB settings + admin password policy endpoint
  - `modules/audit/`: audit log model + middleware for admin mutating routes

- `core/`
  Cross-cutting:
  - `core/security.py`: JWT encode/decode + password hashing/verification
  - `core/auth.py`: current user from Bearer token
  - `core/permissions.py`: DB-backed permission checks + superuser bypass
  - `core/password_policy.py`: enforces password rules based on DB settings
  - `core/config.py`: reads `.env` and builds runtime settings

- `db/`, `alembic/`
  SQLAlchemy setup + migrations.

### Frontend (React)

- `frontend/`
  - Vite + React + TS
  - Tailwind v4 + shadcn/ui (Radix Nova style)
  - User app routes under `/login`, `/dashboard/*` via `react-router-dom`
  - Admin UI routes under `/admin/*` via `react-router-dom`
  - API calls via `src/lib/api.ts` (adds `Authorization: Bearer <token>` automatically)

Key frontend files:

- `frontend/src/main.tsx`: `BrowserRouter` setup
- `frontend/src/App.tsx`: routes + protected user/admin shells
- `frontend/src/components/layout/admin-layout.tsx`: sidebar + topbar + user dropdown + sign out
- `frontend/src/components/layout/app-shell-layout.tsx`: user sidebar + topbar + sign out (distinct UI)
- `frontend/src/pages/`:
  - `login.tsx`: email/password login (react-hook-form + zod)
  - `app-login.tsx`: production-style split login UI for main app (`/login`)
  - `dashboard.tsx`: starter dashboard for standard users (`/dashboard`)
  - `users.tsx`: list users (create/view/edit use full-page routes)
  - `user-create.tsx`: create user (full page)
  - `user-view.tsx`: view user (full page) + audit trail (latest first)
  - `user-edit.tsx`: edit user (full page)
  - `roles.tsx`: roles list + assign permissions (checkboxes grouped by feature)
  - `permissions.tsx`: list + create permission
  - `settings.tsx`: switches + JSON editor for password policy

---

## Environment variables

### Backend (`.env` at repo root)

Minimum required:

- **`JWT_SECRET_KEY`**: required for login/JWT signing
- **`DATABASE_URL`**: your DB connection string

Optional (dev convenience):

- `FRONTEND_ADMIN_URL` (default `http://localhost:5173/admin`)
- `FRONTEND_ORIGIN` (default `http://localhost:5173`)

### Frontend (`frontend/.env`)

In dev we use Vite proxy, so you can usually leave `VITE_API_URL` **unset**.

- If `VITE_API_URL` is set, requests go directly to that origin.
- If `VITE_API_URL` is empty/unset, requests go to same-origin paths like `/login` and `/admin/*` (and Vite proxies them in dev).

---

## How to run (development)

### 1) Backend

From repo root:

```bash
source venv/bin/activate
uvicorn app.main:app --reload
```

Useful URLs:

- `GET /docs` — Swagger UI
- `GET /openapi.json`

### 2) Frontend

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open:

- **Admin UI**: `http://localhost:5173/admin`
- **Login**: `http://localhost:5173/admin/login`
- **User login**: `http://localhost:5173/login`
- **User dashboard**: `http://localhost:5173/dashboard`

---

## Dev proxy (frontend → backend)

`frontend/vite.config.ts` proxies:

- `/login` → backend (`http://localhost:8000`) **only for API/XHR** requests
  - HTML navigations like `/login` stay in the SPA so the React route renders
- `/admin/*` → backend **only for API/XHR** requests
  - HTML navigations like `/admin/login` stay in the SPA to avoid redirect loops

This lets frontend call:

- `POST /login`
- `GET /me`
- `GET /admin/users`, etc.

…without requiring `VITE_API_URL` in dev.

---

## Authentication flow

### Login

- **User app login**: UI submits `POST /login` with JSON:

```json
{ "email": "admin@admin.com", "password": "Admin123!" }
```

Or phone-based login:

```json
{ "phone": "+15550000001", "password": "Admin123!" }
```

- Response returns:
  - `access_token`
  - `refresh_token`

Frontend stores tokens in `localStorage`:

- `access_token`
- `refresh_token`

### Signed-in user

- UI calls `GET /me` with `Authorization: Bearer <access_token>`
- Top-right dropdown shows the real email from `/me`

### Sign out

- Clears tokens from `localStorage`
- Redirects to:
  - **User app**: `/login`
  - **Admin app**: `/admin/login`

### User vs admin separation (frontend)

- `/login` is the **main app** portal:
  - standard users → `/dashboard`
  - **superusers are blocked** here and must use `/admin/login`
- `/admin/*` is the **admin** portal:
  - non-superusers are redirected to `/dashboard`

---

## RBAC model (how permissions work)

High-level:

- **Feature**: a functional area (e.g. `users`, `roles`, `settings`)
- **Permission**: belongs to a feature + action (e.g. `users:create`)
- **Role**: contains many permissions
- **User**: has many roles

Backend supports:

- List/create features
- List/create permissions
- List/get/update roles with `permission_ids`
- Assign roles to a user

---

## Admin API endpoints (common)

All admin endpoints are mounted under `/admin`.

### Users

- `GET /admin/users?skip=0&limit=50`
- `POST /admin/users`
- `PATCH /admin/users/{user_id}`
- `POST /admin/users/{user_id}/roles/{role_id}` (assign role)

### Org units (plants / departments)

- `GET /admin/org-units?type=PLANT`
- `POST /admin/org-units`

### Roles

- `GET /admin/roles?skip=0&limit=50`
- `GET /admin/roles/{role_id}` (includes `permissions`)
- `PATCH /admin/roles/{role_id}` with `{ "permission_ids": [1,2,3] }`

### Features

- `GET /admin/features?skip=0&limit=200`
- `POST /admin/features`

### Permissions

- `GET /admin/permissions?skip=0&limit=200`
- `POST /admin/permissions`

### Settings (password policy)

- `GET /admin/settings/password-policy`
- `PUT /admin/settings/password-policy`

Password policy keys are stored in the DB settings table:

- `password.min_length`
- `password.require_uppercase`
- `password.require_lowercase`
- `password.require_digit`
- `password.require_special`
- `password.max_age_days` (`0` disables expiry)

---

## Admin UI pages (what exists)

All pages are under `http://localhost:5173/admin/*`:

- **Overview**: `/admin`
- **Users**: `/admin/users`
  - Table list users
  - Full-page flows:
    - Create: `/admin/users/new`
    - View: `/admin/users/:id` (shows **Audit Trail** below user details; latest first)
    - Edit: `/admin/users/:id/edit`
- **Roles**: `/admin/roles`
  - Select role
  - Assign permissions with checkboxes grouped by feature
  - Save writes to `PATCH /admin/roles/{id}`
- **Permissions**: `/admin/permissions`
  - Table list permissions
  - Create permission dialog (feature_id + action)
- **Settings**: `/admin/settings`
  - Switches + numeric fields + JSON editor for password policy

---

## User UI pages (what exists)

All pages are under `http://localhost:5173/*`:

- **Login**: `/login` (split-screen login)
- **Dashboard**: `/dashboard` (starter user shell with left sidebar + top navbar)
- **Users** (when permitted): `/dashboard/users`
  - Full-page flows:
    - Create: `/dashboard/users/new`
    - View: `/dashboard/users/:id` (shows **Audit Trail** below user details; latest first)
    - Edit: `/dashboard/users/:id/edit`

---

## Creating a superuser

From repo root:

```bash
source venv/bin/activate
python create_superuser.py --email admin@admin.com --password "Admin123!"
```

Notes:

- Password is validated using the **DB-backed password policy**.
- The script imports `db.models` so SQLAlchemy relationships are registered before DB queries.

---

## Common troubleshooting

### `RuntimeError: JWT_SECRET_KEY is required`

Set it in the repo root `.env`:

```bash
JWT_SECRET_KEY="your-long-random-secret"
```

Restart uvicorn.

### `OPTIONS /login 405 Method Not Allowed`

Fixed by enabling CORS middleware in `app/main.py`.

### `/admin/login` redirect loop in dev

Fixed by Vite proxy `bypass` that prevents proxying HTML navigations for `/admin/*`.

### Logged in but “blank page”

Was caused by nested routers not rendering an `<Outlet />`. The `/admin` route now renders `<Outlet />` correctly.

---

## Next steps (nice-to-haves)

- Add “Create role” UI and “Create feature” UI (optional; APIs already exist).
- Add refresh-token handling (auto refresh on 401).
- Add audit log page (`/admin/audit`) backed by API.
- Improve user app routes under `/dashboard/*` (master data, planning, performance, etc.).

