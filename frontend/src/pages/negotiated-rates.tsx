import * as React from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import {
  Hourglass,
  MessagesSquare,
  Plus,
  Search,
} from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getJson } from "@/lib/api"
import {
  canListOrgUnitsForAssignments,
  canReadNegotiatedRates,
  hasPermission,
  isSuperuser,
} from "@/lib/permissions"
import type { ContractorRateStatus } from "@/components/contractors/rateStatus"
import {
  formatMoney,
  formatPercent,
  rateStatusLabel,
  rateStatusVariant,
} from "@/components/contractors/rateStatus"
type ContractorRatePublic = {
  id: number
  contractor_id: number
  contractor_name: string | null
  part_master_id: number
  part_code: string | null
  part_name: string | null
  unit_type: string | null
  pricing_method: string | null
  org_unit_id: number | null
  org_unit_name: string | null
  base_rate: number | string | null
  negotiated_rate: number | string
  previous_rate: number | string | null
  savings_amount: number | string | null
  savings_percentage: number | string | null
  effective_from: string
  effective_to: string | null
  status: string
  current_round: number
  approval_request_id: number | null
  created_by_name: string | null
  created_at: string
  updated_at: string
}

type Summary = {
  total_negotiations: number
  pending_approvals: number
  approved: number
  rejected: number
  /** Negotiation savings — anchored on the contractor's initial ask (always >= 0). */
  total_savings: number | string
  avg_savings_percentage: number | string
  /** Vs-base KPIs — surfaced separately so contractor-driven price increases
   *  remain visible without poisoning the negotiation-savings figure. */
  total_premium_above_base?: number | string
  total_below_base_savings?: number | string
  approved_above_base?: number
  approved_below_base?: number
  approved_at_base?: number
  by_status?: Record<string, number>
}

type OrgUnitLite = { id: number; name: string; type: string; parent_id: number | null }

type RateStatusTab = "all" | ContractorRateStatus

const RATE_STATUS_TABS: { id: RateStatusTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "pending_approval", label: "Pending Approval" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
]

function rateStatusTabFromQuery(value: string | null): RateStatusTab {
  return RATE_STATUS_TABS.some((tab) => tab.id === value) ? (value as RateStatusTab) : "all"
}

/** Client-side mirror of cluster → plant expansion for table filters. */
function plantIdsUnderScope(rows: OrgUnitLite[], scopeId: number): number[] {
  const root = rows.find((r) => r.id === scopeId)
  if (!root) return []
  const t = String(root.type).toUpperCase()
  if (t === "PLANT") return [scopeId]
  if (t !== "CLUSTER") return []
  const out = new Set<number>()
  const queue = [scopeId]
  while (queue.length) {
    const cur = queue.shift()!
    for (const row of rows) {
      if (row.parent_id !== cur) continue
      const rt = String(row.type).toUpperCase()
      if (rt === "PLANT") out.add(row.id)
      else if (rt === "CLUSTER") queue.push(row.id)
    }
  }
  return [...out]
}

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"

export function NegotiatedRatesPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [rows, setRows] = React.useState<ContractorRatePublic[] | null>(null)
  const [summary, setSummary] = React.useState<Summary | null>(null)
  const [orgScopes, setOrgScopes] = React.useState<OrgUnitLite[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  const [search, setSearch] = React.useState("")
  const [statusTab, setStatusTab] = React.useState<RateStatusTab>(() => rateStatusTabFromQuery(searchParams.get("status")))
  const [plantFilter, setPlantFilter] = React.useState<string>("all")

  const canView = canReadNegotiatedRates()
  const canCreate = hasPermission("contractor_rates.create") || isSuperuser()

  React.useEffect(() => {
    if (!canView) return
    void load()
    if (canListOrgUnitsForAssignments()) void loadOrgScopes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    const next = new URLSearchParams()
    if (statusTab !== "all") next.set("status", statusTab)
    setSearchParams(next, { replace: true })
  }, [setSearchParams, statusTab])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [list, sum] = await Promise.all([
        getJson<ContractorRatePublic[]>("/contractor-rates"),
        getJson<Summary>("/contractor-rates/summary"),
      ])
      setRows(list)
      setSummary(sum)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load negotiations")
      setRows([])
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }

  async function loadOrgScopes() {
    try {
      const [clusters, plants] = await Promise.all([
        getJson<OrgUnitLite[]>("/admin/org-units?type=CLUSTER").catch(() => []),
        getJson<OrgUnitLite[]>("/admin/org-units?type=PLANT").catch(() => []),
      ])
      setOrgScopes([...(Array.isArray(clusters) ? clusters : []), ...(Array.isArray(plants) ? plants : [])])
    } catch {
      setOrgScopes([])
    }
  }

  const statusCounts = React.useMemo(() => {
    const m = new Map<string, number>()
    if (!rows) return m
    for (const r of rows) {
      const k = String(r.status ?? "")
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [rows])

  const filtered = React.useMemo(() => {
    if (!rows) return []
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (statusTab !== "all" && r.status !== statusTab) return false
      if (plantFilter !== "all") {
        const sid = Number(plantFilter)
        const allowed = new Set(plantIdsUnderScope(orgScopes, sid))
        if (!allowed.has(Number(r.org_unit_id ?? 0))) return false
      }
      if (q) {
        const hay = [
          r.contractor_name ?? "",
          r.part_code ?? "",
          r.part_name ?? "",
          r.org_unit_name ?? "",
          r.created_by_name ?? "",
        ]
          .join(" ")
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, search, statusTab, plantFilter, orgScopes])

  if (!canView) {
    return (
      <Alert>
        <AlertTitle>Permission required</AlertTitle>
        <AlertDescription>
          You need <span className="font-mono">contractor_rates.view</span> or{" "}
          <span className="font-mono">contractor_rates.approve</span> to access this page.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Negotiation"
        action={
          canCreate ? (
            <Button asChild type="button">
              <Link to="/dashboard/negotiated-rates/new">
                <Plus className="size-4" /> New Negotiation
              </Link>
            </Button>
          ) : null
        }
      />

      {/* KPIs — only the lifecycle counters remain. The "savings"
          aggregates (negotiation savings, avg savings %, premium vs base)
          were intentionally removed: with contractors typically negotiating
          UP from the procurement baseline, those aggregate figures were
          either misleading or required too much context to interpret on a
          glance. The per-rate detail page still surfaces savings inline. */}
      {summary ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title="Total negotiations"
            value={summary.total_negotiations}
            icon={<MessagesSquare className="size-4" />}
          />
          <KpiCard
            title="Pending Approvals"
            value={summary.pending_approvals}
            icon={<Hourglass className="size-4" />}
            tone="warning"
          />
          <KpiCard
            title="Approved"
            value={summary.approved}
            icon={<MessagesSquare className="size-4" />}
            tone="success"
          />
          <KpiCard
            title="Rejected"
            value={summary.rejected}
            icon={<MessagesSquare className="size-4" />}
            tone="neutral"
          />
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load negotiations</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Refine by plant / text (lifecycle uses tabs on the table card). */}
      <Card>
        <CardHeader className="pb-2">
          {/* <CardTitle className="text-sm font-medium">Refine List</CardTitle> */}
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contractor, part, plant…"
              className="pl-8"
            />
          </div>
          <select
            className={SELECT_CLASS}
            value={plantFilter}
            onChange={(e) => setPlantFilter(e.target.value)}
          >
            <option value="all">All Plants & Clusters</option>
            <optgroup label="Clusters">
              {orgScopes
                .filter((o) => String(o.type).toUpperCase() === "CLUSTER")
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Plants">
              {orgScopes
                .filter((o) => String(o.type).toUpperCase() === "PLANT")
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
            </optgroup>
          </select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Negotiations</CardTitle>
          {/* <CardDescription>
            Pick a lifecycle tab to focus the table; search and plant filters still apply on top of the tab.
          </CardDescription> */}
          <div className="mt-3 flex flex-wrap gap-2">
            {RATE_STATUS_TABS.map((t) => {
              const n = t.id === "all" ? (rows?.length ?? 0) : (statusCounts.get(t.id) ?? 0)
              return (
                <Button
                  key={t.id}
                  type="button"
                  size="sm"
                  variant={statusTab === t.id ? "default" : "outline"}
                  className="h-8"
                  onClick={() => setStatusTab(t.id)}
                >
                  {t.label}
                  <span
                    className={
                      statusTab === t.id
                        ? "ml-1.5 tabular-nums text-primary-foreground/85"
                        : "ml-1.5 tabular-nums text-muted-foreground"
                    }
                  >
                    {loading ? "(Loading...)" : `(${n})`}
                  </span>
                </Button>
              )
            })}
          </div>
        </CardHeader>
        <CardContent className="p-0 border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contractor</TableHead>
                <TableHead>Part</TableHead>
                <TableHead>Plant</TableHead>
                <TableHead className="text-right">Negotiated</TableHead>
                <TableHead className="text-right">Savings</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Status</TableHead>
                {/* <TableHead className="text-right">Open</TableHead> */}
              </TableRow>
            </TableHeader>
            <TableBody>
              {!rows ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    No negotiations match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/dashboard/negotiated-rates/${r.id}`)}
                  >
                    <TableCell>
                      <div className="font-medium text-foreground">
                        {r.contractor_name ?? `Contractor #${r.contractor_id}`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Round {r.current_round}
                        {r.created_by_name ? ` · by ${r.created_by_name}` : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-xs font-medium text-foreground">{r.part_code ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.part_name ?? "—"}</div>
                      <div className="text-[11px] capitalize text-muted-foreground">
                        {(r.pricing_method ?? "").replace(/_/g, " ") || "—"} · {r.unit_type ?? "—"}
                      </div>
                    </TableCell>
                    <TableCell>{r.org_unit_name ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatMoney(r.negotiated_rate)}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.savings_amount !== null ? (
                        <div>
                          <div className="font-medium">{formatMoney(r.savings_amount)}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatPercent(r.savings_percentage)}
                          </div>
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>{r.effective_from}</div>
                      <div className="text-muted-foreground">
                        {r.effective_to ? `→ ${r.effective_to}` : "→ open"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={rateStatusVariant(r.status)}>
                        {rateStatusLabel(r.status)}
                      </Badge>
                    </TableCell>
                    {/* <TableCell className="text-right">
                      <Button asChild size="sm" variant="ghost">
                        <Link to={`/dashboard/negotiated-rates/${r.id}`}>
                          Open
                        </Link>
                      </Button>
                    </TableCell> */}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

    </div>
  )
}


function KpiCard({
  title,
  subtitle,
  value,
  icon,
  tone,
}: {
  title: string
  subtitle?: string
  value: React.ReactNode
  icon?: React.ReactNode
  tone?: "success" | "warning" | "info" | "neutral"
}) {
  const toneClasses: Record<string, string> = {
    success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    warning: "bg-amber-50 text-amber-700 ring-amber-200",
    info: "bg-sky-50 text-sky-700 ring-sky-200",
    neutral: "bg-gray-50 text-gray-600 ring-gray-200",
  }
  const cls = toneClasses[tone ?? "neutral"]
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
          {subtitle ? (
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle}</div>
          ) : null}
        </div>
        {icon ? (
          <span className={`grid size-9 place-items-center rounded-xl ring-2 ${cls}`}>{icon}</span>
        ) : null}
      </CardContent>
    </Card>
  )
}

export default NegotiatedRatesPage
