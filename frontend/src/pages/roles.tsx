import * as React from "react"
import { ChevronDown, Search } from "lucide-react"
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

function chunkActions<T>(items: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size))
  return rows
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

function scopeLabel(orgUnitCount: number): string {
  return orgUnitCount === 0 ? "Global role" : `${orgUnitCount} plant${orgUnitCount === 1 ? "" : "s"}`
}

/** Fits below app chrome so permission matrices scroll inside the panel (not clipped). */
const ROLES_SPLIT_MAX_H = "max-h-[calc(100svh-11rem)]"

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

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className={cn("flex min-h-[420px] flex-col border-zinc-200 bg-white", ROLES_SPLIT_MAX_H)}>
          <CardHeader className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Roles</CardTitle>
                {/* <CardDescription>Search, scan scope, and jump into a role without losing context.</CardDescription> */}
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
                    <Button type="button" variant="outline" size="sm">
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

            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search Roles"
                className="pl-9"
              />
            </div>
          </CardHeader>

          <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto">
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
                      "w-full rounded-2xl border px-4 py-3 text-left transition",
                      active
                        ? "border-zinc-300 bg-zinc-50 shadow-sm"
                        : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-zinc-950">{role.name}</div>
                        {role.description ? (
                          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {role.description}
                          </div>
                        ) : null}
                      </div>
                      <div className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">
                        {role.org_unit_ids.length === 0 ? "All" : role.org_unit_ids.length}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{scopeLabel(role.org_unit_ids.length)}</Badge>
                      {active ? <Badge variant="secondary">Selected</Badge> : null}
                    </div>
                  </button>
                )
              })
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="overflow-hidden border-zinc-200 bg-white shadow-sm">
            <CardContent className="px-6 pb-6 pt-6">
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-3xl font-semibold tracking-tight text-zinc-950">
                            {selectedRole?.name ?? selectedRoleListItem?.name ?? "Permissions"}
                          </h3>
                          <Badge variant="outline">
                            {scopeLabel(
                              selectedRole?.org_units.length ?? selectedRoleListItem?.org_unit_ids.length ?? 0
                            )}
                          </Badge>
                          {!canSaveRole ? <Badge variant="secondary">Read only</Badge> : null}
                        </div>
                      {/* <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
                        {selectedRole?.description ??
                          selectedRoleListItem?.description ??
                          "Select a role to adjust plants and permissions."}
                      </p> */}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
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
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_320px]">
            <Card className={cn("flex min-h-[420px] flex-col border-zinc-200 bg-white", ROLES_SPLIT_MAX_H)}>
              <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-5">
                {catalog === null ? (
                  <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-muted-foreground">
                    Loading permissions…
                  </div>
                ) : selectedRoleId == null ? (
                  <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-muted-foreground">
                    Select a role.
                  </div>
                ) : catalog.modules.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-muted-foreground">
                    No catalog modules defined.
                  </div>
                ) : (
                  catalog.modules.map((mod) => {
                    const stats = countModulePermissionStats(mod, selectedPermissionIds)
                    const inlineTab = mod.tabs.length === 1 ? mod.tabs[0] : null
                    const inlineTabActions =
                      inlineTab == null
                        ? []
                        : orderedActionColumns(
                          Array.isArray(inlineTab.actions) && inlineTab.actions.length
                            ? inlineTab.actions
                            : inlineTab.permissions.map((permission) => permission.action)
                        )
                    const inlineActionRows = chunkActions(inlineTabActions, 5)
                    const inlineRowsOverflow = inlineActionRows.length > 1
                    const inlineExpanded = expandedPermissionModules.has(mod.key)
                    return (
                      <Card key={mod.key} className="border-zinc-200 bg-white">
                        <CardContent className="px-5 pb-5 pt-5">
                          <div className="flex flex-col gap-4">
                            <div
                              className={cn(
                                "grid gap-3",
                                inlineTab
                                  ? "xl:grid-cols-[240px_minmax(0,1fr)] xl:items-start"
                                  : "lg:grid-cols-[minmax(220px,1fr)_auto] lg:items-start",
                              )}
                            >
                              <div className="min-w-0">
                                <h4 className="text-base font-semibold text-zinc-950">{mod.title}</h4>
                              </div>
                              <div className="space-y-3">
                                <div className="flex flex-nowrap items-center gap-3 overflow-x-auto pb-1">
                                  <label
                                    className={cn(
                                      "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium whitespace-nowrap transition",
                                      !canSaveRole || stats.total === 0
                                        ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400"
                                        : "cursor-pointer border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50",
                                    )}
                                  >
                                    <Checkbox
                                      checked={
                                        stats.total > 0 && stats.enabled === stats.total
                                          ? true
                                          : stats.enabled > 0
                                            ? "indeterminate"
                                            : false
                                      }
                                      disabled={!canSaveRole || stats.total === 0}
                                      onCheckedChange={(value) => setModuleEnabled(mod, value === true)}
                                    />
                                    <span>Select All</span>
                                  </label>
                                {inlineActionRows[0]?.map((act) => {
                                    const cell = inlineTab?.permissions.find((permission) => permission.action === act)
                                    if (!cell) return null
                                    const checked = cell.id != null && selectedPermissionIds.has(cell.id)
                                    const disabled = cell.id == null || !canSaveRole
                                    return (
                                      <label
                                        key={`${mod.key}.${inlineTab?.key}.${act}`}
                                        title={
                                          cell.id == null
                                            ? "Run scripts/sync_modules.py to create this permission"
                                            : cell.code
                                        }
                                        className={cn(
                                          "inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium whitespace-nowrap transition",
                                          disabled
                                            ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400"
                                            : checked
                                              ? "border-zinc-300 bg-zinc-100 text-zinc-900 shadow-sm"
                                              : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50"
                                        )}
                                      >
                                        <Checkbox
                                          checked={checked}
                                          disabled={disabled}
                                          onCheckedChange={(value) => {
                                            if (cell.id == null || !canSaveRole) return
                                            const next = new Set(selectedPermissionIds)
                                            if (value) next.add(cell.id)
                                            else next.delete(cell.id)
                                            setSelectedPermissionIds(next)
                                          }}
                                        />
                                        <span>{ACTION_LABEL[act] ?? act}</span>
                                      </label>
                                  )
                                })}
                              </div>
                              {inlineRowsOverflow ? (
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  className="h-7 px-0 text-xs font-medium normal-case text-zinc-600 hover:bg-transparent hover:text-zinc-900"
                                  onClick={() => togglePermissionModule(mod.key)}
                                >
                                  <ChevronDown
                                    className={cn("size-4 transition-transform", inlineExpanded ? "rotate-180" : "rotate-0")}
                                  />
                                  {inlineExpanded ? "Show Less" : `Show ${inlineActionRows.length - 1} More Row${inlineActionRows.length - 1 > 1 ? "s" : ""}`}
                                </Button>
                              ) : null}
                              {inlineExpanded
                                ? inlineActionRows.slice(1).map((row, rowIndex) => (
                                    <div key={`${mod.key}.row.${rowIndex + 2}`} className="flex flex-nowrap items-center gap-3 overflow-x-auto pb-1">
                                      {row.map((act) => {
                                        const cell = inlineTab?.permissions.find((permission) => permission.action === act)
                                        if (!cell) return null
                                        const checked = cell.id != null && selectedPermissionIds.has(cell.id)
                                        const disabled = cell.id == null || !canSaveRole
                                        return (
                                          <label
                                            key={`${mod.key}.${inlineTab?.key}.${act}.extra`}
                                            title={
                                              cell.id == null
                                                ? "Run scripts/sync_modules.py to create this permission"
                                                : cell.code
                                            }
                                            className={cn(
                                              "inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium whitespace-nowrap transition",
                                              disabled
                                                ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400"
                                                : checked
                                                  ? "border-zinc-300 bg-zinc-100 text-zinc-900 shadow-sm"
                                                  : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50"
                                            )}
                                          >
                                            <Checkbox
                                              checked={checked}
                                              disabled={disabled}
                                              onCheckedChange={(value) => {
                                                if (cell.id == null || !canSaveRole) return
                                                const next = new Set(selectedPermissionIds)
                                                if (value) next.add(cell.id)
                                                else next.delete(cell.id)
                                                setSelectedPermissionIds(next)
                                              }}
                                            />
                                            <span>{ACTION_LABEL[act] ?? act}</span>
                                          </label>
                                        )
                                      })}
                                    </div>
                                  ))
                                : null}
                            </div>
                          </div>

                            <div className="space-y-3">
                              {mod.tabs
                                .filter((tab) => inlineTab == null || tab.key !== inlineTab.key)
                                .map((tab) => {
                                  const tabActions = orderedActionColumns(
                                    Array.isArray(tab.actions) && tab.actions.length
                                      ? tab.actions
                                      : tab.permissions.map((permission) => permission.action)
                                  )
                                  return (
                                    <div
                                      key={`${mod.key}.${tab.key}`}
                                      className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
                                    >
                                      <div className="min-w-0">
                                        <div className="text-sm font-medium text-zinc-900">{tab.title}</div>
                                      </div>
                                      <div className="flex flex-wrap gap-3">
                                        {tabActions.map((act) => {
                                          const cell = tab.permissions.find((permission) => permission.action === act)
                                          if (!cell) return null
                                          const checked = cell.id != null && selectedPermissionIds.has(cell.id)
                                          const disabled = cell.id == null || !canSaveRole
                                          return (
                                            <label
                                              key={act}
                                              title={
                                                cell.id == null
                                                  ? "Run scripts/sync_modules.py to create this permission"
                                                  : cell.code
                                              }
                                              className={cn(
                                                "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition",
                                                disabled
                                                  ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400"
                                                  : checked
                                                    ? "border-zinc-300 bg-zinc-100 text-zinc-900 shadow-sm"
                                                    : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50"
                                              )}
                                            >
                                              <Checkbox
                                                checked={checked}
                                                disabled={disabled}
                                                onCheckedChange={(value) => {
                                                  if (cell.id == null || !canSaveRole) return
                                                  const next = new Set(selectedPermissionIds)
                                                  if (value) next.add(cell.id)
                                                  else next.delete(cell.id)
                                                  setSelectedPermissionIds(next)
                                                }}
                                              />
                                              <span>{ACTION_LABEL[act] ?? act}</span>
                                            </label>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  )
                                })}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card className="border-zinc-200 bg-white">
                <CardHeader>
                  <CardTitle>Plant scope</CardTitle>
                  {/* <CardDescription>
                    No plant selected means the role is global. Otherwise it can only be assigned at
                    selected plants.
                  </CardDescription> */}
                </CardHeader>
                <CardContent className="space-y-3">
                  {canLoadPlantList ? (
                    <>
                      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4">
                        <div className="text-sm font-semibold text-zinc-900">
                          {scopeLabel(linkedOrgUnitIds.size)}
                        </div>
                        {/* <div className="mt-1 text-sm text-zinc-700">
                          {linkedOrgUnitIds.size === 0
                            ? "This role can be assigned at any plant."
                            : "This role is restricted to the plants selected below."}
                        </div> */}
                      </div>
                      <div className="rounded-2xl border border-zinc-200 p-3">
                        {plants === null || plants.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No plants defined.</p>
                        ) : (
                          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
                            {plants.map((pl) => {
                              const checked = linkedOrgUnitIds.has(pl.id)
                              return (
                                <label
                                  key={pl.id}
                                  className={cn(
                                    "flex items-center gap-2 rounded-xl px-2 py-2 text-sm",
                                    canSaveRole ? "cursor-pointer hover:bg-zinc-50" : "cursor-not-allowed opacity-70"
                                  )}
                                >
                                  <Checkbox
                                    checked={checked}
                                    disabled={!canSaveRole}
                                    onCheckedChange={(v) => {
                                      if (!canSaveRole) return
                                      const next = new Set(linkedOrgUnitIds)
                                      if (v) next.add(pl.id)
                                      else next.delete(pl.id)
                                      setLinkedOrgUnitIds(next)
                                    }}
                                  />
                                  <span>{pl.name}</span>
                                </label>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </>
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
      </div>
    </div>
  )
}
