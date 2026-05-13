import * as React from "react"
import { Link, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { Plus, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError, getJson, patchJson } from "@/lib/api"
import { canListOrgUnitsForAssignments, hasPermission, isSuperuser } from "@/lib/permissions"
import { RateVersionHistoryButton } from "@/components/contractors/RateVersionHistoryDrawer"

type OrgUnitLite = { id: number; name: string; type: string; parent_id?: number | null }

export type PartMasterPublic = {
  id: number
  part_code: string
  part_name: string
  description: string | null
  unit_type: string
  pricing_method: string
  billing_basis: string
  allow_manual_amount_override: boolean
  weight_per_piece: string | number | null
  labour_headcount: number | null
  standard_man_hours: string | number | null
  base_rate: number | string
  rate_unit_type: string
  org_unit_id: number
  org_unit_name: string | null
  effective_from: string
  effective_to: string | null
  is_active: boolean
  status: string
  notes: string | null
  created_at: string
  updated_at: string
}

export function PartMasterPage() {
  const [searchParams] = useSearchParams()
  const highlightId = searchParams.get("highlight")

  const [rows, setRows] = React.useState<PartMasterPublic[]>([])
  const [orgCatalog, setOrgCatalog] = React.useState<OrgUnitLite[]>([])
  const plants = React.useMemo(
    () => orgCatalog.filter((o) => String(o.type).toUpperCase() === "PLANT"),
    [orgCatalog],
  )
  const [plantFilter, setPlantFilter] = React.useState<string>("")
  const [search, setSearch] = React.useState("")
  const [loading, setLoading] = React.useState(true)

  const canView = hasPermission("part_master.view") || isSuperuser()
  const canCreate = hasPermission("part_master.create") || isSuperuser()
  const canUpdate = hasPermission("part_master.update") || isSuperuser()

  const load = React.useCallback(async () => {
    if (!canView) return
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (plantFilter) qs.set("org_unit_id", plantFilter)
      if (search.trim()) qs.set("part_code", search.trim())
      qs.set("active", "false")
      const list = await getJson<PartMasterPublic[]>(`/part-master?${qs.toString()}`)
      setRows(Array.isArray(list) ? list : [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [canView, plantFilter, search])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    if (!canListOrgUnitsForAssignments()) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await getJson<OrgUnitLite[]>("/admin/org-units")
        if (!cancelled) setOrgCatalog(Array.isArray(data) ? data : [])
      } catch {
        if (!cancelled) setOrgCatalog([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    if (!highlightId) return
    const t = window.setTimeout(() => {
      document.querySelector(`tr[data-part-master-id="${highlightId}"]`)?.scrollIntoView({ block: "center" })
    }, 400)
    return () => window.clearTimeout(t)
  }, [highlightId, rows])

  async function toggleActive(row: PartMasterPublic) {
    if (!canUpdate) return
    try {
      await patchJson<PartMasterPublic>(`/part-master/${row.id}`, { is_active: !row.is_active })
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Update failed")
    }
  }

  if (!canView) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Part master</CardTitle>
          <CardDescription>
            You need <span className="font-mono">part_master.view</span> to access this module.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Part master</h1>
          <p className="text-sm text-muted-foreground">
            Commercial baselines: unit logic, pricing method, and effective rates per plant.
          </p>
        </div>
        {canCreate ? (
          <Button asChild>
            <Link to="/dashboard/part-master/new" className="inline-flex items-center">
              <Plus className="mr-2 size-4" />
              New part
            </Link>
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <div className="grid gap-1">
            <Label>Scope</Label>
            <select
              className="h-9 rounded-md border bg-white px-2 text-sm"
              value={plantFilter}
              onChange={(e) => setPlantFilter(e.target.value)}
            >
              <option value="">All plants & clusters</option>
              <optgroup label="Clusters">
                {orgCatalog
                  .filter((o) => String(o.type).toUpperCase() === "CLUSTER")
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Plants">
                {plants.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <div className="grid min-w-[200px] flex-1 gap-1">
            <Label>Search part</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
              <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Code or name" />
            </div>
          </div>
          <div className="flex items-end">
            <Button variant="secondary" onClick={() => void load()}>
              Apply
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parts</CardTitle>
          <CardDescription>Active and historical part master rows for the selected filters.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Pricing</TableHead>
                  <TableHead>Rate unit</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">Labour</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[120px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} data-part-master-id={r.id}>
                    <TableCell className="font-mono text-xs">{r.part_code}</TableCell>
                    <TableCell className="font-medium">{r.part_name}</TableCell>
                    <TableCell className="uppercase text-xs">{r.unit_type}</TableCell>
                    <TableCell className="text-xs capitalize">{r.pricing_method.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-xs">{r.rate_unit_type}</TableCell>
                    <TableCell className="text-right text-sm">{String(r.base_rate)}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {r.labour_headcount != null ? `${r.labour_headcount} hc` : "—"}
                      {r.standard_man_hours != null ? ` · ${String(r.standard_man_hours)} mh` : ""}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.effective_from}
                      {r.effective_to ? ` → ${r.effective_to}` : ""}
                    </TableCell>
                    <TableCell className="text-xs">{r.is_active ? "active" : "inactive"}</TableCell>
                    <TableCell className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/dashboard/part-master/${r.id}`}>Open</Link>
                      </Button>
                      {canUpdate ? (
                        <div className="flex items-center gap-2 text-xs">
                          <Switch checked={r.is_active} onCheckedChange={() => void toggleActive(r)} />
                        </div>
                      ) : null}
                      <RateVersionHistoryButton
                        resource="part-master"
                        parentId={r.id}
                        title={`${r.part_code} · ${r.part_name}`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default PartMasterPage
