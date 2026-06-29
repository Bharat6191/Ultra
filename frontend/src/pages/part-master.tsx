import * as React from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { Filter, Plus, Search, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ListPagination } from "@/components/shared/ListPagination"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getJson } from "@/lib/api"
import { canListOrgUnitsForAssignments, hasPermission, isSuperuser } from "@/lib/permissions"

type OrgUnitLite = { id: number; name: string; type: string; parent_id?: number | null }
type PartStatusFilter = "all" | "active" | "inactive"

const PART_MASTER_PAGE_SIZE = 20

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
  labour_cost: string | number | null
  man_days: string | number | null
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

function formatCompactNumber(value: string | number | null, maximumFractionDigits = 4): string {
  if (value === null || value === undefined || value === "") return "—"
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return String(value)
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits })
}

function formatManDays(value: string | number | null): string {
  return formatCompactNumber(value, 4)
}

function formatLabourCost(value: string | number | null): string {
  return formatCompactNumber(value, 2)
}

export function PartMasterPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const highlightId = searchParams.get("highlight")

  const [rows, setRows] = React.useState<PartMasterPublic[]>([])
  const [page, setPage] = React.useState(0)
  const [orgCatalog, setOrgCatalog] = React.useState<OrgUnitLite[]>([])
  const plants = React.useMemo(
    () => orgCatalog.filter((o) => String(o.type).toUpperCase() === "PLANT"),
    [orgCatalog],
  )
  const [plantFilter, setPlantFilter] = React.useState<string>("")
  const [statusFilter, setStatusFilter] = React.useState<PartStatusFilter>("all")
  const [search, setSearch] = React.useState("")
  const [loading, setLoading] = React.useState(true)

  const canView = hasPermission("part_master.view") || isSuperuser()
  const canCreate = hasPermission("part_master.create") || isSuperuser()

  const load = React.useCallback(async () => {
    if (!canView) return
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (plantFilter) qs.set("org_unit_id", plantFilter)
      if (search.trim()) qs.set("search", search.trim())
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

  React.useEffect(() => {
    setPage(0)
  }, [plantFilter, search, statusFilter])

  const filteredRows = React.useMemo(
    () =>
      rows.filter((row) => {
        if (statusFilter === "active") return row.is_active
        if (statusFilter === "inactive") return !row.is_active
        return true
      }),
    [rows, statusFilter],
  )

  const paginatedRows = React.useMemo(
    () => filteredRows.slice(page * PART_MASTER_PAGE_SIZE, (page + 1) * PART_MASTER_PAGE_SIZE),
    [filteredRows, page],
  )

  const clusters = React.useMemo(
    () =>
      orgCatalog
        .filter((o) => String(o.type).toUpperCase() === "CLUSTER")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [orgCatalog],
  )

  const activeFilterCount = (plantFilter ? 1 : 0) + (statusFilter !== "all" ? 1 : 0) + (search.trim() ? 1 : 0)

  if (!canView) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Part Master</CardTitle>
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
          <h1 className="text-2xl font-semibold tracking-tight">Part Master</h1>
          {/* <p className="text-sm text-muted-foreground">
            Commercial baselines: unit logic, pricing method, and effective rates per plant.
          </p> */}
        </div>
        {canCreate ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline">
              <Upload className="size-4" />
              Import Excel
            </Button>
            <Button asChild>
              <Link to="/dashboard/part-master/new" className="inline-flex items-center">
                <Plus className="mr-2 size-4" />
                New part
              </Link>
            </Button>
          </div>
        ) : null}
      </div>

      <Card className="rounded-2xl">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 opacity-60" aria-hidden />
            <Input
              aria-label="Search part"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by Part Code or Part Name…"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Filter className="mr-2 size-4 opacity-70" aria-hidden />
                  Status
                  {statusFilter !== "all" ? (
                    <span className="ml-2 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                      1
                    </span>
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={statusFilter === "all"} onCheckedChange={() => setStatusFilter("all")}>
                  All
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={statusFilter === "active"}
                  onCheckedChange={() => setStatusFilter("active")}
                >
                  Active
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={statusFilter === "inactive"}
                  onCheckedChange={() => setStatusFilter("inactive")}
                >
                  Inactive
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Plant
                  {plantFilter ? (
                    <span className="ml-2 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                      1
                    </span>
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-64 w-56 overflow-auto">
                <DropdownMenuLabel>Scope</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={plantFilter === ""} onCheckedChange={() => setPlantFilter("")}>
                  All Plants & Clusters
                </DropdownMenuCheckboxItem>
                {clusters.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Clusters</DropdownMenuLabel>
                    {clusters.map((cluster) => (
                      <DropdownMenuCheckboxItem
                        key={cluster.id}
                        checked={plantFilter === String(cluster.id)}
                        onCheckedChange={() => setPlantFilter(String(cluster.id))}
                      >
                        {cluster.name}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </>
                ) : null}
                {plants.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Plants</DropdownMenuLabel>
                    {plants.map((plant) => (
                      <DropdownMenuCheckboxItem
                        key={plant.id}
                        checked={plantFilter === String(plant.id)}
                        onCheckedChange={() => setPlantFilter(String(plant.id))}
                      >
                        {plant.name}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>

            {activeFilterCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("")
                  setPlantFilter("")
                  setStatusFilter("all")
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parts</CardTitle>
          {/* <CardDescription>Active and historical part master rows for the selected filters.</CardDescription> */}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <>
              <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Pricing</TableHead>
                  <TableHead>Rate Unit</TableHead>
                  <TableHead className="text-right">Should Cost</TableHead>
                  <TableHead className="text-right">Cost / Day</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead>Status</TableHead>
                  {/* <TableHead className="w-[72px] text-right">Actions</TableHead> */}
                </TableRow>
              </TableHeader>
              <TableBody>
                  {filteredRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                        No parts match this filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedRows.map((r) => (
                    <TableRow
                      key={r.id}
                      data-part-master-id={r.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/dashboard/part-master/${r.id}`)}
                    >
                      <TableCell className="font-mono text-xs">{r.part_code}</TableCell>
                      <TableCell className="font-medium">{r.part_name}</TableCell>
                      <TableCell className="uppercase text-xs">{r.unit_type}</TableCell>
                      <TableCell className="text-xs capitalize">{r.pricing_method.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-xs">{r.rate_unit_type}</TableCell>
                      <TableCell className="text-right text-sm">{String(r.base_rate)}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {r.labour_cost != null || r.man_days != null ? (
                          <>
                            {r.labour_cost != null ? formatLabourCost(r.labour_cost) : "—"}
                            {r.man_days != null ? `/${formatManDays(r.man_days)}d` : ""}
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.effective_from}
                        {r.effective_to ? ` → ${r.effective_to}` : ""}
                      </TableCell>
                      <TableCell className="text-xs">{r.is_active ? "active" : "inactive"}</TableCell>
                      {/*
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" className="rounded-lg" aria-label="Row actions">
                              <MoreHorizontal className="size-4 opacity-70" aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.preventDefault()
                                navigate(`/dashboard/part-master/${r.id}`)
                              }}
                            >
                              <Eye className="mr-2 size-4 opacity-70" aria-hidden />
                              View
                            </DropdownMenuItem>
                            {canUpdate ? (
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault()
                                  navigate(`/dashboard/part-master/${r.id}`)
                                }}
                              >
                                <Pencil className="mr-2 size-4 opacity-70" aria-hidden />
                                Edit
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.preventDefault()
                                setHistoryRow(r)
                              }}
                            >
                              <History className="mr-2 size-4 opacity-70" aria-hidden />
                              Version history
                            </DropdownMenuItem>
                            {canUpdate ? (
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault()
                                  void toggleActive(r)
                                }}
                              >
                                {r.is_active ? "Deactivate" : "Activate"}
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                      */}
                    </TableRow>
                  ))
                )}
              </TableBody>
              </Table>
              <ListPagination
                page={page}
                pageSize={PART_MASTER_PAGE_SIZE}
                total={filteredRows.length}
                loading={loading}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default PartMasterPage
