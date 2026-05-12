/** Shared shape for invoice PDF + on-screen preview line rows. */

export type InvoiceDisplayLine = {
  description: string
  qty: number
  /** Commercial unit (e.g. Hours, Kg). */
  unit?: string
  /** How unit rate applies (e.g. per kg). */
  rateBasis?: string
  /** Rate per commercial unit (ex. tax). */
  unitPrice: number
  /** Line amount before tax. */
  taxable: number
  /** Tax % for this line (0 if none). */
  lineTaxPct?: number
  /** Tax amount for this line. */
  taxAmount?: number
  /** Line total including tax. */
  totalInclTax: number
}

export function invoicePreviewTotals(lines: InvoiceDisplayLine[]) {
  const subtotalEx = lines.reduce((s, l) => {
    const tx = Number.isFinite(l.taxable) ? l.taxable : 0
    return s + tx
  }, 0)
  const lineTaxSum = lines.reduce((s, l) => {
    const t = l.taxAmount
    return s + (Number.isFinite(t) ? Number(t) : 0)
  }, 0)
  return { subtotalEx, lineTaxSum }
}
