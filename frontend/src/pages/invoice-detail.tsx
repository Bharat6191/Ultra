import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, getJson, patchJson, postJson, postForm } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"
import { InvoicePdfDownloadButton } from "@/components/invoices/invoice-pdf"
import { InvoicePreview } from "@/components/invoices/invoice-preview"
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

function invoiceStatusVariant(status: string): React.ComponentProps<typeof Badge>["variant"] {
  switch (String(status || "").toLowerCase()) {
    case "draft":
      return "secondary"
    case "submitted":
      return "outline"
    case "pending_exception_approval":
      return "warning"
    case "blocked":
      return "destructive"
    case "approved":
      return "success"
    case "rejected":
      return "destructive"
    case "paid":
      return "success"
    default:
      return "outline"
  }
}

function validationVariant(status: string): React.ComponentProps<typeof Badge>["variant"] {
  switch (String(status || "").toLowerCase()) {
    case "pass":
      return "success"
    case "warn":
      return "warning"
    case "fail":
      return "destructive"
    case "blocked":
      return "destructive"
    default:
      return "outline"
  }
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
  const canValidate = hasPermission("invoices.validate")
  const canUpdate = hasPermission("invoices.update")

  const [file, setFile] = React.useState<File | null>(null)

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
      await postJson(`/invoices/${row.id}/submit`, {})
      toast.success("Submitted")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Submit failed")
    } finally {
      setActing(false)
    }
  }

  async function validate() {
    if (!row) return
    setActing(true)
    try {
      await postJson(`/invoices/${row.id}/validate`, {})
      toast.success("Validated")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Validate failed")
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

  async function saveJustification(issueId: number, justification: string) {
    if (!justification.trim()) return
    setActing(true)
    try {
      await patchJson(`/invoices/issues/${issueId}/justification`, { justification: justification.trim() })
      toast.success("Justification saved")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Save failed")
    } finally {
      setActing(false)
    }
  }

  async function uploadAttachment() {
    if (!row || !file) return
    setActing(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      await postForm(`/invoices/${row.id}/attachments`, fd)
      toast.success("Attachment uploaded")
      setFile(null)
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Upload failed")
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
        unit: l.unit_label ?? l.unit_type ?? "—",
        rateBasis: l.rate_basis_label ?? undefined,
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium">{row.invoice_number}</h2>
          <p className="text-sm text-muted-foreground">
            Contractor #{row.contractor_id} · Plant #{row.org_unit_id}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={invoiceStatusVariant(row.status)}>{row.status}</Badge>
          {row.validation_status ? <Badge variant={validationVariant(row.validation_status)}>{row.validation_status}</Badge> : null}
          <Button asChild size="sm" variant="outline">
            <Link to="/dashboard/invoices">Back</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <InvoicePdfDownloadButton
              data={pdfData}
              filename={`${String(row.invoice_number ?? "invoice").replace(/\s+/g, "_")}.pdf`}
            />
          </Button>
          {canSubmit && row.status === "draft" ? (
            <Button size="sm" onClick={() => void submit()} disabled={acting}>
              Submit
            </Button>
          ) : null}
          {canValidate ? (
            <Button size="sm" variant="outline" onClick={() => void validate()} disabled={acting}>
              Validate
            </Button>
          ) : null}
          {canSubmit &&
          row.validation_status &&
          ["blocked", "fail"].includes(row.validation_status) &&
          row.status === "blocked" &&
          !row.approval_request_id ? (
            <Button size="sm" variant="destructive" onClick={() => void requestVariance()} disabled={acting}>
              Request variance approval
            </Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Lines</CardTitle>
          <CardDescription>Approved rates locked to work order snapshots; tint shows validation posture.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[110px]">Work order</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right w-[72px]">Qty</TableHead>
                <TableHead className="w-[56px]">Unit</TableHead>
                <TableHead className="text-right">Unit rate</TableHead>
                <TableHead className="w-[64px]">Basis</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right w-[56px]">Tax %</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Incl. tax</TableHead>
                <TableHead className="text-right w-[64px]">Var %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(row.lines ?? []).map((l: any) => (
                <TableRow
                  key={l.id}
                  className={
                    l.validation_line_status === "blocked"
                      ? "bg-destructive/10"
                      : l.validation_line_status === "warn"
                        ? "bg-amber-500/10"
                        : undefined
                  }
                >
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
                  <TableCell className="text-xs text-muted-foreground">{l.unit_label ?? l.unit_type ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{String(l.unit_rate ?? l.rate)}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground leading-tight">{l.rate_basis_label ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {String(l.taxable_value ?? l.amount ?? "—")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{l.tax_pct != null ? String(l.tax_pct) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {l.tax_amount != null ? String(l.tax_amount) : "—"}
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
          <CardDescription>Blockers require justification + attachments and may trigger exception approvals.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(row.issues ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">No issues.</div>
          ) : (
            (row.issues ?? []).map((i: any) => (
              <div
                key={i.id}
                className={
                  i.severity === "blocker" || i.severity === "error"
                    ? "rounded-md border border-destructive/30 bg-destructive/5 p-3"
                    : i.severity === "warning"
                      ? "rounded-md border border-amber-300/40 bg-amber-500/5 p-3"
                      : "rounded-md border bg-muted/20 p-3"
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {i.code} <span className="text-muted-foreground">·</span>{" "}
                      <Badge variant={issueSeverityVariant(i.severity)}>{i.severity}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">{i.message}</div>
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    allowed {String(i.allowed_qty ?? i.allowed_value ?? "—")} · actual{" "}
                    {String(i.actual_qty ?? i.actual_value ?? "—")}
                  </div>
                </div>
                {canUpdate && i.requires_justification ? (
                  <div className="mt-2 grid gap-2">
                    <Label className="text-xs">Justification</Label>
                    <Textarea
                      defaultValue={i.justification ?? ""}
                      rows={2}
                      onBlur={(e) => void saveJustification(i.id, e.target.value)}
                      placeholder="Required"
                      disabled={acting}
                    />
                    <div className="text-xs text-muted-foreground">Tip: click out of the field to save.</div>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {(row.attachments ?? []).length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Uploaded attachments</CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-1">
            {(row.attachments ?? []).map((a: any) => (
              <div key={a.id} className="flex justify-between gap-2 border rounded-md px-2 py-1">
                <span className="truncate">{a.file_name ?? a.file_path}</span>
                <span className="tabular-nums text-muted-foreground">#{a.id}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Attachments</CardTitle>
          <CardDescription>Upload proofs required for exception approvals.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>File</Label>
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={!canUpdate || acting} />
          </div>
          <div className="flex items-end justify-end">
            <Button variant="outline" onClick={() => void uploadAttachment()} disabled={!canUpdate || !file || acting}>
              Upload
            </Button>
          </div>
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

