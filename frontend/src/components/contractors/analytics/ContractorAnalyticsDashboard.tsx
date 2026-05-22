import * as React from "react"
import { useNavigate } from "react-router-dom"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  // CircleDollarSign,
  ClipboardList,
  Clock3,
  Handshake,
  ListFilter,
  LoaderCircle,
  XCircle,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PartWorkOrderPreviewDialog } from "@/components/parts/analytics/PartWorkOrderPreviewDialog"
import { VsBaseToleranceBadge } from "@/components/contractors/VsBaseToleranceBadge"
import { formatMoney, formatPercent, rateStatusLabel, rateStatusVariant } from "@/components/contractors/rateStatus"
import { statusLabel, statusVariant } from "@/components/contractors/status"
import { ApiError, getJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"
import { workOrderStatusBadgeVariant } from "@/lib/work-order-status-badge"
import type {
  CommercialInsights,
  ContractorAnalyticsSummary,
  ContractorWorkOrderRow,
  NegotiationAnalytics,
  NegotiationRow,
  PendingActions,
  PendingItem,
  WorkOrderAnalytics,
} from "@/components/contractors/analytics/types"

// const CHART_COLORS = ["#059669", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#64748b"]

// const NEGOTIATION_CHART_OPTIONS = [
//   {
//     value: "base_vs_negotiated",
//     label: "Base vs negotiated",
//     hint: "Compare baseline and negotiated rates across parts.",
//   },
//   {
//     value: "volume_by_month",
//     label: "Volume by month",
//     hint: "Track negotiation record count and average negotiated value over time.",
//   },
//   {
//     value: "status_mix",
//     label: "Status mix",
//     hint: "See how negotiations are split across approval states.",
//   },
//   {
//     value: "premium_ranking",
//     label: "Premium ranking",
//     hint: "Focus on parts with the highest premium above base rate.",
//   },
// ] as const

// const WORK_ORDER_CHART_OPTIONS = [
//   {
//     value: "status_distribution",
//     label: "Status distribution",
//     hint: "Current work-order mix by lifecycle status.",
//   },
//   {
//     value: "created_vs_completed",
//     label: "Created vs completed",
//     hint: "Compare work-order creation and completion volume by month.",
//   },
//   {
//     value: "plant_workload",
//     label: "Plant workload",
//     hint: "Review work-order volume by mapped plant.",
//   },
//   {
//     value: "value_trend",
//     label: "Value trend",
//     hint: "Track work-order value movement across months.",
//   },
// ] as const

// type ChartOption = { value: string; label: string; hint: string }

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
      return "In approval"
    case "draft":
      return "Draft"
    case "rejected":
      return "Returned"
    default:
      return status.replace(/_/g, " ")
  }
}

type InsightTone = "neutral" | "success" | "warning" | "danger" | "info" | "violet"

function insightToneClasses(tone: InsightTone): {
  tile: string
  iconWrap: string
  icon: string
} {
  switch (tone) {
    case "success":
      return {
        tile: "border-emerald-200/80 bg-emerald-50/35",
        iconWrap: "bg-emerald-100/80",
        icon: "text-emerald-600",
      }
    case "warning":
      return {
        tile: "border-amber-200/80 bg-amber-50/35",
        iconWrap: "bg-amber-100/80",
        icon: "text-amber-500",
      }
    case "danger":
      return {
        tile: "border-rose-200/80 bg-rose-50/35",
        iconWrap: "bg-rose-100/80",
        icon: "text-rose-500",
      }
    case "info":
      return {
        tile: "border-sky-200/80 bg-sky-50/30",
        iconWrap: "bg-sky-100/80",
        icon: "text-sky-600",
      }
    case "violet":
      return {
        tile: "border-violet-200/80 bg-violet-50/30",
        iconWrap: "bg-violet-100/80",
        icon: "text-violet-600",
      }
    case "neutral":
    default:
      return {
        tile: "border-border/70 bg-white",
        iconWrap: "bg-slate-100/80",
        icon: "text-slate-500",
      }
  }
}

function FactField({
  label,
  value,
  strong,
}: {
  label: string
  value: React.ReactNode
  strong?: boolean
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 ${strong ? "text-base font-semibold text-foreground" : "text-sm"}`}>
        {value}
      </div>
    </div>
  )
}

function InsightTile({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  valueClassName = "",
}: {
  label: string
  value: React.ReactNode
  icon: React.ElementType
  tone?: InsightTone
  valueClassName?: string
}) {
  const toneClasses = insightToneClasses(tone)

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClasses.tile}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-600">{label}</div>
          <div className={`mt-3 text-2xl font-semibold tracking-tight text-slate-950 ${valueClassName}`}>{value}</div>
        </div>
        <div className={`flex size-11 shrink-0 items-center justify-center rounded-full ${toneClasses.iconWrap}`}>
          <Icon className={`size-5 ${toneClasses.icon}`} aria-hidden />
        </div>
      </div>
    </div>
  )
}

function InsightSection({
  title,
  icon: Icon,
  iconTone = "info",
  children,
}: {
  title: string
  icon: React.ElementType
  iconTone?: InsightTone
  children: React.ReactNode
}) {
  const toneClasses = insightToneClasses(iconTone)

  return (
    <Card className="rounded-[28px] border border-border/70 bg-white/95 shadow-sm">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className={`flex size-10 items-center justify-center rounded-2xl ${toneClasses.iconWrap}`}>
            <Icon className={`size-5 ${toneClasses.icon}`} aria-hidden />
          </div>
          <div className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-700">{title}</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
      </CardContent>
    </Card>
  )
}

// function ChartSelector({
//   value,
//   options,
//   onChange,
// }: {
//   value: string
//   options: readonly ChartOption[]
//   onChange: (value: string) => void
// }) {
//   const activeOption = options.find((option) => option.value === value)
//
//   return (
//     <div className="space-y-3">
//       <div className="flex flex-wrap gap-2">
//         {options.map((option) => (
//           <Button
//             key={option.value}
//             type="button"
//             size="sm"
//             variant={value === option.value ? "default" : "outline"}
//             onClick={() => onChange(option.value)}
//           >
//             {option.label}
//           </Button>
//         ))}
//       </div>
//       {activeOption ? <p className="text-xs text-muted-foreground">{activeOption.hint}</p> : null}
//     </div>
//   )
// }

export function ContractorAnalyticsDashboard({
  contractorId,
}: {
  contractorId: number
}) {
  const navigate = useNavigate()
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")
  const [plantId, setPlantId] = React.useState("")
  const [woStatus, setWoStatus] = React.useState("")
  const [negStatus, setNegStatus] = React.useState("")
  const [partSearch, setPartSearch] = React.useState("")
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  // const [negChartView, setNegChartView] = React.useState<NegotiationChartView>("base_vs_negotiated")
  // const [woChartView, setWoChartView] = React.useState<WorkOrderChartView>("status_distribution")

  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [summary, setSummary] = React.useState<ContractorAnalyticsSummary | null>(null)
  const [neg, setNeg] = React.useState<NegotiationAnalytics | null>(null)
  const [wo, setWo] = React.useState<WorkOrderAnalytics | null>(null)
  const [commercial, setCommercial] = React.useState<CommercialInsights | null>(null)
  const [invoicePending, setInvoicePending] = React.useState<PendingItem[]>([])
  const [selectedNegotiation, setSelectedNegotiation] = React.useState<NegotiationRow | null>(null)
  const [selectedWorkOrder, setSelectedWorkOrder] = React.useState<ContractorWorkOrderRow | null>(null)
  const [woPage, setWoPage] = React.useState(0)
  const canOpenNegotiationPage = hasPermission("contractor_rates.view")

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

  const kpiMap = summary ? new Map(summary.kpis.map((k) => [k.key, k])) : new Map()

  function kpiValue(key: string): number | string {
    return kpiMap.get(key)?.value ?? "—"
  }

  function openNegotiationDetail(rateId: number) {
    navigate(`/dashboard/negotiated-rates/${rateId}`)
  }

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const base = q(filterParams)
    try {
      const [s, n, w, c, pending] = await Promise.all([
        getJson<ContractorAnalyticsSummary>(`/contractors/${contractorId}/analytics/summary${base}`),
        getJson<NegotiationAnalytics>(`/contractors/${contractorId}/analytics/negotiations${base}`),
        getJson<WorkOrderAnalytics>(`/contractors/${contractorId}/analytics/work-orders${base}`),
        getJson<CommercialInsights>(`/contractors/${contractorId}/analytics/commercial${base}`),
        getJson<PendingActions>(`/contractors/${contractorId}/analytics/pending`).catch(() => ({ items: [] })),
      ])
      setSummary(s)
      setNeg(n)
      setWo(w)
      setCommercial(c)
      setInvoicePending((pending.items ?? []).filter((i) => i.kind === "invoice"))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to load analytics")
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [contractorId, filterParams])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    setWoPage(0)
  }, [filterParams])

  const woRows = wo?.rows ?? []
  const woPageCount = Math.max(1, Math.ceil(woRows.length / WO_PAGE_SIZE))
  const woPageSafe = Math.min(woPage, woPageCount - 1)
  const paginatedWoRows = React.useMemo(() => {
    const start = woPageSafe * WO_PAGE_SIZE
    return woRows.slice(start, start + WO_PAGE_SIZE)
  }, [woRows, woPageSafe])
  const woRangeStart = woRows.length === 0 ? 0 : woPageSafe * WO_PAGE_SIZE + 1
  const woRangeEnd = Math.min((woPageSafe + 1) * WO_PAGE_SIZE, woRows.length)

  // const pieData = React.useMemo(() => {
  //   if (!neg) return []
  //   const rows = Object.entries(neg.status_counts).map(([name, value]) => ({ name, value }))
  //   return rows.length ? rows : [{ name: "none", value: 1 }]
  // }, [neg])

  // Dashboard work-order visual section is temporarily hidden.
  // const woDonut = React.useMemo(() => {
  //   if (!wo?.donut_status?.length) return [{ name: "none", value: 0 }]
  //   return wo.donut_status
  // }, [wo])

  // Negotiation graph kept in source but hidden per current UI request.
  // const negotiationChart = React.useMemo(() => {
  //   if (!neg) return null
  //   return (
  //     <div className="h-80 min-h-[300px] w-full min-w-0">
  //       <div className="mb-2 text-xs font-medium text-muted-foreground">Base vs negotiated (sample)</div>
  //       <ResponsiveContainer width="100%" height="100%">
  //         <BarChart data={neg.bar_chart_parts.slice(0, 14)} margin={{ left: 8, right: 8, bottom: 48 }}>
  //           <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
  //           <XAxis dataKey="part_code" angle={-35} textAnchor="end" interval={0} height={60} tick={{ fontSize: 10 }} />
  //           <YAxis tick={{ fontSize: 10 }} />
  //           <Tooltip formatter={(v) => formatMoney(Number(v ?? 0))} />
  //           <Legend />
  //           <Bar dataKey="base_rate" name="Base" fill="#0D2E20" />
  //           <Bar dataKey="negotiated_rate" name="Negotiated" fill="#059669" />
  //         </BarChart>
  //       </ResponsiveContainer>
  //     </div>
  //   )
  // }, [neg])

  const workOrderStatusChart = React.useMemo(() => {
    const activeCount = woRows.filter((row) => String(row.status).toLowerCase() === "active").length
    const inactiveCount = Math.max(0, woRows.length - activeCount)
    return (
      <div className="h-72 min-h-[280px] w-full min-w-0">
        <div className="mb-2 text-xs font-medium text-muted-foreground">Active vs inactive work orders</div>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={[
              {
                bucket: "Work orders",
                active: activeCount,
                inactive: inactiveCount,
              },
            ]}
            margin={{ left: 8, right: 8, bottom: 24 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(value) => String(value)} />
            <Legend />
            <Bar dataKey="active" name="Active" fill="#059669" radius={[6, 6, 0, 0]} />
            <Bar dataKey="inactive" name="Inactive" fill="#94a3b8" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    )
  }, [woRows])

  // const workOrderChart = React.useMemo(() => {
  //   if (!wo) return null
  //
  //   switch (woChartView) {
  //     case "created_vs_completed":
  //       return (
  //         <div className="h-72 min-h-[280px] w-full min-w-0">
  //           <div className="mb-2 text-xs font-medium text-muted-foreground">Created vs completed by month</div>
  //           <ResponsiveContainer width="100%" height="100%">
  //             <ComposedChart data={wo.by_month} margin={{ left: 8, right: 8 }}>
  //               <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
  //               <XAxis dataKey="month" tick={{ fontSize: 10 }} />
  //               <YAxis tick={{ fontSize: 10 }} />
  //               <Tooltip />
  //               <Legend />
  //               <Bar dataKey="created" name="Created" fill="#0ea5e9" />
  //               <Bar dataKey="completed" name="Completed" fill="#059669" />
  //             </ComposedChart>
  //           </ResponsiveContainer>
  //         </div>
  //       )
  //     case "plant_workload":
  //       return (
  //         <div className="h-72 min-h-[280px] w-full min-w-0">
  //           <div className="mb-2 text-xs font-medium text-muted-foreground">Plant workload (count)</div>
  //           <ResponsiveContainer width="100%" height="100%">
  //             <BarChart data={wo.by_plant} margin={{ bottom: 40 }}>
  //               <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
  //               <XAxis dataKey="plant_name" angle={-25} textAnchor="end" interval={0} height={70} tick={{ fontSize: 10 }} />
  //               <YAxis tick={{ fontSize: 10 }} />
  //               <Tooltip />
  //               <Bar dataKey="count" fill="#6366f1" />
  //             </BarChart>
  //           </ResponsiveContainer>
  //         </div>
  //       )
  //     case "value_trend":
  //       return (
  //         <div className="h-72 min-h-[280px] w-full min-w-0">
  //           <div className="mb-2 text-xs font-medium text-muted-foreground">Work order value trend</div>
  //           <ResponsiveContainer width="100%" height="100%">
  //             <LineChart data={wo.value_trend} margin={{ left: 8, right: 8 }}>
  //               <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
  //               <XAxis dataKey="month" tick={{ fontSize: 10 }} />
  //               <YAxis tick={{ fontSize: 10 }} />
  //               <Tooltip formatter={(v) => formatMoney(Number(v ?? 0))} />
  //               <Line type="monotone" dataKey="value" name="Value" stroke="#059669" strokeWidth={2} dot />
  //             </LineChart>
  //           </ResponsiveContainer>
  //         </div>
  //       )
  //     case "status_distribution":
  //     default:
  //       return (
  //         <div className="h-72 min-h-[280px] w-full min-w-0">
  //           <div className="mb-2 text-xs font-medium text-muted-foreground">Status distribution</div>
  //           <ResponsiveContainer width="100%" height="100%">
  //             <PieChart>
  //               <Pie
  //                 data={woDonut}
  //                 dataKey="value"
  //                 nameKey="name"
  //                 cx="50%"
  //                 cy="50%"
  //                 innerRadius={52}
  //                 outerRadius={86}
  //                 paddingAngle={2}
  //               >
  //                 {woDonut.map((_, i) => (
  //                   <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
  //                 ))}
  //               </Pie>
  //               <Tooltip />
  //               <Legend />
  //             </PieChart>
  //           </ResponsiveContainer>
  //         </div>
  //       )
  //   }
  // }, [wo, woChartView, woDonut])

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

  const toolbarControls = (
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
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <Card>
        <CardContent className="p-0">
          <div className="grid gap-0 lg:grid-cols-5">
            <div className="space-y-3 p-6">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Contractor
              </div>
              <div className="text-2xl font-semibold tracking-tight">
                {summary.contractor_code ?? "—"}
              </div>
            </div>

            <div className="space-y-3 border-t p-6 lg:border-t-0 lg:border-l">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Status
              </div>
              <Badge variant={statusVariant(summary.status)}>{statusLabel(summary.status)}</Badge>
            </div>

            <div className="space-y-3 border-t p-6 lg:border-t-0 lg:border-l">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Plants
              </div>
              <div className="space-y-1 text-base font-medium leading-snug">
                {summary.plant_names.length ? (
                  summary.plant_names.map((plant) => <div key={plant}>{plant}</div>)
                ) : (
                  <div>—</div>
                )}
              </div>
            </div>

            <div className="space-y-3 border-t p-6 lg:border-t-0 lg:border-l">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Active since
              </div>
              <div className="inline-flex items-center gap-2 text-xl font-semibold tracking-tight">
                <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
                <span>{summary.active_since ?? "—"}</span>
              </div>
            </div>

            <div className="space-y-3 border-t p-6 lg:border-t-0 lg:border-l">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Negotiated parts
              </div>
              <div className="text-2xl font-semibold tabular-nums tracking-tight">
                {summary.distinct_negotiated_parts}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid gap-4 xl:grid-cols-2">
        <InsightSection title="Work Orders" icon={ClipboardList} iconTone="info">
          <InsightTile label="Total Work Orders" value={String(kpiValue("wo_total"))} icon={ClipboardList} tone="info" />
          <InsightTile label="Pending Work Orders" value={String(kpiValue("wo_pending"))} icon={Clock3} tone="warning" />
          <InsightTile label="In Progress Work Orders" value={String(kpiValue("wo_active"))} icon={LoaderCircle} tone="info" />
          <InsightTile label="Completed Work Orders" value={String(kpiValue("wo_completed"))} icon={CheckCircle2} tone="success" />
          <InsightTile
            label="Cancelled / Rejected Work Orders"
            value={String(kpiValue("wo_cancelled"))}
            icon={XCircle}
            tone="danger"
          />
        </InsightSection>

        <InsightSection title="Negotiations" icon={Handshake} iconTone="violet">
          <InsightTile label="Total Negotiations" value={String(kpiValue("neg_total"))} icon={Handshake} tone="violet" />
          {/* <InsightTile
            label="Approved Negotiations"
            value={String(kpiValue("neg_approved"))}
            icon={CheckCircle2}
            tone="success"
          /> */}
          <InsightTile
            label="Pending / Draft Negotiations"
            value={String(kpiValue("neg_pending"))}
            icon={Clock3}
            tone="warning"
          />
          <InsightTile
            label="Approved Negotiations"
            value={String(kpiValue("neg_approved"))}
            icon={CheckCircle2}
            tone="success"
          />
          <InsightTile
            label="Rejected Negotiations"
            value={String(kpiValue("neg_rejected"))}
            icon={XCircle}
            tone="danger"
          />
          {/*
          <InsightTile
            label="Total Negotiation Savings"
            value={formatMoney(kpiValue("savings_total"))}
            icon={CircleDollarSign}
            tone="success"
            valueClassName="text-emerald-600"
          />
          */}
        </InsightSection>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Partial refresh issue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {invoicePending.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Invoices</CardTitle>
            <CardDescription>Drafts, validation, and recent approvals for this contractor.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {invoicePending.slice(0, 8).map((item) => (
              <button
                key={`${item.kind}-${item.entity_id}-${item.title}`}
                type="button"
                className={
                  "flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 " +
                  (item.severity === "success"
                    ? "border-emerald-300/60 bg-emerald-50/80 dark:border-emerald-800/50 dark:bg-emerald-950/30"
                    : item.severity === "danger"
                      ? "border-destructive/40 bg-destructive/5"
                      : item.severity === "warning"
                        ? "border-amber-300/50 bg-amber-50/60 dark:bg-amber-950/20"
                        : "border-border/80 bg-muted/20")
                }
                onClick={() => {
                  if (item.href_hint) navigate(item.href_hint)
                }}
              >
                <span className="font-medium">{item.title}</span>
                {item.detail ? <span className="text-xs text-muted-foreground tabular-nums">{item.detail}</span> : null}
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-6">
        {/* Negotiation analytics */}
        <div className="space-y-6">
          {/* <Card>
            <CardHeader>
              <CardTitle className="text-base">Negotiation analytics</CardTitle>
              <CardDescription>Per-part commercial posture and approval state.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
                {negotiationChart}
              </div>
            </CardContent>
          </Card> */}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Negotiation detail</CardTitle>
              <CardDescription>Part-by-part negotiated outcomes in a compact list.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  {activeFilterCount > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} applied.
                    </p>
                  ) : null}
                </div>
                {toolbarControls}
              </div>

              {filtersOpen ? (
                <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
                  <div className="mb-4">
                    <div className="text-sm font-semibold">Filters</div>
                    <p className="text-xs text-muted-foreground">
                      Date range, plant, statuses, and part search — use Apply to reload analytics.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                  </div>
                </div>
              ) : null}

              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Part</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Should cost</TableHead>
                      <TableHead className="text-right">Negotiated</TableHead>
                      <TableHead className="text-right">Tolerance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {neg.rows.slice(0, 10).map((r) => (
                      <TableRow key={r.contractor_rate_id}>
                        <TableCell className="font-mono text-xs">
                          <button
                            type="button"
                            className="text-left font-semibold text-emerald-700 transition-colors hover:text-emerald-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                            onClick={() => setSelectedNegotiation(r)}
                          >
                            {r.part_code}
                          </button>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{rateStatusLabel(r.status)}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(r.base_rate)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(r.negotiated_rate)}</TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <VsBaseToleranceBadge
                              negotiated={r.negotiated_rate}
                              baseRate={r.base_rate}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-base">Work orders</CardTitle>
              <CardDescription>
                Work orders for this contractor — {formatMoney(wo.total_wo_value)} total value,{" "}
                {formatMoney(wo.total_invoiced)} invoiced, {formatMoney(wo.pending_invoice_amount)} pending.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 px-0 pb-3">
              <div className="px-6">
                <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
                  {workOrderStatusChart}
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-8 text-xs">WO number</TableHead>
                      <TableHead className="h-8 text-xs">Plant</TableHead>
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
                          No work orders for this contractor.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedWoRows.map((r) => (
                        <TableRow key={r.work_order_id} className="text-sm">
                          <TableCell className="py-2">
                            <button
                              type="button"
                              className="font-mono text-xs font-medium text-primary hover:underline"
                              onClick={() => setSelectedWorkOrder(r)}
                            >
                              {r.work_order_number}
                            </button>
                          </TableCell>
                          <TableCell className="py-2">{r.plant_name}</TableCell>
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
                      <ChevronLeft className="size-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2"
                      disabled={woPageSafe >= woPageCount - 1}
                      onClick={() => setWoPage((p) => Math.min(woPageCount - 1, p + 1))}
                      aria-label="Next page"
                    >
                      <ChevronRight className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/*
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Work order analytics</CardTitle>
            <CardDescription>Execution pipeline, plant workload, and financial exposure. Pick one chart at a time.</CardDescription>
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
            <ChartSelector
              value={woChartView}
              options={WORK_ORDER_CHART_OPTIONS}
              onChange={(value) => setWoChartView(value as WorkOrderChartView)}
            />
            <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
              {workOrderChart}
            </div>
          </CardContent>
        </Card>
        */}

        {/*
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
              <div className="text-xs text-muted-foreground">Above / below should cost</div>
              <div>
                <span className="text-amber-900">{Number(commercial.pct_negotiations_above_base).toFixed(1)}%</span>
                <span className="text-muted-foreground"> / </span>
                <span className="text-emerald-800">{Number(commercial.pct_negotiations_below_base).toFixed(1)}%</span>
              </div>
            </div>
          </CardContent>
        </Card>
        */}
      </div>

      <Dialog open={selectedNegotiation != null} onOpenChange={(open) => !open && setSelectedNegotiation(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          {selectedNegotiation ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm sm:text-base">{selectedNegotiation.part_code}</span>
                  <span className="text-muted-foreground">·</span>
                  <span>{selectedNegotiation.part_name}</span>
                </DialogTitle>
                <DialogDescription>
                  {selectedNegotiation.rounds > 0
                    ? `Showing the latest negotiation snapshot from Round ${selectedNegotiation.rounds}.`
                    : "Showing the latest negotiation snapshot from the contractor dashboard."}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={rateStatusVariant(selectedNegotiation.status)}>
                      {rateStatusLabel(selectedNegotiation.status)}
                    </Badge>
                    {selectedNegotiation.rounds > 0 ? (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
                        Round {selectedNegotiation.rounds}
                      </span>
                    ) : null}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    Rate ID #{selectedNegotiation.contractor_rate_id}
                  </span>
                </div>

                <div className="rounded-2xl border bg-white p-4 sm:p-5">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <FactField label="Should cost" value={formatMoney(selectedNegotiation.base_rate)} />
                    <FactField
                      label="Initial ask"
                      value={selectedNegotiation.initial_rate != null ? formatMoney(selectedNegotiation.initial_rate) : "—"}
                    />
                    <FactField
                      label="Agreed rate"
                      value={formatMoney(selectedNegotiation.negotiated_rate)}
                      strong
                    />
                    <FactField
                      label="Negotiated down by"
                      value={
                        selectedNegotiation.savings_amount !== null && Number(selectedNegotiation.savings_amount) > 0
                          ? `${formatMoney(selectedNegotiation.savings_amount)} (${formatPercent(selectedNegotiation.savings_percentage)})`
                          : "—"
                      }
                      strong
                    />
                    <FactField label="Effective from" value={selectedNegotiation.effective_from} />
                    <FactField label="Effective to" value={selectedNegotiation.effective_to ?? "Open"} />
                  </div>

                  <div className="mt-5 space-y-1">
                    <p className="text-xs text-muted-foreground">Tolerance</p>
                    <VsBaseToleranceBadge
                      negotiated={selectedNegotiation.negotiated_rate}
                      baseRate={selectedNegotiation.base_rate}
                      className="w-fit"
                    />
                  </div>
                </div>

                {/* <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <FactField label="Should cost" value={formatMoney(selectedNegotiation.base_rate)} />
                  <FactField label="Negotiated rate" value={formatMoney(selectedNegotiation.negotiated_rate)} />
                  <FactField
                    label="Initial ask"
                    value={selectedNegotiation.initial_rate != null ? formatMoney(selectedNegotiation.initial_rate) : "—"}
                  />
                  <FactField
                    label="Savings amount"
                    value={selectedNegotiation.savings_amount != null ? formatMoney(selectedNegotiation.savings_amount) : "—"}
                  />
                  <FactField
                    label="Savings %"
                    value={
                      selectedNegotiation.savings_percentage != null
                        ? `${Number(selectedNegotiation.savings_percentage).toFixed(1)}%`
                        : "—"
                    }
                  />
                  <FactField label="Premium above base" value={formatMoney(selectedNegotiation.premium_above_base)} />
                  <FactField label="Rounds" value={selectedNegotiation.rounds} />
                  <FactField label="Effective from" value={selectedNegotiation.effective_from} />
                  <FactField
                    label="Effective to"
                    value={selectedNegotiation.effective_to ?? "Open"}
                  />
                </div> */}
              </div>

              {canOpenNegotiationPage ? (
                <DialogFooter>
                  <Button
                    type="button"
                    onClick={() => {
                      openNegotiationDetail(selectedNegotiation.contractor_rate_id)
                      setSelectedNegotiation(null)
                    }}
                  >
                    Open negotiation page
                  </Button>
                </DialogFooter>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <PartWorkOrderPreviewDialog
        open={selectedWorkOrder != null}
        onOpenChange={(open) => !open && setSelectedWorkOrder(null)}
        summaryRow={selectedWorkOrder}
      />
    </div>
  )
}
