import * as React from "react"
import { ChevronLeft, ChevronRight, ListFilter, RefreshCw } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatMoney, rateStatusLabel } from "@/components/contractors/rateStatus"
import { ApiError, getJson } from "@/lib/api"
import { workOrderStatusBadgeVariant } from "@/lib/work-order-status-badge"
import { PartIntelligenceCharts } from "@/components/parts/analytics/PartIntelligenceCharts"
import { PartWorkOrderPreviewDialog } from "@/components/parts/analytics/PartWorkOrderPreviewDialog"
import type {
  PartAnalyticsFilters,
  PartContractorComparisonRow,
  PartContractorsAnalytics,
  PartMasterAnalyticsSummary,
  PartWorkOrderAnalytics,
  PartWorkOrderRow,
} from "@/components/parts/analytics/types"

const WO_PAGE_SIZE = 10

function q(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v) p.set(k, v)
  })
  const s = p.toString()
  return s ? `?${s}` : ""
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function fmtPct(v: number | null): string {
  if (v === null) return "—"
  return `${v.toFixed(1)}%`
}

function fmtWeightUnit(v: string | number | null | undefined): string {
  const n = num(v)
  return n === null ? "—" : n.toFixed(3)
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso))
  } catch {
    return iso
  }
}

function workOrderStatusLabel(status: string): string {
  switch (String(status || "").toLowerCase()) {
    case "closed":
      return "Completed"
    case "pending_approval":
      return "In Approval"
    case "draft":
      return "Draft"
    case "rejected":
      return "Returned"
    default:
      return status.replace(/_/g, " ")
  }
}

function computeHighlights(rows: PartContractorComparisonRow[], header: PartMasterAnalyticsSummary["header"]) {
  const approved = rows.filter((r) => String(r.status).toLowerCase() === "approved")
  const negRates = approved.map((r) => num(r.final_negotiated_rate)).filter((n): n is number => n !== null)
  const quotes = rows.map((r) => num(r.initial_rate)).filter((n): n is number => n !== null)
  const savings = approved
    .map((r) => {
      const base = num(r.base_rate)
      const neg = num(r.final_negotiated_rate)
      if (base === null || neg === null || neg >= base) return null
      return base - neg
    })
    .filter((n): n is number => n !== null)

  const average =
    num(header.average_negotiated_rate) ?? (negRates.length ? negRates.reduce((a, b) => a + b, 0) / negRates.length : null)
  const highestQuote = quotes.length ? Math.max(...quotes) : null
  const highestSavings = savings.length ? Math.max(...savings) : null

  return { average, highestQuote, highestSavings }
}

function HighlightCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-950">{label}</div>
      <div className="mt-0.5 text-base font-normal tabular-nums text-zinc-950">{value}</div>
    </div>
  )
}

export function PartAnalyticsDashboard({ partMasterId }: { partMasterId: number }) {
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")
  const [plantId, setPlantId] = React.useState("")
  const [contractorId, setContractorId] = React.useState("")
  const woStatus = ""
  const negStatus = ""
  const [filtersOpen, setFiltersOpen] = React.useState(false)

  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [summary, setSummary] = React.useState<PartMasterAnalyticsSummary | null>(null)
  const [ctr, setCtr] = React.useState<PartContractorsAnalytics | null>(null)
  const [wo, setWo] = React.useState<PartWorkOrderAnalytics | null>(null)
  const [woPage, setWoPage] = React.useState(0)
  const [previewWo, setPreviewWo] = React.useState<PartWorkOrderRow | null>(null)
  const [previewOpen, setPreviewOpen] = React.useState(false)

  const summaryLabelClass = "text-sm font-bold text-zinc-950"
  const summaryValueClass = "text-xs font-normal text-zinc-950"
  const summaryValueMonoClass = "font-mono text-xs font-normal text-zinc-950"
  const summaryMetricValueClass = "text-xs font-normal tabular-nums text-zinc-950"

  const filterParams = React.useMemo<PartAnalyticsFilters>(
    () => ({
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      plant_id: plantId || undefined,
      contractor_id: contractorId || undefined,
      work_order_status: woStatus || undefined,
      negotiation_status: negStatus || undefined,
    }),
    [dateFrom, dateTo, plantId, contractorId, woStatus, negStatus],
  )

  const activeFilterCount = React.useMemo(() => {
    let n = 0
    if (dateFrom) n++
    if (dateTo) n++
    if (plantId) n++
    if (contractorId) n++
    if (woStatus) n++
    if (negStatus) n++
    return n
  }, [dateFrom, dateTo, plantId, contractorId, woStatus, negStatus])

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const base = q(filterParams as Record<string, string | undefined>)
    const root = `/part-master/${partMasterId}/analytics`
    try {
      const [s, c, w] = await Promise.all([
        getJson<PartMasterAnalyticsSummary>(`${root}/summary${base}`),
        getJson<PartContractorsAnalytics>(`${root}/contractors${base}`),
        getJson<PartWorkOrderAnalytics>(`${root}/work-orders${base}`),
      ])
      setSummary(s)
      setCtr(c)
      setWo(w)
      setWoPage(0)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to load analytics")
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [partMasterId, filterParams])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    setWoPage(0)
  }, [partMasterId, filterParams])

  React.useEffect(() => {
    const count = wo?.rows?.length ?? 0
    const maxPage = Math.max(0, Math.ceil(count / WO_PAGE_SIZE) - 1)
    if (woPage > maxPage) setWoPage(maxPage)
  }, [wo?.rows?.length, woPage])

  if (loading && !summary) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">Loading part intelligence…</CardContent>
      </Card>
    )
  }

  if (error && !summary) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Analytics unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (!summary || !ctr || !wo) {
    return null
  }

  const h = summary.header
  const highlights = computeHighlights(ctr.rows, h)
  const contractorRows = [...ctr.rows].sort((a, b) => {
    const na = num(a.final_negotiated_rate)
    const nb = num(b.final_negotiated_rate)
    if (na === null && nb === null) return a.contractor_name.localeCompare(b.contractor_name)
    if (na === null) return 1
    if (nb === null) return -1
    return na - nb
  })
  const woRows = wo.rows ?? []
  const woPageCount = Math.max(1, Math.ceil(woRows.length / WO_PAGE_SIZE))
  const woPageSafe = Math.min(woPage, woPageCount - 1)
  const paginatedWoRows = woRows.slice(woPageSafe * WO_PAGE_SIZE, woPageSafe * WO_PAGE_SIZE + WO_PAGE_SIZE)
  const woRangeStart = woRows.length === 0 ? 0 : woPageSafe * WO_PAGE_SIZE + 1
  const woRangeEnd = Math.min((woPageSafe + 1) * WO_PAGE_SIZE, woRows.length)

  function openWoPreview(row: PartWorkOrderRow) {
    setPreviewWo(row)
    setPreviewOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Part Details</h3>
          {/* <p className="text-xs text-muted-foreground">Commercial rates, negotiations, and work orders for procurement decisions.</p> */}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            <ListFilter className="mr-1.5 size-3.5" aria-hidden />
            {filtersOpen ? "Hide" : "Filters"}
            {!filtersOpen && activeFilterCount > 0 ? ` (${activeFilterCount})` : null}
          </Button>
        </div>
      </div>

      {filtersOpen ? (
        <Card className="border-dashed">
          <CardContent className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1">
              <Label htmlFor="pa-from" className="text-xs">
                From
              </Label>
              <Input id="pa-from" type="date" className="h-8" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="pa-to" className="text-xs">
                To
              </Label>
              <Input id="pa-to" type="date" className="h-8" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Plant</Label>
              <select
                className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
                value={plantId}
                onChange={(e) => setPlantId(e.target.value)}
              >
                <option value="">All plants</option>
                {h.plant_filter_options.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="pa-cid" className="text-xs">
                Contractor id
              </Label>
              <Input
                id="pa-cid"
                className="h-8"
                inputMode="numeric"
                placeholder="Optional"
                value={contractorId}
                onChange={(e) => setContractorId(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
              <Button type="button" size="sm" className="h-8" onClick={() => void load()}>
                Apply filters
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`mr-1.5 size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <Alert variant="destructive" className="py-2">
          <AlertDescription className="text-sm">{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Part Summary</CardTitle>
          {/* <CardDescription>Master data snapshot and cross-module footprint.</CardDescription> */}
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className={summaryLabelClass}>Part Number</div>
            <div className={summaryValueMonoClass}>{h.part_code}</div>
          </div>
          <div>
            <div className={summaryLabelClass}>Name</div>
            <div className={summaryValueClass}>{h.part_name}</div>
          </div>
          <div className="sm:col-span-2">
            <div className={summaryLabelClass}>Description</div>
            <div className={summaryValueClass}>{h.description?.trim() || "—"}</div>
          </div>
          <div>
            <div className={summaryLabelClass}>Pricing Method</div>
            <div className={summaryValueClass}>{h.part_category.replace(/_/g, " ")}</div>
          </div>
          <div>
            <div className={summaryLabelClass}>Part Type (UOM)</div>
            <div className={summaryValueClass}>{h.part_type.replace(/_/g, " ")}</div>
          </div>
          <div>
            <div className={summaryLabelClass}> UOM</div>
            <div className={summaryValueClass}>{h.unit_of_measurement}</div>
          </div>
          <div>
            <div className={summaryLabelClass}>Weight / Unit</div>
            <div className={summaryMetricValueClass}>{fmtWeightUnit(h.weight_per_unit)}</div>
          </div>
          <div>
            <div className={summaryLabelClass}>Should Cost</div>
            <div className={summaryMetricValueClass}>{formatMoney(h.base_rate)}</div>
          </div>
          <div>
            <div className={summaryLabelClass}>Status</div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={h.is_active ? "default" : "secondary"}>{h.is_active ? "Active" : "Inactive"}</Badge>
              {/* <Badge variant="outline">{h.record_status}</Badge> */}
            </div>
          </div>
          <div>
            <div className={summaryLabelClass}>Plant</div>
            <div className={summaryValueClass}>{h.home_plant_name ?? "—"}</div>
          </div>
          <div>
            <div className={summaryLabelClass}>Active Work Orders</div>
            <div className={summaryMetricValueClass}>{h.total_active_work_orders}</div>
          </div>
          <div className="sm:col-span-2">
            <div className={summaryLabelClass}>Plants</div>
            <div className={summaryValueClass}>{h.plant_names_used.length ? h.plant_names_used.join(", ") : "—"}</div>
          </div>
          <div>
            <div className={summaryLabelClass}>Contractors (Rates+WO)</div>
            <div className={summaryMetricValueClass}>{h.total_contractors_touching}</div>
          </div>
          <div>
            <div className={summaryLabelClass}>Negotiation Records</div>
            <div className={summaryMetricValueClass}>{h.total_negotiation_records}</div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <HighlightCard label="Savings" value={highlights.highestSavings != null ? formatMoney(highlights.highestSavings) : "—"} />
        <HighlightCard label="Quoted Rate" value={highlights.highestQuote != null ? formatMoney(highlights.highestQuote) : "—"} />
        <HighlightCard label="Negotiated Rate" value={highlights.average != null ? formatMoney(highlights.average) : "—"} />
      </div>

      <PartIntelligenceCharts contractors={ctr} workOrders={wo} />

      <Card>
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm font-semibold"> Contractor Negotiation</CardTitle>
          {/* <CardDescription className="text-xs">Rates and negotiation outcomes by contractor for this part.</CardDescription> */}
        </CardHeader>
        <CardContent className="px-0 pb-3">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-8 text-xs">Contractor</TableHead>
                  <TableHead className="h-8 text-right text-xs">Should Cost</TableHead>
                  <TableHead className="h-8 text-right text-xs"> quote</TableHead>
                  <TableHead className="h-8 text-right text-xs">negotiated</TableHead>
                  <TableHead className="h-8 text-right text-xs">Cost Variance </TableHead>
                  <TableHead className="h-8 text-right text-xs">Savings %</TableHead>
                  <TableHead className="h-8 text-xs"> status</TableHead>
                  <TableHead className="h-8 text-xs">Approved by</TableHead>
                  <TableHead className="h-8 text-xs">Last negotiation</TableHead>
                  <TableHead className="h-8 text-right text-xs">Active WO</TableHead>
                  <TableHead className="h-8 text-right text-xs">Total WO value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contractorRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="py-6 text-center text-sm text-muted-foreground">
                      No contractor rates for this part yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  contractorRows.map((r) => {
                    const base = num(r.base_rate) ?? 0
                    const neg = num(r.final_negotiated_rate)
                    const diff = neg !== null ? neg - base : null
                    return (
                      <TableRow key={r.contractor_rate_id} className="text-sm">
                        <TableCell className="py-2">
                          <div className="font-medium">{r.contractor_name}</div>
                          {r.contractor_code ? (
                            <div className="text-[10px] text-muted-foreground">{r.contractor_code}</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="py-2 text-right tabular-nums">{formatMoney(r.base_rate)}</TableCell>
                        <TableCell className="py-2 text-right tabular-nums">
                          {r.initial_rate != null ? formatMoney(r.initial_rate) : "—"}
                        </TableCell>
                        <TableCell className="py-2 text-right tabular-nums font-medium">
                          {formatMoney(r.final_negotiated_rate)}
                        </TableCell>
                        <TableCell
                          className={
                            "py-2 text-right tabular-nums " +
                            (diff !== null && diff < 0
                              ? "text-emerald-700"
                              : diff !== null && diff > 0
                                ? "text-amber-800"
                                : "")
                          }
                        >
                          {diff !== null ? formatMoney(diff) : "—"}
                        </TableCell>
                        <TableCell className="py-2 text-right tabular-nums">
                          {r.savings_pct != null ? fmtPct(num(r.savings_pct)) : "—"}
                        </TableCell>
                        <TableCell className="py-2">
                          <Badge variant="secondary" className="text-[10px] font-normal">
                            {rateStatusLabel(r.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2 text-xs">{r.approved_by_name ?? "—"}</TableCell>
                        <TableCell className="py-2 text-xs text-muted-foreground">
                          {r.last_negotiation_at ? new Date(r.last_negotiation_at).toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell className="py-2 text-right tabular-nums">{r.active_work_orders}</TableCell>
                        <TableCell className="py-2 text-right tabular-nums">{formatMoney(r.total_work_order_value)}</TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm font-semibold">Work Orders</CardTitle>
          {/* <CardDescription className="text-xs">
            Orders including this part — {formatMoney(wo.total_wo_value)} total value, {formatMoney(wo.total_invoiced_for_part)}{" "}
            invoiced, {formatMoney(wo.pending_invoice_amount_for_part)} pending.
          </CardDescription> */}
        </CardHeader>
        <CardContent className="px-0 pb-3">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-8 text-xs">WO number</TableHead>
                  <TableHead className="h-8 text-xs">Contractor</TableHead>
                  <TableHead className="h-8 text-right text-xs">Qty</TableHead>
                  <TableHead className="h-8 text-right text-xs">WO value</TableHead>
                  <TableHead className="h-8 text-right text-xs">Invoiced</TableHead>
                  <TableHead className="h-8 text-right text-xs">Pending</TableHead>
                  <TableHead className="h-8 text-xs">Status</TableHead>
                  <TableHead className="h-8 text-right text-xs">Completion %</TableHead>
                  <TableHead className="h-8 text-xs">Start</TableHead>
                  <TableHead className="h-8 text-xs">End</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {woRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-6 text-center text-sm text-muted-foreground">
                      No work orders for this part.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedWoRows.map((r) => (
                    <TableRow key={r.work_order_id} className="text-sm">
                      <TableCell className="py-2">
                        <button
                          type="button"
                          className="font-mono text-xs font-medium text-primary hover:underline"
                          onClick={() => openWoPreview(r)}
                        >
                          {r.work_order_number}
                        </button>
                      </TableCell>
                      <TableCell className="py-2">{r.contractor_name}</TableCell>
                      <TableCell className="py-2 text-right tabular-nums">{String(r.quantity)}</TableCell>
                      <TableCell className="py-2 text-right tabular-nums">{formatMoney(r.wo_value)}</TableCell>
                      <TableCell className="py-2 text-right tabular-nums">{formatMoney(r.invoiced_value)}</TableCell>
                      <TableCell className="py-2 text-right tabular-nums">{formatMoney(r.pending_value)}</TableCell>
                      <TableCell className="py-2">
                        <Badge variant={workOrderStatusBadgeVariant(r.status)} className="text-[10px] font-normal">
                          {workOrderStatusLabel(r.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 text-right tabular-nums">{fmtPct(num(r.completion_pct))}</TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">{fmtDate(r.start_date)}</TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">{fmtDate(r.end_date)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {woRows.length > WO_PAGE_SIZE ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2">
              <p className="text-xs text-muted-foreground">
                Showing {woRangeStart}–{woRangeEnd} of {woRows.length}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  disabled={woPageSafe <= 0}
                  onClick={() => setWoPage((p) => Math.max(0, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="min-w-[4.5rem] text-center text-xs tabular-nums text-muted-foreground">
                  {woPageSafe + 1} / {woPageCount}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  disabled={woPageSafe >= woPageCount - 1}
                  onClick={() => setWoPage((p) => Math.min(woPageCount - 1, p + 1))}
                  aria-label="Next page"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <PartWorkOrderPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        partMasterId={partMasterId}
        summaryRow={previewWo}
      />
    </div>
  )
}
