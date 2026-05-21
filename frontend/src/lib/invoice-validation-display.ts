export type InvoiceValidationDisplay = "pass" | "blocked"

/** Engine outcome for tabs/filtering (``warn`` counts as pass). */
export function invoiceValidationDisplay(row: {
  validation_status?: string | null
  status?: string | null
}): InvoiceValidationDisplay | null {
  const v = String(row.validation_status ?? "")
    .trim()
    .toLowerCase()
  if (v === "pass" || v === "warn") return "pass"
  if (v === "blocked" || v === "fail") return "blocked"
  if (String(row.status ?? "").toLowerCase() === "blocked") return "blocked"
  return null
}

export type InvoiceDisplayStatus = "draft" | "pass" | "blocked" | "rejected"

/** Single status for list/detail: Draft, Pass, Blocked, Rejected. */
export function invoiceDisplayStatus(row: {
  status?: string | null
  validation_status?: string | null
}): InvoiceDisplayStatus {
  const st = String(row.status ?? "").toLowerCase()
  if (st === "rejected") return "rejected"
  if (st === "draft") return "draft"
  if (st === "approved" || st === "paid") return "pass"
  const v = invoiceValidationDisplay(row)
  if (v === "pass") return "pass"
  if (v === "blocked") return "blocked"
  if (st === "submitted") return "pass"
  return "draft"
}

export function invoiceDisplayStatusLabel(status: InvoiceDisplayStatus): string {
  switch (status) {
    case "draft":
      return "Draft"
    case "pass":
      return "Pass"
    case "blocked":
      return "Blocked"
    case "rejected":
      return "Rejected"
  }
}

export function invoiceDisplayStatusBadgeVariant(
  status: InvoiceDisplayStatus,
): "secondary" | "success" | "destructive" {
  switch (status) {
    case "draft":
      return "secondary"
    case "pass":
      return "success"
    case "blocked":
      return "destructive"
    case "rejected":
      return "destructive"
  }
}

export type InvoiceLineValidationDisplay = "pending" | "pass" | "blocked"

/** Line table: Pass or Blocked after submit; Pending before validation. */
export function invoiceLineValidationDisplay(
  line: { validation_line_status?: string | null },
  validated: boolean,
): InvoiceLineValidationDisplay {
  if (!validated) return "pending"
  const s = String(line.validation_line_status ?? "").toLowerCase()
  if (s === "blocked") return "blocked"
  return "pass"
}
