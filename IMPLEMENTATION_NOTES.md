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

- **`alembic/versions/011_org_units_rbac_permissions.py`**
  - Seeds **`org_units`** feature and **`org_units.view|create|update|delete`** if missing (alongside sync).

### Org units (plants): two different concerns

| Action | Permission | Purpose |
|--------|------------|---------|
| **`GET /admin/org-units`** | **Any of** `org_units.view`, `users.create`, `users.update`, `roles.create`, `roles.update` | List plants for **Plants admin UI**, **user create/edit plant picker**, or **role–plant checkboxes**. |
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

- Sidebar: Dashboard, Performance, Preferences, then RBAC-gated items (**Users**, **Plants**, **Roles**, **Permissions**, **System settings**).
- **Plants** nav: any of **`org_units.view|create|update|delete`** (Plants **module** only).
- **Performance / Preferences**: hidden when the user has **only** `users.*` permissions; shown if they have any **`roles.*`**, **`permissions.*`**, **`settings.*`**, **`features.*`**, or **`org_units.*`** (see **`hasAnyNonUsersRbacPermission`** in `frontend/src/lib/permissions.ts`).
- **`canListOrgUnitsForAssignments()`** — mirrors **`GET /admin/org-units`** OR rule; used to load plant dropdowns on **Users** / **Roles** pages without requiring **`org_units.view`**.

### Auth snapshot (`frontend/src/lib/permissions.ts`)

- **`persistAuthFromMe` / `clearAuthProfile`** — store **`is_superuser`** and **`permissions[]`** from **`/me`** in `localStorage`.
- **`hasPermission(code)`** — UI checks (superuser = all true).
- Helpers: **`hasAnyNonUsersRbacPermission`**, **`canListOrgUnitsForAssignments`**.

### Key files

| Area | File |
|------|------|
| Routes | `frontend/src/App.tsx` |
| User login | `frontend/src/pages/app-login.tsx` (superuser blocked; must use `/admin/login`) |
| Admin login | `frontend/src/pages/login.tsx` |
| Workspace layout | `frontend/src/components/layout/app-shell-layout.tsx` |
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

- Flesh out **Performance** and **Preferences** under `/dashboard` beyond placeholders.
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

Response shape (high-level):

- `modules.users`
  - `total_users`, `active_users`, `inactive_users`, `new_users_last_7_days`
  - `users_by_role`: distinct user counts per role
- `modules.tasks`
  - `pending`, `approved`, `rejected`, `completed`
  - `completed` is treated as “finished work” and aggregates `approved + completed + closed` statuses for tasks assigned to the current user.

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
