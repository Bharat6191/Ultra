import * as React from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError, getJson } from "@/lib/api"
import {
  invoiceDisplayStatus,
  invoiceDisplayStatusBadgeVariant,
  invoiceDisplayStatusLabel,
  invoiceLineValidationDisplay,
} from "@/lib/invoice-validation-display"

type InvoiceIssue = {
  id: number
  code: string
  severity: string
  message: string
  allowed_value?: number | string | null
  actual_value?: number | string | null
  allowed_qty?: number | string | null
  actual_qty?: number | string | null
  requires_justification?: boolean
  requires_attachments?: boolean
  justification?: string | null
}

type InvoiceLine = {
  id: number
  work_order_item_id: number
  quantity: number | string
  rate: number | string
  amount: number | string
  amount_including_tax?: number | string | null
  taxable_value?: number | string | null
  tax_amount?: number | string | null
  tax_pct?: number | string | null
  work_order_number?: string | null
  job_description?: string | null
  unit_type?: string | null
  unit_label?: string | null
  unit_rate?: number | string | null
  validation_line_status?: string | null
  weight_per_piece_kg?: number | string | null
}

type InvoiceTaskReviewRow = {
  id: number
  invoice_number: string
  invoice_date: string
  contractor_id: number
  contractor_name?: string | null
  org_unit_id: number
  org_unit_name?: string | null
  status: string
  validation_status?: string | null
  validation_score?: number | string | null
  total_amount: number | string
  lines_subtotal_ex_vat?: number | string | null
  extra_amount_ex_vat?: number | string | null
  work_order_numbers?: string[]
  lines: InvoiceLine[]
  issues: InvoiceIssue[]
  attachments?: { id: number }[]
  submitted_at?: string | null
  created_at?: string | null
}

const HIDDEN_VALIDATION_ISSUE_CODES = new Set(["QTY_EXCEEDS_COMPLETION", "CUMULATIVE_QTY_EXCEEDS_ALLOWED"])

function parseNumber(v: number | string | null | undefined): number {
  if (typeof v === "number") return v
  if (typeof v === "string" && v.trim() !== "") return Number(v)
  return NaN
}

function formatMoney(v: number | string | null | undefined): string {
  const n = parseNumber(v)
  if (!Number.isFinite(n)) return "—"
  return `₹${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatQty(v: number | string | null | undefined): string {
  const n = parseNumber(v)
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 })
}

function formatWhen(v: string | null | undefined): string {
  if (!v) return "—"
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function issueSeverityVariant(severity: string): React.ComponentProps<typeof Badge>["variant"] {
  switch (String(severity).toLowerCase()) {
    case "blocker":
    case "error":
      return "destructive"
    case "warning":
      return "warning"
    default:
      return "outline"
  }
}

function issueAllowedActual(issue: InvoiceIssue): string | null {
  const allowed = issue.allowed_qty ?? issue.allowed_value
  const actual = issue.actual_qty ?? issue.actual_value
  if (allowed == null && actual == null) return null
  return `Allowed ${String(allowed ?? "—")} · Actual ${String(actual ?? "—")}`
}

function payloadString(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === "string" && value.trim() !== "") return value.trim()
  }
  return null
}

function payloadNumber(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === "number") return String(value)
    if (typeof value === "string" && value.trim() !== "") return value.trim()
  }
  return null
}

function InvoiceLineStatusBadge({ line, validated }: { line: InvoiceLine; validated: boolean }) {
  const state = invoiceLineValidationDisplay(line, validated)
  if (state === "blocked") {
    return <Badge variant="destructive">Blocked</Badge>
  }
  if (state === "pass") {
    return <Badge variant="success">Pass</Badge>
  }
  return <Badge variant="secondary">Pending</Badge>
}

function FallbackSummary({ payload }: { payload: Record<string, unknown> }) {
  const fallbackRows = [
    { label: "Invoice number", value: payloadString(payload, "invoice_number", "invoiceNo") },
    { label: "Contractor", value: payloadString(payload, "contractor_name") ?? payloadNumber(payload, "contractor_id") },
    { label: "Plant", value: payloadString(payload, "org_unit_name") ?? payloadNumber(payload, "org_unit_id") },
    { label: "Work Order", value: payloadString(payload, "work_order_number") },
    { label: "Validation status", value: payloadString(payload, "validation_status") },
  ].filter((row) => row.value)

  if (fallbackRows.length === 0) {
    return <p className="text-sm text-muted-foreground">No invoice metadata available in the approval payload.</p>
  }

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {fallbackRows.map((row) => (
        <div key={row.label} className="rounded-lg border bg-muted/20 px-3 py-2">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{row.label}</dt>
          <dd className="mt-1 text-sm font-medium">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function InvoiceExceptionApprovalReview({
  invoiceId,
  fallbackPayload,
}: {
  invoiceId: number
  fallbackPayload: Record<string, unknown>
}) {
  const [row, setRow] = React.useState<InvoiceTaskReviewRow | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [fetchErr, setFetchErr] = React.useState<string | null>(null)

  React.useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true)
      setFetchErr(null)
      try {
        const data = await getJson<InvoiceTaskReviewRow>(`/invoices/${invoiceId}`)
        if (active) setRow(data)
      } catch (e) {
        if (active) {
          setFetchErr(e instanceof ApiError ? e.message : "Could not load invoice detail.")
        }
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [invoiceId])

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading invoice review…</p>
  }

  if (!row) {
    return (
      <div className="space-y-3">
        <Alert variant={fetchErr ? "destructive" : "default"}>
          <AlertTitle>Invoice detail</AlertTitle>
          <AlertDescription>{fetchErr ?? "Could not load the live invoice detail. Showing the request payload instead."}</AlertDescription>
        </Alert>
        <FallbackSummary payload={fallbackPayload} />
      </div>
    )
  }

  const visibleIssues = (row.issues ?? []).filter((issue) => !HIDDEN_VALIDATION_ISSUE_CODES.has(String(issue.code ?? "")))
  const validated = Boolean(row.validation_status)
  const workOrders =
    row.work_order_numbers && row.work_order_numbers.length > 0
      ? row.work_order_numbers
      : Array.from(
          new Set(
            (row.lines ?? [])
              .map((line) => line.work_order_number?.trim())
              .filter((value): value is string => Boolean(value)),
          ),
        )
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="space-y-1 pb-2">
            <CardTitle className="text-base">Invoice identification</CardTitle>
            <CardDescription className="text-xs">Key fields approvers use to identify the invoice and its work order coverage.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Invoice number</div>
              <div className="mt-1 text-sm font-semibold">{row.invoice_number}</div>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Status</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant={invoiceDisplayStatusBadgeVariant(invoiceDisplayStatus(row))}>
                  {invoiceDisplayStatusLabel(invoiceDisplayStatus(row))}
                </Badge>
                {row.validation_status ? (
                  <span className="text-sm text-muted-foreground">Validation {String(row.validation_status).replace(/_/g, " ")}</span>
                ) : null}
              </div>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Contractor</div>
              <div className="mt-1 text-sm font-medium">{row.contractor_name?.trim() || `Contractor #${row.contractor_id}`}</div>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Plant</div>
              <div className="mt-1 text-sm font-medium">{row.org_unit_name?.trim() || `Plant #${row.org_unit_id}`}</div>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2 sm:col-span-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Work order</div>
              <div className="mt-1 text-sm font-medium">{workOrders.length > 0 ? workOrders.join(", ") : "—"}</div>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Invoice date</div>
              <div className="mt-1 text-sm font-medium">{row.invoice_date}</div>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Submitted</div>
              <div className="mt-1 text-sm font-medium">{formatWhen(row.submitted_at ?? row.created_at)}</div>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Lines subtotal</div>
              <div className="mt-1 text-sm font-medium">{formatMoney(row.lines_subtotal_ex_vat)}</div>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Extra charges</div>
              <div className="mt-1 text-sm font-medium">{formatMoney(row.extra_amount_ex_vat)}</div>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Invoice total</div>
              <div className="mt-1 text-sm font-semibold">{formatMoney(row.total_amount)}</div>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Attachments</div>
              <div className="mt-1 text-sm font-medium">
                {row.attachments?.length ? `${row.attachments.length} attachment(s)` : "—"}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-sm">
          <CardHeader className="space-y-1 pb-2">
            <CardTitle className="text-base">Why this invoice is blocked</CardTitle>
            <CardDescription className="text-xs">Validation issues identify the exact breach, such as exceeded approved value, unsupported quantity, or missing evidence.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {visibleIssues.length === 0 ? (
              <p className="text-sm text-muted-foreground">No validation issues were returned for this invoice.</p>
            ) : (
              visibleIssues.map((issue) => (
                <div key={issue.id} className="rounded-lg border px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={issueSeverityVariant(issue.severity)}>{issue.severity}</Badge>
                        <Badge variant="outline" className="font-mono text-[11px]">
                          {issue.code}
                        </Badge>
                        {issue.requires_justification ? <Badge variant="warning">Needs justification</Badge> : null}
                        {issue.requires_attachments ? <Badge variant="warning">Needs attachments</Badge> : null}
                      </div>
                      <p className="text-sm font-medium">{issue.message}</p>
                    </div>
                  </div>
                  {issueAllowedActual(issue) ? (
                    <p className="mt-2 text-xs text-muted-foreground">{issueAllowedActual(issue)}</p>
                  ) : null}
                  {issue.justification?.trim() ? (
                    <div className="mt-2 rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
                      Justification: {issue.justification.trim()}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="space-y-1 pb-2">
          <CardTitle className="text-base">Lines</CardTitle>
          <CardDescription className="text-xs">Line-level view of the work order, commercial quantity, rate, and taxable amount that produced the exception.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Work Order</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit rate</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right">Incl. tax</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(row.lines ?? []).map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <InvoiceLineStatusBadge line={line} validated={validated} />
                  </TableCell>
                  <TableCell className="font-medium">{line.work_order_number ?? "—"}</TableCell>
                  <TableCell>
                    <div className="space-y-0.5">
                      <div className="font-medium">{line.job_description ?? `Item #${line.work_order_item_id}`}</div>
                      <div className="text-xs text-muted-foreground">
                        {line.unit_label ?? line.unit_type ?? "—"} · Item #{line.work_order_item_id}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(line.quantity)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(line.unit_rate ?? line.rate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(line.taxable_value ?? line.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(line.amount_including_tax)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

    </div>
  )
}
