import * as React from "react"
import { Building2, FolderTree, MoreVertical, Pencil, Plus, Search } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/layout/PageHeader"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError, getJson, patchJson, postJson } from "@/lib/api"
import { hasPermission, isSuperuser } from "@/lib/permissions"
import { cn } from "@/lib/utils"

type OrgUnitPublic = {
  id: number
  name: string
  type: string
  parent_id: number | null
  created_at: string
  updated_at: string
}

const SELECT_CLASS = cn(
  "h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-base transition-colors outline-none focus-visible:border-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/20 md:text-sm dark:bg-input/30",
)

function includesSearch(value: string, query: string): boolean {
  return value.toLowerCase().includes(query.trim().toLowerCase())
}

export function PlantsPage() {
  const [plants, setPlants] = React.useState<OrgUnitPublic[] | null>(null)
  const [clusters, setClusters] = React.useState<OrgUnitPublic[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState("")

  const [createClusterOpen, setCreateClusterOpen] = React.useState(false)
  const [clusterName, setClusterName] = React.useState("")
  const [clusterParentId, setClusterParentId] = React.useState<string>("")
  const [creatingCluster, setCreatingCluster] = React.useState(false)

  const [createPlantOpen, setCreatePlantOpen] = React.useState(false)
  const [plantName, setPlantName] = React.useState("")
  const [plantParentId, setPlantParentId] = React.useState<string>("")
  const [creatingPlant, setCreatingPlant] = React.useState(false)

  const [editOpen, setEditOpen] = React.useState(false)
  const [editTarget, setEditTarget] = React.useState<{ kind: "PLANT" | "CLUSTER"; row: OrgUnitPublic } | null>(
    null,
  )
  const [editName, setEditName] = React.useState("")
  const [editParentId, setEditParentId] = React.useState<string>("")
  const [savingEdit, setSavingEdit] = React.useState(false)

  const canCreate = hasPermission("org_units.create") || isSuperuser()
  const canUpdate = hasPermission("org_units.update") || isSuperuser()
  const showActions = canUpdate

  const clusterById = React.useMemo(() => {
    const map = new Map<number, OrgUnitPublic>()
    for (const row of clusters) map.set(row.id, row)
    return map
  }, [clusters])

  const sortedClusters = React.useMemo(
    () => clusters.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [clusters],
  )

  const sortedPlants = React.useMemo(() => {
    if (!plants) return []
    return plants.slice().sort((a, b) => a.name.localeCompare(b.name))
  }, [plants])

  const clusterSubtreeIds = React.useCallback(
    (rootId: number) => {
      const out = new Set<number>([rootId])
      const queue = [rootId]
      while (queue.length) {
        const current = queue.shift()!
        for (const row of clusters) {
          if (row.parent_id === current && !out.has(row.id)) {
            out.add(row.id)
            queue.push(row.id)
          }
        }
      }
      return out
    },
    [clusters],
  )

  const clusterParentChoicesForEdit = React.useMemo(() => {
    if (!editTarget || editTarget.kind !== "CLUSTER") return sortedClusters
    const blocked = clusterSubtreeIds(editTarget.row.id)
    return sortedClusters.filter((row) => !blocked.has(row.id))
  }, [clusterSubtreeIds, editTarget, sortedClusters])

  const filteredClusters = React.useMemo(() => {
    if (!search.trim()) return sortedClusters
    return sortedClusters.filter((row) => {
      const parentName = row.parent_id != null ? clusterById.get(row.parent_id)?.name ?? "" : ""
      return includesSearch(row.name, search) || includesSearch(parentName, search) || includesSearch("cluster", search)
    })
  }, [clusterById, search, sortedClusters])

  const filteredPlants = React.useMemo(() => {
    if (!search.trim()) return sortedPlants
    return sortedPlants.filter((row) => {
      const clusterName = row.parent_id != null ? clusterById.get(row.parent_id)?.name ?? "" : ""
      return includesSearch(row.name, search) || includesSearch(clusterName, search) || includesSearch("plant", search)
    })
  }, [clusterById, search, sortedPlants])

  async function load() {
    setError(null)
    try {
      const [plantRows, clusterRows] = await Promise.all([
        getJson<OrgUnitPublic[]>("/admin/org-units?type=PLANT"),
        getJson<OrgUnitPublic[]>("/admin/org-units?type=CLUSTER"),
      ])
      setPlants(plantRows)
      setClusters(clusterRows)
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load org units"
      setError(message)
      setPlants([])
      setClusters([])
    }
  }

  React.useEffect(() => {
    void load()
  }, [])

  function openCreateCluster() {
    setClusterName("")
    setClusterParentId("")
    setCreateClusterOpen(true)
  }

  function closeCreateCluster() {
    setCreateClusterOpen(false)
    setClusterName("")
    setClusterParentId("")
  }

  function openCreatePlant() {
    setPlantName("")
    setPlantParentId("")
    setCreatePlantOpen(true)
  }

  function closeCreatePlant() {
    setCreatePlantOpen(false)
    setPlantName("")
    setPlantParentId("")
  }

  function openEdit(row: OrgUnitPublic, kind: "PLANT" | "CLUSTER") {
    setEditTarget({ kind, row })
    setEditName(row.name)
    setEditParentId(row.parent_id != null ? String(row.parent_id) : "")
    setEditOpen(true)
  }

  function closeEdit() {
    setEditOpen(false)
    setEditTarget(null)
    setEditName("")
    setEditParentId("")
  }

  async function createCluster() {
    const name = clusterName.trim()
    if (!name) {
      toast.error("Cluster name is required.")
      return
    }
    setCreatingCluster(true)
    toast.loading("Creating cluster…", { id: "create-cluster-page" })
    try {
      await postJson<OrgUnitPublic>("/admin/org-units", {
        name,
        type: "CLUSTER",
        parent_id: clusterParentId ? Number(clusterParentId) : null,
      })
      toast.success("Cluster created", { id: "create-cluster-page" })
      closeCreateCluster()
      await load()
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to create cluster"
      toast.error(message, { id: "create-cluster-page" })
      setError(message)
    } finally {
      setCreatingCluster(false)
    }
  }

  async function createPlant() {
    const name = plantName.trim()
    if (!name) {
      toast.error("Plant name is required.")
      return
    }
    setCreatingPlant(true)
    toast.loading("Creating plant…", { id: "create-plant-page" })
    try {
      await postJson<OrgUnitPublic>("/admin/org-units", {
        name,
        type: "PLANT",
        parent_id: plantParentId ? Number(plantParentId) : null,
      })
      toast.success("Plant created", { id: "create-plant-page" })
      closeCreatePlant()
      await load()
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to create plant"
      toast.error(message, { id: "create-plant-page" })
      setError(message)
    } finally {
      setCreatingPlant(false)
    }
  }

  async function saveEdit() {
    if (!editTarget) return
    const name = editName.trim()
    if (!name) {
      toast.error("Name is required.")
      return
    }
    setSavingEdit(true)
    toast.loading("Saving…", { id: "edit-org-page" })
    try {
      await patchJson<OrgUnitPublic>(`/admin/org-units/${editTarget.row.id}`, {
        name,
        parent_id: editParentId ? Number(editParentId) : null,
      })
      toast.success("Saved", { id: "edit-org-page" })
      closeEdit()
      await load()
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to save"
      toast.error(message, { id: "edit-org-page" })
      setError(message)
    } finally {
      setSavingEdit(false)
    }
  }

  const actionButtons = (
    <div className="flex flex-wrap items-center gap-2">
      {canCreate ? (
        <Button type="button" className="gap-2" onClick={openCreateCluster}>
          <Plus className="size-4" aria-hidden />
          Cluster
        </Button>
      ) : null}
      {canCreate ? (
        <Button type="button" variant="outline" className="gap-2" onClick={openCreatePlant}>
          <Plus className="size-4" aria-hidden />
          Plant
        </Button>
      ) : null}
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clusters & Plants"
        subtitle="Manage your organization's cluster and plant hierarchy."
        action={actionButtons}
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="rounded-3xl border-zinc-200 bg-white shadow-sm">
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base">Organization hierarchy</CardTitle>
              <CardDescription>
                Create clusters or plants in popups. Use the row actions to edit names or change cluster placement.
              </CardDescription>
            </div>
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search clusters or plants…"
                className="pl-9"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-zinc-950">{clusters.length}</span> clusters
            </span>
            <span>
              <span className="font-medium text-zinc-950">{plants?.length ?? 0}</span> plants
            </span>
            {search.trim() ? (
              <span>
                Searching for <span className="font-medium text-zinc-950">{search.trim()}</span>
              </span>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-6 p-6 pt-0">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                <FolderTree className="size-4" aria-hidden />
              </div>
              <div>
                <div className="text-sm font-semibold text-zinc-950">Clusters</div>
                <div className="text-xs text-muted-foreground">Root and nested grouping structure.</div>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-zinc-200">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Parent Cluster</TableHead>
                    <TableHead className="w-[100px]">Type</TableHead>
                    {showActions ? <TableHead className="w-[72px] text-right">Actions</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plants === null ? (
                    <TableRow>
                      <TableCell colSpan={showActions ? 4 : 3} className="py-8 text-center text-sm text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : filteredClusters.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={showActions ? 4 : 3} className="py-8 text-center text-sm text-muted-foreground">
                        {search.trim() ? "No matching clusters found." : "No clusters yet."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredClusters.map((row) => {
                      const parent = row.parent_id != null ? clusterById.get(row.parent_id) : null
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="text-sm font-medium text-zinc-950">{row.name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{parent?.name ?? "Root cluster"}</TableCell>
                          <TableCell className="text-xs font-medium tracking-wide text-zinc-600">{row.type}</TableCell>
                          {showActions ? (
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button type="button" variant="ghost" size="icon-sm" className="rounded-lg">
                                    <MoreVertical className="size-4 opacity-70" aria-hidden />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onSelect={() => openEdit(row, "CLUSTER")}>
                                    <Pencil className="mr-2 size-4" aria-hidden />
                                    Edit cluster
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
                <Building2 className="size-4" aria-hidden />
              </div>
              <div>
                <div className="text-sm font-semibold text-zinc-950">Plants</div>
                <div className="text-xs text-muted-foreground">Operational plants and the cluster they belong to.</div>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-zinc-200">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Cluster</TableHead>
                    <TableHead className="w-[100px]">Type</TableHead>
                    {showActions ? <TableHead className="w-[72px] text-right">Actions</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plants === null ? (
                    <TableRow>
                      <TableCell colSpan={showActions ? 4 : 3} className="py-8 text-center text-sm text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : filteredPlants.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={showActions ? 4 : 3} className="py-8 text-center text-sm text-muted-foreground">
                        {search.trim() ? "No matching plants found." : "No plants found."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredPlants.map((row) => {
                      const parent = row.parent_id != null ? clusterById.get(row.parent_id) : null
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="text-sm font-medium text-zinc-950">{row.name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{parent?.name ?? "Unassigned"}</TableCell>
                          <TableCell className="text-xs font-medium tracking-wide text-zinc-600">{row.type}</TableCell>
                          {showActions ? (
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button type="button" variant="ghost" size="icon-sm" className="rounded-lg">
                                    <MoreVertical className="size-4 opacity-70" aria-hidden />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onSelect={() => openEdit(row, "PLANT")}>
                                    <Pencil className="mr-2 size-4" aria-hidden />
                                    Edit plant
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        </CardContent>
      </Card>

      <Dialog open={createClusterOpen} onOpenChange={(open) => (open ? setCreateClusterOpen(true) : closeCreateCluster())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Cluster</DialogTitle>
            <DialogDescription>Create a new cluster and optionally place it under another cluster.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="cluster-name-dialog" showRequired>
                Cluster Name
              </Label>
              <Input
                id="cluster-name-dialog"
                value={clusterName}
                onChange={(e) => setClusterName(e.target.value)}
                placeholder="e.g. West Region"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cluster-parent-dialog">Parent Cluster</Label>
              <select
                id="cluster-parent-dialog"
                className={SELECT_CLASS}
                value={clusterParentId}
                onChange={(e) => setClusterParentId(e.target.value)}
              >
                <option value="">None (root cluster)</option>
                {sortedClusters.map((row) => (
                  <option key={row.id} value={String(row.id)}>
                    {row.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeCreateCluster} disabled={creatingCluster}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void createCluster()} disabled={creatingCluster}>
              {creatingCluster ? "Creating…" : "Create Cluster"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createPlantOpen} onOpenChange={(open) => (open ? setCreatePlantOpen(true) : closeCreatePlant())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Plant</DialogTitle>
            <DialogDescription>Create a new plant and optionally assign it to a cluster.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="plant-name-dialog" showRequired>
                Plant Name
              </Label>
              <Input
                id="plant-name-dialog"
                value={plantName}
                onChange={(e) => setPlantName(e.target.value)}
                placeholder="e.g. Pune Plant"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plant-cluster-dialog">Cluster</Label>
              <select
                id="plant-cluster-dialog"
                className={SELECT_CLASS}
                value={plantParentId}
                onChange={(e) => setPlantParentId(e.target.value)}
              >
                <option value="">None (unassigned plant)</option>
                {sortedClusters.map((row) => (
                  <option key={row.id} value={String(row.id)}>
                    {row.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeCreatePlant} disabled={creatingPlant}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void createPlant()} disabled={creatingPlant}>
              {creatingPlant ? "Creating…" : "Create Plant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={(open) => (open ? setEditOpen(true) : closeEdit())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget?.kind === "PLANT" ? "Edit Plant" : "Edit Cluster"}</DialogTitle>
            <DialogDescription>
              {editTarget?.kind === "PLANT"
                ? "Update the plant name or change which cluster it belongs to."
                : "Update the cluster name or move it under another cluster."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-org-name" showRequired>
                Name
              </Label>
              <Input id="edit-org-name" value={editName} onChange={(e) => setEditName(e.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-org-parent">{editTarget?.kind === "PLANT" ? "Cluster" : "Parent Cluster"}</Label>
              <select
                id="edit-org-parent"
                className={SELECT_CLASS}
                value={editParentId}
                onChange={(e) => setEditParentId(e.target.value)}
              >
                <option value="">{editTarget?.kind === "PLANT" ? "None (unassigned plant)" : "None (root cluster)"}</option>
                {(editTarget?.kind === "CLUSTER" ? clusterParentChoicesForEdit : sortedClusters).map((row) => (
                  <option key={row.id} value={String(row.id)}>
                    {row.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeEdit} disabled={savingEdit}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveEdit()} disabled={savingEdit}>
              {savingEdit ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!canCreate && !canUpdate ? (
        <p className="text-xs text-muted-foreground">
          You have read-only access. Ask an admin for <span className="font-mono">org_units.create</span> or{" "}
          <span className="font-mono">org_units.update</span> to create or edit plants and clusters.
        </p>
      ) : null}
    </div>
  )
}
