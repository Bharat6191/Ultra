import * as React from "react"
import { Link } from "react-router-dom"
import { ExternalLink, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  executionDetailRateCell,
  executionDetailTaxableCell,
  ExecutionSheetContractorBanner,
  formatExecutionQtyDisplay,
  formatExecutionWeightAmount,
  formatWorkOrderDateTime,
  type OrgUnitLite,
} from "@/components/work-orders/work-order-execution-ui"
import { ApiError, getJson } from "@/lib/api"
import { workOrderStatusBadgeVariant } from "@/lib/work-order-status-badge"
import { canListOrgUnitsForAssignments, hasPermission, isSuperuser } from "@/lib/permissions"
import type { PartWorkOrderRow } from "@/components/parts/analytics/types"

type WoItem = {
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
  pricing_snapshot?: { calculation_breakdown?: Record<string, unknown> } | null
  completion?: {
    completed_percentage?: number | null
    completed_quantity?: number | null
    unit_type?: string | null
  } | null
}

type WorkOrderPreview = {
  id: number
  work_order_number: string
  org_unit_id: number
  contractor_id: number
  contractor_name?: string | null
  title: string
  description: string | null
  created_at?: string | null
  approved_at?: string | null
  status: string
  items?: WoItem[]
}

type PreviewLine = {
  sr: number
  part_master_id: number
  part: string
  qty: string
  weight: string
  unit: string
  rate: React.ReactNode
  taxable: React.ReactNode
  completion: string | null
}

function canOpenWorkOrderDetail(): boolean {
  return (
    isSuperuser() ||
    hasPermission("work_orders.view") ||
    hasPermission("work_orders.create") ||
    hasPermission("work_orders.update") ||
    hasPermission("work_orders.approve")
  )
}

function parseNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return NaN
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""))
  return n
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function buildPreviewLines(wo: WorkOrderPreview): PreviewLine[] {
  if (!wo.items?.length) return []
  const showCompletion = wo.status === "active" || wo.status === "closed"
  let sr = 0
  const out: PreviewLine[] = []

  for (const it of wo.items) {
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
      it.pricing_snapshot?.calculation_breakdown && typeof it.pricing_snapshot.calculation_breakdown === "object"
        ? it.pricing_snapshot.calculation_breakdown
        : null
    let taxableDisplay: React.ReactNode = "—"
    if (Number.isFinite(tv)) {
      taxableDisplay = executionDetailTaxableCell({
        money: fmtMoney(tv),
        rateSource: String(it.rate_source ?? ""),
        pricingMethod: it.pricing_method,
        rateUnitType: it.rate_unit_type,
        calculationBreakdown: bdBreakdown,
      })
    }

    const bdObj = bdBreakdown
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

    const cp = it.completion?.completed_percentage
    const completion =
      showCompletion && cp != null && Number.isFinite(Number(cp)) ? `${Number(cp).toFixed(1)}%` : showCompletion ? "—" : null

    out.push({
      sr,
      part_master_id: it.part_master_id,
      part: it.part_code?.trim() || "—",
      qty: qtyDisplay,
      weight: weightDisplay,
      unit: it.unit_type?.trim() || "—",
      rate: rateDisplay,
      taxable: taxableDisplay,
      completion,
    })
  }
  return out
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="break-words text-sm font-medium leading-snug text-foreground">{value || "—"}</div>
    </div>
  )
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, highlights the matching part row (part analytics). Omit for contractor dashboard. */
  partMasterId?: number
  summaryRow: PartWorkOrderRow | null
}

export function PartWorkOrderPreviewDialog({ open, onOpenChange, partMasterId, summaryRow }: Props) {
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [detail, setDetail] = React.useState<WorkOrderPreview | null>(null)
  const [plants, setPlants] = React.useState<OrgUnitLite[]>([])

  const canViewFull = canOpenWorkOrderDetail()

  React.useEffect(() => {
    if (!open || !summaryRow) {
      setDetail(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    const woId = summaryRow.work_order_id
    void Promise.all([
      getJson<WorkOrderPreview>(`/work-orders/${woId}`),
      canListOrgUnitsForAssignments()
        ? getJson<OrgUnitLite[]>("/admin/org-units?type=PLANT").catch(() => [])
        : Promise.resolve([]),
    ])
      .then(([wo, plist]) => {
        if (cancelled) return
        setDetail(wo)
        setPlants(plist)
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to load work order")
          setDetail(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, summaryRow?.work_order_id])

  const contractorLabel =
    detail?.contractor_name?.trim() ||
    summaryRow?.contractor_name ||
    (detail?.contractor_id != null ? `Contractor #${detail.contractor_id}` : "—")

  const plantLabel = React.useMemo(() => {
    const oid = detail?.org_unit_id
    if (oid == null) return "—"
    const hit = plants.find((p) => p.id === oid)
    return hit?.name ?? `#${oid}`
  }, [plants, detail?.org_unit_id])

  const previewLines = React.useMemo(() => (detail ? buildPreviewLines(detail) : []), [detail])
  const showCompletionCol = previewLines.some((l) => l.completion !== null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92vh,900px)] w-[calc(100%-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="shrink-0 space-y-0 border-b px-6 py-4 pr-12">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {detail?.work_order_number ?? summaryRow?.work_order_number ?? "Work order"}
          </p>
          <DialogTitle className="text-lg font-semibold tracking-tight">Work order</DialogTitle>
          {detail ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={workOrderStatusBadgeVariant(detail.status)}>{detail.status}</Badge>
              <span className="text-sm text-muted-foreground tabular-nums">
                Created: {formatWorkOrderDateTime(detail.created_at)}
              </span>
              {detail.approved_at ? (
                <span className="text-sm text-muted-foreground tabular-nums">
                  Approved: {formatWorkOrderDateTime(detail.approved_at)}
                </span>
              ) : null}
            </div>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin" aria-hidden />
              Loading work order…
            </div>
          ) : error ? (
            <p className="py-8 text-sm text-destructive">{error}</p>
          ) : detail ? (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <ReadOnlyField label="Title" value={detail.title} />
                <ReadOnlyField label="Reference (optional)" value={detail.description?.trim() || "—"} />
                <ReadOnlyField label="Plant" value={plantLabel} />
                <ReadOnlyField label="Created" value={formatWorkOrderDateTime(detail.created_at)} />
                <ReadOnlyField label="Approved" value={formatWorkOrderDateTime(detail.approved_at)} />
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Execution sheet</CardTitle>
                  <ExecutionSheetContractorBanner name={contractorLabel} />
                </CardHeader>
                <CardContent className="px-0 pb-4 sm:px-6">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table className="min-w-[640px]">
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="h-9 w-10 text-xs">SR</TableHead>
                          <TableHead className="h-9 min-w-[7rem] text-xs">Part</TableHead>
                          <TableHead className="h-9 w-16 text-right text-xs">Qty</TableHead>
                          <TableHead className="h-9 w-16 text-right text-xs">Wt</TableHead>
                          <TableHead className="h-9 w-14 text-right text-xs">Unit</TableHead>
                          <TableHead className="h-9 min-w-[6.5rem] text-right text-xs">Rate</TableHead>
                          <TableHead className="h-9 min-w-[8rem] text-right text-xs">Taxable</TableHead>
                          {showCompletionCol ? (
                            <TableHead className="h-9 w-20 text-right text-xs">Completion</TableHead>
                          ) : null}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewLines.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={showCompletionCol ? 8 : 7}
                              className="py-8 text-center text-sm text-muted-foreground"
                            >
                              No execution lines on this work order.
                            </TableCell>
                          </TableRow>
                        ) : (
                          previewLines.map((line) => (
                            <TableRow
                              key={line.sr}
                              className={
                                partMasterId != null && line.part_master_id === partMasterId ? "bg-primary/5" : undefined
                              }
                            >
                              <TableCell className="py-2.5 text-xs tabular-nums text-muted-foreground">{line.sr}</TableCell>
                              <TableCell className="py-2.5 font-mono text-xs font-semibold">{line.part}</TableCell>
                              <TableCell className="py-2.5 text-right text-xs font-medium tabular-nums">{line.qty}</TableCell>
                              <TableCell className="py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                                {line.weight}
                              </TableCell>
                              <TableCell className="py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                                {line.unit}
                              </TableCell>
                              <TableCell className="py-2.5 align-top text-right text-xs">{line.rate}</TableCell>
                              <TableCell className="py-2.5 align-top text-right text-xs">{line.taxable}</TableCell>
                              {showCompletionCol ? (
                                <TableCell className="py-2.5 text-right text-xs font-medium tabular-nums">
                                  {line.completion ?? "—"}
                                </TableCell>
                              ) : null}
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

            </div>
          ) : null}
        </div>

        {canViewFull && summaryRow ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t bg-muted/20 px-6 py-4">
            <Button type="button" size="sm" asChild>
              <Link to={`/dashboard/work-orders/${summaryRow.work_order_id}`}>
                Open full work order
                <ExternalLink className="ml-1.5 size-3.5 shrink-0" aria-hidden />
              </Link>
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
