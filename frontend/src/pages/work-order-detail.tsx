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
  flattenWorkOrderToDraftLines,
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
import { workOrderStatusBadgeVariant } from "@/lib/work-order-status-badge"
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
  title: string
  description: string | null
  work_date: string
  status: string
  updated_at?: string | null
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
    unit_type: it.unit_type ?? "",
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

export function WorkOrderDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const woId = Number(id)
  const [row, setRow] = React.useState<WorkOrder | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [audit, setAudit] = React.useState<AuditEntry[]>([])

  const [plants, setPlants] = React.useState<OrgUnitLite[]>([])
  const [contractors, setContractors] = React.useState<ContractorLite[]>([])

  const [submitBusy, setSubmitBusy] = React.useState(false)
  const [saveDraftBusy, setSaveDraftBusy] = React.useState(false)

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

  const contractorName = React.useCallback(
    (id: number) => contractors.find((c) => c.id === id)?.name ?? `Contractor #${id}`,
    [contractors],
  )

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
    row && canSubmit && (row.status === "draft" || row.status === "rejected"),
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
      const r = await getJson<WorkOrder>(`/work-orders/${woId}`)
      setRow(r)
      const logs = await getJson<AuditEntry[]>(`/work-orders/${woId}/audit-logs`).catch(() => [])
      setAudit(Array.isArray(logs) ? logs : [])
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
    if (!confirm("Archive this work order? It will be removed from the work orders list.")) return
    try {
      await deleteJson(`/work-orders/${row.id}`)
      toast.success("Work order archived")
      navigate("/dashboard/work-orders", { replace: true })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Archive failed")
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
            ? `${it.planned_percentage}%`
            : "—"
          : it.planned_quantity != null && String(it.planned_quantity) !== ""
            ? String(it.planned_quantity)
            : "—"

      const rateN = parseNum(it.resolved_rate)
      const pmHint =
        it.pricing_method && it.rate_unit_type ? `${it.pricing_method} / ${it.rate_unit_type}` : (it.pricing_method ?? it.rate_unit_type ?? "")
      const rateDisplay = pmHint ? `${fmtMoney(rateN)} (${it.rate_source}) · ${pmHint}` : `${fmtMoney(rateN)} (${it.rate_source})`

      const tv = parseNum(it.taxable_value)
      let invoiceDisplay = "—"
      if (Number.isFinite(tv)) invoiceDisplay = fmtMoney(tv)
      else if (it.progress_type === "quantity") {
        const q = parseNum(it.planned_quantity)
        if (Number.isFinite(q) && Number.isFinite(rateN)) invoiceDisplay = fmtMoney(q * rateN)
      }

      const completionItem: LineWithCompletion = {
        id: it.id,
        part_code: it.part_code ?? null,
        part_name: it.part_name ?? null,
        unit_type: it.completion?.unit_type ?? it.unit_type ?? "",
        progress_type: it.progress_type,
        planned_quantity: it.planned_quantity,
        planned_percentage: it.planned_percentage,
        completion: it.completion ?? fallbackLineCompletion(it),
      }

      const lineLabel =
        it.part_code || it.part_name
          ? `${it.part_code ?? "—"} · ${it.part_name ?? "—"}`
          : "—"

      const bd = it.pricing_snapshot?.calculation_breakdown
      const breakdownHint =
        bd && typeof bd === "object" && "formula" in bd
          ? ` (${String((bd as { formula?: string }).formula ?? "")})`
          : ""

      out.push({
        sr,
        contractor_label: contractorName(headCid),
        job_label: `${lineLabel}${breakdownHint}`.trim(),
        qty_display: qtyDisplay,
        unit_display: it.unit_type ?? "—",
        rate_display: rateDisplay,
        invoice_display: invoiceDisplay,
        remarks_display: it.notes?.trim() ? it.notes : "—",
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
    if (!editOrgUnit) return toast.error("Plant is required.")
    if (!editTitle.trim()) return toast.error("Title is required.")
    const built = buildWorkOrderLinesForApi(editContractorId, draftLines, partMasters)
    if (!built.ok) return toast.error(built.error)

    setSaveDraftBusy(true)
    try {
      await patchJson(`/work-orders/${row.id}`, {
        title: editTitle.trim(),
        description: editReference.trim() || null,
        work_date: row.work_date,
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

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>
  if (!row) {
    return (
      <Alert variant={error ? "destructive" : "default"}>
        <AlertTitle>Work order</AlertTitle>
        <AlertDescription>{error ?? "Not found"}</AlertDescription>
      </Alert>
    )
  }

  const showSubmitButton = canSubmit && (row.status === "draft" || row.status === "rejected")

  const showCompletionEngine = row.status === "active" && canManageCompletion && !editableDraft

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{row.work_order_number}</p>
          <h2 className="text-base font-medium">Work order</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant={workOrderStatusBadgeVariant(row.status)}>{row.status}</Badge>
            <span className="text-sm text-muted-foreground tabular-nums">Work date: {row.work_date ?? "—"}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/dashboard/work-orders">Back</Link>
          </Button>
          {canDelete ? (
            <Button size="sm" variant="outline" onClick={() => void archive()}>
              Archive
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
      />

      <WorkOrderExecutionFooter
        busy={submitBusy || saveDraftBusy}
        showSave={editableDraft}
        showSubmit={showSubmitButton}
        tip={
          editableDraft
            ? "Tip: choose the contractor once, then edit part lines. Saved taxable values use negotiated rates when approved."
            : showCompletionEngine
              ? "Active work order: update completion per line — invoice lines cannot exceed the latest saved completion."
              : "Rates shown are governed (negotiated where applicable)."
        }
        onCancel={() => navigate("/dashboard/work-orders")}
        onSave={() => void saveDraft()}
        onSubmitApproval={() => void submit()}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Audit trail</CardTitle>
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
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{a.action}</div>
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
