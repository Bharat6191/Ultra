import * as React from "react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">Roles</h2>
          <p className="text-sm text-muted-foreground">
            Link roles to plants, assign permissions by module. Leave all plants unchecked for a
            global role (any plant). Run{" "}
            <span className="font-mono text-xs">python scripts/sync_modules.py</span> for missing
            permission rows.
          </p>
        </div>
        <Button size="sm" onClick={save} disabled={!selectedRoleId || !hasDirty || !canSaveRole}>
          Save
        </Button>
      </div>

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
            {catalogMissingPermissionCount} checkbox(es) are disabled because there is no matching row in{" "}
            <span className="font-mono">permissions</span> yet (the Roles UI cannot tick them until they exist). From
            the repo root run{" "}
            <span className="font-mono">python scripts/sync_modules.py</span> against this environment&apos;s
            database, then reload this page.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] md:items-stretch">
        <div
          className={cn(
            "flex min-h-[240px] flex-col overflow-hidden rounded-lg border",
            ROLES_SPLIT_MAX_H,
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
            <div className="text-sm font-medium">Roles</div>
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
                    Create role
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Create role</DialogTitle>
                    <DialogDescription>
                      Add a new role, optionally restrict it to specific plants, then assign
                      permissions on the right.
                    </DialogDescription>
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
                        <p className="text-xs text-muted-foreground">
                          Leave none selected so this role applies at every plant. Otherwise pick one or
                          more plants.
                        </p>
                        <ScrollArea className="h-[160px] rounded-md border p-2">
                          {plants === null || plants.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No plants yet. Create plants under Plants.</p>
                          ) : (
                            <div className="space-y-2">
                              {plants.map((pl) => {
                                const checked = createOrgUnitIds.has(pl.id)
                                return (
                                  <label
                                    key={pl.id}
                                    className="flex cursor-pointer items-center gap-2 text-sm"
                                  >
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
                        Plant checkboxes need{" "}
                        <span className="font-medium">Plants (org units) View</span>, or{" "}
                        <span className="font-medium">Roles Create/Edit</span> (same as listing plants for user
                        assignment).
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
          <Separator />
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles === null ? (
                <TableRow>
                  <TableCell className="py-8 text-center text-sm text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : roles.length === 0 ? (
                <TableRow>
                  <TableCell className="py-8 text-center text-sm text-muted-foreground">
                    No roles found.
                  </TableCell>
                </TableRow>
              ) : (
                roles.map((r) => {
                  const active = selectedRoleId === r.id
                  return (
                    <TableRow
                      key={r.id}
                      className={cn(active && "bg-muted/50")}
                      onClick={() => setSelectedRoleId(r.id)}
                      role="button"
                    >
                      <TableCell className="cursor-pointer">
                        <div className="text-sm font-medium">{r.name}</div>
                        {r.description ? (
                          <div className="line-clamp-1 text-sm text-muted-foreground">
                            {r.description}
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
          </div>
        </div>

        <div
          className={cn(
            "flex min-h-[280px] flex-col overflow-hidden rounded-lg border",
            ROLES_SPLIT_MAX_H,
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {selectedRole ? selectedRole.name : "Permissions"}
              </div>
              <div className="truncate text-sm text-muted-foreground">
                Adjust plants and permissions, then save.{" "}
                {!canSaveRole ? "You need roles.update to save." : null}
              </div>
            </div>
            {hasDirty ? (
              <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                Unsaved changes
              </span>
            ) : null}
          </div>
          <Separator />

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
            {catalog === null ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
            ) : selectedRoleId == null ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Select a role.</div>
            ) : catalog.modules.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No catalog modules defined.
              </div>
            ) : (
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="text-sm font-semibold">Plants for this role</div>
                  {canLoadPlantList ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        No selection = role is available at every plant. Otherwise limit to selected
                        plants (used when assigning users).
                      </p>
                      <div className="rounded-md border p-2">
                        {plants === null || plants.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No plants defined.</p>
                        ) : (
                          <div className="flex max-h-40 flex-col gap-2 overflow-y-auto pr-1">
                            {plants.map((pl) => {
                              const checked = linkedOrgUnitIds.has(pl.id)
                              return (
                                <label
                                  key={pl.id}
                                  className={cn(
                                    "flex items-center gap-2 text-sm",
                                    canSaveRole ? "cursor-pointer" : "cursor-not-allowed opacity-70"
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
                    <p className="text-xs text-muted-foreground">
                      Plant linking needs <span className="font-medium">Plants View</span> or{" "}
                      <span className="font-medium">Roles Create/Edit</span>.
                    </p>
                  )}
                </div>
                {catalog.modules.map((mod) => (
                  <div key={mod.key} className="space-y-2">
                    <div className="text-sm font-semibold">{mod.title}</div>
                    <div className="rounded-md border">
                      {(() => {
                        const moduleActions = orderedActionColumns(
                          mod.tabs.flatMap((t) => (Array.isArray(t.actions) ? t.actions : []))
                        )
                        return (
                      <Table className="w-max min-w-[40rem] table-fixed">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[220px] min-w-[220px]">Tab</TableHead>
                            {moduleActions.map((act) => (
                              <TableHead key={act} className="w-[96px] min-w-[96px] text-center">
                                {ACTION_LABEL[act] ?? act}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {mod.tabs.map((tab) => (
                            <TableRow key={`${mod.key}.${tab.key}`}>
                              <TableCell className="w-[220px] min-w-[220px] text-sm text-muted-foreground">
                                {tab.title}
                              </TableCell>
                              {moduleActions.map((act) => {
                                const cell = tab.permissions.find((p) => p.action === act)
                                if (!cell) {
                                  return (
                                    <TableCell key={act} className="w-[96px] min-w-[96px] text-center">
                                      <span className="text-xs text-muted-foreground">—</span>
                                    </TableCell>
                                  )
                                }
                                const id = cell.id
                                const checked = id != null && selectedPermissionIds.has(id)
                                const disabled = id == null || !canSaveRole
                                return (
                                  <TableCell key={act} className="w-[96px] min-w-[96px] text-center">
                                    <div className="flex justify-center">
                                      <Checkbox
                                        checked={checked}
                                        disabled={disabled}
                                        title={
                                          id == null
                                            ? "Run scripts/sync_modules.py to create this permission"
                                            : cell.code
                                        }
                                        onCheckedChange={(v) => {
                                          if (id == null) return
                                          const next = new Set(selectedPermissionIds)
                                          if (v) next.add(id)
                                          else next.delete(id)
                                          setSelectedPermissionIds(next)
                                        }}
                                      />
                                    </div>
                                  </TableCell>
                                )
                              })}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                        )
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
