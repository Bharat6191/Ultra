import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, getJson, patchJson, postJson } from "@/lib/api"
import {
  invoiceDisplayStatus,
  invoiceDisplayStatusBadgeVariant,
  invoiceDisplayStatusLabel,
  invoiceLineValidationDisplay,
} from "@/lib/invoice-validation-display"
import { hasPermission } from "@/lib/permissions"
import { InvoicePdfDownloadButton } from "@/components/invoices/invoice-pdf"
import { InvoicePreview } from "@/components/invoices/invoice-preview"
import type { InvoiceDisplayLine } from "@/components/invoices/invoice-line-types"

function InvoiceLineStatusBadge({ line, validated }: { line: any; validated: boolean }) {
  const d = invoiceLineValidationDisplay(line, validated)
  if (d === "pending") {
    return (
      <Badge variant="secondary" className="font-normal">
        Pending
      </Badge>
    )
  }
  if (d === "blocked") {
    return (
      <Badge variant="destructive" className="font-normal">
        Blocked
      </Badge>
    )
  }
  return (
    <Badge variant="success" className="font-normal">
      Pass
    </Badge>
  )
}

type Invoice = any
type InvoiceAuditEntry = {
  id: number
  invoice_id: number
  action: string
  actor_name?: string | null
  changed_by?: number | null
  created_at?: string | null
  old_value?: any
  new_value?: any
  metadata?: any
}

const HIDDEN_VALIDATION_ISSUE_CODES = new Set(["QTY_EXCEEDS_COMPLETION", "CUMULATIVE_QTY_EXCEEDS_ALLOWED"])

function issueAllowedActual(i: { allowed_qty?: unknown; allowed_value?: unknown; actual_qty?: unknown; actual_value?: unknown }) {
  const allowed = i.allowed_qty ?? i.allowed_value
  const actual = i.actual_qty ?? i.actual_value
  if (allowed == null && actual == null) return null
  return (
    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
      allowed {String(allowed ?? "—")} · actual {String(actual ?? "—")}
    </span>
  )
}

function mergedBlockerJustification(issues: { justification?: string | null }[]): string {
  const texts = [
    ...new Set(
      issues.map((i) => String(i.justification ?? "").trim()).filter(Boolean),
    ),
  ]
  return texts[0] ?? ""
}

function issueSeverityVariant(sev: string): React.ComponentProps<typeof Badge>["variant"] {
  switch (String(sev || "").toLowerCase()) {
    case "blocker":
      return "destructive"
    case "error":
      return "destructive"
    case "warning":
      return "warning"
    default:
      return "outline"
  }
}

export function InvoiceDetailPage() {
  const { id } = useParams()
  const invId = Number(id)
  const [row, setRow] = React.useState<Invoice | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [acting, setActing] = React.useState(false)
  const [audit, setAudit] = React.useState<InvoiceAuditEntry[]>([])

  const canSubmit = hasPermission("invoices.submit")
  const canUpdate = hasPermission("invoices.update")
  const canEditDraft = canUpdate && (row?.status === "draft" || row?.status === "rejected")

  const load = React.useCallback(async () => {
    if (!Number.isFinite(invId) || invId <= 0) return
    setLoading(true)
    setError(null)
    try {
      const r = await getJson<any>(`/invoices/${invId}`)
      setRow(r)
      const logs = await getJson<InvoiceAuditEntry[]>(`/invoices/${invId}/audit-logs`).catch(() => [])
      setAudit(Array.isArray(logs) ? logs : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load invoice")
    } finally {
      setLoading(false)
    }
  }, [invId])

  React.useEffect(() => {
    void load()
  }, [load])

  async function submit() {
    if (!row) return
    setActing(true)
    try {
      const inv = await postJson<{ status: string; validation_status?: string | null }>(
        `/invoices/${row.id}/submit`,
        {},
      )
      if (inv.validation_status === "pass" || inv.validation_status === "warn") {
        toast.success(`Submitted — validation ${inv.validation_status}`)
      } else if (inv.status === "pending_exception_approval") {
        toast.warning("Submitted and blocked — finance approval tasks created")
      } else if (inv.status === "blocked" || inv.validation_status === "blocked") {
        toast.warning("Submitted but blocked — adjust amounts or complete approval setup")
      } else {
        toast.success("Submitted")
      }
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Submit failed")
    } finally {
      setActing(false)
    }
  }

  async function requestVariance() {
    if (!row) return
    setActing(true)
    try {
      await postJson(`/invoices/${row.id}/request-exception-approval`, {})
      toast.success("Variance approval requested")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Request failed")
    } finally {
      setActing(false)
    }
  }

  async function saveJustificationForBlockers(justification: string, issueIds: number[]) {
    const text = justification.trim()
    if (!text || issueIds.length === 0) return
    setActing(true)
    try {
      await Promise.all(
        issueIds.map((issueId) =>
          patchJson(`/invoices/issues/${issueId}/justification`, { justification: text }),
        ),
      )
      toast.success("Justification saved")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Save failed")
    } finally {
      setActing(false)
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>
  if (!row) {
    return (
      <Alert variant={error ? "destructive" : "default"}>
        <AlertTitle>Invoice</AlertTitle>
        <AlertDescription>{error ?? "Not found"}</AlertDescription>
      </Alert>
    )
  }

  const pdfLines: InvoiceDisplayLine[] =
    (row.lines ?? []).map((l: any) => {
      const taxable = Number(l.taxable_value ?? l.amount ?? 0)
      const tp = l.tax_pct != null ? Number(l.tax_pct) : 0
      const taxAmt = l.tax_amount != null ? Number(l.tax_amount) : Number.isFinite(tp) && tp > 0 ? taxable * (tp / 100) : 0
      const incl =
        l.amount_including_tax != null
          ? Number(l.amount_including_tax)
          : Number.isFinite(taxable)
            ? taxable + (Number.isFinite(taxAmt) ? taxAmt : 0)
            : 0
      return {
        description:
          (l.work_order_number ? `${l.work_order_number} · ` : "") +
          (l.job_description ? `${l.job_description} · ` : "") +
          `Item #${l.work_order_item_id}`,
        qty: Number(l.quantity ?? 0),
        weightKg:
          l.weight_per_piece_kg != null && Number.isFinite(Number(l.weight_per_piece_kg))
            ? Number(l.weight_per_piece_kg)
            : null,
        unit: l.unit_label ?? l.unit_type ?? "—",
        unitPrice: Number(l.unit_rate ?? l.rate ?? 0),
        taxable,
        lineTaxPct: Number.isFinite(tp) && tp > 0 ? tp : undefined,
        taxAmount: taxAmt,
        totalInclTax: incl,
      }
    }) ?? []

  const taxPctHeader = 0

  const pdfData = {
    invoiceNo: String(row.invoice_number ?? "—"),
    invoiceDate: String(row.invoice_date ?? "—"),
    dueDate: undefined,
    issuedTo: { name: `Contractor #${row.contractor_id}`, address: `Plant #${row.org_unit_id}` },
    payTo: { name: "Ultra Workspace", bank: "—", accountName: "—", accountNoMasked: "—" },
    currencySymbol: "₹",
    taxPct: taxPctHeader,
    lines: pdfLines,
  }

  const invoiceValidationDone = Boolean(row.last_validated_at ?? row.validation_status)

  const visibleIssues = (row.issues ?? []).filter(
    (i: { code?: string }) => !HIDDEN_VALIDATION_ISSUE_CODES.has(String(i.code ?? "")),
  )
  const issuesNeedingJustification = visibleIssues.filter((i: { requires_justification?: boolean }) =>
    Boolean(i.requires_justification),
  )
  const otherVisibleIssues = visibleIssues.filter((i: { requires_justification?: boolean }) => !i.requires_justification)
  const blockerJustificationKey = issuesNeedingJustification.map((i: { id: number }) => i.id).join(",")

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium">{row.invoice_number}</h2>
          <p className="text-sm text-muted-foreground">
            Contractor #{row.contractor_id} · Plant #{row.org_unit_id}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant={invoiceDisplayStatusBadgeVariant(invoiceDisplayStatus(row))}>
            {invoiceDisplayStatusLabel(invoiceDisplayStatus(row))}
          </Badge>
          <Button asChild variant="outline" size="default" className="min-h-10 bg-background shadow-sm">
            <Link to="/dashboard/invoices">Back</Link>
          </Button>
          <InvoicePdfDownloadButton
            data={pdfData}
            filename={`${String(row.invoice_number ?? "invoice").replace(/\s+/g, "_")}.pdf`}
            variant="outline"
            size="default"
            className="min-h-10 bg-background shadow-sm"
          />
          {canEditDraft ? (
            <Button asChild variant="outline" size="default" className="min-h-10 bg-background shadow-sm">
              <Link to={`/dashboard/invoices/${row.id}/edit`}>Edit draft</Link>
            </Button>
          ) : null}
          {canSubmit && (row.status === "draft" || row.status === "rejected") ? (
            <Button size="default" onClick={() => void submit()} disabled={acting}>
              Submit
            </Button>
          ) : null}
          {canSubmit &&
          row.validation_status &&
          ["blocked", "fail"].includes(row.validation_status) &&
          row.status === "blocked" &&
          !row.approval_request_id ? (
            <Button size="default" variant="destructive" onClick={() => void requestVariance()} disabled={acting}>
              Request approval
            </Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Lines</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[88px]">Status</TableHead>
                <TableHead className="w-[110px]">Work order</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right w-[72px]">Qty</TableHead>
                <TableHead className="text-right w-[80px]">WT (kg)</TableHead>
                <TableHead className="w-[56px]">Unit</TableHead>
                <TableHead className="text-right">Unit rate</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right">Incl. tax</TableHead>
                <TableHead className="text-right w-[64px]">Var %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(row.lines ?? []).map((l: any) => (
                <TableRow
                  key={l.id}
                  className={
                    invoiceLineValidationDisplay(l, invoiceValidationDone) === "blocked"
                      ? "bg-destructive/10"
                      : undefined
                  }
                >
                  <TableCell className="align-middle">
                    <InvoiceLineStatusBadge line={l} validated={invoiceValidationDone} />
                  </TableCell>
                  <TableCell className="text-xs font-mono whitespace-nowrap">{l.work_order_number ?? "—"}</TableCell>
                  <TableCell className="text-xs max-w-[200px]">
                    <div className="font-medium">#{l.work_order_item_id}</div>
                    <div className="text-muted-foreground truncate">{l.job_description ?? ""}</div>
                    {l.part_code || l.part_name ? (
                      <div className="text-[11px] text-muted-foreground truncate">
                        {[l.part_code, l.part_name].filter(Boolean).join(" · ")}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{String(l.quantity)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                    {l.weight_per_piece_kg != null && Number.isFinite(Number(l.weight_per_piece_kg))
                      ? Number(l.weight_per_piece_kg).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{l.unit_label ?? l.unit_type ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{String(l.unit_rate ?? l.rate)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {String(l.taxable_value ?? l.amount ?? "—")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {l.amount_including_tax != null ? String(l.amount_including_tax) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                    {l.variance_pct_hint != null ? `${l.variance_pct_hint.toFixed(2)}%` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Invoice preview</CardTitle>
          <CardDescription>Printable layout matching the PDF download.</CardDescription>
        </CardHeader>
        <CardContent>
          <InvoicePreview data={pdfData} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Validation issues</CardTitle>
          <CardDescription>
            Provide one justification for all blockers below before requesting exception approval.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {visibleIssues.length === 0 ? (
            <div className="text-sm text-muted-foreground">No issues.</div>
          ) : null}
          {issuesNeedingJustification.length > 0 ? (
            <div className="space-y-4 rounded-md border border-destructive/30 bg-destructive/5 p-4">
              <ul className="space-y-3">
                {issuesNeedingJustification.map((i: any) => (
                  <li key={i.id} className="border-b border-destructive/15 pb-3 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{i.code}</span>
                          <Badge variant={issueSeverityVariant(i.severity)}>{i.severity}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{i.message}</p>
                      </div>
                      {issueAllowedActual(i)}
                    </div>
                  </li>
                ))}
              </ul>
              {canUpdate ? (
                <div className="grid gap-2 border-t border-destructive/15 pt-3">
                  <Label className="text-xs" showRequired>
                    Justification
                  </Label>
                  <Textarea
                    key={blockerJustificationKey}
                    defaultValue={mergedBlockerJustification(issuesNeedingJustification)}
                    rows={3}
                    onBlur={(e) =>
                      void saveJustificationForBlockers(
                        e.target.value,
                        issuesNeedingJustification.map((i: { id: number }) => i.id),
                      )
                    }
                    placeholder="Explain why this invoice should be approved despite the exceptions above"
                    disabled={acting}
                  />
                  <p className="text-xs text-muted-foreground">Click outside the field to save for all blockers.</p>
                </div>
              ) : null}
            </div>
          ) : null}
          {otherVisibleIssues.map((i: any) => (
            <div
              key={i.id}
              className={
                i.severity === "warning"
                  ? "rounded-md border border-amber-300/40 bg-amber-500/5 p-3"
                  : "rounded-md border bg-muted/20 p-3"
              }
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{i.code}</span>
                    <Badge variant={issueSeverityVariant(i.severity)}>{i.severity}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{i.message}</p>
                </div>
                {issueAllowedActual(i)}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Audit trail</CardTitle>
          <CardDescription>Immutable timeline of actions on this invoice.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {audit.length === 0 ? (
            <div className="text-sm text-muted-foreground">No audit entries yet.</div>
          ) : (
            audit
              .slice()
              .reverse()
              .slice(0, 30)
              .map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{a.action}</div>
                    <div className="text-sm">{a.actor_name ?? (a.changed_by != null ? `User #${a.changed_by}` : "—")}</div>
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {a.created_at ? new Date(a.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—"}
                  </div>
                </div>
              ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default InvoiceDetailPage
