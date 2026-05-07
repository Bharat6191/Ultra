/**
 * Centralised palette + label table for contractor lifecycle status, compliance state,
 * document verification, and plant-mapping role. Used by table cells, header chips,
 * detail badges, and dashboard charts so the colour language is consistent.
 */

export type ContractorStatus =
  | "draft"
  | "pending"
  | "active"
  | "suspended"
  | "blacklisted"
  | "expired"
  | "non_compliant"

export type ComplianceState = "compliant" | "warning" | "non_compliant" | "no_data"

export type DocumentVerification = "pending" | "verified" | "rejected"

export const CONTRACTOR_STATUS_OPTIONS: { value: ContractorStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "pending", label: "Pending approval" },
  { value: "active", label: "Active" },
  { value: "non_compliant", label: "Non-compliant" },
  { value: "expired", label: "Expired" },
  { value: "suspended", label: "Suspended" },
  { value: "blacklisted", label: "Blacklisted" },
]

export const CONTRACTOR_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "vendor", label: "Vendor" },
  { value: "labour", label: "Labour" },
  { value: "service", label: "Service" },
  { value: "epc", label: "EPC" },
]

export const CONTRACTOR_PLANT_ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "approved_vendor", label: "Approved vendor" },
  { value: "temporary", label: "Temporary" },
  { value: "restricted", label: "Restricted" },
]

export type StatusVariant = "default" | "secondary" | "success" | "warning" | "error" | "outline"

export function statusVariant(status: string | null | undefined): StatusVariant {
  switch ((status ?? "").toLowerCase()) {
    case "active":
      return "success"
    case "non_compliant":
    case "expired":
    case "blacklisted":
      return "error"
    case "suspended":
    case "pending":
      return "warning"
    default:
      return "secondary"
  }
}

export function statusLabel(status: string | null | undefined): string {
  const found = CONTRACTOR_STATUS_OPTIONS.find((o) => o.value === status)
  return found ? found.label : (status ?? "—")
}

export function complianceVariant(state: string | null | undefined): StatusVariant {
  switch ((state ?? "").toLowerCase()) {
    case "compliant":
      return "success"
    case "warning":
      return "warning"
    case "non_compliant":
      return "error"
    default:
      return "secondary"
  }
}

export function complianceLabel(state: string | null | undefined): string {
  switch ((state ?? "").toLowerCase()) {
    case "compliant":
      return "Compliant"
    case "warning":
      return "Needs attention"
    case "non_compliant":
      return "Non-compliant"
    case "no_data":
      return "No data"
    default:
      return state ?? "—"
  }
}

export function verificationVariant(state: string | null | undefined): StatusVariant {
  switch ((state ?? "").toLowerCase()) {
    case "verified":
      return "success"
    case "rejected":
      return "error"
    case "pending":
    default:
      return "warning"
  }
}

export function verificationLabel(state: string | null | undefined): string {
  switch ((state ?? "").toLowerCase()) {
    case "verified":
      return "Verified"
    case "rejected":
      return "Rejected"
    case "pending":
      return "Pending"
    default:
      return state ?? "—"
  }
}

export function plantRoleLabel(role: string | null | undefined): string {
  const found = CONTRACTOR_PLANT_ROLE_OPTIONS.find((o) => o.value === role)
  return found ? found.label : (role ?? "—")
}

export function plantRoleVariant(role: string | null | undefined): StatusVariant {
  switch ((role ?? "").toLowerCase()) {
    case "approved_vendor":
      return "success"
    case "temporary":
      return "warning"
    case "restricted":
      return "error"
    default:
      return "secondary"
  }
}

/**
 * Lifecycle classification for a contractor↔plant mapping based on its effective
 * date range and a configurable warning window. Mirrors the backend semantics
 * (open-ended start_date is considered already-active; open-ended end_date is
 * indefinite).
 *
 * - ``upcoming``     — start_date is set and is strictly after today.
 * - ``expired``      — end_date is set and is strictly before today.
 * - ``expiring_soon``— end_date is within ``warnDays`` (inclusive).
 * - ``active``       — otherwise (the mapping is currently in force).
 */
export type PlantMappingLifecycle = "upcoming" | "active" | "expiring_soon" | "expired"

export function plantMappingLifecycle(
  start: string | null | undefined,
  end: string | null | undefined,
  warnDays = 14,
): PlantMappingLifecycle {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const startDate = start ? new Date(start) : null
  const endDate = end ? new Date(end) : null
  if (startDate && startDate.getTime() > today.getTime()) return "upcoming"
  if (endDate && endDate.getTime() < today.getTime()) return "expired"
  if (endDate) {
    const days = Math.round((endDate.getTime() - today.getTime()) / 86_400_000)
    if (days <= warnDays) return "expiring_soon"
  }
  return "active"
}

export function plantMappingLifecycleLabel(s: PlantMappingLifecycle): string {
  switch (s) {
    case "upcoming":
      return "Upcoming"
    case "expired":
      return "Expired"
    case "expiring_soon":
      return "Expiring soon"
    case "active":
    default:
      return "Active"
  }
}

export function plantMappingLifecycleVariant(s: PlantMappingLifecycle): StatusVariant {
  switch (s) {
    case "upcoming":
      return "secondary"
    case "expired":
      return "error"
    case "expiring_soon":
      return "warning"
    case "active":
    default:
      return "success"
  }
}

export function contractorTypeLabel(type: string | null | undefined): string {
  const found = CONTRACTOR_TYPE_OPTIONS.find((o) => o.value === type)
  return found ? found.label : (type ?? "—")
}
