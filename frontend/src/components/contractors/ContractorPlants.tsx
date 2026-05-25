import * as React from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import {
  Building2,
  CalendarOff,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { deleteJson, getJson, patchJson, postJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"
import {
  CONTRACTOR_PLANT_ROLE_OPTIONS,
  plantMappingLifecycle,
  plantMappingLifecycleLabel,
  plantMappingLifecycleVariant,
  plantRoleLabel,
  plantRoleVariant,
} from "./status"

export type Plant = { id: number; name: string; type?: string }

export type ContractorPlantMapping = {
  id: number
  contractor_id: number
  org_unit_id: number
  org_unit_name: string | null
  role: string
  start_date: string | null
  end_date: string | null
  notes: string | null
  is_expired: boolean
  created_at: string
  updated_at: string
}

type FormState = {
  org_unit_id: string | number
  role: string
  start_date: string
  end_date: string
  notes: string
}

const EMPTY_FORM: FormState = {
  org_unit_id: "",
  role: "approved_vendor",
  start_date: "",
  end_date: "",
  notes: "",
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  try {
    const d = new Date(value)
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })
  } catch {
    return value
  }
}

function canOpenPlantsAdminPage(): boolean {
  return (
    hasPermission("org_units.view") ||
    hasPermission("org_units.create") ||
    hasPermission("org_units.update") ||
    hasPermission("org_units.delete")
  )
}

export function ContractorPlants({ contractorId }: { contractorId: number }) {
  const canManage =
    hasPermission("contractor.manage_plants") || hasPermission("contractor.update")
  const plantsAdminHref = canOpenPlantsAdminPage() ? "/dashboard/plants" : null

  const [rows, setRows] = React.useState<ContractorPlantMapping[] | null>(null)
  const [plants, setPlants] = React.useState<Plant[]>([])
  const [plantQuery, setPlantQuery] = React.useState("")

  const [dialog, setDialog] = React.useState<
    | { mode: "add" }
    | { mode: "edit"; mapping: ContractorPlantMapping }
    | null
  >(null)
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = React.useState(false)

  const [confirmDelete, setConfirmDelete] = React.useState<ContractorPlantMapping | null>(null)
  const [busyMappingId, setBusyMappingId] = React.useState<number | null>(null)

  async function loadMappings() {
    try {
      const data = await getJson<ContractorPlantMapping[]>(
        `/contractors/${contractorId}/plants`,
      )
      setRows(data)
    } catch (e) {
      setRows([])
      toast.error(e instanceof Error ? e.message : "Failed to load plant mappings")
    }
  }

  async function loadPlants() {
    try {
      const data = await getJson<Plant[]>("/admin/org-units?type=PLANT")
      const sorted = [...data].sort((a, b) => a.name.localeCompare(b.name))
      setPlants(sorted)
    } catch {
      setPlants([])
    }
  }

  React.useEffect(() => {
    void loadMappings()
    void loadPlants()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractorId])

  function openAdd() {
    setForm(EMPTY_FORM)
    setPlantQuery("")
    setDialog({ mode: "add" })
  }

  function openEdit(mapping: ContractorPlantMapping) {
    setForm({
      org_unit_id: mapping.org_unit_id,
      role: mapping.role,
      start_date: mapping.start_date ?? "",
      end_date: mapping.end_date ?? "",
      notes: mapping.notes ?? "",
    })
    setPlantQuery("")
    setDialog({ mode: "edit", mapping })
  }

  function closeDialog() {
    setDialog(null)
    setForm(EMPTY_FORM)
    setPlantQuery("")
  }

  function validateForm(): string | null {
    if (dialog?.mode === "add" && !form.org_unit_id) return "Select a plant first."
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      return "End date must be on or after start date."
    }
    return null
  }

  async function save() {
    const error = validateForm()
    if (error) {
      toast.error(error)
      return
    }
    setSaving(true)
    try {
      if (dialog?.mode === "edit") {
        await patchJson(
          `/contractors/${contractorId}/plants/${dialog.mapping.id}`,
          {
            role: form.role,
            start_date: form.start_date || null,
            end_date: form.end_date || null,
            notes: form.notes || null,
          },
        )
        toast.success("Plant mapping updated")
      } else {
        await postJson(`/contractors/${contractorId}/plants`, {
          org_unit_id: Number(form.org_unit_id),
          role: form.role,
          start_date: form.start_date || null,
          end_date: form.end_date || null,
          notes: form.notes || null,
        })
        toast.success("Plant mapping added")
      }
      closeDialog()
      await loadMappings()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save mapping")
    } finally {
      setSaving(false)
    }
  }

  async function endEngagement(mapping: ContractorPlantMapping) {
    setBusyMappingId(mapping.id)
    try {
      await patchJson(`/contractors/${contractorId}/plants/${mapping.id}`, {
        end_date: todayIso(),
      })
      toast.success("Engagement ended (mapping kept for audit)")
      await loadMappings()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to end engagement")
    } finally {
      setBusyMappingId(null)
    }
  }

  async function confirmDeleteMapping() {
    if (!confirmDelete) return
    setBusyMappingId(confirmDelete.id)
    try {
      await deleteJson(`/contractors/${contractorId}/plants/${confirmDelete.id}`)
      toast.success("Plant mapping removed")
      setConfirmDelete(null)
      await loadMappings()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove mapping")
    } finally {
      setBusyMappingId(null)
    }
  }

  // Hide plants that are already mapped at the SELECTED role to avoid violating the
  // (contractor, plant, role) unique constraint. Other roles remain available.
  const availablePlants = React.useMemo(() => {
    const selectedRole = form.role
    return plants.filter((p) => {
      const sameRoleMapped = rows?.some(
        (r) => r.org_unit_id === p.id && r.role === selectedRole,
      )
      if (sameRoleMapped) return false
      if (plantQuery.trim() && !p.name.toLowerCase().includes(plantQuery.trim().toLowerCase())) {
        return false
      }
      return true
    })
  }, [plants, rows, form.role, plantQuery])

  const summary = React.useMemo(() => {
    if (!rows) return { total: 0, active: 0, expiring: 0, expired: 0, upcoming: 0 }
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    let active = 0
    let expiring = 0
    let expired = 0
    let upcoming = 0
    for (const r of rows) {
      const lc = plantMappingLifecycle(r.start_date, r.end_date)
      if (lc === "active") active += 1
      else if (lc === "expiring_soon") expiring += 1
      else if (lc === "expired") expired += 1
      else if (lc === "upcoming") upcoming += 1
    }
    return { total: rows.length, active, expiring, expired, upcoming }
  }, [rows])

  const isEditing = dialog?.mode === "edit"
  const dialogOpen = dialog !== null

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Plant mapping</CardTitle>
            <div className="text-sm text-muted-foreground">
              Where this contractor is operationally engaged, in what status, and for how long.
            </div>
            {rows && rows.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
                <span>
                  <span className="font-medium text-zinc-950">{summary.total}</span> total
                </span>
                <span>
                  <span className="font-medium text-emerald-700">{summary.active}</span> active
                </span>
                {summary.expiring > 0 ? (
                  <span>
                    <span className="font-medium text-yellow-700">{summary.expiring}</span> expiring
                    soon
                  </span>
                ) : null}
                {summary.expired > 0 ? (
                  <span>
                    <span className="font-medium text-red-700">{summary.expired}</span> expired
                  </span>
                ) : null}
                {summary.upcoming > 0 ? (
                  <span>
                    <span className="font-medium text-zinc-700">{summary.upcoming}</span> upcoming
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          {canManage ? (
            <Button size="sm" onClick={openAdd}>
              <Plus className="mr-2 size-4" aria-hidden />
              Add mapping
            </Button>
          ) : null}
        </div>
        {rows !== null && plants.length === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <span className="font-medium">No plants in the catalog.</span>{" "}
            {canManage ? (
              plantsAdminHref ? (
                <>
                  Create org units with type <span className="font-medium">Plant</span> under{" "}
                  <Link
                    to={plantsAdminHref}
                    className="font-medium text-emerald-800 underline-offset-2 hover:underline"
                  >
                    Plants
                  </Link>
                  , then map this contractor here.
                </>
              ) : (
                <>
                  Ask someone with <span className="font-medium">Plants (org units)</span> access to
                  create plant org units, then map this contractor here.
                </>
              )
            ) : (
              "Ask an administrator to define plants before mappings can be added."
            )}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-gray-50">
              <TableHead>Plant</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Period</TableHead>
              <TableHead className="w-[160px]">Lifecycle</TableHead>
              <TableHead className="w-[64px] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows === null ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  No plant mappings yet.
                  {canManage ? (
                    plants.length > 0 ? (
                      <>
                        {" "}
                        <button
                          type="button"
                          onClick={openAdd}
                          className="font-medium text-emerald-700 hover:underline"
                        >
                          Add the first one
                        </button>
                        .
                      </>
                    ) : (
                      <>
                        {plantsAdminHref ? (
                          <>
                            {" "}
                            <Link
                              to={plantsAdminHref}
                              className="font-medium text-emerald-700 underline-offset-2 hover:underline"
                            >
                              Open Plants
                            </Link>{" "}
                            to create plant org units first.
                          </>
                        ) : (
                          <> Ask an org-units admin to create plants before you can add a mapping.</>
                        )}
                      </>
                    )
                  ) : (
                    <> You need contractor update rights to add mappings.</>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const lifecycle = plantMappingLifecycle(r.start_date, r.end_date)
                const isBusy = busyMappingId === r.id
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                          <Building2 className="size-4" aria-hidden />
                        </div>
                        <div className="min-w-0 space-y-0.5">
                          <div className="truncate text-sm font-medium text-zinc-950">
                            {r.org_unit_name || `Plant #${r.org_unit_id}`}
                          </div>
                          {r.notes ? (
                            <div className="truncate text-xs text-muted-foreground">{r.notes}</div>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={plantRoleVariant(r.role)} className="capitalize">
                        {plantRoleLabel(r.role)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col text-sm">
                        <span className="text-zinc-950">
                          {formatDate(r.start_date)} <span className="text-muted-foreground">→</span>{" "}
                          {formatDate(r.end_date)}
                        </span>
                        {r.end_date && lifecycle === "expiring_soon" ? (
                          <span className="text-xs text-yellow-700">Ends soon</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={plantMappingLifecycleVariant(lifecycle)}>
                        {plantMappingLifecycleLabel(lifecycle)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            disabled={!canManage || isBusy}
                            title={
                              !canManage
                                ? "Missing permission: contractor.update or contractor.manage_plants"
                                : "Manage mapping"
                            }
                            className="rounded-lg"
                          >
                            <MoreHorizontal className="size-4 opacity-70" aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => openEdit(r)}>
                            <Pencil className="mr-2 size-4" aria-hidden />
                            Edit details
                          </DropdownMenuItem>
                          {lifecycle !== "expired" ? (
                            <DropdownMenuItem onClick={() => void endEngagement(r)}>
                              <CalendarOff className="mr-2 size-4" aria-hidden />
                              End engagement today
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setConfirmDelete(r)}
                            className="text-red-600 focus:text-red-700"
                          >
                            <Trash2 className="mr-2 size-4" aria-hidden />
                            Remove mapping
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </CardContent>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? null : closeDialog())}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit plant mapping" : "Map contractor to plant"}</DialogTitle>
            <DialogDescription>
              Define where the contractor is engaged, in what status, and the period of validity.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {!isEditing ? (
              <div className="grid gap-2">
                <div className="text-xs text-muted-foreground">Plant</div>
                <Input
                  value={plantQuery}
                  onChange={(e) => setPlantQuery(e.target.value)}
                  placeholder="Search plants…"
                  autoFocus
                />
                <select
                  className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
                  value={form.org_unit_id}
                  onChange={(e) => setForm((s) => ({ ...s, org_unit_id: e.target.value }))}
                  size={Math.min(6, Math.max(2, availablePlants.length))}
                >
                  {availablePlants.length === 0 ? (
                    <option value="" disabled>
                      No plants available
                    </option>
                  ) : null}
                  {availablePlants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Plant</span>
                <span className="ml-2 font-medium text-zinc-950">
                  {dialog?.mode === "edit" ? dialog.mapping.org_unit_name : ""}
                </span>
              </div>
            )}
            <div className="grid gap-2">
              <div className="text-xs text-muted-foreground">Status</div>
              <select
                className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
                value={form.role}
                onChange={(e) => setForm((s) => ({ ...s, role: e.target.value }))}
              >
                {CONTRACTOR_PLANT_ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <div className="text-xs text-muted-foreground">Start date</div>
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((s) => ({ ...s, start_date: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <div className="text-xs text-muted-foreground">End date</div>
                <Input
                  type="date"
                  value={form.end_date}
                  min={form.start_date || undefined}
                  onChange={(e) => setForm((s) => ({ ...s, end_date: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <div className="text-xs text-muted-foreground">Notes</div>
              <Input
                value={form.notes}
                onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
                placeholder="Optional context (scope, contact, etc.)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={saving || (!isEditing && !form.org_unit_id)}
            >
              {saving ? "Saving…" : isEditing ? "Save Changes" : "Save mapping"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm delete dialog */}
      <Dialog open={confirmDelete !== null} onOpenChange={(open) => (open ? null : setConfirmDelete(null))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove plant mapping?</DialogTitle>
            <DialogDescription>
              This permanently removes the contractor↔plant mapping. To preserve audit history,
              consider <span className="font-medium text-zinc-950">ending the engagement</span> instead.
            </DialogDescription>
          </DialogHeader>
          {confirmDelete ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <div className="font-medium text-zinc-950">
                {confirmDelete.org_unit_name || `Plant #${confirmDelete.org_unit_id}`}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {plantRoleLabel(confirmDelete.role)} ·{" "}
                {formatDate(confirmDelete.start_date)} → {formatDate(confirmDelete.end_date)}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={busyMappingId !== null}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDeleteMapping()}
              disabled={busyMappingId !== null}
            >
              {busyMappingId !== null ? "Removing…" : "Remove mapping"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
