import * as React from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import type {
  ContractorLite,
  ExecutionDetailRow,
  ExecutionDraftLine,
  OrgUnitLite,
  PartMasterLite,
} from "@/components/work-orders/work-order-execution-ui"
import {
  buildWorkOrderLinesForApi,
  executionDetailRateCell,
  executionDetailTaxableCell,
  flattenWorkOrderToDraftLines,
  formatExecutionQtyDisplay,
  formatExecutionWeightAmount,
  formatWorkOrderDateTime,
  pricingDateForNewWorkOrder,
  newDraftLine,
  WorkOrderExecutionFooter,
  WorkOrderExecutionHeader,
  WorkOrderExecutionTable,
} from "@/components/work-orders/work-order-execution-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { LineWithCompletion } from "@/components/work-orders/work-order-completion-tracker"
import { WorkOrderLineCompletionInline } from "@/components/work-orders/work-order-completion-tracker"
import { ApiError, deleteJson, getJson, patchJson, postJson } from "@/lib/api"
import {
  invoiceDisplayStatus,
  invoiceDisplayStatusBadgeVariant,
  invoiceDisplayStatusLabel,
} from "@/lib/invoice-validation-display"
import { workOrderStatusBadgeVariant, workOrderStatusLabel } from "@/lib/work-order-status-badge"
import { canListOrgUnitsForAssignments, hasPermission } from "@/lib/permissions"

type LineCompletionPayload = {
  progress_type: string
  unit_type: string
  approved_quantity: number | null
  approved_percentage: number | null
  completed_quantity: number | null
  completed_percentage: number | null
  remaining_quantity: number | null
  last_updated_at: string | null
  last_updated_by: number | null
  last_updated_by_name: string | null
}

type WorkOrder = {
  id: number
  work_order_number: string
  org_unit_id: number
  contractor_id: number
  contractor_name?: string | null
  title: string
  description: string | null
  status: string
  is_active?: boolean
  created_at?: string | null
  approved_at?: string | null
  updated_at?: string | null
  approved_value_total?: string | number | null
  invoiced_ex_tax_total?: string | number | null
  committed_invoiced_ex_tax_total?: string | number | null
  remaining_invoiceable_value?: string | number | null
  items?: {
    id: number
    part_master_id: number
    part_code?: string | null
    part_name?: string | null
    unit_type?: string | null
    pricing_method?: string | null
    rate_unit_type?: string | null
    progress_type: string
    planned_quantity: string | number | null
    planned_percentage: string | number | null
    weight_per_piece_snapshot?: string | number | null
    taxable_value?: string | number | null
    resolved_rate: string | number
    rate_source: string
    notes?: string | null
    pricing_snapshot?: { calculation_breakdown?: Record<string, unknown> } | null
    completion?: LineCompletionPayload
  }[]
}

type AuditEntry = {
  id: number
  work_order_id: number
  action: string
  actor_name?: string | null
  changed_by?: number | null
  created_at?: string | null
  old_value?: any
  new_value?: any
  metadata?: any
}

type LinkedInvoice = {
  id: number
  invoice_number: string
  invoice_date: string
  status: string
  validation_status?: string | null
  total_amount: string | number
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function parseNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return NaN
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""))
  return n
}

function fallbackLineCompletion(it: NonNullable<WorkOrder["items"]>[number]): LineCompletionPayload {
  const aq = parseNum(it.planned_quantity)
  const apPct = parseNum(it.planned_percentage)
  return {
    progress_type: it.progress_type,
    unit_type: it.planned_quantity != null && String(it.planned_quantity) !== "" ? "qty" : (it.unit_type ?? "qty"),
    approved_quantity: Number.isFinite(aq) ? aq : null,
    approved_percentage: Number.isFinite(apPct) ? apPct : null,
    completed_quantity: null,
    completed_percentage: null,
    remaining_quantity: null,
    last_updated_at: null,
    last_updated_by: null,
    last_updated_by_name: null,
  }
}

function workOrderListTabForStatus(status: string): "draft" | "approval" | "operating" | "completed" | null {
  switch (String(status || "").toLowerCase()) {
    case "draft":
    case "rejected":
      return "draft"
    case "pending_approval":
      return "approval"
    case "approved":
    case "active":
      return "operating"
    case "closed":
      return "completed"
    default:
      return null
  }
}

function workOrderAuditActionLabel(entry: AuditEntry): string {
  const action = String(entry.action || "").toUpperCase()
  if (action === "ARCHIVED" || action === "UNARCHIVED") return action
  const next =
    entry.new_value && typeof entry.new_value === "object" ? (entry.new_value as Record<string, unknown>) : null
  if (action === "CANCELLED" && next?.is_active === false) return "ARCHIVED"
  return action
}

export function WorkOrderDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const woId = Number(id)
  const [row, setRow] = React.useState<WorkOrder | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [audit, setAudit] = React.useState<AuditEntry[]>([])
  const [linkedInvoices, setLinkedInvoices] = React.useState<LinkedInvoice[]>([])

  const [plants, setPlants] = React.useState<OrgUnitLite[]>([])
  const [contractors, setContractors] = React.useState<ContractorLite[]>([])

  const [submitBusy, setSubmitBusy] = React.useState(false)
  const [saveDraftBusy, setSaveDraftBusy] = React.useState(false)
  const [completeBusy, setCompleteBusy] = React.useState(false)

  const [partMasters, setPartMasters] = React.useState<PartMasterLite[]>([])
  const [pmsLoading, setPmsLoading] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState("")
  const [editReference, setEditReference] = React.useState("")
  const [editOrgUnit, setEditOrgUnit] = React.useState("")
  const [editContractorId, setEditContractorId] = React.useState("")
  const [draftLines, setDraftLines] = React.useState<ExecutionDraftLine[]>(() => [newDraftLine()])

  const canSubmit = hasPermission("work_orders.create")
  const canManageCompletion =
    hasPermission("work_orders.manage_completion") || hasPermission("work_orders.track_completion")
  const canDelete = hasPermission("work_orders.delete")
  const canViewInvoices = hasPermission("invoices.view")

  const contractorName = React.useCallback(
    (id: number) => contractors.find((c) => c.id === id)?.name ?? `Contractor #${id}`,
    [contractors],
  )

  const workOrderContractorLabel = React.useMemo(() => {
    const apiName = row?.contractor_name?.trim()
    if (apiName) return apiName
    return row ? contractorName(row.contractor_id) : undefined
  }, [contractorName, row])

  const plantLabel = React.useMemo(() => {
    const hit = plants.find((p) => p.id === row?.org_unit_id)
    return hit?.name ?? (row?.org_unit_id !== undefined ? `#${row.org_unit_id}` : "—")
  }, [plants, row?.org_unit_id])

  React.useEffect(() => {
    void (async () => {
      try {
        const [plist, clist] = await Promise.all([
          canListOrgUnitsForAssignments()
            ? getJson<OrgUnitLite[]>("/admin/org-units?type=PLANT").catch(() => [])
            : Promise.resolve([]),
          getJson<ContractorLite[]>("/contractors/lookup?limit=400&status=active").catch(() => []),
        ])
        setPlants(plist)
        setContractors(clist)
      } catch {
        setPlants([])
        setContractors([])
      }
    })()
  }, [])

  const editableDraft = Boolean(
    row && row.is_active !== false && canSubmit && (row.status === "draft" || row.status === "rejected"),
  )

  React.useEffect(() => {
    if (!editableDraft || !row) return
    setPmsLoading(true)
    void (async () => {
      try {
        const rms = await getJson<PartMasterLite[]>("/part-master?active=true")
        setPartMasters(Array.isArray(rms) ? rms : [])
      } catch {
        setPartMasters([])
      } finally {
        setPmsLoading(false)
      }
    })()
  }, [editableDraft, row?.id])

  React.useEffect(() => {
    if (!row || !editableDraft) return
    setEditTitle(row.title)
    setEditReference(row.description ?? "")
    setEditOrgUnit(String(row.org_unit_id))
    setEditContractorId(String(row.contractor_id ?? ""))
    setDraftLines(flattenWorkOrderToDraftLines(row))
  }, [row, editableDraft])

  const load = React.useCallback(async () => {
    if (!Number.isFinite(woId) || woId <= 0) return
    setLoading(true)
    setError(null)
    try {
      const [r, logs, invs] = await Promise.all([
        getJson<WorkOrder>(`/work-orders/${woId}`),
        getJson<AuditEntry[]>(`/work-orders/${woId}/audit-logs`).catch(() => []),
        getJson<LinkedInvoice[]>(`/work-orders/${woId}/invoices`).catch(() => []),
      ])
      setRow(r)
      setAudit(Array.isArray(logs) ? logs : [])
      setLinkedInvoices(Array.isArray(invs) ? invs : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load work order")
    } finally {
      setLoading(false)
    }
  }, [woId])

  React.useEffect(() => {
    void load()
  }, [load])

  async function submit() {
    if (!row) return
    if (editableDraft) {
      if (!editTitle.trim()) return toast.error("Title is required.")
      const built = buildWorkOrderLinesForApi(editContractorId, draftLines, partMasters)
      if (!built.ok) return toast.error(built.error)
      setSubmitBusy(true)
      try {
        await patchJson(`/work-orders/${row.id}`, {
          title: editTitle.trim(),
          description: editReference.trim() || null,
          org_unit_id: Number(editOrgUnit),
          contractor_id: built.contractor_id,
          items: built.items,
        })
        await postJson(`/work-orders/${row.id}/submit`, {})
        toast.success("Submitted for approval")
        await load()
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Submit failed")
      } finally {
        setSubmitBusy(false)
      }
      return
    }
    setSubmitBusy(true)
    try {
      await postJson(`/work-orders/${row.id}/submit`, {})
      toast.success("Submitted for approval")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Submit failed")
    } finally {
      setSubmitBusy(false)
    }
  }

  async function archive() {
    if (!row) return
    if (!confirm("Archive this work order? It will move to the Archive tab.")) return
    try {
      await deleteJson(`/work-orders/${row.id}`)
      toast.success("Work order archived")
      navigate("/dashboard/work-orders?tab=archive", { replace: true })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Archive failed")
    }
  }

  async function unarchive() {
    if (!row) return
    if (!confirm("Unarchive this work order?")) return
    try {
      const res = await postJson<{ status?: string }>(`/work-orders/${row.id}/unarchive`, {})
      toast.success("Work order unarchived")
      const nextTab = workOrderListTabForStatus(String(res?.status ?? row.status))
      navigate(nextTab ? `/dashboard/work-orders?tab=${nextTab}` : "/dashboard/work-orders", { replace: true })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Unarchive failed")
    }
  }

  async function completeWorkOrder() {
    if (!row) return
    if (!confirm("Mark this work order complete? It will be closed.")) return
    setCompleteBusy(true)
    try {
      await postJson(`/work-orders/${row.id}/complete`, {})
      toast.success("Work order completed.")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not complete work order.")
    } finally {
      setCompleteBusy(false)
    }
  }

  const detailRows = React.useMemo(() => {
    if (!row?.items?.length) return []
    let sr = 0
    const out: ExecutionDetailRow[] = []
    const headCid = row.contractor_id

    for (const it of row.items) {
      sr += 1
      const qtyDisplay =
        it.progress_type === "percentage"
          ? it.planned_percentage != null && String(it.planned_percentage) !== ""
            ? (() => {
                const s = formatExecutionQtyDisplay(it.planned_percentage)
                return s.includes("%") ? s : `${s}%`
              })()
            : "—"
          : it.planned_quantity != null && String(it.planned_quantity) !== ""
            ? formatExecutionQtyDisplay(it.planned_quantity)
            : "—"

      const rateN = parseNum(it.resolved_rate)
      const rateDisplay = Number.isFinite(rateN)
        ? executionDetailRateCell({
            rateMoney: fmtMoney(rateN),
            rateSource: String(it.rate_source ?? ""),
            pricingMethod: it.pricing_method,
            rateUnitType: it.rate_unit_type,
          })
        : "—"

      const tv = parseNum(it.taxable_value)
      const bdBreakdown =
        it.pricing_snapshot?.calculation_breakdown &&
        typeof it.pricing_snapshot.calculation_breakdown === "object"
          ? (it.pricing_snapshot.calculation_breakdown as Record<string, unknown>)
          : null
      let invoiceDisplay: React.ReactNode = "—"
      if (Number.isFinite(tv)) {
        invoiceDisplay = executionDetailTaxableCell({
          money: fmtMoney(tv),
          rateSource: String(it.rate_source ?? ""),
          pricingMethod: it.pricing_method,
          rateUnitType: it.rate_unit_type,
          calculationBreakdown: bdBreakdown,
        })
      } else if (it.progress_type === "quantity") {
        const q = parseNum(it.planned_quantity)
        if (Number.isFinite(q) && Number.isFinite(rateN)) {
          invoiceDisplay = executionDetailTaxableCell({
            money: fmtMoney(q * rateN),
            rateSource: String(it.rate_source ?? ""),
            pricingMethod: it.pricing_method,
            rateUnitType: it.rate_unit_type,
            calculationBreakdown: bdBreakdown,
          })
        }
      }

      const completionItem: LineWithCompletion = {
        id: it.id,
        part_code: it.part_code ?? null,
        part_name: it.part_name ?? null,
        unit_type: "qty",
        progress_type: it.progress_type,
        planned_quantity: it.planned_quantity,
        planned_percentage: it.planned_percentage,
        completion: it.completion ?? fallbackLineCompletion(it),
      }

      const job_label = it.part_code?.trim() ? it.part_code.trim() : "—"

      const bd = it.pricing_snapshot?.calculation_breakdown
      const bdObj = bd && typeof bd === "object" && bd !== null ? (bd as Record<string, unknown>) : null

      let weightStr: string | null =
        it.weight_per_piece_snapshot != null && String(it.weight_per_piece_snapshot).trim() !== ""
          ? String(it.weight_per_piece_snapshot).trim()
          : null
      if (!weightStr && bdObj?.weight_per_piece != null && String(bdObj.weight_per_piece).trim() !== "") {
        weightStr = String(bdObj.weight_per_piece).trim()
      }
      const weightBased =
        String(it.pricing_method ?? "").toLowerCase() === "weight_based" &&
        String(it.rate_unit_type ?? "").toLowerCase() === "per_kg"
      const unitKg = String(it.unit_type ?? "").toLowerCase() === "kg"
      const showWeightHint = Boolean(weightStr && (weightBased || unitKg))

      const weightDisplay = showWeightHint && weightStr ? formatExecutionWeightAmount(weightStr) : "—"
      const unitDisplay = it.unit_type?.trim() ? it.unit_type.trim() : "—"

      out.push({
        sr,
        contractor_label: contractorName(headCid),
        job_label,
        qty_display: qtyDisplay,
        weight_display: weightDisplay,
        unit_display: unitDisplay,
        rate_display: rateDisplay,
        invoice_display: invoiceDisplay,
        completionCell:
          row.status === "active" && canManageCompletion && !editableDraft ? (
            <WorkOrderLineCompletionInline
              item={completionItem}
              contractorLabel={contractorName(headCid)}
              lineSr={sr}
              onSaved={() => void load()}
            />
          ) : null,
      })
    }
    return out
  }, [
    row,
    contractorName,
    editableDraft,
    canManageCompletion,
    load,
  ])

  async function saveDraft() {
    if (!row || !editableDraft) return
    if (!editTitle.trim()) return toast.error("Title is required.")
    const built = buildWorkOrderLinesForApi(editContractorId, draftLines, partMasters)
    if (!built.ok) return toast.error(built.error)

    setSaveDraftBusy(true)
    try {
      await patchJson(`/work-orders/${row.id}`, {
        title: editTitle.trim(),
        description: editReference.trim() || null,
        org_unit_id: Number(editOrgUnit),
        contractor_id: built.contractor_id,
        items: built.items,
      })
      toast.success("Work order saved")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Save failed")
    } finally {
      setSaveDraftBusy(false)
    }
  }

  const allLinesFullyComplete = React.useMemo(() => {
    if (!row?.items?.length) return false
    for (const it of row.items) {
      const comp = it.completion ?? fallbackLineCompletion(it)
      const cq = comp.completed_quantity
      const approved =
        typeof comp.approved_quantity === "number" && Number.isFinite(comp.approved_quantity)
          ? comp.approved_quantity
          : parseNum(it.planned_quantity)
      if (typeof cq !== "number" || !Number.isFinite(cq)) return false
      if (Number.isFinite(approved) && approved > 0) {
        if (cq + 1e-9 < approved) return false
      } else {
        const cp = comp.completed_percentage
        if (typeof cp !== "number" || !Number.isFinite(cp) || cp < 99.99) return false
      }
    }
    return true
  }, [row?.items])

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>
  if (!row) {
    return (
      <Alert variant={error ? "destructive" : "default"}>
        <AlertTitle>Work Order</AlertTitle>
        <AlertDescription>{error ?? "Not found"}</AlertDescription>
      </Alert>
    )
  }

  const showSubmitButton = row.is_active !== false && canSubmit && (row.status === "draft" || row.status === "rejected")

  const showCompletionEngine = row.is_active !== false && row.status === "active" && canManageCompletion && !editableDraft

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{row.work_order_number}</p>
          <h2 className="text-base font-medium">Work Order</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant={workOrderStatusBadgeVariant(row.status, row.is_active)}>
              {workOrderStatusLabel(row.status, row.is_active)}
            </Badge>
            {!editableDraft ? (
              <>
                <span className="text-sm text-muted-foreground tabular-nums">
                  Created: {formatWorkOrderDateTime(row.created_at)}
                </span>
                {row.approved_at ? (
                  <span className="text-sm text-muted-foreground tabular-nums">
                    Approved: {formatWorkOrderDateTime(row.approved_at)}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to={row.is_active === false ? "/dashboard/work-orders?tab=archive" : "/dashboard/work-orders"}>
              Back
            </Link>
          </Button>
          {canDelete ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void (row.is_active === false ? unarchive() : archive())}
            >
              {row.is_active === false ? "Unarchive" : "Archive"}
            </Button>
          ) : null}
        </div>
      </div>

      <WorkOrderExecutionHeader
        loading={editableDraft && pmsLoading}
        editable={editableDraft}
        title={editableDraft ? editTitle : row.title}
        reference={editableDraft ? editReference : row.description ?? ""}
        org_unit_id={editableDraft ? editOrgUnit : String(row.org_unit_id)}
        plants={plants}
        onTitle={setEditTitle}
        onReference={setEditReference}
        onOrgUnit={setEditOrgUnit}
        plantLabel={editableDraft ? undefined : plantLabel}
      />

      <WorkOrderExecutionTable
        mode={editableDraft ? "edit" : "view"}
        loading={editableDraft && pmsLoading}
        org_unit_id={editableDraft ? editOrgUnit : String(row.org_unit_id)}
        contractors={contractors}
        partMasters={editableDraft ? partMasters : []}
        contractorId={editableDraft ? editContractorId : ""}
        onContractorId={editableDraft ? setEditContractorId : () => {}}
        lines={editableDraft ? draftLines : []}
        onLinesChange={editableDraft ? setDraftLines : () => {}}
        detailRows={editableDraft ? undefined : detailRows}
        contractorSummaryLabel={!editableDraft ? workOrderContractorLabel : undefined}
        pricingWorkDate={editableDraft ? pricingDateForNewWorkOrder() : undefined}
      />

      {showCompletionEngine && allLinesFullyComplete ? (
        <Card>
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-end">
            <Button
              type="button"
              className="shrink-0 sm:min-w-[11rem]"
              disabled={completeBusy}
              onClick={() => void completeWorkOrder()}
            >
              {completeBusy ? "Working…" : "Complete work order"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <WorkOrderExecutionFooter
        busy={submitBusy || saveDraftBusy || completeBusy}
        showSave={editableDraft}
        showSubmit={showSubmitButton}
        tip={null}
        onSave={() => void saveDraft()}
        onSubmitApproval={() => void submit()}
      />

      {(row.status === "active" || row.status === "closed") &&
      (row.approved_value_total != null ||
        row.invoiced_ex_tax_total != null ||
        linkedInvoices.length > 0) ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Billing & invoices</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {row.approved_value_total != null ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-md border bg-muted/30 px-3 py-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Approved work order value (ex. tax)
                  </div>
                  <div className="mt-1 font-medium tabular-nums">{fmtMoney(parseNum(row.approved_value_total))}</div>
                  {/* <p className="mt-1 text-xs text-muted-foreground">Set when the work order was approved; not editable here.</p> */}
                </div>
                <div className="rounded-md border px-3 py-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Passed validation (ex. tax)
                  </div>
                  <div className="mt-1 font-medium tabular-nums text-emerald-700 dark:text-emerald-300">
                    {fmtMoney(parseNum(row.invoiced_ex_tax_total ?? 0))}
                  </div>
                </div>
                <div className="rounded-md border px-3 py-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Remaining (ex. tax)</div>
                  <div className="mt-1 font-medium tabular-nums">
                    {fmtMoney(parseNum(row.remaining_invoiceable_value ?? 0))}
                  </div>
                </div>
              </div>
            ) : null}
            <div>
              {/* <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Invoices linked to this work order
              </div> */}
              {linkedInvoices.length === 0 ? (
                <p className="text-muted-foreground">
                  No invoices yet. Create one from Invoices → New and select lines from this work order.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Invoice #</th>
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium text-right">Total</th>
                        <th className="px-3 py-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {linkedInvoices.map((inv) => (
                        <tr key={inv.id} className="border-b last:border-0">
                          <td className="px-3 py-2 font-mono text-xs">{inv.invoice_number}</td>
                          <td className="px-3 py-2 tabular-nums">{inv.invoice_date}</td>
                          <td className="px-3 py-2">
                            {(() => {
                              const d = invoiceDisplayStatus(inv)
                              return (
                                <Badge variant={invoiceDisplayStatusBadgeVariant(d)}>
                                  {invoiceDisplayStatusLabel(d)}
                                </Badge>
                              )
                            })()}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(parseNum(inv.total_amount))}</td>
                          <td className="px-3 py-2 text-right">
                            {canViewInvoices ? (
                              <Button asChild variant="ghost" size="sm" className="h-7">
                                <Link to={`/dashboard/invoices/${inv.id}`}>Open</Link>
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Audit Log</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {audit.length === 0 ? (
            <div className="text-sm text-muted-foreground">No audit entries yet.</div>
          ) : (
            <div className="space-y-2">
              {audit
                .slice()
                .reverse()
                .slice(0, 30)
                .map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {workOrderAuditActionLabel(a)}
                      </div>
                      <div className="text-sm">
                        {a.actor_name ?? (a.changed_by != null ? `User #${a.changed_by}` : "—")}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {a.created_at ? new Date(a.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—"}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default WorkOrderDetailPage
