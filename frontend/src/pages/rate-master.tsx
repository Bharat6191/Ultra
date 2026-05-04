import * as React from "react"
import { toast } from "sonner"
import { Pencil, Plus, Power, Search } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { formatMoney } from "@/components/contractors/rateStatus"

type OrgUnitLite = { id: number; name: string; type: string }

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

export function RateMasterPage() {
  const [rows, setRows] = React.useState<RateMasterPublic[] | null>(null)
  const [plants, setPlants] = React.useState<OrgUnitLite[]>([])
  const [error, setError] = React.useState<string | null>(null)

  const [search, setSearch] = React.useState("")
  const [skillFilter, setSkillFilter] = React.useState<string>("all")
  const [plantFilter, setPlantFilter] = React.useState<string>("all")
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

  React.useEffect(() => {
    if (!canView) return
    void load()
    if (canListOrgUnitsForAssignments()) void loadPlants()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setError(null)
    try {
      const list = await getJson<RateMasterPublic[]>("/rate-master")
      setRows(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rate master")
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
      if (skillFilter !== "all" && r.skill_type !== skillFilter) return false
      if (plantFilter !== "all" && String(r.org_unit_id) !== plantFilter) return false
      if (statusFilter === "active" && !r.is_active) return false
      if (statusFilter === "inactive" && r.is_active) return false
      if (q) {
        const hay = `${r.job_type} ${r.skill_type} ${r.unit} ${r.org_unit_name ?? ""}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, search, skillFilter, plantFilter, statusFilter])

  const summary = React.useMemo(() => {
    if (!rows) return { total: 0, active: 0, plants: 0 }
    const plantIds = new Set<number>()
    let active = 0
    for (const r of rows) {
      plantIds.add(r.org_unit_id)
      if (r.is_active) active += 1
    }
    return { total: rows.length, active, plants: plantIds.size }
  }, [rows])

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
      await load()
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to create"
      toast.error(msg, { id: "create-rate-master" })
    } finally {
      setCreating(false)
    }
  }

  function startEdit(row: RateMasterPublic) {
    setEditId(row.id)
    setEditForm({
      base_rate: String(row.base_rate),
      effective_from: row.effective_from,
      effective_to: row.effective_to ?? "",
      is_active: row.is_active,
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
      await load()
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to save"
      toast.error(msg, { id: "edit-rate-master" })
    } finally {
      setSavingEdit(false)
    }
  }

  async function toggleActive(row: RateMasterPublic) {
    try {
      await patchJson<RateMasterPublic>(`/rate-master/${row.id}`, {
        is_active: !row.is_active,
      })
      toast.success(row.is_active ? "Deactivated" : "Activated")
      await load()
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium">Rate master</h2>
          <p className="text-sm text-muted-foreground">
            Reference base rates per job type, skill, unit and plant. Used as the baseline for
            contractor negotiations.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> New base rate
          </Button>
        ) : null}
      </div>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Total rates</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight">{summary.total}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Active</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight">{summary.active}</div>
            </div>
            <Badge variant="success">
              {summary.total ? Math.round((summary.active / summary.total) * 100) : 0}%
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Plants covered</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight">{summary.plants}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load rate master</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Filters */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search job, skill, plant…"
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
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job · Skill</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Plant</TableHead>
                <TableHead className="text-right">Base rate</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Status</TableHead>
                {canUpdate ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {!rows ? (
                <TableRow>
                  <TableCell colSpan={canUpdate ? 7 : 6} className="text-center text-sm text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canUpdate ? 7 : 6} className="text-center text-sm text-muted-foreground">
                    No base rates match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{r.job_type}</div>
                      <div className="text-xs capitalize text-muted-foreground">
                        {r.skill_type.replace(/_/g, " ")}
                      </div>
                    </TableCell>
                    <TableCell className="capitalize">{r.unit}</TableCell>
                    <TableCell>{r.org_unit_name ?? `Plant #${r.org_unit_id}`}</TableCell>
                    <TableCell className="text-right font-medium">{formatMoney(r.base_rate)}</TableCell>
                    <TableCell className="text-xs">
                      <div>{r.effective_from}</div>
                      <div className="text-muted-foreground">
                        {r.effective_to ? `→ ${r.effective_to}` : "→ open"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.is_active ? "success" : "secondary"}>
                        {r.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    {canUpdate ? (
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => startEdit(r)}>
                            <Pencil className="size-3.5" /> Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void toggleActive(r)}>
                            <Power className="size-3.5" />
                            {r.is_active ? " Deactivate" : " Activate"}
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
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
              Job, skill, unit, and plant are immutable. Update the rate, validity window, or
              activation state.
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
                    {editForm.is_active ? "Currently active" : "Inactive — won't appear as a base"}
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
