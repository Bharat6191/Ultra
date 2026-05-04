## Implementation notes (what we built, and how)

This document describes the work completed so far in this repo:

- **Backend**: RBAC with dotted permission codes, `org_units` (Plants) as its own module, strict route guards, and **OR**-style guards where one API serves multiple workflows.
- **Frontend**: **User workspace** (`/login` → `/dashboard/*`) with RBAC-gated sidebar; **Superadmin console** (`/admin/login` → `/admin/*`) superuser-only; shared JWT + `/me` permission snapshot in `localStorage`.
- **Dev ergonomics**: Vite proxy so browser `GET /login` does not hit FastAPI.

---

## 1) Backend: RBAC and permission enforcement

### Core mechanics

- **`core/permissions.py`**
  - **`require_permission(code, *more)`** — caller must have **all** listed codes (typically one code).
  - **`require_any_permission(code, *alternatives)`** — caller must have **at least one** of the listed codes (OR). Used where a single endpoint supports more than one product flow.
  - Loads **user → roles → permissions** from the DB; **superuser** bypasses checks.
  - **TTL cache** (~30s) for permission snapshots; **`invalidate_permission_cache(...)`** for tests and after RBAC mutations.
  - Permission codes use **dotted** form (e.g. `users.view`); legacy **`module:action`** is still accepted for the first separator only.

- **`core/auth.py`** — JWT Bearer parsing, **`get_current_user`**.

- **`modules/module_config.py` + `modules/rbac_sync.py`**
  - Declarative modules/tabs/actions; sync script seeds **`features`** / **`permissions`** rows.
  - Modules include: **users**, **org_units** (Plants), **roles**, **permissions**, **settings**, **features**.
  - Run from project root (with `DATABASE_URL` / same DB as the app):  
    `python scripts/sync_modules.py`
  - With the `backend/` folder structure, Alembic lives under `backend/`:
    `alembic -c backend/alembic.ini upgrade head`

- **`alembic/versions/011_org_units_rbac_permissions.py`**
  - Seeds **`org_units`** feature and **`org_units.view|create|update|delete`** if missing (alongside sync).

### Org units (plants): two different concerns

| Action | Permission | Purpose |
|--------|------------|---------|
| **`GET /admin/org-units`** | **Any of** `org_units.view`, `users.create`, `users.update`, `roles.create`, `roles.update`, `contractor.view`, **`contractor.update`**, `contractor.manage_plants` | List plants for **Plants admin UI**, **user/role pickers**, **contractor list plant filter**, and **contractor plant-mapping dialog** without granting org-unit admin rights. |
| **`POST /admin/org-units`** | **`org_units.create`** only | Create a new plant (org unit). Does **not** use user permissions. |

This keeps **plant CRUD** under **`org_units.*`** while allowing **user/role assignment** pickers without granting Plants module view.

### Other admin routes (representative)

- **Users** — `users.view` / `users.create` / `users.update` on list, create, patch.
- **Roles** — guarded per router (e.g. create/update).
- **Permissions / features / settings** — per `require_permission` on each handler.

### Tests

- `tests/test_permissions.py` — 403 / allow / superuser patterns.
- `tests/test_rbac_sync.py` — sync creates canonical codes (includes **`org_units.view`** after sync).

---

## 2) Frontend: user workspace vs superadmin console

### Two portals

| Portal | Login | Main UI | Who |
|--------|-------|-----------|-----|
| **User workspace** | `/login` | `/dashboard/*` | All non–superuser accounts (and superusers are redirected away). |
| **Superadmin console** | `/admin/login` | `/admin/*` | **Superuser only**; others with a token are redirected to `/dashboard`. |

### Routing (`frontend/src/App.tsx`)

- **`AppRoute`** (`/dashboard/*`): loads **`GET /me`**, **`persistAuthFromMe`**. If **`is_superuser`**, redirect to **`/admin`**.
- **`AdminRoute`** (`/admin/*`): if not superuser after **`/me`**, redirect to **`/dashboard`**. Otherwise **`AdminLayout`** + nested routes.
- **Workspace management screens** live under **`/dashboard/*`** (Users, Plants, Roles, Permissions, System settings) with **`RequirePermission`** on each route — same pages/APIs as admin, but shell is **`AppShellLayout`**.

### User workspace shell (`frontend/src/components/layout/app-shell-layout.tsx`)

- **Layout**: full-width main area (`px-6 py-6`), off-white page background; **sticky top navbar** (`AppNavbar`) and **left sidebar** (`AppSidebar`, `w-64`, `bg-gray-50`, active row `bg-muted rounded-lg`).
- **Navbar**: dynamic page title; **no search in navbar**; notifications placeholder; profile (avatar + email on wide screens). Sign-out in profile menu.
- **Sidebar**: Dashboard, then **all RBAC-gated items** the user is allowed to see — including **Users**, **Plants**, **Roles**, **Permissions**, **System settings**, **Contractors**, **My tasks** (each item gated by the same permission rules as routes below).
- **Plants** nav: any of **`org_units.view|create|update|delete`** (Plants **module** only).
- **My tasks** nav: **`approval.view` OR `task.view`** (matches `App.tsx` route guard for `/dashboard/tasks`).
- **`canListOrgUnitsForAssignments()`** — mirrors **`GET /admin/org-units`** OR rule (includes **`contractor.view`**, **`contractor.update`**, **`contractor.manage_plants`**); used to load plant dropdowns on **Users** / **Roles** / **contractors** pages without requiring **`org_units.view`**.

### Auth snapshot (`frontend/src/lib/permissions.ts`)

- **`persistAuthFromMe` / `clearAuthProfile`** — store **`is_superuser`** and **`permissions[]`** from **`/me`** in `localStorage`.
- **`hasPermission(code)`** — UI checks (superuser = all true).
- Helpers: **`canListOrgUnitsForAssignments`**.

### Key files

| Area | File |
|------|------|
| Routes | `frontend/src/App.tsx` |
| User login | `frontend/src/pages/app-login.tsx` (identifier **email or username**; superuser blocked; must use `/admin/login`) |
| Admin login | `frontend/src/pages/login.tsx` (identifier **email or username**) |
| Workspace layout | `frontend/src/components/layout/app-shell-layout.tsx` |
| Workspace navbar / sidebar / page header | `frontend/src/components/layout/AppNavbar.tsx`, `AppSidebar.tsx`, `PageHeader.tsx` |
| Admin layout | `frontend/src/components/layout/admin-layout.tsx` |
| Permission gate | `frontend/src/components/admin/require-permission.tsx` |
| Users UI | `frontend/src/pages/users.tsx` — **View** (read-only dialog), **Edit** only with **`users.update`**; plant column and pickers aligned with **`canListOrgUnitsForAssignments`**; table/header styling for workspace |
| Plants UI | `frontend/src/pages/plants.tsx` — create uses **`org_units.create`** |
| Roles UI | `frontend/src/pages/roles.tsx` — plant lists when **`canListOrgUnitsForAssignments`** |

---

## 3) Frontend auth flow

### Endpoints

- **`POST /login`** → `access_token`, `refresh_token`
- **`GET /me`** → profile + **`is_superuser`** + **`permissions`** (flat codes for RBAC snapshot)

### User login (`/login`)

- **Identifier**: users may sign in with **email or username** in the first field; the client sends it as JSON `email` (backend `LoginRequest` accepts `username` as an alias and normalizes non-`@` identifiers to username vs phone).
- Stores tokens, calls **`/me`**, **`persistAuthFromMe`**.
- If **superuser**: clear tokens, error directing to **`/admin/login`**.
- Else: navigate to **`/dashboard`**.

### Token + `/me` on workspace

- **`AppRoute`** refreshes **`/me`** so sidebar permission checks stay in sync (e.g. **`Outlet`** keyed after load).

---

## 4) Dev proxy (Vite): `GET /login` vs API

**Problem**: Vite proxied browser navigation **`GET /login`** to FastAPI → **405** (only **`POST /login`** exists).

**Fix**: **`frontend/vite.config.ts`** — proxy **`/login`** to the backend only for API-style requests; HTML navigations serve the SPA.

---

## 5) How to verify quickly

### RBAC

- User missing a permission on an admin route → **403**.
- Superuser → allowed (and full permission list in **`/me`** for UI).

### Portals

- **`/login`** → standard user → **`/dashboard`**; superuser → message, use **`/admin/login`**.
- **`/admin/login`** → superuser → **`/admin`**; non-superuser with token → redirected to **`/dashboard`**.

### Plants vs user creation

- Role with **`users.create`** but **no** **`org_units.view`**: can still open **Create user** and load **plant dropdown** (same **`GET /admin/org-units`** OR rule).
- **Plants** sidebar tab and plant **creation** still require **`org_units.*`** as configured in nav and **`POST /admin/org-units`**.

### DB / catalog

- After pulling code: **`alembic upgrade head`** and/or **`python scripts/sync_modules.py`** so **`org_units`** rows exist and the Permissions/Roles UI catalog matches **`MODULE_CONFIG`**.

---

## 6) Notes / possible next steps

- Optional: backend guardrails for “admin UI only for superuser” in addition to frontend redirects.
- Tests: pytest fixtures that register **OrgUnit** (and related tables) on **`Base.metadata`** for in-memory runs if you expand integration tests around org-units.

---

## 7) Production Readiness Improvements

### RBAC Audit Logs

- Added dedicated RBAC change tracking in the table **`rbac_audit_logs`**.
- This log records **who** changed RBAC (**`actor_user_id`**), **what** was changed (**`target_type`** + **`target_id`**), **which action** occurred (create/update/delete/assign), and **before/after** snapshots (**`old_value`** / **`new_value`**, JSON).
- Logged RBAC mutations include:
  - Role creation and update
  - Permission creation and deletion
  - User-role assignment (both initial role at user creation and subsequent role changes)

### Permission Versioning

The permission snapshot cache in **`core/permissions.py`** previously relied on a TTL (~30s), which can still serve stale permissions after RBAC changes.

Fix: introduce version counters and include them in the cache key.

- Version keys (stored in DB):
  - **`company_permission_version:{company_id}`** → implemented by **`rbac_company_permission_versions`** (single-tenant default company id = `1`)
  - **`user_permission_version:{user_id}`** → implemented by **`rbac_user_permission_versions`**
- New permission cache key format:
  - `permissions:{user_id}:{company_version}:{user_version}`
- On RBAC changes:
  - Company version is incremented for role/permission mutations.
  - User version is incremented for user-role assignment (and for users affected by a role change).
- TTL remains as a fallback, but the version mismatch forces a cache miss immediately after RBAC changes.

### Backend Admin Enforcement

- Added **`require_superuser()`** dependency for backend-only superadmin enforcement.
- Admin router can enforce superuser on **all** `/admin/*` endpoints when **`ENFORCE_SUPERUSER_ON_ADMIN=true`** is set.
  - This is an opt-in switch to avoid breaking existing non-superuser workflows that use `/admin/*` APIs.

### Safety Checks

RBAC mutations now include guardrails to prevent lockouts:

- Prevent a user from changing a role in a way that removes their own `users.view` access (when they are assigned that role).
- Prevent assigning yourself a role that removes `users.view`.
- Prevent deleting a role if it would strand users with no roles.
- Prevent updates that would remove the last role-based admin-capable account (unless a superuser exists, or the system is already misconfigured and needs recovery).
- Optional guard: prevent setting a role’s permissions to an empty set.

### Auth Protection

- Added basic `/login` protections:
  - Rate limit total login attempts per IP (per-minute budget).
  - Track failed logins and apply a temporary lockout after repeated invalid credentials.
- Implementation is intentionally simple and in-memory (suitable for single-instance deployments; replace with Redis/shared store when running multiple replicas).

---

## 8) Approval Workflow Engine

### Overview

We added a lightweight, role-based approval workflow engine to support “human-in-the-loop” operations without introducing a full BPM system. Workflows are configured by superadmin and executed step-by-step, assigning approval tasks to users who have a configured **approver role**.

The first supported use case is **User Creation Approval** (`entity_type = "user_creation"`), but the data model and engine are generic for future entity types.

### Tables

- **`approval_workflows`**: workflow definition (`name`, `entity_type`, `is_active`, `created_by`, timestamps)
- **`approval_steps`**: ordered steps (`step_order`, `approver_role_id`, `required_approvals`)
- **`approval_requests`**: workflow instance for a specific entity (`entity_type`, `entity_id`, `status`, `current_step`, `payload`)
- **`approval_tasks`**: per-approver assignments for a step (`assigned_user_id`, `status`, `acted_at`)
- **`approval_actions`**: immutable action history (`approve` / `reject`, optional comment)

### Flow (User creation example)

When an admin creates a user via **`POST /admin/users`**:

1. The backend checks for an **active workflow** for `entity_type = "user_creation"`.
2. If a workflow exists:
   - The created user is set to **inactive** (`is_active = false`).
   - An **`approval_requests`** row is created with a safe `payload` snapshot (no password stored).
   - Step 1 **`approval_tasks`** are created for all active users who have the step’s `approver_role_id`.
3. Approvers review their tasks and act via **`POST /approvals/tasks/{task_id}/action`**.
4. When the last step reaches its `required_approvals`, the request is finalized:
   - The user becomes **active** (`is_active = true`).
   - A password setup email is triggered (minimal stub sender for now).

If no active workflow exists, user creation behaves as before (user is active immediately).

### How roles are used for approvals

Each approval step is tied to a single **approver role** (`approver_role_id`). Tasks are assigned to all **active users** who currently have that role. This reuses the existing RBAC role membership model (no separate approver lists).

### APIs + permissions

- **Workflow management (superadmin)**:
  - `POST /admin/approval-workflows` (create)
  - `GET /admin/approval-workflows` (list)
  - `POST /admin/approval-workflows/{id}/steps` (add step)
  - `PATCH /admin/approval-workflows/{id}/activate` (activate; only one active per `entity_type`)
- **Approver/user APIs**:
  - `GET /approvals/my-tasks`
  - `GET /approvals/requests/{id}`
  - `POST /approvals/tasks/{task_id}/action`

New permissions:

- **`approval.view`**: view assigned tasks / requests
- **`approval.act`**: approve/reject assigned tasks
- **`approval.manage`**: configure workflows (superadmin-only endpoints)

### Future extensibility

The engine is designed around `entity_type` + `entity_id` + `payload` snapshots, so additional approval flows (assets, settings changes, org unit provisioning, etc.) can be implemented by:

- defining a new `entity_type` string
- adding a finalization handler for that entity type (optional)
- creating requests + tasks via the same engine service

---

## 9) Workflow Assignment Layer

### Purpose

Approval triggering used to be tied to legacy identifiers like `entity_type="user_creation"`. The **workflow assignment layer** removes that hardcoding for supported actions by letting a superadmin map an **RBAC permission code** (`action_code`, e.g. `users.create`) to an **approval workflow**.

### Table structure (`approval_workflow_mappings`)

- **`action_code`**: canonical permission string (matches a row in `permissions.code`, which is owned by a `features` row).
- **`workflow_id`**: FK to `approval_workflows`.
- **`is_active`**: whether this mapping row is the current assignment (older rows may be retained with `is_active=false` for audit).
- **Constraint**: at most **one active mapping per `action_code`** (Postgres partial unique index on `action_code` where `is_active` is true).

### Flow (`action_code` → workflow → approval)

1. On user creation, the backend calls `get_workflow_for_action("users.create")`.
2. That helper:
   - looks up an **active mapping** for the canonical permission code, and ensures the linked workflow is **active**;
   - otherwise falls back to the legacy **`entity_type=user_creation`** active workflow (backward compatible);
   - otherwise returns **no workflow** (user stays active immediately).
3. When a workflow is returned, the existing approval engine creates the `approval_requests` / `approval_tasks` rows as before.

### Admin APIs

- `GET /admin/workflow-mappings/action-codes` — list all catalog permission codes (with owning feature metadata) for UI dropdowns.
- `GET /admin/workflow-mappings` — list mapping rows.
- `POST /admin/workflow-mappings` — assign `action_code` → `workflow_id` (requires an **active** workflow with steps).

These endpoints are **superadmin-only** and reuse `approval.manage` alongside the existing workflow configuration routes.

### Admin UI

Superadmin sidebar includes **Workflow Assignment**: pick an action from the catalog, pick an active workflow, and save the mapping; the page also lists current mappings.

### Backward compatibility

- `approval_requests.entity_type` is still populated (e.g. `user_creation`) so finalization logic and reporting continue to work.
- Deployments that have **not** created a mapping yet keep working via the **`user_creation`** workflow fallback for `users.create`.

---

## 10) Task Inbox & Audit Timeline

### My Tasks concept

Approvers with **`approval.view`** see an **inbox** of approval **tasks** assigned to them: each row ties a **task** to an **approval request**, the **entity** under review (for example a pending user creation), and the **workflow step** they are responsible for. **`approval.act`** is required to **approve** or **reject** from the UI or API.

### Timeline concept

For a given domain entity (for example a user id after creation is wired to the approval payload), **`GET /audit/entity/{entity_type}/{entity_id}`** returns a **read-only, ordered timeline**: request **created**, each recorded **approval action**, and a synthetic entry for the **current pending** step (including who still needs to act when known). This complements RBAC audit logs by focusing on the **approval lifecycle** for that entity.

### APIs added or enriched

- **`GET /approvals/my-tasks`** — enriched list: task and request ids, entity, **`action_code`**, step position (**`current_step` / `total_steps`**), optional **`step_name`**, initiator (**`created_by`** / display name), **`created_at`**, **`payload_preview`** (non-sensitive fields only), and task **`status`**.
- **`GET /approvals/requests/{id}/status`** — **`current_step`**, **`total_steps`**, **`pending_approvers`**, **`approved_count`**, **`required_approvals`**, plus overall request status.
- **`GET /audit/entity/{entity_type}/{entity_id}`** — unified timeline for viewers allowed to see that entity’s approval history (requires **`approval.view`**); path `entity_type` may use a short alias (for example **`user`**) mapped to the stored approval **`entity_type`** where applicable.

### Example flow (user creation)

1. An operator with **`users.create`** submits a new user; the engine creates an **`approval_request`** with **`entity_type=user_creation`**, snapshots a safe **`payload`**, and opens **tasks** for the first workflow step.
2. Each approver opens **My tasks**, sees the **action** and **entity preview**, and uses **Approve** or **Reject** (requires **`approval.act`**).
3. **View details** loads **request status** (progress) and the **audit timeline** for that entity so reviewers see **who created**, **who approved**, **when**, and **what is still pending**.

---

## 11) Dynamic Dashboard System (module-based)

We added a modular, permission-driven dashboard system for the **user workspace** (`/dashboard`) where the UI automatically composes dashboard sections based on the modules a user can access.

### Backend API

- `GET /dashboard/summary`
  - Returns a `modules` object where each key is a module dashboard payload.
  - Module enablement is derived from the caller’s permissions snapshot (same DB-backed RBAC as the rest of the system).

Module detection rules (current):

- **Users dashboard** enabled when the user has `users.view`.
- **Tasks dashboard** enabled when the user has `approval.view` or `task.view` (the system has both approval-style and unified task permissions).
- **Contractors dashboard** enabled when the user has any of `contractor.view`, `contractor.create`, or `contractor.update` (KPIs, status mix, expiring documents, contractors-by-plant).

**Database note:** contractor lifecycle uses a **`contractors.status`** column (draft / pending / active / suspended / etc.), introduced in Alembic **`032_contractor_enterprise_upgrade`**. It is **not** the same as **`contractors.state`** (Indian state / region on the address). If **`GET /dashboard/summary`** errors with *column contractors.status does not exist*, run **`alembic upgrade head`** from `backend/` (see §1).

Response shape (high-level):

- `modules.users`
  - `total_users`, `active_users`, `inactive_users`, `new_users_last_7_days`
  - `users_by_role`: distinct user counts per role
- `modules.tasks`
  - `pending`, `approved`, `rejected`, `completed`
  - `completed` is treated as “finished work” and aggregates `approved + completed + closed` statuses for tasks assigned to the current user.
- `modules.contractors` (when enabled)
  - Totals by lifecycle **status**, document expiry counts, **by_status** breakdown, **contractors_by_plant** (joins `contractor_plants` → `org_units`).

Files:

- `modules/dashboard/app_router.py`
- Registered in `app_api/routes.py`

### Frontend composition

- `frontend/src/pages/dashboard.tsx`
  - Fetches `GET /dashboard/summary`
  - Renders module sections dynamically (no hardcoded numbers)
  - Shows an empty-state card when no module dashboards are available

Module components:

- `frontend/src/components/dashboard/user-dashboard.tsx`
  - Stats cards + charts (Recharts):
    - Users by role (bar)
    - Active vs inactive (donut)
- `frontend/src/components/dashboard/task-dashboard.tsx`
  - Stats cards + chart (Recharts):
    - Pending / Approved / Rejected / Completed

### Charts + theming

- Chart library: `recharts` (frontend dependency)
- Dashboard uses an emerald accent / dark header style to keep a “green on black” feel while staying consistent with the rest of the ShadCN UI.

---

## 12) Workspace UI refresh, contractors, auth, and dev seed data

### Global design system (ShadCN primitives)

Shared styling is centralized on the UI primitives so most pages pick up the same look without one-off classes:

- **`frontend/src/components/ui/button.tsx`** — primary emerald, outline/secondary/ghost/destructive variants; default height `h-10`, `rounded-xl`, icon+label `gap-2`.
- **`frontend/src/components/ui/card.tsx`** — `rounded-2xl`, border, `shadow-sm`, consistent header/content padding.
- **`frontend/src/components/ui/input.tsx`** — `h-10`, `rounded-lg`, emerald-tinted focus ring.
- **`frontend/src/components/ui/badge.tsx`** — added semantic variants (`success`, `warning`, `error`) for status chips.
- **`frontend/src/components/ui/table.tsx`** — header `bg-gray-50`, uppercase muted labels; body cells `px-6 py-4`; row hover/border-b via table defaults.
- **`frontend/src/index.css`** — workspace background token tuned toward **gray-50**.

Reusable layout pieces (workspace):

- `PageHeader`, `DataTable` (card wrapper for tables), `EmptyState`, contractor-specific `ContractorCharts` / `ContractorDashboard` (used on the **main** `/dashboard` contractors section).

### Contractors (app workspace)

- **Route**: `/dashboard/contractors` is the **directory** (list + filters + table). Detail: `/dashboard/contractors/:id`, create: `/dashboard/contractors/new`.
- **Document upload**: `POST /contractors/{id}/documents` uses multipart parsing; **`python-multipart`** is listed in `requirements.txt` and required in the venv (Starlette asserts otherwise).
- **View uploaded files**: API returns paths like `/uploads/...`. The UI resolves relative URLs with **`API_BASE_URL`** so “View” opens the FastAPI static mount, not the Vite app route.
- **Dashboard widgets on `/dashboard`**: summary from `GET /dashboard/summary` plus optional charts (`ContractorCharts`) and KPI cards (`ContractorDashboard`) when the contractors module is enabled; **“Open directory”** links to `/dashboard/contractors` (not a removed `/directory` path).

### Contractor plants, timeline, and RBAC

- **Plant mapping** (contractor ↔ plant `org_unit`, role, effective dates) is implemented in **`ContractorPlants`** (`frontend/src/components/contractors/ContractorPlants.tsx`) against **`GET/POST/PATCH/DELETE /contractors/{id}/plants`**.
- **Mutations** (`POST` / `PATCH` / `DELETE` plant mappings) require **`contractor.manage_plants` OR `contractor.update`** (backend mirrors the same OR guard). The **Add mapping** button and row actions use that combined rule so editors with **`contractor.update`** are not blocked when they lack the narrower **`contractor.manage_plants`** permission.
- **Plant catalog** for the picker uses **`GET /admin/org-units?type=PLANT`**, which also allows **`contractor.update`** (see §1 org-units table) so the dialog can load plants without **`org_units.view`**.
- **Timeline** tab: **`GET /contractors/{id}/timeline`** merges **`contractor_audit_logs`** with contractor-related **approval** activity (`modules/contractor/timeline.py`). Rich history appears when the service writes audit rows on create/update/documents/plants; synthetic demo rows can be seeded (see below).

### Login: email or username

- **Workspace** (`app-login.tsx`): first field is text (“Email or username”), still posts `{ email: "<identifier>", password }` for backend normalization.
- **Admin** (`login.tsx`): Zod no longer requires `.email()` on that field; same posting shape.
- **`POST /login`**: on invalid credentials, detail text is **`Invalid credentials`** (not email-specific).

### RBAC + navigation fixes

- **My tasks** sidebar and **`/dashboard/tasks`** routes allow **`RequirePermission anyOf=[approval.view, task.view]`** so roles that only grant **`task.*`** still see the task inbox (backend task APIs already use **`task.view`**).

### Dev seed scripts

- **`scripts/seed_admin_test_data.py`** — syncs `MODULE_CONFIG` permissions via `sync_all_modules_to_db`, upserts several **global** test roles (empty `org_unit_ids`), creates test users (default password **`TestPass123!`**, overridable with `--password`), and seeds a few **manual** tasks for inbox testing. The **Contractor Manager** role includes **`contractor.manage_plants`** alongside view/create/update/delete and document upload so plant mapping is allowed when that role is used.
- Run: `./venv/bin/python scripts/seed_admin_test_data.py` (from repo root, same DB as the app).

- **`scripts/seed_manual_test_contractors.py`** — idempotent **contractor master** demo data for local UI testing:
  - Upserts five contractors by **`contractor_code`** (Acme, Zenith, Orion, Delta, Nova) with mixed **active** / **inactive** and full address/contact fields.
  - Ensures three **`org_units`** with **`type=PLANT`** named **`TiM Demo Plant — …`** if missing, then inserts **`contractor_plants`** rows (multiple mappings for Acme/Nova, expired engagement for Delta, etc.).
  - Creates four **documents** per contractor (valid / expiring soon / expired / missing expiry) and writes tiny placeholder files under **`backend/uploads/contractor_documents/{id}/`**.
  - Seeds **`contractor_audit_logs`** so the **Timeline** tab shows **CREATED**, **STATUS_CHANGED**, **UPDATED**, **DOCUMENT_***, **PLANT_MAPPING_***, and (for **CTR-NOVA-005**) **COMPLIANCE_FLAGGED**. Rows carry **`metadata_json.seed_tag` = `manual_test_contractors_timeline`** so re-running the script does not duplicate those synthetic events per contractor.
- Run: `./venv/bin/python scripts/seed_manual_test_contractors.py` (from repo root).

- **`scripts/seed_manual_test_rates.py`** — idempotent **rate master + negotiation** demo data:
  - Seeds 7 `rate_master` rows across multiple plants — current active, superseded historical, future-effective, and an explicitly expired row to demo the "expired" warning in the negotiation UI.
  - Auto-creates an `ApprovalWorkflow` mapped to action `contractor_rates.create` with a single approval step backed by the **Procurement Approver** role (or a fallback **Rate Seed Approver** role if the admin seed hasn't run). Attaches the role to the `rate_approver` user (or earliest superuser) so role-scoped tasks have an actor.
  - Creates 5 `contractor_rates` covering every status the UI renders: **draft**, **pending_approval**, **approved**, **rejected**, plus a **multi-round** approved rate with three `negotiation_logs` entries.
  - Use **`--reset`** to delete previously-seeded rows (matched on the `[seed] ...` remarks marker) and rebuild cleanly — useful after the workflow mapping has been added.
- Run: `./venv/bin/python scripts/seed_manual_test_rates.py [--reset]` (from repo root).

Other seeds:

- `scripts/seed_manual_test_users.py` — sample users tied to the first org unit in the DB.
- `python scripts/sync_modules.py` — canonical way to align **`features`** / **`permissions`** with **`MODULE_CONFIG`**.

---

## 13) Negotiation workflow module (3.3)

A new module under `backend/modules/contractor_rates/` that manages contractor rate
negotiations end-to-end (base rate master → negotiation rounds → approval → savings
tracking).

### Tables (Alembic `033_contractor_rate_negotiation`)

- **`rate_master`** — reference base rate per `(job_type, skill_type, unit, org_unit_id)`. Multiple
  `effective_from` rows are allowed for history; only one `is_active=True` row per combo (enforced
  in service layer). Constrained by `uq_rate_master_combo_effective_from`.
- **`contractor_rates`** — a contractor's negotiated rate against a `rate_master` row, with
  `initial_rate` (contractor's opening ask, immutable through rounds), computed
  `previous_rate`, `savings_amount`, `savings_percentage`. Status lifecycle:
  `draft → pending_approval → approved → expired` (or `rejected` / `cancelled`).
  - Alembic `035_contractor_rate_initial_rate` adds the column and backfills it
    from existing `negotiation_logs` (round 1 proposed_rate) or, failing that,
    from the current `negotiated_rate`. Existing savings are recomputed on the
    same migration.
- **`negotiation_logs`** — per-round trail (`round_number`, `proposed_rate`, `counter_rate`, `remarks`).
  Unique on `(contractor_rate_id, round_number)`.
- **`contractor_rate_audit_logs`** — field-level + lifecycle audit history with `old_value` / `new_value` /
  `metadata_json` JSON columns. Action codes: `CREATED`, `UPDATED`, `NEGOTIATION_ADDED`,
  `SENT_FOR_APPROVAL`, `APPROVED`, `REJECTED`, `RATE_ACTIVATED`, `RATE_DEACTIVATED`,
  `CANCELLED`, `EXPIRED`.
- **`rate_master_audit_logs`** (Alembic `034_rate_master_audit_logs`) — audit trail for base
  rate changes. Same shape as `contractor_rate_audit_logs` (JSON `old_value` / `new_value` /
  `metadata_json`). Action codes: `CREATED`, `UPDATED`, `ACTIVATED`, `DEACTIVATED`,
  `SUPERSEDED`. The `metadata_json` of a `CREATED` row carries `{"superseded_ids": [...]}`
  whenever activating it bumped older active rows out.

### Services + business rules

- `RateMasterService` — list/get/create/patch. Activating a new combo deactivates any other
  active row for the same `(job, skill, unit, plant)` automatically.
- `ContractorRateService` — CRUD + business logic:
  - **Savings logic (anchored on `initial_rate`).** Contractors typically open
    above the procurement baseline, so anchoring savings on `base_rate` produced
    misleading negative figures. Instead we anchor on the contractor's
    **opening ask**:
    - `create_rate` captures `initial_rate` (explicit override or — by default —
      whatever was passed as `negotiated_rate`). It is **immutable** through
      subsequent rounds, with one exception: if round 1's `proposed_rate` is
      higher than the recorded `initial_rate`, the round-1 ask is treated as the
      true opening and `initial_rate` is lifted accordingly.
    - `savings_amount = max(0, initial_rate − negotiated_rate)` (always ≥ 0)
    - `savings_percentage = savings_amount / initial_rate × 100`
    - `previous_rate` is still recorded for history but no longer drives the
      savings calculation.
    - Vs-base metrics (`vs_base_amount`, `vs_base_percentage`) live alongside on
      `to_public_dict` and surface separately in the dashboard.
  - **Round handling.** `add_negotiation_round` increments `current_round`. If
    round 1's `proposed_rate` exceeds the current `initial_rate`, the anchor is
    lifted and savings recomputed (with an `UPDATED` audit row). If
    `apply_to_negotiated_rate=True`, the round's counter/proposed rate becomes
    the canonical negotiated rate and savings is recomputed against the
    (immutable) `initial_rate`.
  - **Submission.** `submit_for_approval` checks for overlapping approved windows for the same
    `(contractor, rate_master)` and either:
    - creates an `ApprovalRequest` with `entity_type="contractor_rate_approval"` (action code
      `contractor_rates.create`) when a workflow is mapped, OR
    - auto-approves and activates the rate immediately when no workflow exists.
  - **Activation.** Sets `status="approved"`, fills `approved_by`/`approved_at`, recomputes savings
    using a fresh `previous_rate`, deactivates any previously approved rate for the same
    combo (`status="expired"` + `RATE_DEACTIVATED` + `EXPIRED` audit rows on the loser),
    and writes `APPROVED` + `RATE_ACTIVATED` rows on the winner.
  - **Rejection.** `finalize_rejection` is invoked from the approval engine's `act_on_task` path
    when a negotiation request is rejected; sets `status="rejected"`, fills `rejected_by`/`rejected_at`
    and writes a `REJECTED` audit row.
- **Notifications.** `_notify` triggers `EmailNotificationService.trigger_event(...)` for
  `CONTRACTOR_RATE_SUBMITTED`, `CONTRACTOR_RATE_APPROVED`, and `CONTRACTOR_RATE_REJECTED`. Failures
  are swallowed so the API call never fails because of email transport issues.

### Approval engine integration

- `modules/approvals/service.py::_finalize_request` recognizes
  `entity_type="contractor_rate_approval"` and delegates activation to `ContractorRateService.finalize_approval`,
  passing the latest approver's `user_id` so the audit row carries the human actor.
- `_apply_entity_rejection` is invoked in `act_on_task` right before the request transitions
  to `in_rework`. It dispatches to entity-specific reject hooks (currently rate-only). Failures
  in the hook are swallowed so the rework path always completes.

### APIs (`/contractor-rates/*`, `/rate-master/*`, also re-mounted under `/admin/*`)

Rate master:
- `GET /rate-master`                    (`rate_master.view`)
- `POST /rate-master`                   (`rate_master.create`)
- `GET /rate-master/{id}`               (`rate_master.view`)
- `PATCH /rate-master/{id}`             (`rate_master.update`)
- `GET /rate-master/{id}/audit-logs`    (`rate_master.view`) — chronological audit trail with actor names

Contractor rates:
- `GET /contractor-rates`                       (`contractor_rates.view`) — filters: `contractor_id`, `status`, `rate_master_id`, `org_unit_id`, `job_type`
- `GET /contractor-rates/summary`               (`contractor_rates.view`) — KPI counters (with optional `?contractor_id=`)
- `POST /contractor-rates`                      (`contractor_rates.create`)
- `GET /contractor-rates/{id}`                  (`contractor_rates.view`)
- `PATCH /contractor-rates/{id}`                (`contractor_rates.update`)
- `POST /contractor-rates/{id}/negotiate`       (`contractor_rates.update`) — adds a round
- `POST /contractor-rates/{id}/submit`          (`contractor_rates.create`)
- `POST /contractor-rates/{id}/cancel`          (`contractor_rates.update`)
- `GET /contractor-rates/{id}/timeline`         (`contractor_rates.view`) — merged audit + rounds + approval actions

### Dashboard summary

`GET /dashboard/summary` adds a `contractor_rates` block when the caller has any of
`contractor_rates.{view,create,update,approve}`. The block is split into two
distinct procurement KPIs:

* **Negotiation savings** — anchored on the contractor's opening ask
  (`initial_rate`); always non-negative. This is the figure the dashboard's
  "Negotiated savings" card and the "Avg savings %" card render.
* **Vs base** — signed delta against `rate_master.base_rate`, surfaced via
  three counters and two totals:
  * `total_premium_above_base` — sum of `(final − base)` for approved rates that
    landed **above** base. The dashboard renders this as "Premium paid above
    base" and shades it amber.
  * `total_below_base_savings` — magnitude (≥ 0) of the same diff for rates
    that landed **below** base. Rendered as "Discount below base" in green.
  * `approved_above_base` / `approved_at_base` / `approved_below_base` —
    counts that drive the small stacked bar visualising how the approved rates
    are distributed relative to the procurement baseline.

```json
"contractor_rates": {
  "total_negotiations": 4,
  "pending_approvals": 1,
  "approved": 2,
  "rejected": 0,
  "total_savings": 107.00,
  "avg_savings_percentage": 8.36,
  "total_premium_above_base": 3.00,
  "total_below_base_savings": 50.00,
  "approved_above_base": 1,
  "approved_at_base": 0,
  "approved_below_base": 1,
  "by_status": [{"status": "approved", "count": 2}, ...]
}
```

The split exists because contractors typically negotiate **upward** from the
procurement baseline — anchoring savings on `base_rate` produced negative
"savings" in real usage, which made the dashboard graph misleading. With the
split, negotiation savings always tells the "we shaved X off the vendor's
opening price" story, while the vs-base counters surface contractor-driven
price increases without poisoning the savings figure. See `aggregate_summary`
in `modules/contractor_rates/service.py` and the corresponding block in
`modules/dashboard/app_router.py` for the SQL.

### RBAC

`MODULE_CONFIG` registers two new modules — `rate_master` and `contractor_rates` — emitting
canonical permissions:

- `rate_master.view` / `.create` / `.update` / `.delete`
- `contractor_rates.view` / `.create` / `.update` / `.delete` / `.approve`

The migration also seeds these permissions immediately so existing roles can be granted them
without a separate sync step. `scripts/seed_admin_test_data.py` adds a **Procurement Approver**
role wired with `contractor_rates.approve` + `approval.act`, and extends the existing
**Contractor Manager** role with `rate_master.*` + `contractor_rates.{view,create,update}`.

### Frontend

- **Top-level sidebar entries** (`components/layout/app-shell-layout.tsx`) — two new items so
  the negotiation workflow is reachable without first drilling into a contractor:
  - **Rate master** (`/dashboard/rate-master`) — visible when the user has any of
    `rate_master.view` / `.create` / `.update`.
  - **Negotiated rates** (`/dashboard/negotiated-rates`) — visible when the user has any of
    `contractor_rates.view` / `.create` / `.update` / `.approve`.
- **`pages/rate-master.tsx`** — standalone CRUD for base rates: KPI tiles
  (total / active / plants covered), filters (search + skill + plant + active), table with
  inline Edit and Activate / Deactivate, and Create dialog with plant picker, job/skill/unit
  selects, and validity window.
- **`pages/negotiated-rates.tsx`** — workspace-wide table of every negotiation across all
  contractors with the same KPI tiles (total / pending / total savings / avg savings %),
  filters (search + status + plant), and an "Open" button that deep-links to
  `/dashboard/contractors/<id>?tab=rates&focus=<rate_id>`.
- **Negotiated rates tab** on the contractor detail page (`pages/contractor-detail.tsx`) uses
  the shared `components/contractors/ContractorRatesPanel.tsx` component alongside
  Overview / Documents / Plants / Timeline whenever the user has `contractor_rates.view`. The
  active tab is driven by the `?tab=` query param so deep-links from the My Tasks inbox or the
  workspace-wide Negotiated rates list can land on the rates tab and pre-select the rate via
  `?focus=<rateId>`.
- **Standalone route**: `/dashboard/contractors/:id/rates` (gated by `contractor_rates.view`)
  renders `pages/contractor-rates.tsx`, a thin wrapper around the same `ContractorRatesPanel` for
  bookmarking / direct access. It also honours `?focus=<rateId>` for deep-linking.
- **`ContractorRatesPanel`** (`components/contractors/ContractorRatesPanel.tsx`) provides:
  - KPI cards (total negotiations, pending approvals, total savings, avg savings %).
  - Active rate cards (`status="approved"`).
  - All-negotiations table (job + skill, plant, base, negotiated, savings, effective dates,
    status badge using `rateStatusVariant`, row actions for Submit / Cancel).
  - Detail panel for a selected rate: stepper (Draft → Pending → Approved or terminal Rejected/Cancelled),
    rate facts (base / negotiated / previous / savings), savings highlight banner, list of
    rounds (sky-tinted "Round N" chips with proposal/counter values + remarks), and the
    embedded `ContractorRateTimeline` panel.
- **Components**:
  - `components/contractors/rateStatus.ts` — labels, variants, stepper helpers, money/percent formatters.
  - `components/contractors/ContractorRateDialog.tsx` — `NewNegotiationDialog` (rate-master picker
    with search + base-rate readonly + estimated savings preview) and `NegotiationRoundDialog`
    (proposed/counter inputs, remarks, "apply as new negotiated rate" toggle).
  - `components/contractors/ContractorRateTimeline.tsx` — chat-style timeline merging audit /
    rounds / approval actions.
  - `components/contractors/RatesDashboard.tsx` — workspace dashboard widget (KPI tiles, gated by
    `contractor_rates.view`).

### Approver UX (My Tasks)

When a rate is submitted, `ApprovalEngineService` creates an `ApprovalTask` assigned to the
configured `approver_role_id` for the matching workflow step. The new
`_task_title_and_description` helper enriches that task so it shows up usefully in the
approver's `/dashboard/my-tasks` inbox:

- **Title** — `Rate approval: <Contractor name> · <Job type>` instead of the legacy
  `Approval: contractor_rate_approval`.
- **Description** — embeds negotiated / base / previous / savings amounts and the effective
  window so the approver has the context inline.
- **Deep-link** — `pages/my-task-detail.tsx` resolves `entity_type=contractor_rate_approval`
  to `/dashboard/contractors/<contractor_id>?tab=rates&focus=<rate_id>`. An "Open rate"
  button is rendered both in the entity row and beside the "Your decision" header so the
  approver can review the timeline / rounds before approving or rejecting.

The same plumbing also gives nicer titles + an "Open contractor" link for
`contractor_creation` / `contractor_activation` / `contractor_update` approvals.

### Tests

`tests/test_contractor_rates.py` (13 cases):

- rate_master: list with org name, activation supersedes previous active, inverted dates rejected.
- savings: against `base_rate` when no previous; against last approved `negotiated_rate` once one exists.
- rounds: increments, proposal+counter dialog options, "at least one value required" guard, audit logs.
- approval flow: auto-approval when no workflow, pending → approved with workflow + audit.
- activation/deactivation: previous active rate becomes `expired` with `RATE_DEACTIVATED` + `EXPIRED` audits.
- rejection: workflow rejection flips rate to `rejected` and writes `REJECTED` audit.
- overlap protection: submission rejects overlapping approved date ranges for the same combo.
- aggregate summary: counters + total savings.

