import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SectionHint } from "@/components/ui/section-hint"
import { invoiceLineValidationDisplay } from "@/lib/invoice-validation-display"
import { cn } from "@/lib/utils"

export type InvoiceLineTableRow = {
  id: number | string
  work_order_item_id?: number | string | null
  quantity?: number | string | null
  rate?: number | string | null
  unit_rate?: number | string | null
  amount?: number | string | null
  taxable_value?: number | string | null
  amount_including_tax?: number | string | null
  tax_amount?: number | string | null
  tax_pct?: number | string | null
  work_order_number?: string | null
  job_description?: string | null
  part_code?: string | null
  part_name?: string | null
  unit_type?: string | null
  unit_label?: string | null
  validation_line_status?: string | null
  weight_per_piece_kg?: number | string | null
  variance_pct_hint?: number | string | null
}

type InvoiceLinesTableCardProps = {
  title?: string
  description?: string | null
  lines: InvoiceLineTableRow[]
  validated?: boolean
  emptyMessage?: string
  showVariance?: boolean
}

const invoiceTableShellCardClass =
  "overflow-hidden rounded-[1.5rem] border border-zinc-200/80 bg-white/95 shadow-[0_20px_48px_-36px_rgba(15,23,42,0.32)]"

function readNumber(...values: Array<number | string | null | undefined>): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value.replace(/,/g, ""))
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return Number.NaN
}

function formatQty(value: number | string | null | undefined): string {
  const n = readNumber(value)
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 })
}

function formatWeight(value: number | string | null | undefined): string {
  const n = readNumber(value)
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })
}

function formatMoney(value: number | string | null | undefined): string {
  const n = readNumber(value)
  if (!Number.isFinite(n)) return "—"
  try {
    return n.toLocaleString(undefined, {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  } catch {
    return `₹${n.toFixed(2)}`
  }
}

function formatVariance(value: number | string | null | undefined): string {
  const n = readNumber(value)
  if (!Number.isFinite(n)) return "—"
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`
}

function nonEmptyText(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : ""
  return text ? text : null
}

function lineItemLabel(line: InvoiceLineTableRow): string {
  return line.work_order_item_id != null ? `Item ${line.work_order_item_id}` : "Line item"
}

function linePartNumber(line: InvoiceLineTableRow): string {
  return nonEmptyText(line.part_code) ?? lineItemLabel(line)
}

function lineTotalInclTax(line: InvoiceLineTableRow): number {
  const direct = readNumber(line.amount_including_tax)
  if (Number.isFinite(direct)) return direct
  const taxable = readNumber(line.taxable_value, line.amount)
  if (!Number.isFinite(taxable)) return Number.NaN
  const taxAmount = readNumber(line.tax_amount)
  if (Number.isFinite(taxAmount)) return taxable + taxAmount
  const taxPct = readNumber(line.tax_pct)
  if (Number.isFinite(taxPct)) return taxable * (1 + taxPct / 100)
  return taxable
}

function InvoiceLineStatusBadge({ line, validated }: { line: InvoiceLineTableRow; validated: boolean }) {
  const state = invoiceLineValidationDisplay(line, validated)
  if (state === "blocked") {
    return <Badge variant="destructive" className="font-normal">Blocked</Badge>
  }
  if (state === "pass") {
    return <Badge variant="success" className="font-normal">Pass</Badge>
  }
  return <Badge variant="secondary" className="font-normal">Pending</Badge>
}

function InvoiceTableHeaderLabel({
  label,
  hint,
  align = "left",
}: {
  label: string
  hint?: string | null
  align?: "left" | "right" | "center"
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5",
        align === "right" && "justify-end",
        align === "center" && "justify-center",
      )}
    >
      <span>{label}</span>
      {hint ? <SectionHint text={hint} /> : null}
    </span>
  )
}

export function InvoiceLinesTableCard({
  title = "Lines",
  description,
  lines,
  validated = false,
  emptyMessage = "No invoice lines available.",
  showVariance,
}: InvoiceLinesTableCardProps) {
  const displayVariance = showVariance ?? lines.some((line) => line.variance_pct_hint != null)
  const columnCount = displayVariance ? 10 : 9
  const th =
    "whitespace-nowrap border-b border-emerald-100/80 px-3.5 py-3.5 text-left align-middle text-[0.9rem] font-semibold tracking-tight text-zinc-950"
  const tableMinWidth = displayVariance ? "min-w-[72rem]" : "min-w-[66rem]"

  return (
    <Card className={invoiceTableShellCardClass}>
      <CardHeader className="px-5 pb-0 pt-5 sm:px-6 sm:pt-6">
        <div className="min-w-0">
          <CardTitle className="text-[1.15rem] font-bold tracking-tight text-zinc-950 sm:text-[1.25rem]">
            {title}
          </CardTitle>
          {description ? (
            <CardDescription className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
              {description}
            </CardDescription>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto px-5 pb-5 pt-5 sm:px-6 sm:pb-6">
        <div className="relative w-full max-h-[min(68vh,760px)] overflow-x-auto overflow-y-auto rounded-[1.55rem] border border-emerald-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(250,250,250,0.97))] shadow-[0_20px_44px_-34px_rgba(15,23,42,0.28)]">
          <table className={cn("w-full table-fixed border-separate border-spacing-0 text-sm align-middle", tableMinWidth)}>
            <thead className="sticky top-0 z-10 bg-[linear-gradient(135deg,rgba(240,253,250,0.98),rgba(255,255,255,0.97),rgba(236,253,245,0.96))] backdrop-blur-sm supports-[backdrop-filter]:bg-emerald-50/90">
              <tr>
                <th className={cn(th, "w-[7rem] text-center")}>
                  <InvoiceTableHeaderLabel label="Status" align="center" />
                </th>
                <th className={cn(th, "w-[14rem]")}>
                  <InvoiceTableHeaderLabel label="Work Order" />
                </th>
                <th className={cn(th, "w-[10rem]")}>
                  <InvoiceTableHeaderLabel label="Part No." />
                </th>
                <th className={cn(th, "w-[5.5rem] text-center tabular-nums")}>
                  <InvoiceTableHeaderLabel label="Qty" align="center" />
                </th>
                <th className={cn(th, "w-[7.5rem] text-center tabular-nums")}>
                  <InvoiceTableHeaderLabel
                    label="Weight (kg)"
                    hint="Weight per billed quantity unit, shown in kilograms."
                    align="center"
                  />
                </th>
                <th className={cn(th, "w-[5rem] text-center")}>
                  <InvoiceTableHeaderLabel label="Unit" align="center" />
                </th>
                <th className={cn(th, "w-[8rem] text-right tabular-nums")}>
                  <InvoiceTableHeaderLabel
                    label="Unit Rate (₹)"
                    hint="Commercial billed rate before tax for this line."
                    align="right"
                  />
                </th>
                <th className={cn(th, "w-[9rem] text-right tabular-nums")}>
                  <InvoiceTableHeaderLabel
                    label="Taxable (₹)"
                    hint="Line amount before tax."
                    align="right"
                  />
                </th>
                <th className={cn(th, "w-[9rem] text-right tabular-nums")}>
                  <InvoiceTableHeaderLabel
                    label="Incl. Tax (₹)"
                    hint="Line total after tax."
                    align="right"
                  />
                </th>
                {displayVariance ? (
                  <th className={cn(th, "w-[6rem] text-center tabular-nums")}>
                    <InvoiceTableHeaderLabel
                      label="Var %"
                      hint="Variance hint for this invoice line when the backend provides it."
                      align="center"
                    />
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="[&_tr:last-child_td]:border-b-0">
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-6 py-12 text-center text-sm text-zinc-500">
                    {emptyMessage}
                  </td>
                </tr>
              ) : null}
              {lines.map((line) => {
                const titleText = linePartNumber(line)
                const variance = readNumber(line.variance_pct_hint)
                const varianceTone = Number.isFinite(variance)
                  ? variance > 0
                    ? "bg-rose-50 text-rose-600 ring-rose-100"
                    : variance < 0
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                      : "bg-zinc-100 text-zinc-600 ring-zinc-200"
                  : "bg-zinc-100 text-zinc-500 ring-zinc-200"

                return (
                  <tr
                    key={line.id}
                    className={cn(
                      "bg-white transition-colors hover:bg-emerald-50/35",
                      invoiceLineValidationDisplay(line, validated) === "blocked" && "bg-rose-50/70 hover:bg-rose-50/80",
                    )}
                  >
                    <td className="border-b border-zinc-200/80 px-3.5 py-4 text-center align-middle">
                      <InvoiceLineStatusBadge line={line} validated={validated} />
                    </td>
                    <td className="border-b border-zinc-200/80 px-3.5 py-4 align-middle">
                      <div
                        className="overflow-hidden text-ellipsis whitespace-normal break-words font-mono text-[0.96rem] font-semibold leading-6 tracking-tight text-zinc-900"
                        title={line.work_order_number ?? "—"}
                      >
                        {line.work_order_number ?? "—"}
                      </div>
                    </td>
                    <td className="min-w-0 border-b border-zinc-200/80 px-3.5 py-4 align-middle">
                      <div className="min-w-0">
                        <div className="truncate text-[1rem] font-semibold tracking-tight text-zinc-950" title={titleText}>
                          {titleText}
                        </div>
                      </div>
                    </td>
                    <td className="border-b border-zinc-200/80 px-3.5 py-4 text-center align-middle text-[1rem] font-semibold tabular-nums text-zinc-950">
                      {formatQty(line.quantity)}
                    </td>
                    <td className="border-b border-zinc-200/80 px-3.5 py-4 text-center align-middle text-[1rem] tabular-nums text-zinc-700">
                      {formatWeight(line.weight_per_piece_kg)}
                    </td>
                    <td className="border-b border-zinc-200/80 px-3.5 py-4 text-center align-middle text-[1rem] font-medium text-zinc-800">
                      {nonEmptyText(line.unit_label) ?? nonEmptyText(line.unit_type) ?? "—"}
                    </td>
                    <td className="border-b border-zinc-200/80 px-3.5 py-4 text-right align-middle text-[1rem] font-semibold tabular-nums text-zinc-950">
                      {formatMoney(line.unit_rate ?? line.rate)}
                    </td>
                    <td className="border-b border-zinc-200/80 px-3.5 py-4 text-right align-middle text-[1rem] font-semibold tabular-nums text-zinc-950">
                      {formatMoney(line.taxable_value ?? line.amount)}
                    </td>
                    <td className="border-b border-zinc-200/80 px-3.5 py-4 text-right align-middle text-[1rem] font-semibold tabular-nums text-zinc-950">
                      {formatMoney(lineTotalInclTax(line))}
                    </td>
                    {displayVariance ? (
                      <td className="border-b border-zinc-200/80 px-3.5 py-4 text-center align-middle">
                        <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1", varianceTone)}>
                          {formatVariance(line.variance_pct_hint)}
                        </span>
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
