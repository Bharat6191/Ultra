import * as React from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, Equal, Handshake, History, Pencil, Plus, Power, Search } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, getJson, patchJson, postJson } from "@/lib/api"
import { canListOrgUnitsForAssignments, hasPermission, isSuperuser } from "@/lib/permissions"
import { formatMoney, formatPercent } from "@/components/contractors/rateStatus"
import { RateVersionHistoryButton } from "@/components/contractors/RateVersionHistoryDrawer"

type OrgUnitLite = { id: number; name: string; type: string }
type ContractorLite = { id: number; name: string }

type RateMasterPublic = {
  id: number
  job_type: string
  skill_type: string
  unit: string
  base_rate: number | string
  org_unit_id: number
  org_unit_name: string | null
  effective_from: string
  effective_to: string | null
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

type RateCardRow = {
  rate_master_id: number
  job_type: string
  skill_type: string
  unit: string
  org_unit_id: number
  org_unit_name: string | null
  base_rate: string
  base_rate_status: string
  base_rate_is_active: boolean
  base_rate_effective_from: string
  base_rate_effective_to: string | null
  notes: string | null
  contractor_id: number | null
  contractor_name: string | null
  contractor_rate_id: number | null
  contractor_rate: string | null
  previous_rate: string | null
  contractor_rate_status: string | null
  contractor_rate_effective_from: string | null
  contractor_rate_effective_to: string | null
  vs_base_amount: string | null
  vs_base_percentage: string | null
  vs_previous_amount: string | null
  vs_previous_percentage: string | null
}

type Benchmark = {
  total_rates: number
  active: number
  upcoming: number
  expired: number
  above_base: number
  below_base: number
  at_base: number
  total_premium_above_base: string
  total_savings_below_base: string
  rates_with_previous: number
  net_vs_previous: string
  net_vs_base: string
}

const SKILL_OPTIONS: { value: string; label: string }[] = [
  { value: "skilled", label: "Skilled" },
  { value: "semi_skilled", label: "Semi-skilled" },
  { value: "unskilled", label: "Unskilled" },
]

const UNIT_OPTIONS: { value: string; label: string }[] = [
  { value: "hour", label: "Hour" },
  { value: "day", label: "Day" },
  { value: "shift", label: "Shift" },
  { value: "job", label: "Job" },
  { value: "month", label: "Month" },
]

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"

type CreateForm = {
  job_type: string
  skill_type: string
  unit: string
  base_rate: string
  org_unit_id: string
  effective_from: string
  effective_to: string
  notes: string
}

const EMPTY_CREATE_FORM: CreateForm = {
  job_type: "",
  skill_type: "skilled",
  unit: "day",
  base_rate: "",
  org_unit_id: "",
  effective_from: new Date().toISOString().slice(0, 10),
  effective_to: "",
  notes: "",
}

type EditForm = {
  base_rate: string
  effective_from: string
  effective_to: string
  is_active: boolean
  notes: string
}

function statusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case "active":
      return "border-0 bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
    case "upcoming":
      return "border-0 bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200"
    case "expired":
      return "border-0 bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
    case "inactive":
      return "border-0 bg-slate-100 text-slate-700 dark:bg-slate-900/60 dark:text-slate-200"
    case "draft":
      return "border-0 bg-zinc-100 text-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100"
    case "pending_approval":
      return "border-0 bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
    case "rejected":
    case "cancelled":
      return "border-0 bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200"
    default:
      return ""
  }
}

function VarianceCell({ amount, percent }: { amount: string | null; percent: string | null }) {
  if (amount === null || percent === null) return <span className="text-muted-foreground">—</span>
  const amt = Number(amount)
  const isSaving = amt < 0
  const isPremium = amt > 0
  const Icon = isSaving ? ArrowDown : isPremium ? ArrowUp : Equal
  const cls = isSaving
    ? "text-emerald-700 dark:text-emerald-300"
    : isPremium
      ? "text-rose-700 dark:text-rose-300"
      : "text-muted-foreground"
  return (
    <span className={`inline-flex items-center gap-1 text-sm ${cls}`}>
      <Icon className="h-3.5 w-3.5" />
      <span className="tabular-nums">{formatMoney(amount)}</span>
      <span className="text-xs">({formatPercent(percent)})</span>
    </span>
  )
}

function ValidityBar({
  from,
  to,
  status,
}: {
  from: string | null | undefined
  to: string | null | undefined
  status: string | null | undefined
}) {
  const segs: Array<"past" | "active" | "future"> = ["past", "active", "future"]
  const highlight =
    status === "expired" ? "past" : status === "upcoming" ? "future" : "active"
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-2 w-24 overflow-hidden rounded-full border bg-muted">
        {segs.map((s) => (
          <div
            key={s}
            className={`flex-1 ${
              s === highlight
                ? s === "active"
                  ? "bg-emerald-500"
                  : s === "future"
                    ? "bg-sky-500"
                    : "bg-amber-500"
                : "bg-transparent"
            }`}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {from ?? "—"}
        {to ? ` → ${to}` : " → ∞"}
      </span>
    </div>
  )
}

export function RateMasterPage() {
  const [plants, setPlants] = React.useState<OrgUnitLite[]>([])
  const [contractors, setContractors] = React.useState<ContractorLite[]>([])
  const [cardRows, setCardRows] = React.useState<RateCardRow[] | null>(null)
  const [benchmark, setBenchmark] = React.useState<Benchmark | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [cardLoading, setCardLoading] = React.useState(false)

  const [search, setSearch] = React.useState("")
  const [skillFilter, setSkillFilter] = React.useState<string>("all")
  const [plantFilter, setPlantFilter] = React.useState<string>("all")
  const [contractorFilter, setContractorFilter] = React.useState<string>("all")
  const [statusFilter, setStatusFilter] = React.useState<"all" | "active" | "inactive">("all")

  const [createOpen, setCreateOpen] = React.useState(false)
  const [createForm, setCreateForm] = React.useState<CreateForm>(EMPTY_CREATE_FORM)
  const [creating, setCreating] = React.useState(false)

  const [editId, setEditId] = React.useState<number | null>(null)
  const [editForm, setEditForm] = React.useState<EditForm | null>(null)
  const [savingEdit, setSavingEdit] = React.useState(false)

  const canView = hasPermission("rate_master.view") || isSuperuser()
  const canCreate = hasPermission("rate_master.create") || isSuperuser()
  const canUpdate = hasPermission("rate_master.update") || isSuperuser()
  const canLoadPlantList = canListOrgUnitsForAssignments()

  React.useEffect(() => {
    if (!canView) return
    void (async () => {
      if (canLoadPlantList) {
        try {
          const list = await getJson<OrgUnitLite[]>("/admin/org-units?type=PLANT")
          setPlants(list)
        } catch {
          setPlants([])
        }
      }
      try {
        const c = await getJson<{ id: number; name: string }[]>(
          "/contractors?limit=200&status=active",
        )
        setContractors(c.map((x) => ({ id: x.id, name: x.name })))
      } catch {
        setContractors([])
      }
    })()
  }, [canView, canLoadPlantList])

  const loadCardData = React.useCallback(async () => {
    setCardLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (plantFilter !== "all") params.set("plant_id", plantFilter)
    if (contractorFilter !== "all") params.set("contractor_id", contractorFilter)
    if (search.trim()) params.set("job_type", search.trim())
    if (skillFilter !== "all") params.set("skill_type", skillFilter)
    params.set("active_base_only", statusFilter === "active" ? "true" : "false")
    const qs = params.toString()
    try {
      const [data, kpis] = await Promise.all([
        getJson<RateCardRow[]>(`/rate-card${qs ? `?${qs}` : ""}`),
        getJson<Benchmark>(`/rate-card/benchmark${qs ? `?${qs}` : ""}`),
      ])
      setCardRows(data)
      setBenchmark(kpis)
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to load rates"
      setError(msg)
      setCardRows([])
      setBenchmark(null)
    } finally {
      setCardLoading(false)
    }
  }, [plantFilter, contractorFilter, search, skillFilter, statusFilter])

  React.useEffect(() => {
    if (!canView) return
    void loadCardData()
  }, [canView, loadCardData])

  const displayed = React.useMemo(() => {
    if (!cardRows) return []
    if (statusFilter === "inactive") {
      return cardRows.filter((r) => r.base_rate_status === "inactive")
    }
    return cardRows
  }, [cardRows, statusFilter])

  const summary = React.useMemo(() => {
    if (!displayed.length) return { total: 0, activeFlag: 0, plants: 0 }
    const plantIds = new Set<number>()
    let activeFlag = 0
    for (const r of displayed) {
      plantIds.add(r.org_unit_id)
      if (r.base_rate_is_active) activeFlag += 1
    }
    return { total: displayed.length, activeFlag, plants: plantIds.size }
  }, [displayed])

  async function createRate() {
    if (!createForm.job_type.trim()) {
      toast.error("Job type is required.")
      return
    }
    if (!createForm.base_rate) {
      toast.error("Base rate is required.")
      return
    }
    if (!createForm.org_unit_id) {
      toast.error("Plant is required.")
      return
    }
    setCreating(true)
    toast.loading("Creating rate…", { id: "create-rate-master" })
    try {
      await postJson<RateMasterPublic>("/rate-master", {
        job_type: createForm.job_type.trim(),
        skill_type: createForm.skill_type,
        unit: createForm.unit,
        base_rate: createForm.base_rate,
        org_unit_id: Number(createForm.org_unit_id),
        effective_from: createForm.effective_from,
        effective_to: createForm.effective_to || null,
        notes: createForm.notes.trim() || null,
      })
      toast.success("Base rate created", { id: "create-rate-master" })
      setCreateOpen(false)
      setCreateForm(EMPTY_CREATE_FORM)
      await loadCardData()
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to create"
      toast.error(msg, { id: "create-rate-master" })
    } finally {
      setCreating(false)
    }
  }

  function startEdit(row: RateCardRow) {
    setEditId(row.rate_master_id)
    setEditForm({
      base_rate: String(row.base_rate),
      effective_from: row.base_rate_effective_from,
      effective_to: row.base_rate_effective_to ?? "",
      is_active: row.base_rate_is_active,
      notes: row.notes ?? "",
    })
  }

  async function saveEdit() {
    if (editId === null || !editForm) return
    setSavingEdit(true)
    toast.loading("Saving…", { id: "edit-rate-master" })
    try {
      await patchJson<RateMasterPublic>(`/rate-master/${editId}`, {
        base_rate: editForm.base_rate || null,
        effective_from: editForm.effective_from || null,
        effective_to: editForm.effective_to || null,
        is_active: editForm.is_active,
        notes: editForm.notes.trim() || null,
      })
      toast.success("Saved", { id: "edit-rate-master" })
      setEditId(null)
      setEditForm(null)
      await loadCardData()
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to save"
      toast.error(msg, { id: "edit-rate-master" })
    } finally {
      setSavingEdit(false)
    }
  }

  async function toggleActive(row: RateCardRow) {
    try {
      await patchJson<RateMasterPublic>(`/rate-master/${row.rate_master_id}`, {
        is_active: !row.base_rate_is_active,
      })
      toast.success(row.base_rate_is_active ? "Deactivated" : "Activated")
      await loadCardData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to toggle")
    }
  }

  if (!canView) {
    return (
      <Alert>
        <AlertTitle>Permission required</AlertTitle>
        <AlertDescription>
          You need <span className="font-mono">rate_master.view</span> to access this page.
        </AlertDescription>
      </Alert>
    )
  }

  const tableNote =
    contractorFilter === "all"
      ? "Pick a contractor to see negotiated rates, variance and benchmark KPIs for that vendor."
      : "Variance is negotiated rate vs base / previous approved rate. Negative = saving vs base."

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium">Rate master</h2>
          <p className="text-sm text-muted-foreground">
            Base rates per job, skill, unit and plant — with optional contractor comparison and
            benchmarks on the same grid.
          </p>
        </div>
        {canCreate ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> New base rate
            </Button>
            <Button variant="outline" asChild>
              <Link to="/dashboard/negotiated-rates">
                <Handshake className="size-4" /> Negotiated rates
              </Link>
            </Button>
          </div>
        ) : (
          <Button variant="outline" asChild>
            <Link to="/dashboard/negotiated-rates">
              <Handshake className="size-4" /> Negotiated rates
            </Link>
          </Button>
        )}
      </div>

      <Alert>
        <AlertTitle>How to use this screen</AlertTitle>
        <AlertDescription className="space-y-2 text-sm">
          <p>
            <strong>Step 1 — Base rate:</strong> Use <strong>New base rate</strong> (needs{" "}
            <span className="font-mono text-xs">rate_master.create</span>). These rows are the standard
            prices per job, skill, unit and plant.
          </p>
          <p>
            <strong>Step 2 — Negotiation:</strong> Open{" "}
            <Link to="/dashboard/negotiated-rates" className="font-medium underline underline-offset-2">
              Negotiated rates
            </Link>{" "}
            and click <strong>New negotiation</strong>, or open a contractor → <strong>Rates</strong> tab (
            needs <span className="font-mono text-xs">contractor_rates.create</span>). Pick the same base
            rate row here in the grid to compare vendor price vs baseline when you choose a contractor
            above.
          </p>
        </AlertDescription>
      </Alert>

      {/* Base-rate KPIs */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Rows (filtered)</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight">{summary.total}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Active base rows</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight">{summary.activeFlag}</div>
            </div>
            <Badge variant="success">
              {summary.total ? Math.round((summary.activeFlag / summary.total) * 100) : 0}%
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Plants (filtered)</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight">{summary.plants}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Contractor benchmark KPIs — meaningful when a contractor is selected */}
      {benchmark && contractorFilter !== "all" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Contractor rates (filtered)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{benchmark.active}</div>
              <div className="text-xs text-muted-foreground">
                {benchmark.upcoming} upcoming · {benchmark.expired} expired
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Below base
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                {benchmark.below_base}
              </div>
              <div className="text-xs text-muted-foreground">
                Saving {formatMoney(benchmark.total_savings_below_base)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Above base
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums text-rose-700 dark:text-rose-300">
                {benchmark.above_base}
              </div>
              <div className="text-xs text-muted-foreground">
                Premium {formatMoney(benchmark.total_premium_above_base)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Net vs base
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-semibold tabular-nums ${
                  Number(benchmark.net_vs_base) < 0
                    ? "text-emerald-700 dark:text-emerald-300"
                    : Number(benchmark.net_vs_base) > 0
                      ? "text-rose-700 dark:text-rose-300"
                      : ""
                }`}
              >
                {formatMoney(benchmark.net_vs_base)}
              </div>
              <div className="text-xs text-muted-foreground">
                {benchmark.rates_with_previous} vs prev. ({formatMoney(benchmark.net_vs_previous)})
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load rates</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Filters */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Filters</CardTitle>
          <CardDescription>
            Job search maps to job type (partial match). Pick a contractor to load negotiated rates and
            benchmarks.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div className="relative xl:col-span-2">
            <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Job type (partial match)…"
              className="pl-8"
            />
          </div>
          <select
            className={SELECT_CLASS}
            value={skillFilter}
            onChange={(e) => setSkillFilter(e.target.value)}
          >
            <option value="all">All skills</option>
            {SKILL_OPTIONS.map((s) => (
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
          <select
            className={SELECT_CLASS}
            value={contractorFilter}
            onChange={(e) => setContractorFilter(e.target.value)}
          >
            <option value="all">Contractor — base only</option>
            {contractors.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            className={SELECT_CLASS}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="all">All base rows</option>
            <option value="active">Active base only</option>
            <option value="inactive">Inactive base only</option>
          </select>
        </CardContent>
      </Card>

      {/* Unified table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Rates</CardTitle>
          <CardDescription>{tableNote}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Skill</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Plant</TableHead>
                <TableHead className="text-right">Base rate</TableHead>
                <TableHead className="text-right">Contractor rate</TableHead>
                <TableHead className="text-right">Previous</TableHead>
                <TableHead>vs Base</TableHead>
                <TableHead>vs Prev</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Validity</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cardLoading && !cardRows ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-sm text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : displayed.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-sm text-muted-foreground">
                    No rates match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                displayed.map((r) => {
                  const status = r.contractor_rate_status ?? r.base_rate_status
                  const showActiveBadge = r.contractor_rate_status === "active"
                  return (
                    <TableRow key={r.rate_master_id}>
                      <TableCell className="font-medium">{r.job_type}</TableCell>
                      <TableCell className="capitalize">{r.skill_type.replace(/_/g, " ")}</TableCell>
                      <TableCell className="capitalize">{r.unit}</TableCell>
                      <TableCell>{r.org_unit_name ?? `Plant #${r.org_unit_id}`}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(r.base_rate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.contractor_rate !== null ? (
                          <span className="inline-flex items-center justify-end gap-1.5">
                            {formatMoney(r.contractor_rate)}
                            {showActiveBadge ? (
                              <Badge className="rounded-md border-0 bg-emerald-600 text-[10px] text-white">
                                Active
                              </Badge>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.previous_rate !== null ? (
                          formatMoney(r.previous_rate)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <VarianceCell amount={r.vs_base_amount} percent={r.vs_base_percentage} />
                      </TableCell>
                      <TableCell>
                        <VarianceCell amount={r.vs_previous_amount} percent={r.vs_previous_percentage} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant="outline" className={`w-fit rounded-md ${statusBadgeClass(status)}`}>
                            {status ? status.replace(/_/g, " ") : "—"}
                          </Badge>
                          {!r.base_rate_is_active ? (
                            <span className="text-[10px] text-muted-foreground">Base inactive</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <ValidityBar
                          from={r.contractor_rate_effective_from ?? r.base_rate_effective_from}
                          to={r.contractor_rate_effective_to ?? r.base_rate_effective_to}
                          status={status}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <RateVersionHistoryButton
                            resource="rate-master"
                            parentId={r.rate_master_id}
                            title={`${r.job_type} (${r.skill_type})`}
                            subtitle={`${r.org_unit_name ?? `Plant #${r.org_unit_id}`} · ${r.unit}`}
                            label="History"
                          />
                          {canUpdate ? (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => startEdit(r)}>
                                <Pencil className="size-3.5" /> Edit
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => void toggleActive(r)}>
                                <Power className="size-3.5" />
                                {r.base_rate_is_active ? " Off" : " On"}
                              </Button>
                            </>
                          ) : null}
                          {r.contractor_rate_id ? (
                            <Button asChild variant="ghost" size="sm">
                              <Link to={`/dashboard/negotiated-rates/${r.contractor_rate_id}`}>
                                <History className="mr-1 size-3.5" />
                                Open
                              </Link>
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New base rate</DialogTitle>
            <DialogDescription>
              Each (job, skill, unit, plant, effective_from) combination must be unique.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Job type</Label>
              <Input
                value={createForm.job_type}
                onChange={(e) => setCreateForm((f) => ({ ...f, job_type: e.target.value }))}
                placeholder="e.g. Welder, Painter"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Skill</Label>
              <select
                className={SELECT_CLASS}
                value={createForm.skill_type}
                onChange={(e) => setCreateForm((f) => ({ ...f, skill_type: e.target.value }))}
              >
                {SKILL_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>Unit</Label>
              <select
                className={SELECT_CLASS}
                value={createForm.unit}
                onChange={(e) => setCreateForm((f) => ({ ...f, unit: e.target.value }))}
              >
                {UNIT_OPTIONS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>Plant</Label>
              <select
                className={SELECT_CLASS}
                value={createForm.org_unit_id}
                onChange={(e) => setCreateForm((f) => ({ ...f, org_unit_id: e.target.value }))}
              >
                <option value="">Pick a plant…</option>
                {plants.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>Base rate (₹)</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={createForm.base_rate}
                onChange={(e) => setCreateForm((f) => ({ ...f, base_rate: e.target.value }))}
                placeholder="500.00"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Effective from</Label>
              <Input
                type="date"
                value={createForm.effective_from}
                onChange={(e) => setCreateForm((f) => ({ ...f, effective_from: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Effective to (optional)</Label>
              <Input
                type="date"
                value={createForm.effective_to}
                onChange={(e) => setCreateForm((f) => ({ ...f, effective_to: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={createForm.notes}
                onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={() => void createRate()} disabled={creating}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={editId !== null}
        onOpenChange={(o) => {
          if (!o) {
            setEditId(null)
            setEditForm(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit base rate #{editId ?? ""}</DialogTitle>
            <DialogDescription>
              Job, skill, unit, and plant are immutable. Updates create a new version snapshot for audit.
            </DialogDescription>
          </DialogHeader>
          {editForm ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Base rate (₹)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={editForm.base_rate}
                  onChange={(e) => setEditForm((f) => (f ? { ...f, base_rate: e.target.value } : f))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Effective from</Label>
                <Input
                  type="date"
                  value={editForm.effective_from}
                  onChange={(e) =>
                    setEditForm((f) => (f ? { ...f, effective_from: e.target.value } : f))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Effective to</Label>
                <Input
                  type="date"
                  value={editForm.effective_to}
                  onChange={(e) =>
                    setEditForm((f) => (f ? { ...f, effective_to: e.target.value } : f))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Active</Label>
                <div className="flex h-9 items-center gap-2 rounded-md border bg-background px-3">
                  <Switch
                    checked={editForm.is_active}
                    onCheckedChange={(v) =>
                      setEditForm((f) => (f ? { ...f, is_active: Boolean(v) } : f))
                    }
                  />
                  <span className="text-xs text-muted-foreground">
                    {editForm.is_active ? "Active base row" : "Inactive"}
                  </span>
                </div>
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Notes</Label>
                <Textarea
                  rows={2}
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => (f ? { ...f, notes: e.target.value } : f))}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditId(null)
                setEditForm(null)
              }}
              disabled={savingEdit}
            >
              Cancel
            </Button>
            <Button onClick={() => void saveEdit()} disabled={savingEdit}>
              {savingEdit ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default RateMasterPage
