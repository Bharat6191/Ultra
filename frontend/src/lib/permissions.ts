const LS_PERMISSIONS = "user_permissions"
const LS_IS_SUPERUSER = "me_is_superuser"

export type MePermissionsPayload = {
  is_superuser?: boolean
  permissions?: string[]
}

export const TASK_INBOX_PERMISSION_CODES = [
  "task.view",
  "task.act",
  "task.close",
  "approval.view",
  "approval.act",
  "contractor_rates.approve",
  "work_orders.approve",
  "invoices.approve_exceptions",
]

export const NEGOTIATED_RATE_READ_PERMISSION_CODES = [
  "contractor_rates.view",
  "contractor_rates.approve",
]

/** Persist RBAC snapshot from ``GET /me`` (call after login when token is set). */
export function persistAuthFromMe(me: MePermissionsPayload): void {
  try {
    localStorage.setItem(LS_IS_SUPERUSER, me.is_superuser === true ? "1" : "0")
    if (Array.isArray(me.permissions)) {
      localStorage.setItem(LS_PERMISSIONS, JSON.stringify(me.permissions))
    } else {
      localStorage.removeItem(LS_PERMISSIONS)
    }
  } catch {
    // ignore storage errors
  }
}

export function clearAuthProfile(): void {
  try {
    localStorage.removeItem(LS_PERMISSIONS)
    localStorage.removeItem(LS_IS_SUPERUSER)
  } catch {
    // ignore
  }
}

/** True when the last ``GET /me`` snapshot identified a superuser (see ``persistAuthFromMe``). */
export function isSuperuser(): boolean {
  try {
    return localStorage.getItem(LS_IS_SUPERUSER) === "1"
  } catch {
    return false
  }
}

/** Match ``module.action`` ↔ legacy ``module:action`` (first separator only). */
function permissionCodeVariants(code: string): Set<string> {
  const v = new Set<string>([code])
  const ci = code.indexOf(":")
  if (ci !== -1) v.add(`${code.slice(0, ci)}.${code.slice(ci + 1)}`)
  const di = code.indexOf(".")
  if (di !== -1) v.add(`${code.slice(0, di)}:${code.slice(di + 1)}`)
  return v
}

function permissionSetsIntersect(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) {
    if (b.has(x)) return true
  }
  return false
}

/**
 * UI-only permission check. Backend still enforces RBAC on every API call.
 * Superusers are treated as having all permissions.
 */
export function hasPermission(code: string): boolean {
  try {
    if (localStorage.getItem(LS_IS_SUPERUSER) === "1") return true
    const raw = localStorage.getItem(LS_PERMISSIONS)
    if (!raw) return false
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return false
    const required = permissionCodeVariants(code)
    for (const p of arr) {
      if (typeof p !== "string") continue
      if (permissionSetsIntersect(required, permissionCodeVariants(p))) return true
    }
    return false
  } catch {
    return false
  }
}

export function hasAnyPermission(codes: readonly string[]): boolean {
  return isSuperuser() || codes.some((code) => hasPermission(code))
}

export function canAccessTaskInbox(): boolean {
  return hasAnyPermission(TASK_INBOX_PERMISSION_CODES)
}

export function canReadNegotiatedRates(): boolean {
  return hasAnyPermission(NEGOTIATED_RATE_READ_PERMISSION_CODES)
}

/**
 * List org units (plants) for user/role pickers without opening the Plants admin module.
 * Matches ``GET /admin/org-units`` authorization (OR of these codes).
 */
export function canListOrgUnitsForAssignments(): boolean {
  try {
    if (localStorage.getItem(LS_IS_SUPERUSER) === "1") return true
    return (
      hasPermission("org_units.view") ||
      hasPermission("org_units.update") ||
      hasPermission("org_units.delete") ||
      hasPermission("users.create") ||
      hasPermission("users.update") ||
      hasPermission("roles.create") ||
      hasPermission("roles.update") ||
      // Contractor master uses /admin/org-units (filtered to type=PLANT) to render
      // the plant picker on the list page filter and on the per-contractor mapping
      // dialog. Mirror the backend OR-permission list.
      hasPermission("contractor.view") ||
      hasPermission("contractor.update") ||
      hasPermission("contractor.manage_plants") ||
      // Part master + negotiated rates UIs use the same plant picker.
      hasPermission("part_master.view") ||
      hasPermission("part_master.create") ||
      hasPermission("part_master.update") ||
      hasPermission("contractor_rates.view") ||
      hasPermission("contractor_rates.create") ||
      hasPermission("contractor_rates.update") ||
      // Work orders UI needs plant labels for lists/detail screens.
      hasPermission("work_orders.view") ||
      hasPermission("work_orders.create") ||
      hasPermission("work_orders.update") ||
      hasPermission("work_orders.approve") ||
      hasPermission("work_orders.manage_completion") ||
      hasPermission("work_orders.track_completion")
    )
  } catch {
    return false
  }
}
