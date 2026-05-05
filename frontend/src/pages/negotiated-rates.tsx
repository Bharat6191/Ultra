import * as React from "react"
import { Link } from "react-router-dom"
import {
  ChevronRight,
  Hourglass,
  MessagesSquare,
  Plus,
  Search,
} from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError, getJson, postJson } from "@/lib/api"
import { canListOrgUnitsForAssignments, hasPermission, isSuperuser } from "@/lib/permissions"
import {
  CONTRACTOR_RATE_STATUS_OPTIONS,
  formatMoney,
  formatPercent,
  rateStatusLabel,
  rateStatusVariant,
} from "@/components/contractors/rateStatus"
import {
  NewNegotiationDialog,
  type RateMasterPick,
  type NewRateForm,
} from "@/components/contractors/ContractorRateDialog"

type ContractorRatePublic = {
  id: number
  contractor_id: number
  contractor_name: string | null
  rate_master_id: number
  job_type: string | null
  skill_type: string | null
  unit: string | null
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

type OrgUnitLite = { id: number; name: string }

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"

export function NegotiatedRatesPage() {
  const [rows, setRows] = React.useState<ContractorRatePublic[] | null>(null)
  const [summary, setSummary] = React.useState<Summary | null>(null)
  const [plants, setPlants] = React.useState<OrgUnitLite[]>([])
  const [error, setError] = React.useState<string | null>(null)

  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<string>("all")
  const [plantFilter, setPlantFilter] = React.useState<string>("all")

  const [newOpen, setNewOpen] = React.useState(false)
  const [newSaving, setNewSaving] = React.useState(false)
  const [newError, setNewError] = React.useState<string | null>(null)
  const [pickerContractors, setPickerContractors] = React.useState<{ id: number; name: string }[]>(
    [],
  )
  const [pickerRateMasters, setPickerRateMasters] = React.useState<RateMasterPick[]>([])

  const canView = hasPermission("contractor_rates.view") || isSuperuser()
  const canCreate = hasPermission("contractor_rates.create") || isSuperuser()

  React.useEffect(() => {
    if (!canView) return
    void load()
    if (canListOrgUnitsForAssignments()) void loadPlants()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
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
    }
  }

  async function loadPlants() {
    try {
      const list = await getJson<OrgUnitLite[]>("/admin/org-units?type=PLANT")
      setPlants(list)
    } catch {
      setPlants([])
    }
  }

  const filtered = React.useMemo(() => {
    if (!rows) return []
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false
      if (plantFilter !== "all" && String(r.org_unit_id ?? "") !== plantFilter) return false
      if (q) {
        const hay = [
          r.contractor_name ?? "",
          r.job_type ?? "",
          r.skill_type ?? "",
          r.org_unit_name ?? "",
          r.created_by_name ?? "",
        ]
          .join(" ")
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, search, statusFilter, plantFilter])

  React.useEffect(() => {
    if (!newOpen || !canCreate) return
    void (async () => {
      setNewError(null)
      try {
        const [clist, raws] = await Promise.all([
          getJson<{ id: number; name: string }[]>("/contractors?limit=200&status=active"),
          getJson<
            {
              id: number
              job_type: string
              skill_type: string
              unit: string
              base_rate: number | string
              org_unit_id: number
              org_unit_name: string | null
            }[]
          >("/rate-master?active=true").catch(() => []),
        ])
        setPickerContractors(clist)
        setPickerRateMasters(
          raws.map((rm) => ({
            id: rm.id,
            job_type: rm.job_type,
            skill_type: rm.skill_type,
            unit: rm.unit,
            base_rate: rm.base_rate,
            org_unit_id: rm.org_unit_id,
            org_unit_name: rm.org_unit_name,
          })),
        )
      } catch (e) {
        setNewError(e instanceof Error ? e.message : "Failed to load picker data")
      }
    })()
  }, [newOpen, canCreate])

  async function createNegotiationFromHub(form: NewRateForm, ctx: { contractorId: number }) {
    if (form.rate_master_id === null) return
    setNewSaving(true)
    setNewError(null)
    try {
      await postJson<ContractorRatePublic>("/contractor-rates", {
        contractor_id: ctx.contractorId,
        rate_master_id: form.rate_master_id,
        negotiated_rate: form.negotiated_rate,
        initial_rate: form.initial_rate.trim() ? form.initial_rate : null,
        effective_from: form.effective_from,
        effective_to: form.effective_to || null,
        remarks: form.remarks || null,
      })
      toast.success("Draft negotiation created")
      setNewOpen(false)
      await load()
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to create draft"
      setNewError(msg)
    } finally {
      setNewSaving(false)
    }
  }

  if (!canView) {
    return (
      <Alert>
        <AlertTitle>Permission required</AlertTitle>
        <AlertDescription>
          You need <span className="font-mono">contractor_rates.view</span> to access this page.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium">Negotiated rates</h2>
          <p className="text-sm text-muted-foreground">
            Workspace-wide view of every contractor negotiation: filter by status, plant, or
            contractor and click a row to open the full negotiation timeline.
          </p>
        </div>
        {canCreate ? (
          <Button type="button" onClick={() => setNewOpen(true)}>
            <Plus className="size-4" /> New negotiation
          </Button>
        ) : null}
      </div>

      <Alert>
        <AlertTitle>How rates fit together</AlertTitle>
        <AlertDescription className="space-y-2 text-sm">
          <p>
            <strong>Base rates</strong> live under{" "}
            <Link to="/dashboard/rate-master" className="font-medium underline underline-offset-2">
              Rate master
            </Link>
            — one row per job, skill, unit and plant. You need{" "}
            <span className="font-mono text-xs">rate_master.create</span> to add them.
          </p>
          <p>
            <strong>Negotiations</strong> attach a contractor to a base rate. Use{" "}
            <strong>New negotiation</strong> here, or open any contractor →{" "}
            <strong>Rates</strong> tab. You need{" "}
            <span className="font-mono text-xs">contractor_rates.create</span>.
          </p>
        </AlertDescription>
      </Alert>

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
            title="Pending approvals"
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

      {/* Filters */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contractor, job, plant…"
              className="pl-8"
            />
          </div>
          <select
            className={SELECT_CLASS}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            {CONTRACTOR_RATE_STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            className={SELECT_CLASS}
            value={plantFilter}
            onChange={(e) => setPlantFilter(e.target.value)}
          >
            <option value="all">All plants</option>
            {plants.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.name}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contractor</TableHead>
                <TableHead>Job · Skill</TableHead>
                <TableHead>Plant</TableHead>
                <TableHead className="text-right">Negotiated</TableHead>
                <TableHead className="text-right">Savings</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!rows ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    No negotiations match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
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
                      <div className="font-medium text-foreground">{r.job_type ?? "—"}</div>
                      <div className="text-xs capitalize text-muted-foreground">
                        {(r.skill_type ?? "").replace(/_/g, " ") || "—"}
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
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="ghost">
                        <Link to={`/dashboard/negotiated-rates/${r.id}`}>
                          Open <ChevronRight className="size-3.5" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <NewNegotiationDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        contractorChoices={pickerContractors}
        rateMasters={pickerRateMasters}
        saving={newSaving}
        error={newError}
        onSave={createNegotiationFromHub}
      />
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
