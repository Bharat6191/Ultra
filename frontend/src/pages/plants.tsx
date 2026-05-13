import * as React from "react"
import { toast } from "sonner"

import { AccessDenied } from "@/components/admin/access-denied"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApiError, getJson, patchJson, postJson } from "@/lib/api"
import { cn } from "@/lib/utils"
import { hasPermission, isSuperuser } from "@/lib/permissions"

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

export function PlantsPage() {
  const [plants, setPlants] = React.useState<OrgUnitPublic[] | null>(null)
  const [clusters, setClusters] = React.useState<OrgUnitPublic[]>([])
  const [error, setError] = React.useState<string | null>(null)

  const [clusterName, setClusterName] = React.useState("")
  const [clusterParentId, setClusterParentId] = React.useState<string>("")
  const [creatingCluster, setCreatingCluster] = React.useState(false)

  const [plantName, setPlantName] = React.useState("")
  const [plantParentId, setPlantParentId] = React.useState<string>("")
  const [creatingPlant, setCreatingPlant] = React.useState(false)

  const [attachPlantId, setAttachPlantId] = React.useState<string>("")
  const [attachClusterId, setAttachClusterId] = React.useState<string>("")
  const [attaching, setAttaching] = React.useState(false)

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

  const [tab, setTab] = React.useState<string>("catalog")

  React.useEffect(() => {
    if (tab === "cluster" && !canCreate) setTab("catalog")
    if (tab === "plant" && !canCreate) setTab("catalog")
    if (tab === "attach" && !canUpdate) setTab("catalog")
  }, [tab, canCreate, canUpdate])

  const clusterById = React.useMemo(() => {
    const m = new Map<number, OrgUnitPublic>()
    for (const c of clusters) m.set(c.id, c)
    return m
  }, [clusters])

  /** Cluster ids in the subtree rooted at ``rootId`` (includes ``rootId``). Used to block invalid parent picks. */
  const clusterSubtreeIds = React.useCallback(
    (rootId: number) => {
      const out = new Set<number>([rootId])
      const queue = [rootId]
      while (queue.length) {
        const cur = queue.shift()!
        for (const c of clusters) {
          if (c.parent_id === cur && !out.has(c.id)) {
            out.add(c.id)
            queue.push(c.id)
          }
        }
      }
      return out
    },
    [clusters],
  )

  async function load() {
    setError(null)
    try {
      const [p, c] = await Promise.all([
        getJson<OrgUnitPublic[]>("/admin/org-units?type=PLANT"),
        getJson<OrgUnitPublic[]>("/admin/org-units?type=CLUSTER"),
      ])
      setPlants(p)
      setClusters(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load org units")
      setPlants([])
      setClusters([])
    }
  }

  React.useEffect(() => {
    void load()
  }, [])

  async function createCluster() {
    const n = clusterName.trim()
    if (!n) {
      toast.error("Cluster name is required.")
      return
    }
    setCreatingCluster(true)
    toast.loading("Creating cluster…", { id: "create-cluster-page" })
    try {
      await postJson<OrgUnitPublic>("/admin/org-units", {
        name: n,
        type: "CLUSTER",
        parent_id: clusterParentId ? Number(clusterParentId) : null,
      })
      toast.success("Cluster created", { id: "create-cluster-page" })
      setClusterName("")
      setClusterParentId("")
      await load()
      setTab("catalog")
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to create cluster"
      toast.error(message, { id: "create-cluster-page" })
      setError(message)
    } finally {
      setCreatingCluster(false)
    }
  }

  async function createPlant() {
    const n = plantName.trim()
    if (!n) {
      toast.error("Plant name is required.")
      return
    }
    setCreatingPlant(true)
    toast.loading("Creating plant…", { id: "create-plant-page" })
    try {
      await postJson<OrgUnitPublic>("/admin/org-units", {
        name: n,
        type: "PLANT",
        parent_id: plantParentId ? Number(plantParentId) : null,
      })
      toast.success("Plant created", { id: "create-plant-page" })
      setPlantName("")
      setPlantParentId("")
      await load()
      setTab("catalog")
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to create plant"
      toast.error(message, { id: "create-plant-page" })
      setError(message)
    } finally {
      setCreatingPlant(false)
    }
  }

  async function attachPlantToCluster() {
    if (!attachPlantId) {
      toast.error("Select a plant.")
      return
    }
    setAttaching(true)
    toast.loading("Updating plant…", { id: "attach-plant-page" })
    try {
      await patchJson<OrgUnitPublic>(`/admin/org-units/${attachPlantId}`, {
        parent_id: attachClusterId ? Number(attachClusterId) : null,
      })
      toast.success("Plant updated", { id: "attach-plant-page" })
      setAttachPlantId("")
      setAttachClusterId("")
      await load()
      setTab("catalog")
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to update plant"
      toast.error(message, { id: "attach-plant-page" })
      setError(message)
    } finally {
      setAttaching(false)
    }
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

  async function saveEdit() {
    if (!editTarget) return
    const n = editName.trim()
    if (!n) {
      toast.error("Name is required.")
      return
    }
    setSavingEdit(true)
    toast.loading("Saving…", { id: "edit-org-page" })
    try {
      await patchJson<OrgUnitPublic>(`/admin/org-units/${editTarget.row.id}`, {
        name: n,
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

  const catalogColSpan = showActions ? 4 : 3

  const sortedClusters = React.useMemo(
    () => clusters.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [clusters],
  )

  const clusterParentChoicesForEdit = React.useMemo(() => {
    if (!editTarget || editTarget.kind !== "CLUSTER") return sortedClusters
    const blocked = clusterSubtreeIds(editTarget.row.id)
    return sortedClusters.filter((c) => !blocked.has(c.id))
  }, [editTarget, sortedClusters, clusterSubtreeIds])

  const sortedPlants = React.useMemo(() => {
    if (!plants) return []
    return plants.slice().sort((a, b) => a.name.localeCompare(b.name))
  }, [plants])

  return (
    <div className="space-y-4">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-medium">Clusters & plants</h2>
        <p className="text-sm text-muted-foreground">
          Create clusters and plants, attach plants to clusters, or edit names and parent links in the catalog
          (edit requires <span className="font-mono text-xs">org_units.update</span>). Creating rows requires{" "}
          <span className="font-mono text-xs">org_units.create</span>.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 p-1 sm:w-auto">
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          {canCreate ? <TabsTrigger value="cluster">New cluster</TabsTrigger> : null}
          {canCreate ? <TabsTrigger value="plant">New plant</TabsTrigger> : null}
          {canUpdate ? <TabsTrigger value="attach">Attach plant</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="catalog" className="mt-0 space-y-4">
          <div className="rounded-lg border">
            <div className="px-3 py-2 text-sm font-medium">Plants</div>
            <Separator />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Cluster</TableHead>
                  <TableHead className="w-[100px]">Type</TableHead>
                  {showActions ? <TableHead className="w-[88px] text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {plants === null ? (
                  <TableRow>
                    <TableCell colSpan={catalogColSpan} className="py-8 text-center text-sm text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : sortedPlants.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={catalogColSpan} className="py-8 text-center text-sm text-muted-foreground">
                      No plants found.
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedPlants.map((p) => {
                    const parent = p.parent_id != null ? clusterById.get(p.parent_id) : null
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="text-sm">{p.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {parent ? parent.name : "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{p.type}</TableCell>
                        {showActions ? (
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8"
                              onClick={() => openEdit(p, "PLANT")}
                            >
                              Edit
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-lg border">
            <div className="px-3 py-2 text-sm font-medium">Clusters</div>
            <Separator />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Parent cluster</TableHead>
                  <TableHead className="w-[100px]">Type</TableHead>
                  {showActions ? <TableHead className="w-[88px] text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {plants === null ? (
                  <TableRow>
                    <TableCell colSpan={catalogColSpan} className="py-8 text-center text-sm text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : sortedClusters.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={catalogColSpan} className="py-8 text-center text-sm text-muted-foreground">
                      No clusters yet. Open the <strong>New cluster</strong> tab to add one.
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedClusters.map((c) => {
                    const parent = c.parent_id != null ? clusterById.get(c.parent_id) : null
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm">{c.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{parent ? parent.name : "—"}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{c.type}</TableCell>
                        {showActions ? (
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8"
                              onClick={() => openEdit(c, "CLUSTER")}
                            >
                              Edit
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="cluster" className="mt-0">
          {canCreate ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Create cluster</CardTitle>
                <CardDescription>
                  Permission: <span className="font-mono text-xs">org_units.create</span>. Optional parent nests this
                  cluster under another cluster.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cluster-name-page">Cluster name</Label>
                  <Input
                    id="cluster-name-page"
                    value={clusterName}
                    onChange={(e) => setClusterName(e.target.value)}
                    placeholder="e.g. Western region"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cluster-parent-page">Parent cluster (optional)</Label>
                  <select
                    id="cluster-parent-page"
                    className={SELECT_CLASS}
                    value={clusterParentId}
                    onChange={(e) => setClusterParentId(e.target.value)}
                  >
                    <option value="">None (root cluster)</option>
                    {sortedClusters.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </CardContent>
              <CardFooter className="justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setTab("catalog")}>
                  Cancel
                </Button>
                <Button type="button" size="sm" disabled={creatingCluster} onClick={() => void createCluster()}>
                  {creatingCluster ? "Creating…" : "Create cluster"}
                </Button>
              </CardFooter>
            </Card>
          ) : (
            <AccessDenied message="You need org_units.create (or a superuser) to create clusters." />
          )}
        </TabsContent>

        <TabsContent value="plant" className="mt-0">
          {canCreate ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Create plant</CardTitle>
                <CardDescription>
                  Permission: <span className="font-mono text-xs">org_units.create</span>. Choose a cluster so the
                  plant is grouped correctly; leave cluster unset only for legacy flat setups.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="plant-name-page">Plant name</Label>
                  <Input
                    id="plant-name-page"
                    value={plantName}
                    onChange={(e) => setPlantName(e.target.value)}
                    placeholder="e.g. Plant A"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="plant-cluster-page">Cluster (optional)</Label>
                  <select
                    id="plant-cluster-page"
                    className={SELECT_CLASS}
                    value={plantParentId}
                    onChange={(e) => setPlantParentId(e.target.value)}
                  >
                    <option value="">None (unassigned plant)</option>
                    {sortedClusters.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </CardContent>
              <CardFooter className="justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setTab("catalog")}>
                  Cancel
                </Button>
                <Button type="button" size="sm" disabled={creatingPlant} onClick={() => void createPlant()}>
                  {creatingPlant ? "Creating…" : "Create plant"}
                </Button>
              </CardFooter>
            </Card>
          ) : (
            <AccessDenied message="You need org_units.create (or a superuser) to create plants." />
          )}
        </TabsContent>

        <TabsContent value="attach" className="mt-0">
          {canUpdate ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Attach plant to cluster</CardTitle>
                <CardDescription>
                  Permission: <span className="font-mono text-xs">org_units.update</span>. Sets the plant&apos;s parent
                  cluster. Choose &quot;Unassigned&quot; to clear the cluster link.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="attach-plant">Plant</Label>
                  <select
                    id="attach-plant"
                    className={SELECT_CLASS}
                    value={attachPlantId}
                    onChange={(e) => setAttachPlantId(e.target.value)}
                  >
                    <option value="">Select a plant…</option>
                    {sortedPlants.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="attach-cluster">Cluster</Label>
                  <select
                    id="attach-cluster"
                    className={SELECT_CLASS}
                    value={attachClusterId}
                    onChange={(e) => setAttachClusterId(e.target.value)}
                  >
                    <option value="">Unassigned (remove from cluster)</option>
                    {sortedClusters.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </CardContent>
              <CardFooter className="justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setTab("catalog")}>
                  Cancel
                </Button>
                <Button type="button" size="sm" disabled={attaching} onClick={() => void attachPlantToCluster()}>
                  {attaching ? "Saving…" : "Save"}
                </Button>
              </CardFooter>
            </Card>
          ) : (
            <AccessDenied message="You need org_units.update (or a superuser) to attach plants to clusters." />
          )}
        </TabsContent>
      </Tabs>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          if (!open) closeEdit()
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget?.kind === "PLANT" ? "Edit plant" : "Edit cluster"}</DialogTitle>
            <DialogDescription>
              {editTarget?.kind === "PLANT"
                ? "Update the display name or move the plant to another cluster (or leave unassigned)."
                : "Update the display name or reparent the cluster. You cannot choose this cluster or anything nested under it as the parent."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-org-name">Name</Label>
              <Input
                id="edit-org-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-org-parent">
                {editTarget?.kind === "PLANT" ? "Cluster (optional)" : "Parent cluster (optional)"}
              </Label>
              <select
                id="edit-org-parent"
                className={SELECT_CLASS}
                value={editParentId}
                onChange={(e) => setEditParentId(e.target.value)}
              >
                <option value="">
                  {editTarget?.kind === "PLANT" ? "None (unassigned plant)" : "None (root cluster)"}
                </option>
                {(editTarget?.kind === "CLUSTER" ? clusterParentChoicesForEdit : sortedClusters).map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => closeEdit()} disabled={savingEdit}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveEdit()} disabled={savingEdit}>
              {savingEdit ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!canCreate && !canUpdate && tab === "catalog" ? (
        <p className="text-xs text-muted-foreground">
          You have read-only access. Ask an admin for <span className="font-mono">org_units.create</span> or{" "}
          <span className="font-mono">org_units.update</span> to create or edit plants and clusters.
        </p>
      ) : null}
    </div>
  )
}
