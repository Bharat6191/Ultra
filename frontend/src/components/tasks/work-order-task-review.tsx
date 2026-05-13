import * as React from "react"

import type { ContractorLite, ExecutionDetailRow, OrgUnitLite } from "@/components/work-orders/work-order-execution-ui"
import {
  WorkOrderExecutionHeader,
  WorkOrderExecutionTable,
} from "@/components/work-orders/work-order-execution-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError, getJson } from "@/lib/api"
import { workOrderStatusBadgeVariant } from "@/lib/work-order-status-badge"
import { canListOrgUnitsForAssignments, hasPermission, isSuperuser } from "@/lib/permissions"
import { cn } from "@/lib/utils"

type WorkOrderPublic = {
  id: number
  work_order_number: string
  org_unit_id: number
  contractor_id: number
  title: string
  description: string | null
  work_date: string
  status: string
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
    taxable_value?: string | number | null
    resolved_rate: string | number
    rate_source: string
    notes?: string | null
  }[]
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

function buildDetailRows(row: WorkOrderPublic, contractorName: (id: number) => string): ExecutionDetailRow[] {
  if (!row.items?.length) return []
  let sr = 0
  const out: ExecutionDetailRow[] = []
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

    const lineLabel =
      it.part_code || it.part_name ? `${it.part_code ?? "—"} · ${it.part_name ?? "—"}` : "—"

    out.push({
      sr,
      contractor_label: contractorName(row.contractor_id),
      job_label: lineLabel,
      qty_display: qtyDisplay,
      unit_display: it.unit_type ?? "—",
      rate_display: rateDisplay,
      invoice_display: invoiceDisplay,
      remarks_display: it.notes?.trim() ? it.notes : "—",
    })
  }
  return out
}

type PayloadLine = Record<string, unknown>

function FallbackExecutionTable({ payload }: { payload: Record<string, unknown> }) {
  const raw = payload.execution_lines
  const lines = Array.isArray(raw) ? (raw as PayloadLine[]) : []
  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">No execution lines in the approval snapshot.</p>
  }

  const th = "whitespace-normal px-2 py-2 text-left align-bottom text-[11px] font-medium uppercase tracking-wide text-muted-foreground"

  return (
    <div className="overflow-x-auto rounded-lg border border-border/80">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className={th}>#</th>
            <th className={th}>Contractor</th>
            <th className={th}>Item / job</th>
            <th className={th}>Qty / %</th>
            <th className={th}>Unit</th>
            <th className={cn(th, "text-right tabular-nums")}>Resolved rate</th>
            <th className={cn(th, "text-right tabular-nums")}>Master rate</th>
            <th className={th}>Source</th>
            <th className={th}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((ln, idx) => {
            const contractor =
              typeof ln.contractor_name === "string" && ln.contractor_name.trim() !== ""
                ? ln.contractor_name
                : ln.contractor_id != null
                  ? `#${String(ln.contractor_id)}`
                  : "—"
            const job =
              typeof ln.part_code === "string" || typeof ln.part_name === "string"
                ? `${String(ln.part_code ?? "—")} · ${String(ln.part_name ?? "—")}`
                : typeof ln.job_type === "string" && typeof ln.skill_type === "string"
                  ? `${ln.job_type} · ${String(ln.skill_type).replace(/_/g, " ")}`
                  : "—"
            const prog = typeof ln.progress_type === "string" ? ln.progress_type : ""
            const qty =
              prog === "percentage"
                ? ln.planned_percentage != null && String(ln.planned_percentage) !== ""
                  ? `${String(ln.planned_percentage)}%`
                  : "—"
                : ln.planned_quantity != null && String(ln.planned_quantity) !== ""
                  ? String(ln.planned_quantity)
                  : "—"
            const unit =
              typeof ln.unit_type === "string"
                ? ln.unit_type
                : typeof ln.unit === "string"
                  ? ln.unit
                  : "—"
            const rr = ln.resolved_rate != null ? String(ln.resolved_rate) : "—"
            const mr = ln.master_rate != null ? String(ln.master_rate) : "—"
            const src = typeof ln.rate_source === "string" ? ln.rate_source : "—"
            const notes = typeof ln.notes === "string" && ln.notes.trim() !== "" ? ln.notes : "—"

            return (
              <tr key={idx} className="border-b border-border/60">
                <td className="px-2 py-2 tabular-nums text-muted-foreground">{idx + 1}</td>
                <td className="px-2 py-2">{contractor}</td>
                <td className="px-2 py-2">{job}</td>
                <td className="px-2 py-2 tabular-nums">{qty}</td>
                <td className="px-2 py-2">{unit}</td>
                <td className="px-2 py-2 text-right tabular-nums">{rr}</td>
                <td className="px-2 py-2 text-right tabular-nums">{mr}</td>
                <td className="px-2 py-2 text-xs">{src}</td>
                <td className="max-w-[180px] px-2 py-2 text-xs text-muted-foreground">{notes}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function WorkOrderApprovalReview(props: {
  workOrderId: number
  fallbackPayload: Record<string, unknown>
}) {
  const { workOrderId, fallbackPayload } = props
  const [row, setRow] = React.useState<WorkOrderPublic | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [fetchErr, setFetchErr] = React.useState<string | null>(null)

  const [plants, setPlants] = React.useState<OrgUnitLite[]>([])
  const [contractors, setContractors] = React.useState<ContractorLite[]>([])

  const canLoadPlantCatalog =
    canListOrgUnitsForAssignments() ||
    isSuperuser() ||
    hasPermission("work_orders.view") ||
    hasPermission("work_orders.approve") ||
    hasPermission("work_orders.create")

  React.useEffect(() => {
    void (async () => {
      try {
        const [plist, clist] = await Promise.all([
          canLoadPlantCatalog
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
  }, [canLoadPlantCatalog])

  React.useEffect(() => {
    if (!Number.isFinite(workOrderId) || workOrderId <= 0) {
      setLoading(false)
      setFetchErr("Invalid work order reference.")
      return
    }
    setLoading(true)
    setFetchErr(null)
    void (async () => {
      try {
        const r = await getJson<WorkOrderPublic>(`/work-orders/${workOrderId}`)
        setRow(r)
      } catch (e) {
        setRow(null)
        setFetchErr(e instanceof ApiError ? e.message : "Could not load work order.")
      } finally {
        setLoading(false)
      }
    })()
  }, [workOrderId])

  const contractorName = React.useCallback(
    (id: number) => contractors.find((c) => c.id === id)?.name ?? `Contractor #${id}`,
    [contractors],
  )

  const plantLabel = React.useMemo(() => {
    if (row?.org_unit_id == null) return "—"
    const hit = plants.find((p) => p.id === row.org_unit_id)
    return hit?.name ?? "—"
  }, [plants, row?.org_unit_id])

  const snapshotPlantLabel = React.useMemo(() => {
    const rawName =
      typeof fallbackPayload.org_unit_name === "string" && fallbackPayload.org_unit_name.trim() !== ""
        ? fallbackPayload.org_unit_name.trim()
        : null
    if (rawName) return rawName
    const oid =
      fallbackPayload.org_unit_id != null && String(fallbackPayload.org_unit_id).trim() !== ""
        ? Number(fallbackPayload.org_unit_id)
        : NaN
    if (!Number.isFinite(oid)) return null
    const hit = plants.find((p) => p.id === oid)
    return hit?.name ?? null
  }, [plants, fallbackPayload])

  const detailRows = React.useMemo(() => {
    if (!row) return []
    return buildDetailRows(row, contractorName)
  }, [row, contractorName])

  const snapTitle =
    typeof fallbackPayload.title === "string" && fallbackPayload.title.trim() !== ""
      ? fallbackPayload.title
      : null
  const snapNumber =
    typeof fallbackPayload.work_order_number === "string" && fallbackPayload.work_order_number.trim() !== ""
      ? fallbackPayload.work_order_number
      : null
  const snapDate = typeof fallbackPayload.work_date === "string" ? fallbackPayload.work_date : null

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading work order…</p>
  }

  if (fetchErr || !row) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertTitle>Live work order unavailable</AlertTitle>
          <AlertDescription>{fetchErr ?? "Work order could not be loaded."}</AlertDescription>
        </Alert>
        <div className="rounded-lg border border-border/80 bg-muted/10 p-3 text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Approval snapshot</div>
          <dl className="mt-2 space-y-1">
            {snapNumber ? (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                <dt className="text-muted-foreground">WO #</dt>
                <dd className="font-medium tabular-nums">{snapNumber}</dd>
              </div>
            ) : null}
            {snapTitle ? (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                <dt className="text-muted-foreground">Title</dt>
                <dd>{snapTitle}</dd>
              </div>
            ) : null}
            {snapDate ? (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                <dt className="text-muted-foreground">Work date</dt>
                <dd className="tabular-nums">{snapDate}</dd>
              </div>
            ) : null}
            {snapshotPlantLabel ? (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                <dt className="text-muted-foreground">Plant</dt>
                <dd>{snapshotPlantLabel}</dd>
              </div>
            ) : null}
            {typeof fallbackPayload.description === "string" && fallbackPayload.description.trim() !== "" ? (
              <div className="pt-1">
                <dt className="text-muted-foreground">Reference</dt>
                <dd className="mt-0.5 whitespace-pre-wrap">{fallbackPayload.description}</dd>
              </div>
            ) : null}
          </dl>
        </div>
        <FallbackExecutionTable payload={fallbackPayload} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{row.work_order_number}</p>
        <h3 className="text-base font-semibold tracking-tight">{row.title}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Badge variant={workOrderStatusBadgeVariant(row.status)}>{row.status}</Badge>
          <span className="text-sm text-muted-foreground tabular-nums">Work date: {row.work_date ?? "—"}</span>
        </div>
      </div>

      <WorkOrderExecutionHeader
        loading={false}
        editable={false}
        title={row.title}
        reference={row.description ?? ""}
        org_unit_id={String(row.org_unit_id)}
        plants={plants}
        onTitle={() => {}}
        onReference={() => {}}
        onOrgUnit={() => {}}
        plantLabel={plantLabel}
        work_date={row.work_date}
      />

      <WorkOrderExecutionTable
        mode="view"
        loading={false}
        org_unit_id={String(row.org_unit_id)}
        contractors={contractors}
        partMasters={[]}
        contractorId=""
        onContractorId={() => {}}
        lines={[]}
        onLinesChange={() => {}}
        detailRows={detailRows}
      />
    </div>
  )
}

type OverridePayload = {
  work_order_id?: number
  work_order_number?: string | null
  work_order_title?: string | null
  org_unit_name?: string | null
  work_date?: string | null
  contractor_name?: string | null
  override_rate?: string | null
  override_reason?: string | null
  line?: {
    part_code?: string
    part_name?: string
    job_type?: string
    skill_type?: string
    unit_type?: string
    unit?: string
    progress_type?: string
    planned_quantity?: string | null
    planned_percentage?: string | null
    governed_resolved_rate?: string | null
    rate_source?: string | null
  }
}

export function WorkOrderRateOverrideApprovalReview(props: { payload: Record<string, unknown> }) {
  const p = props.payload as OverridePayload
  const line = p.line ?? {}
  const jobLabel =
    typeof line.part_code === "string" || typeof line.part_name === "string"
      ? `${String(line.part_code ?? "—")} · ${String(line.part_name ?? "—")}`
      : typeof line.job_type === "string" && typeof line.skill_type === "string"
        ? `${line.job_type} · ${String(line.skill_type).replace(/_/g, " ")}`
        : "—"
  const qty =
    line.progress_type === "percentage"
      ? line.planned_percentage != null && String(line.planned_percentage) !== ""
        ? `${String(line.planned_percentage)}%`
        : "—"
      : line.planned_quantity != null && String(line.planned_quantity) !== ""
        ? String(line.planned_quantity)
        : "—"

  return (
    <div className="space-y-4">
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {p.work_order_number ?? "Rate override"}
        </p>
        <h3 className="text-base font-semibold">{p.work_order_title ?? "Requested rate override"}</h3>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {p.org_unit_name ? <span>{p.org_unit_name}</span> : null}
          {p.work_date ? <span className="tabular-nums">Work date: {p.work_date}</span> : null}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[28%]">Field</TableHead>
            <TableHead>Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="align-top text-muted-foreground">Contractor</TableCell>
            <TableCell>{p.contractor_name ?? "—"}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="align-top text-muted-foreground">Line</TableCell>
            <TableCell>{jobLabel}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="align-top text-muted-foreground">Qty / coverage</TableCell>
            <TableCell className="tabular-nums">
              {qty}{" "}
              {typeof line.unit_type === "string"
                ? `· ${line.unit_type}`
                : typeof line.unit === "string"
                  ? `· ${line.unit}`
                  : ""}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="align-top text-muted-foreground">Governed unit rate</TableCell>
            <TableCell className="tabular-nums">
              {line.governed_resolved_rate ?? "—"}
              {line.rate_source ? (
                <span className="ml-2 text-xs text-muted-foreground">({line.rate_source})</span>
              ) : null}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="align-top font-medium text-foreground">Requested override rate</TableCell>
            <TableCell className="tabular-nums font-medium">{p.override_rate ?? "—"}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="align-top text-muted-foreground">Reason</TableCell>
            <TableCell className="whitespace-pre-wrap">{p.override_reason ?? "—"}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}
