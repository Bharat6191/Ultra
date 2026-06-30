import * as React from "react"
import { Eye } from "lucide-react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { InvoiceLinesTableCard } from "@/components/invoices/invoice-lines-table"
import { InvoicePreview } from "@/components/invoices/invoice-preview"
import { PageBackLink } from "@/components/layout/page-back-link"
import { CollapsibleAuditList } from "@/components/shared/collapsible-audit-list"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ApiError, getJson, postJson } from "@/lib/api"
import {
  invoiceDisplayStatus,
  invoiceDisplayStatusBadgeVariant,
  invoiceDisplayStatusLabel,
} from "@/lib/invoice-validation-display"
import { hasPermission } from "@/lib/permissions"
import { InvoicePdfDownloadButton } from "@/components/invoices/invoice-pdf"
import type { InvoiceDisplayLine } from "@/components/invoices/invoice-line-types"

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

export function InvoiceDetailPage() {
  const { id } = useParams()
  const invId = Number(id)
  const [row, setRow] = React.useState<Invoice | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [acting, setActing] = React.useState(false)
  const [audit, setAudit] = React.useState<InvoiceAuditEntry[]>([])
  const [showInvoicePreview, setShowInvoicePreview] = React.useState(false)

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

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>
  if (!row) {
    return (
      <Alert variant={error ? "destructive" : "default"}>
        <AlertTitle>Invoice</AlertTitle>
        <AlertDescription>{error ?? "Not found"}</AlertDescription>
      </Alert>
    )
  }

  const pdfLines: InvoiceDisplayLine[] = [
    ...((row.lines ?? []).map((l: any) => {
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
          `Item ${l.work_order_item_id}`,
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
    }) ?? []),
    ...((row.extra_lines ?? []).map((l: any) => {
      const qty = l.quantity != null && Number.isFinite(Number(l.quantity)) && Number(l.quantity) > 0 ? Number(l.quantity) : 1
      const taxable = Number(l.amount_ex_vat ?? 0)
      const unitPrice =
        l.unit_price != null && Number.isFinite(Number(l.unit_price)) ? Number(l.unit_price) : taxable
      return {
        description: String(l.description ?? "Extra line"),
        qty,
        unit: l.unit ?? "—",
        unitPrice,
        taxable,
        taxAmount: 0,
        totalInclTax: taxable,
      }
    }) ?? []),
  ]

  const taxPctHeader = 0

  const pdfData = {
    invoiceNo: String(row.invoice_number ?? "—"),
    invoiceDate: String(row.invoice_date ?? "—"),
    dueDate: undefined,
    issuedTo: {
      name: row.contractor_name?.trim() || `Contractor ${row.contractor_id}`,
      address: row.org_unit_name?.trim() || `Plant ${row.org_unit_id}`,
    },
    payTo: { name: "Ultra Workspace", bank: "—", accountName: "—", accountNoMasked: "—" },
    plantName: row.org_unit_name?.trim() || `Plant ${row.org_unit_id}`,
    contractorName: row.contractor_name?.trim() || `Contractor ${row.contractor_id}`,
    invoiceTypeLabel: "Individual Invoice",
    currencySymbol: "₹",
    taxPct: taxPctHeader,
    lines: pdfLines,
  }
  const invoiceFilename = `${String(row.invoice_number ?? "invoice").replace(/\s+/g, "_")}.pdf`

  const invoiceValidationDone = Boolean(row.last_validated_at ?? row.validation_status)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <PageBackLink
            to="/dashboard/invoices"
            label={String(row.invoice_number ?? "Invoices")}
            className="font-mono"
          />
          <h2 className="text-base font-medium">{row.invoice_number}</h2>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant={invoiceDisplayStatusBadgeVariant(invoiceDisplayStatus(row))}>
            {invoiceDisplayStatusLabel(invoiceDisplayStatus(row))}
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="default"
            className="min-h-10 gap-1.5 bg-background shadow-sm"
            onClick={() => setShowInvoicePreview(true)}
            disabled={pdfLines.length === 0}
          >
            <Eye className="size-4" />
            Preview
          </Button>
          <InvoicePdfDownloadButton
            data={pdfData}
            filename={invoiceFilename}
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

      <InvoiceLinesTableCard
        title="Lines"
        // description="Work-order-backed commercial lines with billed quantity, rate, taxable amount, and tax-inclusive totals."
        lines={row.lines ?? []}
        validated={invoiceValidationDone}
        showVariance={true}
        emptyMessage="No invoice lines available."
      />

      <Dialog open={showInvoicePreview} onOpenChange={setShowInvoicePreview}>
        <DialogContent
          className="flex max-h-[min(92vh,960px)] w-[calc(100vw-1.5rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(56rem,calc(100vw-1.5rem))]"
          showCloseButton
        >
          <DialogHeader className="flex shrink-0 flex-row items-center justify-between gap-3 border-b px-5 py-4 pr-12">
            <DialogTitle>Invoice preview</DialogTitle>
            <InvoicePdfDownloadButton
              data={pdfData}
              filename={invoiceFilename}
              variant="outline"
              size="sm"
              disabled={pdfLines.length === 0}
            />
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto bg-zinc-100/80 p-4 sm:p-6">
            <InvoicePreview data={pdfData} className="shadow-md" />
          </div>
        </DialogContent>
      </Dialog>

      {/* <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Invoice preview</CardTitle>
        </CardHeader>
        <CardContent>
          <InvoicePreview data={pdfData} />
        </CardContent>
      </Card> */}

      {/* <Card>
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
      </Card> */}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Audit Log</CardTitle>
          {/* <CardDescription>Immutable timeline of actions on this invoice.</CardDescription> */}
        </CardHeader>
        <CardContent className="space-y-2">
          {audit.length === 0 ? (
            <div className="text-sm text-muted-foreground">No audit entries yet.</div>
          ) : (
            <CollapsibleAuditList
              items={audit
                .slice()
                .reverse()
                .slice(0, 30)}
              className="space-y-2"
              renderItem={(a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{a.action}</div>
                    <div className="text-sm">{a.actor_name ?? (a.changed_by != null ? `User #${a.changed_by}` : "—")}</div>
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {a.created_at ? new Date(a.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—"}
                  </div>
                </div>
              )}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default InvoiceDetailPage
