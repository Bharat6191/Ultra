import * as React from "react"
import type { LucideIcon } from "lucide-react"
import {
  Bell,
  BriefcaseBusiness,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Factory,
  Handshake,
  KeyRound,
  Receipt,
  Search,
  Settings,
  Shield,
  Sparkles,
  Users,
} from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { getJson, patchJson, postJson } from "@/lib/api"
import {
  canListOrgUnitsForAssignments,
  hasPermission,
  isSuperuser,
  persistAuthFromMe,
} from "@/lib/permissions"

type OrgUnitPublic = {
  id: number
  name: string
  type: string
  parent_id: number | null
  created_at: string
  updated_at: string
}

type RoleListItem = {
  id: number
  name: string
  description: string | null
  created_at: string
  org_unit_ids: number[]
}

type PermissionPublic = {
  id: number
  feature_id: number
  action: string
  code: string
  description: string | null
  created_at: string
}

type RoleDetail = {
  id: number
  name: string
  description: string | null
  created_at: string
  permissions: PermissionPublic[]
  org_units: OrgUnitPublic[]
}

type CatalogPermission = {
  id: number | null
  action: string
  code: string
  description: string | null
}

type CatalogTab = {
  key: string
  title: string
  actions: string[]
  permissions: CatalogPermission[]
}

type CatalogModule = {
  key: string
  title: string
  tabs: CatalogTab[]
}

type PermissionCatalog = {
  modules: CatalogModule[]
}

/** Column order and header labels for standard CRUD actions. */
const ACTION_COLUMNS = ["view", "create", "update", "delete"] as const
const ACTION_LABEL: Record<string, string> = {
  view: "View",
  create: "Create",
  update: "Edit",
  delete: "Delete",
  act: "Act",
  manage: "Manage",
}

function orderedActionColumns(actions: string[]): string[] {
  const uniq = new Set<string>(actions.map((a) => a.trim()).filter(Boolean))
  const out: string[] = []
  for (const a of ACTION_COLUMNS) {
    if (uniq.has(a)) out.push(a)
  }
  for (const a of ["act", "manage"]) {
    if (uniq.has(a)) out.push(a)
  }
  // Any other action types should still be shown (stable order).
  const rest = Array.from(uniq).filter((a) => !out.includes(a)).sort((a, b) => a.localeCompare(b))
  out.push(...rest)
  return out
}

function countModulePermissionStats(mod: CatalogModule, selectedPermissionIds: Set<number>) {
  let total = 0
  let enabled = 0
  for (const tab of mod.tabs) {
    for (const permission of tab.permissions) {
      if (permission.id == null) continue
      total += 1
      if (selectedPermissionIds.has(permission.id)) enabled += 1
    }
  }
  return { total, enabled, isFull: total > 0 && enabled === total }
}

function countTabPermissionStats(tab: CatalogTab, selectedPermissionIds: Set<number>) {
  let total = 0
  let enabled = 0
  for (const permission of tab.permissions) {
    if (permission.id == null) continue
    total += 1
    if (selectedPermissionIds.has(permission.id)) enabled += 1
  }
  return { total, enabled, isFull: total > 0 && enabled === total }
}

function scopeLabel(orgUnitCount: number): string {
  return orgUnitCount === 0 ? "Global role" : `${orgUnitCount} plant${orgUnitCount === 1 ? "" : "s"}`
}

function moduleActionColumns(tab: CatalogTab): string[] {
  return orderedActionColumns(
    Array.isArray(tab.actions) && tab.actions.length
      ? tab.actions
      : tab.permissions.map((permission) => permission.action)
  )
}

function moduleIcon(module: CatalogModule): LucideIcon {
  const ref = `${module.key} ${module.title}`.toLowerCase()
  if (ref.includes("user")) return Users
  if (ref.includes("plant") || ref.includes("cluster") || ref.includes("org")) return Factory
  if (ref.includes("role")) return Shield
  if (ref.includes("permission")) return KeyRound
  if (ref.includes("setting")) return Settings
  if (ref.includes("feature")) return Sparkles
  if (ref.includes("negotiat") || ref.includes("rate")) return Handshake
  if (ref.includes("work order")) return BriefcaseBusiness
  if (ref.includes("invoice")) return Receipt
  if (ref.includes("task") || ref.includes("approval")) return ClipboardList
  if (ref.includes("notif")) return Bell
  return Sparkles
}

function roleListScopeLabel(orgUnitCount: number): string {
  return orgUnitCount === 0 ? "Global role" : `${orgUnitCount} plant${orgUnitCount === 1 ? "" : "s"}`
}

function TogglePill({
  label,
  checked,
  disabled,
  onCheckedChange,
  activeTone = "default",
}: {
  label: string
  checked: boolean | "indeterminate"
  disabled: boolean
  onCheckedChange: (value: boolean) => void
  activeTone?: "default" | "muted"
}) {
  return (
    <label
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium whitespace-nowrap transition",
        disabled
          ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400"
          : checked
            ? activeTone === "default"
              ? "border-emerald-200 bg-emerald-50 text-zinc-950 shadow-sm"
              : "border-zinc-300 bg-zinc-100 text-zinc-950 shadow-sm"
            : "cursor-pointer border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50",
      )}
    >
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => onCheckedChange(value === true)} />
      <span>{label}</span>
    </label>
  )
}

/** Fits below app chrome so permission matrices scroll inside the panel (not clipped). */
const ROLES_SPLIT_MAX_H = "max-h-[calc(100svh-7rem)]"

export function RolesPage() {
  const [roles, setRoles] = React.useState<RoleListItem[] | null>(null)
  const [plants, setPlants] = React.useState<OrgUnitPublic[] | null>(null)
  const [catalog, setCatalog] = React.useState<PermissionCatalog | null>(null)

  const [selectedRoleId, setSelectedRoleId] = React.useState<number | null>(null)
  const [selectedRole, setSelectedRole] = React.useState<RoleDetail | null>(null)
  const [selectedPermissionIds, setSelectedPermissionIds] = React.useState<Set<number>>(
    () => new Set()
  )
  const [linkedOrgUnitIds, setLinkedOrgUnitIds] = React.useState<Set<number>>(() => new Set())

  const [error, setError] = React.useState<string | null>(null)

  const [createOpen, setCreateOpen] = React.useState(false)
  const [createName, setCreateName] = React.useState("")
  const [createDescription, setCreateDescription] = React.useState("")
  const [creating, setCreating] = React.useState(false)
  const [createOrgUnitIds, setCreateOrgUnitIds] = React.useState<Set<number>>(() => new Set())
  const [search, setSearch] = React.useState("")
  const [expandedPermissionModules, setExpandedPermissionModules] = React.useState<Set<string>>(() => new Set())

  const canCreateRole = hasPermission("roles.create") || isSuperuser()
  /** Same as ``GET /admin/org-units`` (plant pickers for roles vs. Plants admin module). */
  const canLoadPlantList = canListOrgUnitsForAssignments()

  async function loadBase() {
    setError(null)
    try {
      const [r, cat] = await Promise.all([
        getJson<RoleListItem[]>("/admin/roles?skip=0&limit=50"),
        getJson<PermissionCatalog>("/admin/permissions/catalog"),
      ])
      setRoles(r)
      setCatalog(cat)
      if (canLoadPlantList) {
        try {
          const p = await getJson<OrgUnitPublic[]>("/admin/org-units?type=PLANT")
          setPlants(p)
        } catch {
          setPlants([])
        }
      } else {
        setPlants([])
      }
      if (selectedRoleId == null && r.length > 0) setSelectedRoleId(r[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load roles")
      setRoles([])
      setPlants([])
      setCatalog({ modules: [] })
    }
  }

  async function loadRole(roleId: number) {
    setError(null)
    try {
      const detail = await getJson<RoleDetail>(`/admin/roles/${roleId}`)
      setSelectedRole(detail)
      setSelectedPermissionIds(new Set(detail.permissions.map((x) => x.id)))
      setLinkedOrgUnitIds(new Set(detail.org_units.map((o) => o.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load role")
      setSelectedRole(null)
      setSelectedPermissionIds(new Set())
      setLinkedOrgUnitIds(new Set())
    }
  }

  React.useEffect(() => {
    void loadBase()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    if (selectedRoleId != null) void loadRole(selectedRoleId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoleId])

  const hasDirtyPermissions = React.useMemo(() => {
    if (!selectedRole) return false
    const original = new Set(selectedRole.permissions.map((p) => p.id))
    if (original.size !== selectedPermissionIds.size) return true
    for (const id of selectedPermissionIds) if (!original.has(id)) return true
    return false
  }, [selectedRole, selectedPermissionIds])

  const hasDirtyPlants = React.useMemo(() => {
    if (!canLoadPlantList || !selectedRole) return false
    const original = new Set(selectedRole.org_units.map((o) => o.id))
    if (original.size !== linkedOrgUnitIds.size) return true
    for (const id of linkedOrgUnitIds) if (!original.has(id)) return true
    return false
  }, [canLoadPlantList, selectedRole, linkedOrgUnitIds])

  const hasDirty = hasDirtyPermissions || hasDirtyPlants

  const catalogMissingPermissionCount = React.useMemo(() => {
    if (!catalog?.modules?.length) return 0
    let n = 0
    for (const mod of catalog.modules) {
      for (const tab of mod.tabs) {
        for (const p of tab.permissions) {
          if (p.id == null) n += 1
        }
      }
    }
    return n
  }, [catalog])

  const canSaveRole = hasPermission("roles.update") || isSuperuser()
  const filteredRoles = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return roles ?? []
    return (roles ?? []).filter((role) => {
      const haystack = `${role.name} ${role.description ?? ""}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [roles, search])

  React.useEffect(() => {
    if (filteredRoles.length === 0) return
    if (!filteredRoles.some((role) => role.id === selectedRoleId)) {
      setSelectedRoleId(filteredRoles[0].id)
    }
  }, [filteredRoles, selectedRoleId])

  const selectedRoleListItem = React.useMemo(
    () => roles?.find((role) => role.id === selectedRoleId) ?? null,
    [roles, selectedRoleId]
  )
  const rolesFooterLabel = React.useMemo(() => {
    if (roles === null) return "Loading roles..."
    if (filteredRoles.length === 0) return "0 roles"
    if (search.trim()) return `${filteredRoles.length} result${filteredRoles.length === 1 ? "" : "s"}`
    return `1-${filteredRoles.length} of ${roles.length}`
  }, [filteredRoles.length, roles, search])

  function resetEditorState() {
    if (!selectedRole) return
    setSelectedPermissionIds(new Set(selectedRole.permissions.map((permission) => permission.id)))
    setLinkedOrgUnitIds(new Set(selectedRole.org_units.map((orgUnit) => orgUnit.id)))
  }

  function setModuleEnabled(module: CatalogModule, enabled: boolean) {
    if (!canSaveRole) return
    setSelectedPermissionIds((current) => {
      const next = new Set(current)
      for (const tab of module.tabs) {
        for (const permission of tab.permissions) {
          if (permission.id == null) continue
          if (enabled) next.add(permission.id)
          else next.delete(permission.id)
        }
      }
      return next
    })
  }

  function setTabEnabled(tab: CatalogTab, enabled: boolean) {
    if (!canSaveRole) return
    setSelectedPermissionIds((current) => {
      const next = new Set(current)
      for (const permission of tab.permissions) {
        if (permission.id == null) continue
        if (enabled) next.add(permission.id)
        else next.delete(permission.id)
      }
      return next
    })
  }

  function setPermissionEnabled(permissionId: number, enabled: boolean) {
    if (!canSaveRole) return
    setSelectedPermissionIds((current) => {
      const next = new Set(current)
      if (enabled) next.add(permissionId)
      else next.delete(permissionId)
      return next
    })
  }

  function togglePermissionModule(moduleKey: string) {
    setExpandedPermissionModules((current) => {
      const next = new Set(current)
      if (next.has(moduleKey)) next.delete(moduleKey)
      else next.add(moduleKey)
      return next
    })
  }

  async function createRole() {
    const name = createName.trim()
    if (!name) {
      toast.error("Role name is required.")
      return
    }
    setCreating(true)
    toast.loading("Creating role…", { id: "create-role" })
    try {
      const created = await postJson<RoleDetail>("/admin/roles", {
        name,
        description: createDescription.trim() ? createDescription.trim() : null,
        permission_ids: [],
        org_unit_ids: Array.from(createOrgUnitIds.values()),
      })
      toast.success("Role created", { id: "create-role" })
      setCreateOpen(false)
      setCreateName("")
      setCreateDescription("")
      setCreateOrgUnitIds(new Set())
      await loadBase()
      setSelectedRoleId(created.id)
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to create role"
      toast.error(message, { id: "create-role" })
      setError(message)
    } finally {
      setCreating(false)
    }
  }

  async function save() {
    if (!selectedRoleId) return
    const body: Record<string, unknown> = {}
    if (hasDirtyPermissions) body.permission_ids = Array.from(selectedPermissionIds.values())
    if (hasDirtyPlants) body.org_unit_ids = Array.from(linkedOrgUnitIds.values())
    if (Object.keys(body).length === 0) return
    toast.loading("Saving…", { id: "save-perms" })
    try {
      await patchJson<RoleDetail>(`/admin/roles/${selectedRoleId}`, body)
      // If the editor happens to be in this role too, refresh their own RBAC
      // snapshot so menus / tabs / buttons update immediately. The dashboard
      // app shell also auto-refreshes on focus, so users in other tabs pick
      // up the change on their next switch back.
      try {
        const me = await getJson<{ is_superuser?: boolean; permissions?: string[] }>("/me")
        persistAuthFromMe(me)
      } catch {
        // ignore — a stale snapshot will be cleared on next focus / login.
      }
      toast.success(
        "Saved. Affected users will see new menus on their next page focus, or via Profile → Refresh permissions.",
        { id: "save-perms" },
      )
      await loadRole(selectedRoleId)
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save"
      toast.error(message, { id: "save-perms" })
      setError(message)
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {catalogMissingPermissionCount > 0 ? (
        <Alert>
          <AlertTitle>Permission rows missing in the database</AlertTitle>
          <AlertDescription>
            {catalogMissingPermissionCount} action(s) are disabled because there is no matching row
            in <span className="font-mono">permissions</span> yet. Run{" "}
            <span className="font-mono">python scripts/sync_modules.py</span> against this
            environment&apos;s database, then reload this page.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid items-stretch gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card
          className="flex h-full min-h-[520px] self-stretch flex-col overflow-hidden rounded-[28px] border-zinc-200 bg-white shadow-sm"
        >
          <CardHeader className="space-y-4 px-6 pb-4 pt-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-[2rem] font-semibold tracking-tight text-zinc-950">Roles</CardTitle>
              </div>
              {canCreateRole ? (
                <Dialog
                  open={createOpen}
                  onOpenChange={(open) => {
                    setCreateOpen(open)
                    if (!open) setCreateOrgUnitIds(new Set())
                  }}
                >
                  <DialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800 hover:text-white"
                    >
                      Create Role
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Create role</DialogTitle>
                      {/* <DialogDescription>
                        Add a new role, optionally restrict it to specific plants, then assign
                        permissions on the right.
                      </DialogDescription> */}
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="role-name" showRequired>
                          Name
                        </Label>
                        <Input
                          id="role-name"
                          value={createName}
                          onChange={(e) => setCreateName(e.target.value)}
                          placeholder="e.g. Plant operator"
                          autoComplete="off"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="role-desc">Description (optional)</Label>
                        <Input
                          id="role-desc"
                          value={createDescription}
                          onChange={(e) => setCreateDescription(e.target.value)}
                          placeholder="What this role is for"
                        />
                      </div>
                      {canLoadPlantList ? (
                        <div className="space-y-2">
                          <Label>Plants (optional)</Label>
                          {/* <p className="text-xs text-muted-foreground">
                            Leave none selected so this role applies at every plant. Otherwise pick
                            one or more plants.
                          </p> */}
                          <ScrollArea className="h-[160px] rounded-md border p-2">
                            {plants === null || plants.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                No plants yet. Create plants under Plants.
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {plants.map((pl) => {
                                  const checked = createOrgUnitIds.has(pl.id)
                                  return (
                                    <label key={pl.id} className="flex cursor-pointer items-center gap-2 text-sm">
                                      <Checkbox
                                        checked={checked}
                                        onCheckedChange={(v) => {
                                          const next = new Set(createOrgUnitIds)
                                          if (v) next.add(pl.id)
                                          else next.delete(pl.id)
                                          setCreateOrgUnitIds(next)
                                        }}
                                      />
                                      <span>{pl.name}</span>
                                    </label>
                                  )
                                })}
                              </div>
                            )}
                          </ScrollArea>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Plant checkboxes need <span className="font-medium">Plants View</span>, or{" "}
                          <span className="font-medium">Roles Create/Edit</span>.
                        </p>
                      )}
                      <div className="flex justify-end gap-2 pt-1">
                        <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
                          Cancel
                        </Button>
                        <Button type="button" size="sm" disabled={creating} onClick={() => void createRole()}>
                          {creating ? "Creating…" : "Create"}
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              ) : null}
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search roles"
                className="h-11 rounded-2xl border-zinc-200 pl-9"
              />
            </div>
          </CardHeader>

          <CardContent className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-5">
            {roles === null ? (
              <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-muted-foreground">
                Loading roles…
              </div>
            ) : filteredRoles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-muted-foreground">
                No roles match this search.
              </div>
            ) : (
              filteredRoles.map((role) => {
                const active = selectedRoleId === role.id
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => setSelectedRoleId(role.id)}
                    className={cn(
                      "w-full rounded-[24px] border px-4 py-4 text-left transition",
                      active
                        ? "border-emerald-200 bg-emerald-50/60 shadow-sm"
                        : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "flex size-11 shrink-0 items-center justify-center rounded-2xl border",
                          active
                            ? "border-emerald-100 bg-white text-emerald-600"
                            : "border-zinc-200 bg-zinc-50 text-zinc-500"
                        )}
                      >
                        <Users className="size-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[1.05rem] font-semibold text-zinc-950">{role.name}</div>
                        {role.description ? (
                          <div className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-600">
                            {role.description}
                          </div>
                        ) : null}
                        <div className="mt-2 text-sm font-medium text-zinc-500">
                          {roleListScopeLabel(role.org_unit_ids.length)}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </CardContent>

          <div className="flex items-center justify-between border-t border-zinc-100 px-6 py-4">
            <div className="text-sm font-medium text-zinc-500">{rolesFooterLabel}</div>
            <div className="flex items-center gap-2">
              <Button size="icon-xs" variant="outline" disabled>
                <ChevronLeft className="size-4" />
              </Button>
              <Button size="icon-xs" variant="outline" disabled>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="overflow-hidden rounded-[28px] border-zinc-200 bg-white shadow-sm">
            <CardContent className="px-8 pb-7 pt-7">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-[2rem] font-semibold tracking-tight text-zinc-950">
                      {selectedRole?.name ?? selectedRoleListItem?.name ?? "Permissions"}
                    </h3>{scopeLabel(
                        selectedRole?.org_units.length ?? selectedRoleListItem?.org_unit_ids.length ?? 0
                      )}
                    {!canSaveRole ? <Badge variant="secondary">Read only</Badge> : null}
                  </div>
                  {/* <div className="space-y-1">
                    <div className="text-1xl font-semibold uppercase tracking-[0.24em] text-zinc-950">
                      Plant scope
                    </div>
                    <div className="text-1xs font-medium text-zinc-900">
                      {scopeLabel(
                        selectedRole?.org_units.length ?? selectedRoleListItem?.org_unit_ids.length ?? 0
                      )}
                    </div>
                  </div> */}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" onClick={resetEditorState} disabled={!hasDirty}>
                    Discard
                  </Button>
                  <Button
                    onClick={save}
                    disabled={!selectedRoleId || !hasDirty || !canSaveRole}
                    className="border border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800"
                  >
                    Save Changes
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card
            className={cn(
              "flex min-h-[420px] flex-col overflow-hidden rounded-[28px] border-zinc-200 bg-white shadow-sm",
              ROLES_SPLIT_MAX_H
            )}
          >
            <CardContent className="min-h-0 flex-1 overflow-auto p-0">
              <div className="min-w-[960px]">
                {catalog === null ? (
                  <div className="m-6 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-muted-foreground">
                    Loading permissions…
                  </div>
                ) : selectedRoleId == null ? (
                  <div className="m-6 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-muted-foreground">
                    Select a role.
                  </div>
                ) : catalog.modules.length === 0 ? (
                  <div className="m-6 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-muted-foreground">
                    No catalog modules defined.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-[minmax(240px,1.45fr)_repeat(5,minmax(120px,0.75fr))] gap-4 border-b border-zinc-200 px-8 py-5 text-sm font-semibold text-zinc-600">
                      <div>Module</div>
                      <div>Select All</div>
                      <div>View</div>
                      <div>Create</div>
                      <div>Edit</div>
                      <div>Delete</div>
                    </div>

                    <div className="divide-y divide-zinc-100">
                      {catalog.modules.map((mod) => {
                        const Icon = moduleIcon(mod)
                        const stats = countModulePermissionStats(mod, selectedPermissionIds)
                        const primaryTab = mod.tabs[0] ?? null
                        const primaryActions = primaryTab ? moduleActionColumns(primaryTab) : []
                        const extraPrimaryActions = primaryActions.filter(
                          (action) => !ACTION_COLUMNS.includes(action as (typeof ACTION_COLUMNS)[number])
                        )
                        const extraTabs = primaryTab ? mod.tabs.slice(1) : mod.tabs
                        const extraRowCount = extraTabs.length + (extraPrimaryActions.length > 0 ? 1 : 0)
                        const expanded = expandedPermissionModules.has(mod.key)
                        return (
                          <div key={mod.key}>
                            <div className="grid grid-cols-[minmax(240px,1.45fr)_repeat(5,minmax(120px,0.75fr))] gap-4 px-8 py-5">
                              <div className="min-w-0">
                                <div className="flex items-start gap-3">
                                  <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 text-zinc-600">
                                    <Icon className="size-5" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-base font-semibold text-zinc-950">{mod.title}</div>
                                    {extraRowCount > 0 ? (
                                      <Button
                                        variant="ghost"
                                        size="xs"
                                        className="mt-1 h-auto px-0 text-xs font-medium normal-case text-zinc-500 hover:bg-transparent hover:text-zinc-900"
                                        onClick={() => togglePermissionModule(mod.key)}
                                      >
                                        <ChevronDown
                                          className={cn(
                                            "size-4 transition-transform",
                                            expanded ? "rotate-180" : "rotate-0"
                                          )}
                                        />
                                        {expanded
                                          ? "Show less"
                                          : `Show ${extraRowCount} more row${extraRowCount === 1 ? "" : "s"}`}
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center">
                                <TogglePill
                                  label="Select All"
                                  checked={
                                    stats.total > 0 && stats.enabled === stats.total
                                      ? true
                                      : stats.enabled > 0
                                        ? "indeterminate"
                                        : false
                                  }
                                  disabled={!canSaveRole || stats.total === 0}
                                  onCheckedChange={(value) => setModuleEnabled(mod, value)}
                                  activeTone="muted"
                                />
                              </div>

                              {ACTION_COLUMNS.map((action) => {
                                const cell =
                                  primaryTab?.permissions.find((permission) => permission.action === action) ?? null
                                const checked = cell?.id != null && selectedPermissionIds.has(cell.id)
                                const disabled = cell?.id == null || !canSaveRole
                                return (
                                  <div key={`${mod.key}.${primaryTab?.key ?? "module"}.${action}`} className="flex items-center">
                                    <TogglePill
                                      label={ACTION_LABEL[action] ?? action}
                                      checked={checked}
                                      disabled={disabled}
                                      onCheckedChange={(value) => {
                                        if (cell?.id == null) return
                                        setPermissionEnabled(cell.id, value)
                                      }}
                                    />
                                  </div>
                                )
                              })}
                            </div>

                            {expanded && extraPrimaryActions.length > 0 ? (
                              <div className="border-t border-zinc-100 bg-zinc-50/70 px-8 py-4">
                                <div className="pl-14">
                                  <div className="text-sm font-medium text-zinc-800">Additional permissions</div>
                                  <div className="mt-3 flex flex-wrap gap-3">
                                    {extraPrimaryActions.map((action) => {
                                      const cell =
                                        primaryTab?.permissions.find((permission) => permission.action === action) ??
                                        null
                                      const checked = cell?.id != null && selectedPermissionIds.has(cell.id)
                                      const disabled = cell?.id == null || !canSaveRole
                                      return (
                                        <TogglePill
                                          key={`${mod.key}.extra.${action}`}
                                          label={ACTION_LABEL[action] ?? action}
                                          checked={checked}
                                          disabled={disabled}
                                          onCheckedChange={(value) => {
                                            if (cell?.id == null) return
                                            setPermissionEnabled(cell.id, value)
                                          }}
                                        />
                                      )
                                    })}
                                  </div>
                                </div>
                              </div>
                            ) : null}

                            {expanded
                              ? extraTabs.map((tab) => {
                                  const tabStats = countTabPermissionStats(tab, selectedPermissionIds)
                                  const tabActions = moduleActionColumns(tab)
                                  const extraActions = tabActions.filter(
                                    (action) =>
                                      !ACTION_COLUMNS.includes(action as (typeof ACTION_COLUMNS)[number])
                                  )
                                  return (
                                    <div
                                      key={`${mod.key}.${tab.key}`}
                                      className="grid grid-cols-[minmax(240px,1.45fr)_repeat(5,minmax(120px,0.75fr))] gap-4 border-t border-zinc-100 bg-zinc-50/70 px-8 py-4"
                                    >
                                      <div className="min-w-0 pl-14">
                                        <div className="text-sm font-semibold text-zinc-900">{tab.title}</div>
                                        {extraActions.length > 0 ? (
                                          <div className="mt-3 flex flex-wrap gap-3">
                                            {extraActions.map((action) => {
                                              const cell =
                                                tab.permissions.find((permission) => permission.action === action) ??
                                                null
                                              const checked = cell?.id != null && selectedPermissionIds.has(cell.id)
                                              const disabled = cell?.id == null || !canSaveRole
                                              return (
                                                <TogglePill
                                                  key={`${mod.key}.${tab.key}.${action}.extra`}
                                                  label={ACTION_LABEL[action] ?? action}
                                                  checked={checked}
                                                  disabled={disabled}
                                                  onCheckedChange={(value) => {
                                                    if (cell?.id == null) return
                                                    setPermissionEnabled(cell.id, value)
                                                  }}
                                                />
                                              )
                                            })}
                                          </div>
                                        ) : null}
                                      </div>

                                      <div className="flex items-center">
                                        <TogglePill
                                          label="Select All"
                                          checked={
                                            tabStats.total > 0 && tabStats.enabled === tabStats.total
                                              ? true
                                              : tabStats.enabled > 0
                                                ? "indeterminate"
                                                : false
                                          }
                                          disabled={!canSaveRole || tabStats.total === 0}
                                          onCheckedChange={(value) => setTabEnabled(tab, value)}
                                          activeTone="muted"
                                        />
                                      </div>

                                      {ACTION_COLUMNS.map((action) => {
                                        const cell =
                                          tab.permissions.find((permission) => permission.action === action) ?? null
                                        const checked = cell?.id != null && selectedPermissionIds.has(cell.id)
                                        const disabled = cell?.id == null || !canSaveRole
                                        return (
                                          <div key={`${mod.key}.${tab.key}.${action}`} className="flex items-center">
                                            <TogglePill
                                              label={ACTION_LABEL[action] ?? action}
                                              checked={checked}
                                              disabled={disabled}
                                              onCheckedChange={(value) => {
                                                if (cell?.id == null) return
                                                setPermissionEnabled(cell.id, value)
                                              }}
                                            />
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )
                                })
                              : null}
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-zinc-200 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-3xl font-semibold tracking-tight text-zinc-950">Plant scope</CardTitle>
            </CardHeader>
            <CardContent>
              {canLoadPlantList ? (
                plants === null ? (
                  <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-muted-foreground">
                    Loading plants…
                  </div>
                ) : plants.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-muted-foreground">
                    No plants defined.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {plants.map((pl) => {
                      const checked = linkedOrgUnitIds.has(pl.id)
                      return (
                        <TogglePill
                          key={pl.id}
                          label={pl.name}
                          checked={checked}
                          disabled={!canSaveRole}
                          onCheckedChange={(value) => {
                            const next = new Set(linkedOrgUnitIds)
                            if (value) next.add(pl.id)
                            else next.delete(pl.id)
                            setLinkedOrgUnitIds(next)
                          }}
                        />
                      )
                    })}
                  </div>
                )
              ) : (
                <p className="text-sm text-muted-foreground">
                  Plant linking needs <span className="font-medium">Plants View</span> or{" "}
                  <span className="font-medium">Roles Create/Edit</span>.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
