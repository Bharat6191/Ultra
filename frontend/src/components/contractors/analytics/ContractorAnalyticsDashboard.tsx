import * as React from "react"
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
import { ContractorReportExport } from "@/components/contractors/analytics/ContractorReportExport"
import type {
  AnalyticsTimelineEvent,
  CommercialInsights,
  ContractorAnalyticsSummary,
  NegotiationAnalytics,
  WorkOrderAnalytics,
} from "@/components/contractors/analytics/types"

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

export function ContractorAnalyticsDashboard({ contractorId }: { contractorId: number }) {
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")
  const [plantId, setPlantId] = React.useState("")
  const [woStatus, setWoStatus] = React.useState("")
  const [negStatus, setNegStatus] = React.useState("")
  const [partSearch, setPartSearch] = React.useState("")
  const [tlCats, setTlCats] = React.useState("all")
  const [filtersOpen, setFiltersOpen] = React.useState(false)

  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [summary, setSummary] = React.useState<ContractorAnalyticsSummary | null>(null)
  const [neg, setNeg] = React.useState<NegotiationAnalytics | null>(null)
  const [wo, setWo] = React.useState<WorkOrderAnalytics | null>(null)
  const [commercial, setCommercial] = React.useState<CommercialInsights | null>(null)
  const [timeline, setTimeline] = React.useState<AnalyticsTimelineEvent[]>([])

  const filterParams = React.useMemo(
    () => ({
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      plant_id: plantId || undefined,
      work_order_status: woStatus || undefined,
      negotiation_status: negStatus || undefined,
      part_search: partSearch || undefined,
    }),
    [dateFrom, dateTo, plantId, woStatus, negStatus, partSearch],
  )

  const activeFilterCount = React.useMemo(() => {
    let n = 0
    if (dateFrom) n++
    if (dateTo) n++
    if (plantId) n++
    if (woStatus) n++
    if (negStatus) n++
    if (partSearch.trim()) n++
    return n
  }, [dateFrom, dateTo, plantId, woStatus, negStatus, partSearch])

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const base = q(filterParams)
    try {
      const [s, n, w, c, t] = await Promise.all([
        getJson<ContractorAnalyticsSummary>(`/contractors/${contractorId}/analytics/summary${base}`),
        getJson<NegotiationAnalytics>(`/contractors/${contractorId}/analytics/negotiations${base}`),
        getJson<WorkOrderAnalytics>(`/contractors/${contractorId}/analytics/work-orders${base}`),
        getJson<CommercialInsights>(`/contractors/${contractorId}/analytics/commercial${base}`),
        getJson<AnalyticsTimelineEvent[]>(
          `/contractors/${contractorId}/analytics/timeline${tlCats ? `?categories=${encodeURIComponent(tlCats)}` : ""}`,
        ),
      ])
      setSummary(s)
      setNeg(n)
      setWo(w)
      setCommercial(c)
      setTimeline(t)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to load analytics")
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [contractorId, filterParams, tlCats])

  React.useEffect(() => {
    void load()
  }, [load])

  const pieData = React.useMemo(() => {
    if (!neg) return []
    const rows = Object.entries(neg.status_counts).map(([name, value]) => ({ name, value }))
    return rows.length ? rows : [{ name: "none", value: 1 }]
  }, [neg])

  const woDonut = React.useMemo(() => {
    if (!wo?.donut_status?.length) return [{ name: "none", value: 0 }]
    return wo.donut_status
  }, [wo])

  if (loading && !summary) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">Loading analytics…</CardContent>
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

  if (!summary || !neg || !wo || !commercial) {
    return null
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">Operational & commercial intelligence</h3>
          <p className="text-sm text-muted-foreground">
            Negotiations, work orders, and invoices for this contractor in one place.
          </p>
          {activeFilterCount > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} applied — open Filters to edit or clear.
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
          <ContractorReportExport
            contractorId={contractorId}
            filters={filterParams}
            summary={summary}
            neg={neg}
            wo={wo}
            commercial={commercial}
          />
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
          <CardDescription>
            Date range, plant, statuses, and part search — use Apply to reload analytics.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1">
            <Label htmlFor="ca-from">From</Label>
            <Input id="ca-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ca-to">To</Label>
            <Input id="ca-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>Plant</Label>
            <select
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              value={plantId}
              onChange={(e) => setPlantId(e.target.value)}
            >
              <option value="">All mapped plants</option>
              {(summary.plants ?? []).map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
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
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="ca-part">Part search</Label>
            <Input
              id="ca-part"
              placeholder="Code or name contains…"
              value={partSearch}
              onChange={(e) => setPartSearch(e.target.value)}
            />
          </div>
          <div className="flex items-end sm:col-span-2">
            <Button type="button" size="sm" onClick={() => void load()}>
              Apply filters
            </Button>
          </div>
        </CardContent>
      </Card>
      ) : null}

      {/* Summary header */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Contractor summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Code</div>
            <div className="font-medium">{summary.contractor_code ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Status</div>
            <Badge variant="secondary">{summary.status}</Badge>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Plants</div>
            <div className="font-medium">{summary.plant_names.length ? summary.plant_names.join(", ") : "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Active since</div>
            <div className="font-medium">{summary.active_since ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Active work orders</div>
            <div className="text-lg font-semibold tabular-nums">{summary.total_active_work_orders}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Negotiated parts</div>
            <div className="text-lg font-semibold tabular-nums">{summary.distinct_negotiated_parts}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Approved negotiations</div>
            <div className="text-lg font-semibold tabular-nums">{summary.approved_negotiations}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Savings vs initial</div>
            <div className="text-lg font-semibold tabular-nums text-emerald-800">
              {formatMoney(summary.overall_savings_vs_initial)}
            </div>
          </div>
          <div className="sm:col-span-2">
            <div className="text-xs text-muted-foreground">Premium above base (approved)</div>
            <div className="text-lg font-semibold tabular-nums text-amber-900">
              {formatMoney(summary.overall_premium_above_base)}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.kpis.map((k) => (
          <Card key={k.key} className={`border ${kpiToneClass(k.tone)}`}>
            <CardHeader className="pb-1 pt-3">
              <CardDescription className="text-xs font-medium uppercase tracking-wide">{k.label}</CardDescription>
            </CardHeader>
            <CardContent className="pb-3 text-2xl font-semibold tabular-nums">{String(k.value)}</CardContent>
          </Card>
        ))}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Partial refresh issue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Negotiation analytics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Negotiation analytics</CardTitle>
          <CardDescription>Per-part commercial posture, savings, and approval state.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="h-72 min-h-[280px] w-full min-w-0">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Base vs negotiated (sample)</div>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={neg.bar_chart_parts.slice(0, 14)} margin={{ left: 8, right: 8, bottom: 48 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="part_code" angle={-35} textAnchor="end" interval={0} height={60} tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => formatMoney(Number(v ?? 0))} />
                  <Legend />
                  <Bar dataKey="base_rate" name="Base" fill="#94a3b8" />
                  <Bar dataKey="negotiated_rate" name="Negotiated" fill="#059669" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="h-72 min-h-[280px] w-full min-w-0">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Negotiation volume by month</div>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={neg.trend} margin={{ left: 8, right: 16 }}>
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
            <div className="h-64 min-h-[240px] w-full min-w-0">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Negotiation status mix</div>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="h-64 min-h-[240px] w-full min-w-0">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Highest premium above base (parts)</div>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={neg.premium_ranking.slice(0, 10)}
                  margin={{ left: 72, right: 16 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="part_code" width={68} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => formatMoney(Number(v ?? 0))} />
                  <Bar dataKey="premium_above_base" name="Premium" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">Negotiation detail</div>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Part</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">Negotiated</TableHead>
                    <TableHead className="text-right">Initial</TableHead>
                    <TableHead className="text-right">Savings %</TableHead>
                    <TableHead className="text-right">Premium</TableHead>
                    <TableHead className="text-right">Rounds</TableHead>
                    <TableHead>Effective</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {neg.rows.slice(0, 50).map((r) => (
                    <TableRow key={r.contractor_rate_id}>
                      <TableCell className="font-mono text-xs">
                        {r.part_code}
                        <div className="text-[11px] font-normal text-muted-foreground">{r.part_name}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{rateStatusLabel(r.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(r.base_rate)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(r.negotiated_rate)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.initial_rate != null ? formatMoney(r.initial_rate) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.savings_percentage != null ? `${Number(r.savings_percentage).toFixed(1)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-amber-900">{formatMoney(r.premium_above_base)}</TableCell>
                      <TableCell className="text-right">{r.rounds}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.effective_from}
                        {r.effective_to ? ` → ${r.effective_to}` : " → open"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Work order analytics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Work order analytics</CardTitle>
          <CardDescription>Execution pipeline, plant workload, and financial exposure.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Total WO value</div>
              <div className="text-xl font-semibold">{formatMoney(wo.total_wo_value)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Invoiced</div>
              <div className="text-xl font-semibold text-emerald-800">{formatMoney(wo.total_invoiced)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Pending invoice exposure</div>
              <div className="text-xl font-semibold text-amber-900">{formatMoney(wo.pending_invoice_amount)}</div>
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="h-64 min-h-[240px] w-full min-w-0">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Status distribution</div>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={woDonut}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={76}
                    paddingAngle={2}
                  >
                    {woDonut.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="h-64 min-h-[240px] w-full min-w-0">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Created vs completed by month</div>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={wo.by_month} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="created" name="Created" fill="#0ea5e9" />
                  <Bar dataKey="completed" name="Completed" fill="#059669" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="h-64 min-h-[240px] w-full min-w-0">
            <div className="mb-2 text-xs font-medium text-muted-foreground">Plant workload (count)</div>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={wo.by_plant} margin={{ bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="plant_name" angle={-25} textAnchor="end" interval={0} height={70} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="h-56 min-h-[220px] w-full min-w-0">
            <div className="mb-2 text-xs font-medium text-muted-foreground">Work order value trend</div>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={wo.value_trend} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => formatMoney(Number(v ?? 0))} />
                <Line type="monotone" dataKey="value" name="Value" stroke="#059669" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Commercial */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Commercial performance</CardTitle>
            <CardDescription>Savings vs premium profile across approved negotiations.</CardDescription>
          </div>
          <Badge
            variant={
              commercial.risk_level === "high" ? "destructive" : commercial.risk_level === "medium" ? "warning" : "success"
            }
          >
            Risk: {commercial.risk_level}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/50 p-3">
            <div className="text-xs font-medium text-emerald-900">Avg savings % (approved)</div>
            <div className="text-lg font-semibold text-emerald-950">
              {commercial.avg_negotiation_reduction_pct != null
                ? `${Number(commercial.avg_negotiation_reduction_pct).toFixed(1)}%`
                : "—"}
            </div>
          </div>
          <div className="rounded-lg border border-amber-200/80 bg-amber-50/50 p-3">
            <div className="text-xs font-medium text-amber-950">Avg premium above base</div>
            <div className="text-lg font-semibold text-amber-950">
              {commercial.avg_premium_above_base != null ? formatMoney(commercial.avg_premium_above_base) : "—"}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Total savings generated</div>
            <div className="text-lg font-semibold">{formatMoney(commercial.total_savings_generated)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Highest premium part</div>
            <div className="font-medium">{commercial.highest_premium_part_code ?? "—"}</div>
            <div className="tabular-nums text-amber-900">{formatMoney(commercial.highest_premium_amount)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Highest savings part</div>
            <div className="font-medium">{commercial.highest_savings_part_code ?? "—"}</div>
            <div className="tabular-nums text-emerald-800">{formatMoney(commercial.highest_savings_amount)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Above / below base rate</div>
            <div>
              <span className="text-amber-900">{Number(commercial.pct_negotiations_above_base).toFixed(1)}%</span>
              <span className="text-muted-foreground"> / </span>
              <span className="text-emerald-800">{Number(commercial.pct_negotiations_below_base).toFixed(1)}%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline & activity</CardTitle>
          <CardDescription>Filter categories then refresh.</CardDescription>
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
