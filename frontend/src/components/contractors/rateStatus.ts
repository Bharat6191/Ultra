/**
 * Centralised palette + label table for the negotiation workflow (3.3).
 * Mirrors the philosophy of `status.ts` (contractor lifecycle / compliance) so the
 * negotiation UI stays visually consistent with the rest of the contractor module.
 */

import type { StatusVariant } from "@/components/contractors/status"

export type ContractorRateStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled"

export const CONTRACTOR_RATE_STATUS_OPTIONS: {
  value: ContractorRateStatus
  label: string
}[] = [
  { value: "draft", label: "Draft" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
]

export function rateStatusLabel(status: string | null | undefined): string {
  const found = CONTRACTOR_RATE_STATUS_OPTIONS.find((o) => o.value === status)
  return found ? found.label : (status ?? "—")
}

export function rateStatusVariant(status: string | null | undefined): StatusVariant {
  switch ((status ?? "").toLowerCase()) {
    case "approved":
      return "success"
    case "pending_approval":
      return "warning"
    case "rejected":
    case "cancelled":
      return "error"
    case "expired":
      return "secondary"
    default:
      return "outline"
  }
}

/**
 * Approval stepper steps for the negotiation lifecycle.
 *
 * The stepper highlights:
 *   draft -> pending -> approved (with a side-rail for rejected/cancelled).
 */
export const RATE_STEPPER_STEPS: { key: string; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "pending_approval", label: "Pending" },
  { key: "approved", label: "Approved" },
]

/** Index into `RATE_STEPPER_STEPS` representing the current state, or -1 for terminal-rejected. */
export function rateStepperIndex(status: string | null | undefined): number {
  switch ((status ?? "").toLowerCase()) {
    case "draft":
      return 0
    case "pending_approval":
      return 1
    case "approved":
      return 2
    case "expired":
      return 2 // approved-then-expired still hit "Approved" as the highwater mark
    default:
      return -1
  }
}

/**
 * Pretty-print money. Uses INR as the default. The numbers are kept as strings
 * server-side (Decimal) — we accept both for safety.
 */
export function formatMoney(value: number | string | null | undefined, opts?: {
  currency?: string
  fractionDigits?: number
}): string {
  if (value === null || value === undefined || value === "") return "—"
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return String(value)
  const currency = opts?.currency ?? "INR"
  const digits = opts?.fractionDigits ?? 2
  try {
    return n.toLocaleString(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
  } catch {
    return `₹${n.toFixed(digits)}`
  }
}

export function formatPercent(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—"
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return String(value)
  return `${n.toFixed(2)}%`
}

/** Signed variance vs Part Master base: positive = above base (org loss), negative = below base (org gain). */
export type VsBaseToleranceTone = "loss" | "gain" | "neutral"

export type VsBaseTolerance = {
  amount: number
  pct: number
  amount_display: string
  pct_display: string
  tone: VsBaseToleranceTone
}

export function computeVsBaseTolerance(
  negotiated: number | string | null | undefined,
  baseRate: number | string | null | undefined,
): VsBaseTolerance | null {
  const neg = typeof negotiated === "number" ? negotiated : Number(negotiated)
  const base = typeof baseRate === "number" ? baseRate : Number(baseRate)
  if (!Number.isFinite(neg) || !Number.isFinite(base) || base <= 0) return null
  const amount = neg - base
  const pct = (amount / base) * 100
  let tone: VsBaseToleranceTone = "neutral"
  let amount_display = "at base"
  if (amount > 0) {
    tone = "loss"
    amount_display = `+${formatMoney(amount)} above base`
  } else if (amount < 0) {
    tone = "gain"
    amount_display = `${formatMoney(Math.abs(amount))} below base`
  }
  const pct_display = `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`
  return { amount, pct, amount_display, pct_display, tone }
}

export function vsBaseToleranceToneClasses(
  tone: VsBaseToleranceTone,
  variant: "box" | "text" = "text",
): string {
  if (variant === "box") {
    switch (tone) {
      case "loss":
        return "border-red-200/80 bg-red-50/50"
      case "gain":
        return "border-emerald-200/80 bg-emerald-50/50"
      default:
        return "border-border bg-muted/30"
    }
  }
  switch (tone) {
    case "loss":
      return "text-red-600"
    case "gain":
      return "text-emerald-600"
    default:
      return "text-muted-foreground"
  }
}
