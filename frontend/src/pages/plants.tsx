import * as React from "react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError, getJson, postJson } from "@/lib/api"
import { hasPermission, isSuperuser } from "@/lib/permissions"

type OrgUnitPublic = {
  id: number
  name: string
  type: string
  parent_id: number | null
  created_at: string
  updated_at: string
}

export function PlantsPage() {
  const [plants, setPlants] = React.useState<OrgUnitPublic[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [creating, setCreating] = React.useState(false)

  const canCreate = hasPermission("org_units.create") || isSuperuser()

  async function load() {
    setError(null)
    try {
      const p = await getJson<OrgUnitPublic[]>("/admin/org-units?type=PLANT")
      setPlants(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load plants")
      setPlants([])
    }
  }

  React.useEffect(() => {
    void load()
  }, [])

  async function createPlant() {
    const plantName = name.trim()
    if (!plantName) {
      toast.error("Plant name is required.")
      return
    }
    setCreating(true)
    toast.loading("Creating plant…", { id: "create-plant-page" })
    try {
      await postJson<OrgUnitPublic>("/admin/org-units", {
        name: plantName,
        type: "PLANT",
        parent_id: null,
      })
      toast.success("Plant created", { id: "create-plant-page" })
      setOpen(false)
      setName("")
      await load()
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to create plant"
      toast.error(message, { id: "create-plant-page" })
      setError(message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">Plants</h2>
          <p className="text-sm text-muted-foreground">Manage plants (org units of type PLANT).</p>
        </div>

        {canCreate ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Create plant</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create plant</DialogTitle>
                <DialogDescription>Add a new plant. Type is set to PLANT.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="plant-name-page">Plant name</Label>
                  <Input
                    id="plant-name-page"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Plant A"
                    autoComplete="off"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="button" size="sm" disabled={creating} onClick={() => void createPlant()}>
                    {creating ? "Creating…" : "Create"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="rounded-lg border">
        <div className="px-3 py-2 text-sm font-medium">All plants</div>
        <Separator />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-[140px]">Type</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plants === null ? (
              <TableRow>
                <TableCell colSpan={2} className="py-8 text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : plants.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="py-8 text-center text-sm text-muted-foreground">
                  No plants found.
                </TableCell>
              </TableRow>
            ) : (
              plants
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">{p.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{p.type}</TableCell>
                  </TableRow>
                ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

