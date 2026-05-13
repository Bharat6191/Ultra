import * as React from "react"
import { Link } from "react-router-dom"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ListFilter, RefreshCw } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatMoney, rateStatusLabel } from "@/components/contractors/rateStatus"
import { ApiError, getJson } from "@/lib/api"
import { PartReportExport } from "@/components/parts/analytics/PartReportExport"
import type {
  PartAnalyticsFilters,
  PartCommercialInsights,
  PartCompetitionAnalytics,
  PartContractorsAnalytics,
  PartMasterAnalyticsSummary,
  PartNegotiationBundle,
  PartWorkOrderAnalytics,
  PendingActions,
  AnalyticsTimelineEvent,
} from "@/components/parts/analytics/types"

const CHART_COLORS = ["#059669", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#64748b"]

function q(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v) p.set(k, v)
  })
  const s = p.toString()
  return s ? `?${s}` : ""
}

function kpiToneClass(tone: string): string {
  if (tone === "success") return "border-emerald-200 bg-emerald-50/80"
  if (tone === "warning") return "border-amber-200 bg-amber-50/80"
  if (tone === "danger") return "border-rose-200 bg-rose-50/80"
  return "border-border/60 bg-card"
}

function heatClass(pct: number): string {
  if (pct <= 0) return "bg-emerald-50/90 text-emerald-950"
  if (pct <= 8) return "bg-amber-50/80 text-amber-950"
  return "bg-rose-50/80 text-rose-950"
}

export function PartAnalyticsDashboard({ partMasterId }: { partMasterId: number }) {
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")
  const [plantId, setPlantId] = React.useState("")
  const [contractorId, setContractorId] = React.useState("")
  const [woStatus, setWoStatus] = React.useState("")
  const [negStatus, setNegStatus] = React.useState("")
  const [tlCats, setTlCats] = React.useState("all")
  const [filtersOpen, setFiltersOpen] = React.useState(false)

  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [summary, setSummary] = React.useState<PartMasterAnalyticsSummary | null>(null)
  const [ctr, setCtr] = React.useState<PartContractorsAnalytics | null>(null)
  const [negB, setNegB] = React.useState<PartNegotiationBundle | null>(null)
  const [wo, setWo] = React.useState<PartWorkOrderAnalytics | null>(null)
  const [commercial, setCommercial] = React.useState<PartCommercialInsights | null>(null)
  const [competition, setCompetition] = React.useState<PartCompetitionAnalytics | null>(null)
  const [pending, setPending] = React.useState<PendingActions | null>(null)
  const [timeline, setTimeline] = React.useState<AnalyticsTimelineEvent[]>([])

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
      const [s, c, n, w, co, cp, p, t] = await Promise.all([
        getJson<PartMasterAnalyticsSummary>(`${root}/summary${base}`),
        getJson<PartContractorsAnalytics>(`${root}/contractors${base}`),
        getJson<PartNegotiationBundle>(`${root}/negotiations${base}`),
        getJson<PartWorkOrderAnalytics>(`${root}/work-orders${base}`),
        getJson<PartCommercialInsights>(`${root}/commercial${base}`),
        getJson<PartCompetitionAnalytics>(`${root}/competition${base}`),
        getJson<PendingActions>(`${root}/pending`),
        getJson<AnalyticsTimelineEvent[]>(
          `${root}/timeline${tlCats ? `?categories=${encodeURIComponent(tlCats)}` : ""}`,
        ),
      ])
      setSummary(s)
      setCtr(c)
      setNegB(n)
      setWo(w)
      setCommercial(co)
      setCompetition(cp)
      setPending(p)
      setTimeline(t)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to load analytics")
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [partMasterId, filterParams, tlCats])

  React.useEffect(() => {
    void load()
  }, [load])

  const negPie = React.useMemo(() => {
    if (!negB) return []
    const rows = Object.entries(negB.status_counts).map(([name, value]) => ({ name, value }))
    return rows.length ? rows : [{ name: "none", value: 1 }]
  }, [negB])

  const scatterData = React.useMemo(
    () =>
      (ctr?.scatter_volume ?? []).map((d) => ({
        x: d.work_orders,
        y: d.negotiated_rate,
        name: d.name,
      })),
    [ctr],
  )

  if (loading && !summary) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">Loading part intelligence…</CardContent>
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

  if (!summary || !ctr || !negB || !wo || !commercial || !competition || !pending) {
    return null
  }

  const h = summary.header
  const lb = ctr.leaderboard

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">Part intelligence</h3>
          <p className="text-sm text-muted-foreground">
            Contractors, negotiations, work orders, and commercial posture for this part in one view.
          </p>
          {activeFilterCount > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} applied — open Filters to edit.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            <ListFilter className="mr-1.5 size-3.5" aria-hidden />
            {filtersOpen ? "Hide filters" : "Filters"}
            {!filtersOpen && activeFilterCount > 0 ? ` (${activeFilterCount})` : null}
          </Button>
          <PartReportExport partMasterId={partMasterId} filters={filterParams} />
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1.5 size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </Button>
        </div>
      </div>

      {filtersOpen ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Filters</CardTitle>
            <CardDescription>Date range, plant, contractor, and statuses — Apply to reload all blocks.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1">
              <Label htmlFor="pa-from">From</Label>
              <Input id="pa-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="pa-to">To</Label>
              <Input id="pa-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Plant</Label>
              <select
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
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
              <Label htmlFor="pa-cid">Contractor id</Label>
              <Input
                id="pa-cid"
                inputMode="numeric"
                placeholder="Optional"
                value={contractorId}
                onChange={(e) => setContractorId(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div className="grid gap-1">
              <Label>WO status</Label>
              <select
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                value={woStatus}
                onChange={(e) => setWoStatus(e.target.value)}
              >
                <option value="">Any</option>
                {["draft", "pending_approval", "approved", "active", "closed", "cancelled", "rejected"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <Label>Negotiation status</Label>
              <select
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                value={negStatus}
                onChange={(e) => setNegStatus(e.target.value)}
              >
                <option value="">Any</option>
                {["draft", "pending_approval", "approved", "rejected", "expired", "cancelled"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end sm:col-span-2">
              <Button type="button" size="sm" onClick={() => void load()}>
                Apply filters
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Part summary</CardTitle>
          <CardDescription>Master data snapshot and cross-module footprint.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Part number</div>
            <div className="font-mono font-semibold">{h.part_code}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Name</div>
            <div className="font-medium">{h.part_name}</div>
          </div>
          <div className="sm:col-span-2">
            <div className="text-xs text-muted-foreground">Description</div>
            <div className="text-muted-foreground">{h.description?.trim() || "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Category / pricing</div>
            <div className="font-medium">{h.part_category.replace(/_/g, " ")}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Part type (rate UOM)</div>
            <div className="font-medium">{h.part_type.replace(/_/g, " ")}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Billing UOM</div>
            <div className="font-medium">{h.unit_of_measurement}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Weight / unit</div>
            <div className="font-medium tabular-nums">{h.weight_per_unit != null ? String(h.weight_per_unit) : "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Standard base rate</div>
            <div className="text-lg font-semibold tabular-nums">{formatMoney(h.base_rate)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Active / status</div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={h.is_active ? "default" : "secondary"}>{h.is_active ? "Active" : "Inactive"}</Badge>
              <Badge variant="outline">{h.record_status}</Badge>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Home plant</div>
            <div className="font-medium">{h.home_plant_name ?? "—"}</div>
          </div>
          <div className="sm:col-span-2">
            <div className="text-xs text-muted-foreground">Plants using this part (WO footprint)</div>
            <div className="font-medium">{h.plant_names_used.length ? h.plant_names_used.join(", ") : "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Contractors (rates + WO)</div>
            <div className="text-lg font-semibold tabular-nums">{h.total_contractors_touching}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Active work orders</div>
            <div className="text-lg font-semibold tabular-nums">{h.total_active_work_orders}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Negotiation records</div>
            <div className="text-lg font-semibold tabular-nums">{h.total_negotiation_records}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Low / avg / high (approved)</div>
            <div className="tabular-nums text-xs">
              {h.lowest_negotiated_rate != null ? formatMoney(h.lowest_negotiated_rate) : "—"} ·{" "}
              {h.average_negotiated_rate != null ? formatMoney(h.average_negotiated_rate) : "—"} ·{" "}
              {h.highest_negotiated_rate != null ? formatMoney(h.highest_negotiated_rate) : "—"}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.kpis.map((k) => (
          <Card key={k.key} className={`border ${kpiToneClass(k.tone)}`}>
            <CardHeader className="pb-1 pt-3">
              <CardDescription className="text-xs font-medium uppercase tracking-wide">{k.label}</CardDescription>
            </CardHeader>
            <CardContent className="pb-3 text-xl font-semibold tabular-nums">{String(k.value)}</CardContent>
          </Card>
        ))}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Partial refresh issue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contractor rate comparison</CardTitle>
          <CardDescription>Negotiated positions, premiums, and operational load by contractor.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="border-emerald-200/80 bg-emerald-50/50">
              <CardHeader className="pb-1">
                <CardDescription className="text-xs">Lowest cost (current approved)</CardDescription>
              </CardHeader>
              <CardContent className="text-sm font-semibold">
                {lb.lowest_cost ? (
                  <>
                    <div>{lb.lowest_cost.name}</div>
                    <div className="tabular-nums text-emerald-900">{formatMoney(lb.lowest_cost.rate ?? 0)}</div>
                  </>
                ) : (
                  "—"
                )}
              </CardContent>
            </Card>
            <Card className="border-sky-200/80 bg-sky-50/50">
              <CardHeader className="pb-1">
                <CardDescription className="text-xs">Most used (active WO)</CardDescription>
              </CardHeader>
              <CardContent className="text-sm font-semibold">
                {lb.most_used ? (
                  <>
                    <div>{lb.most_used.name}</div>
                    <div className="tabular-nums">{lb.most_used.work_orders ?? 0} work orders</div>
                  </>
                ) : (
                  "—"
                )}
              </CardContent>
            </Card>
            <Card className="border-amber-200/80 bg-amber-50/50">
              <CardHeader className="pb-1">
                <CardDescription className="text-xs">Highest savings (record)</CardDescription>
              </CardHeader>
              <CardContent className="text-sm font-semibold">
                {lb.highest_savings ? (
                  <>
                    <div>{lb.highest_savings.name}</div>
                    <div className="tabular-nums">{formatMoney(lb.highest_savings.savings_amount ?? 0)}</div>
                  </>
                ) : (
                  "—"
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="h-72 min-h-[280px] w-full min-w-0">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Contractor negotiated rate (current)</div>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ctr.bar_by_contractor.slice(0, 16)} margin={{ left: 8, right: 8, bottom: 56 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" angle={-30} textAnchor="end" interval={0} height={64} tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => formatMoney(Number(v ?? 0))} />
                  <Legend />
                  <Bar dataKey="base_rate" name="Base" fill="#94a3b8" />
                  <Bar dataKey="negotiated_rate" name="Negotiated" fill="#059669" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="h-72 min-h-[280px] w-full min-w-0">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Negotiation trend (records / month)</div>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={ctr.negotiation_trend} margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="count" name="Records" fill="#0ea5e9" />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="avg_negotiated"
                    name="Avg negotiated"
                    stroke="#059669"
                    dot={false}
                    strokeWidth={2}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="h-72 min-h-[280px] w-full min-w-0">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Rate vs active work orders</div>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ left: 8, right: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" dataKey="x" name="Work orders" tick={{ fontSize: 10 }} />
                  <YAxis type="number" dataKey="y" name="Rate" tick={{ fontSize: 10 }} />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                  <Scatter data={scatterData} fill="#8b5cf6" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="h-72 min-h-[280px] w-full min-w-0">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Premium heatmap (% above base)</div>
              <div className="max-h-[280px] space-y-1 overflow-y-auto rounded-lg border p-2">
                {ctr.premium_heatmap.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No premium rows.</p>
                ) : (
                  ctr.premium_heatmap.map((row, i) => (
                    <div
                      key={`${row.contractor}-${i}`}
                      className={`flex items-center justify-between rounded-md px-2 py-1.5 text-xs ${heatClass(row.premium_pct)}`}
                    >
                      <span className="font-medium">{row.contractor}</span>
                      <span className="tabular-nums">{row.premium_pct.toFixed(1)}%</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contractor</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">Initial</TableHead>
                  <TableHead className="text-right">Negotiated</TableHead>
                  <TableHead className="text-right">Savings %</TableHead>
                  <TableHead className="text-right">Premium %</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Active WO</TableHead>
                  <TableHead className="text-right">WO value</TableHead>
                  <TableHead>Last negotiation</TableHead>
                  <TableHead>Approved by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ctr.rows.slice(0, 80).map((r) => (
                  <TableRow key={r.contractor_rate_id}>
                    <TableCell>
                      <div className="font-medium">{r.contractor_name}</div>
                      <div className="text-xs text-muted-foreground">{r.contractor_code ?? ""}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.base_rate)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.initial_rate != null ? formatMoney(r.initial_rate) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatMoney(r.final_negotiated_rate)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.savings_pct != null ? `${Number(r.savings_pct).toFixed(1)}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{Number(r.premium_above_base_pct).toFixed(1)}%</TableCell>
                    <TableCell className="text-xs">
                      {r.effective_from}
                      {r.effective_to ? ` → ${r.effective_to}` : ""}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{rateStatusLabel(r.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.active_work_orders}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.total_work_order_value)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.last_negotiation_at ? new Date(r.last_negotiation_at).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-xs">{r.approved_by_name ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Negotiation mix</CardTitle>
          </CardHeader>
          <CardContent className="h-64 min-h-[240px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={negPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={76} paddingAngle={2}>
                  {negPie.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Work order status</CardTitle>
          </CardHeader>
          <CardContent className="h-64 min-h-[240px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={wo.donut_status}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={76}
                  paddingAngle={2}
                >
                  {wo.donut_status.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Work order analytics</CardTitle>
          <CardDescription>Volume, plants, contractors, and invoicing attributed to this part.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Total WO value (lines)</div>
              <div className="text-lg font-semibold tabular-nums">{formatMoney(wo.total_wo_value)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Invoiced (lines on this part)</div>
              <div className="text-lg font-semibold tabular-nums">{formatMoney(wo.total_invoiced_for_part)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Pending invoice exposure</div>
              <div className="text-lg font-semibold tabular-nums text-amber-900">
                {formatMoney(wo.pending_invoice_amount_for_part)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Consumption qty (planned)</div>
              <div className="text-lg font-semibold tabular-nums">{String(wo.total_consumption_qty)}</div>
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="h-64 min-h-[240px] w-full min-w-0">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Monthly trend (value)</div>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={wo.value_trend} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => formatMoney(Number(v ?? 0))} />
                  <Line type="monotone" dataKey="value" stroke="#059669" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="h-64 min-h-[240px] w-full min-w-0">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Quantity trend (planned)</div>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={wo.qty_trend} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="quantity" fill="#0ea5e9" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="h-56 min-h-[220px] w-full min-w-0">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Plant-wise value</div>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={wo.by_plant.slice(0, 12)} layout="vertical" margin={{ left: 72, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="plant_name" width={68} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => formatMoney(Number(v ?? 0))} />
                  <Bar dataKey="value" fill="#64748b" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="h-56 min-h-[220px] w-full min-w-0">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Contractor distribution (count)</div>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={wo.by_contractor.slice(0, 14)} margin={{ left: 8, right: 8, bottom: 48 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="contractor_name" angle={-25} textAnchor="end" interval={0} height={56} tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Commercial & cost intelligence</CardTitle>
          <CardDescription>Risk posture and plain-language takeaways for leadership.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={commercial.risk_level === "high" ? "destructive" : commercial.risk_level === "medium" ? "secondary" : "outline"}>
              Risk: {commercial.risk_level}
            </Badge>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">Spread (high − low)</div>
              <div className="text-lg font-semibold tabular-nums">
                {commercial.spread_low_high != null ? formatMoney(commercial.spread_low_high) : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/50 p-3">
              <div className="text-xs font-medium text-emerald-900">Total savings (approved)</div>
              <div className="text-lg font-semibold text-emerald-950 tabular-nums">
                {formatMoney(commercial.total_savings_through_negotiation)}
              </div>
            </div>
            <div className="rounded-lg border border-amber-200/80 bg-amber-50/50 p-3">
              <div className="text-xs font-medium text-amber-950">Extra above base (approved)</div>
              <div className="text-lg font-semibold text-amber-950 tabular-nums">
                {formatMoney(commercial.total_extra_above_base)}
              </div>
            </div>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {commercial.insight_lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          <div className="h-52 w-full min-w-0">
            <div className="mb-2 text-xs font-medium text-muted-foreground">Average approved rate by month</div>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={commercial.cost_trend} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => formatMoney(Number(v ?? 0))} />
                <Line type="monotone" dataKey="avg_rate" stroke="#059669" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contractor competition</CardTitle>
          <CardDescription>Ranking, throughput, and negotiation throughput for this part.</CardDescription>
        </CardHeader>
        <CardContent className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>Contractor</TableHead>
                <TableHead className="text-right">WO count</TableHead>
                <TableHead className="text-right">Completion %</TableHead>
                <TableHead className="text-right">Success %</TableHead>
                <TableHead className="text-right">Pending negs</TableHead>
                <TableHead className="text-right">Avg rounds</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {competition.rows.map((r) => (
                <TableRow key={r.contractor_id}>
                  <TableCell className="font-mono">{r.rate_rank}</TableCell>
                  <TableCell className="font-medium">{r.contractor_name}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.work_order_count}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.completion_rate_pct != null ? `${Number(r.completion_rate_pct).toFixed(0)}%` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.negotiation_success_pct != null ? `${Number(r.negotiation_success_pct).toFixed(0)}%` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.pending_approvals}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.avg_rounds != null ? Number(r.avg_rounds).toFixed(1) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending & risk</CardTitle>
          <CardDescription>Negotiations, premiums, expiries, and open work tied to this part.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {pending.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No alerts for this part.</p>
          ) : (
            pending.items.map((item, idx) => (
              <div
                key={`${item.kind}-${idx}`}
                className={
                  "flex flex-wrap items-start justify-between gap-2 rounded-lg border px-3 py-2 text-sm " +
                  (item.severity === "danger"
                    ? "border-rose-200 bg-rose-50/70"
                    : item.severity === "warning"
                      ? "border-amber-200 bg-amber-50/60"
                      : "border-border/60 bg-muted/30")
                }
              >
                <div>
                  <div className="font-medium">{item.title}</div>
                  {item.detail ? <div className="text-xs text-muted-foreground">{item.detail}</div> : null}
                </div>
                {item.href_hint ? (
                  <Button variant="outline" size="sm" className="h-8 shrink-0 text-xs" asChild>
                    <Link to={item.href_hint}>Open</Link>
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline & activity</CardTitle>
          <CardDescription>Chronological feed — pick categories then refresh.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {["all", "negotiations", "work_orders", "approvals", "financial", "compliance"].map((c) => (
              <Button
                key={c}
                type="button"
                size="sm"
                variant={tlCats === c ? "default" : "outline"}
                className="h-8 text-xs capitalize"
                onClick={() => setTlCats(c)}
              >
                {c.replace("_", " ")}
              </Button>
            ))}
          </div>
          <Separator />
          <ul className="max-h-96 space-y-2 overflow-y-auto text-sm">
            {timeline.map((e, i) => (
              <li key={`${e.timestamp}-${i}`} className="rounded-md border border-border/50 bg-muted/20 px-2 py-2">
                <div className="flex flex-wrap justify-between gap-1 text-xs text-muted-foreground">
                  <span className="uppercase tracking-wide">{e.category}</span>
                  <span>{new Date(e.timestamp).toLocaleString()}</span>
                </div>
                <div className="font-medium">{e.title}</div>
                {e.description ? <div className="text-xs text-muted-foreground">{e.description}</div> : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
