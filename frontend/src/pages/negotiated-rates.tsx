import * as React from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import {
  Filter,
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ListPagination } from "@/components/shared/ListPagination"
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

const NEGOTIATION_PAGE_SIZE = 20

const RATE_STATUS_TABS: { id: RateStatusTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "pending_approval", label: "Pending Approval" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "cancelled", label: "Cancelled" },
]

function rateStatusTabFromQuery(value: string | null): RateStatusTab {
  return RATE_STATUS_TABS.some((tab) => tab.id === value) ? (value as RateStatusTab) : "all"
}

export function NegotiatedRatesPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [rows, setRows] = React.useState<ContractorRatePublic[] | null>(null)
  const [summary, setSummary] = React.useState<Summary | null>(null)
  const [orgScopes, setOrgScopes] = React.useState<OrgUnitLite[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [page, setPage] = React.useState(0)

  const [search, setSearch] = React.useState(() => searchParams.get("q") ?? "")
  const [statusTab, setStatusTab] = React.useState<RateStatusTab>(() => rateStatusTabFromQuery(searchParams.get("status")))
  const [scopeFilter, setScopeFilter] = React.useState<string>(() => searchParams.get("plant_id") ?? "all")

  const canView = canReadNegotiatedRates()
  const canCreate = hasPermission("contractor_rates.create") || isSuperuser()

  React.useEffect(() => {
    if (!canView) return
    void load(scopeFilter)
  }, [canView, scopeFilter])

  React.useEffect(() => {
    if (!canView) return
    if (canListOrgUnitsForAssignments()) void loadOrgScopes()
  }, [canView])

  React.useEffect(() => {
    const next = new URLSearchParams()
    if (statusTab !== "all") next.set("status", statusTab)
    if (search.trim()) next.set("q", search.trim())
    if (scopeFilter !== "all") next.set("plant_id", scopeFilter)
    setSearchParams(next, { replace: true })
  }, [scopeFilter, search, setSearchParams, statusTab])

  React.useEffect(() => {
    setPage(0)
  }, [search, scopeFilter, statusTab])

  async function load(scopeId: string) {
    setError(null)
    try {
      const params = new URLSearchParams()
      if (scopeId !== "all") params.set("org_unit_id", scopeId)
      const queryString = params.toString()
      const query = queryString ? `?${queryString}` : ""
      const [list, sum] = await Promise.all([
        getJson<ContractorRatePublic[]>(`/contractor-rates${query}`),
        getJson<Summary>(`/contractor-rates/summary${query}`),
      ])
      setRows(list)
      setSummary(sum)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load negotiations")
      setRows([])
      setSummary(null)
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

  const filtered = React.useMemo(() => {
    if (!rows) return []
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (statusTab !== "all" && r.status !== statusTab) return false
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
  }, [rows, search, statusTab])

  const totalRows = filtered.length
  const pageCount = Math.max(1, Math.ceil(totalRows / NEGOTIATION_PAGE_SIZE))
  const pageSafe = Math.min(page, pageCount - 1)
  const paginatedRows = React.useMemo(
    () =>
      filtered.slice(
        pageSafe * NEGOTIATION_PAGE_SIZE,
        pageSafe * NEGOTIATION_PAGE_SIZE + NEGOTIATION_PAGE_SIZE,
      ),
    [filtered, pageSafe],
  )

  const activeFilterCount = (statusTab !== "all" ? 1 : 0) + (scopeFilter !== "all" ? 1 : 0) + (search.trim() ? 1 : 0)

  const clusters = React.useMemo(
    () =>
      orgScopes
        .filter((o) => String(o.type).toUpperCase() === "CLUSTER")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [orgScopes],
  )

  const plants = React.useMemo(
    () =>
      orgScopes
        .filter((o) => String(o.type).toUpperCase() === "PLANT")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [orgScopes],
  )

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

      <Card className="rounded-2xl">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 opacity-60" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by contractor, part, plant or owner…"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Filter className="mr-2 size-4 opacity-70" aria-hidden />
                  Status
                  {statusTab !== "all" ? (
                    <span className="ml-2 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                      1
                    </span>
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {RATE_STATUS_TABS.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.id}
                    checked={statusTab === option.id}
                    onCheckedChange={() => setStatusTab(option.id)}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Plant
                  {scopeFilter !== "all" ? (
                    <span className="ml-2 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                      1
                    </span>
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-64 w-56 overflow-auto">
                <DropdownMenuLabel>Scope</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={scopeFilter === "all"} onCheckedChange={() => setScopeFilter("all")}>
                  All Plants & Clusters
                </DropdownMenuCheckboxItem>
                {clusters.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Clusters</DropdownMenuLabel>
                    {clusters.map((cluster) => (
                      <DropdownMenuCheckboxItem
                        key={cluster.id}
                        checked={scopeFilter === String(cluster.id)}
                        onCheckedChange={() => setScopeFilter(String(cluster.id))}
                      >
                        {cluster.name}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </>
                ) : null}
                {plants.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Plants</DropdownMenuLabel>
                    {plants.map((plant) => (
                      <DropdownMenuCheckboxItem
                        key={plant.id}
                        checked={scopeFilter === String(plant.id)}
                        onCheckedChange={() => setScopeFilter(String(plant.id))}
                      >
                        {plant.name}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>

            {activeFilterCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("")
                  setStatusTab("all")
                  setScopeFilter("all")
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Negotiations</CardTitle>
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
                paginatedRows.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/dashboard/negotiated-rates/${r.id}`)}
                  >
                    <TableCell>
                      <div className="truncate font-medium text-foreground" title={r.contractor_name ?? `Contractor ${r.contractor_id}`}>
                        {r.contractor_name ?? `Contractor #${r.contractor_id}`}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="truncate font-mono text-xs font-medium text-foreground" title={r.part_code ?? "—"}>
                        {r.part_code ?? "—"}
                      </div>
                    </TableCell>
                    <TableCell className="truncate" title={r.org_unit_name ?? "—"}>{r.org_unit_name ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatMoney(r.negotiated_rate)}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.savings_amount !== null ? (
                        <div className="font-medium">{formatMoney(r.savings_amount)}</div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{r.effective_from}</TableCell>
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
          {totalRows > 0 ? (
            <ListPagination
              page={pageSafe}
              pageSize={NEGOTIATION_PAGE_SIZE}
              total={totalRows}
              loading={rows === null}
              onPageChange={setPage}
            />
          ) : null}
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
          <div className="text-xs font-bold uppercase tracking-wide text-zinc-950">{title}</div>
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
