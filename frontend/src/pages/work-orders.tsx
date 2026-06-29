import * as React from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { Filter, Plus, Search } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/layout/PageHeader"
import { ListPagination } from "@/components/shared/ListPagination"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getJson, getJsonList } from "@/lib/api"
import { workOrderStatusBadgeVariant, workOrderStatusLabel } from "@/lib/work-order-status-badge"
import { canListOrgUnitsForAssignments, hasPermission } from "@/lib/permissions"

type WoTab = "all" | "draft" | "operating" | "completed" | "inactive"

const WO_PAGE_SIZE = 20

const WO_TABS: { id: WoTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "operating", label: "Active" },
  { id: "completed", label: "Completed" },
  { id: "inactive", label: "Inactive" },
]

function isWoTab(value: string | null): value is WoTab {
  return WO_TABS.some((tab) => tab.id === value)
}

function workOrderPlantFromQuery(value: string | null): number | "all" {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : "all"
}

function workOrdersListPath(tab: WoTab, page: number, plantFilter: number | "all", search: string): string {
  const qs = new URLSearchParams({
    limit: String(WO_PAGE_SIZE),
    offset: String(page * WO_PAGE_SIZE),
  })
  if (plantFilter !== "all") qs.set("org_unit_id", String(plantFilter))
  if (search.trim()) qs.set("q", search.trim())
  if (tab === "draft") {
    qs.append("statuses", "draft")
    qs.append("statuses", "rejected")
    qs.append("statuses", "pending_approval")
  } else if (tab === "operating") {
    qs.append("statuses", "active")
    qs.append("statuses", "approved")
  } else if (tab === "completed") {
    qs.set("status", "closed")
  } else if (tab === "inactive") {
    qs.set("active", "false")
  }
  return `/work-orders?${qs.toString()}`
}

export function WorkOrdersPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const canCreate = hasPermission("work_orders.create")
  const canView = hasPermission("work_orders.view")

  const [page, setPage] = React.useState(0)
  const [rows, setRows] = React.useState<any[] | null>(null)
  const [total, setTotal] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [plants, setPlants] = React.useState<{ id: number; name: string }[]>([])
  const [q, setQ] = React.useState(() => searchParams.get("q") ?? "")
  const [plantFilter, setPlantFilter] = React.useState<number | "all">(() =>
    workOrderPlantFromQuery(searchParams.get("plant_id")),
  )
  const rawTab = searchParams.get("tab")
  const tab: WoTab = isWoTab(rawTab) ? rawTab : "all"

  const pageCount = Math.max(1, Math.ceil(total / WO_PAGE_SIZE))
  const pageSafe = Math.min(page, pageCount - 1)

  const load = React.useCallback(async () => {
    if (!canView) return
    setError(null)
    try {
      const { items, total: t } = await getJsonList<any>(workOrdersListPath(tab, page, plantFilter, q))
      setRows(items)
      setTotal(t)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load work orders")
      setRows([])
      setTotal(0)
    }
  }, [canView, page, plantFilter, q, tab])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    setPage(0)
  }, [plantFilter, q, tab])

  React.useEffect(() => {
    const next = new URLSearchParams()
    if (tab !== "all") next.set("tab", tab)
    if (q.trim()) next.set("q", q.trim())
    if (plantFilter !== "all") next.set("plant_id", String(plantFilter))
    setSearchParams(next, { replace: true })
  }, [plantFilter, q, setSearchParams, tab])

  React.useEffect(() => {
    if (!canView) return
    void (async () => {
      try {
        const list = canListOrgUnitsForAssignments()
          ? await getJson<{ id: number; name: string }[]>("/admin/org-units?type=PLANT").catch(() => [])
          : []
        setPlants(list)
      } catch {
        setPlants([])
      }
    })()
  }, [canView])

  const plantName = React.useCallback(
    (orgUnitId: number) => plants.find((p) => p.id === orgUnitId)?.name ?? `#${orgUnitId}`,
    [plants],
  )

  const activeFilterCount = (tab !== "all" ? 1 : 0) + (plantFilter !== "all" ? 1 : 0) + (q.trim() ? 1 : 0)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Work Orders"
        action={
          canCreate ? (
            <Button asChild type="button">
              <Link to="/dashboard/work-orders/new">
                <Plus className="size-4" /> New Work Order
              </Link>
            </Button>
          ) : null
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load work orders</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="rounded-2xl">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 opacity-60" aria-hidden />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by WO number or title…"
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Filter className="mr-2 size-4 opacity-70" aria-hidden />
                  Status
                  {tab !== "all" ? (
                    <span className="ml-2 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                      1
                    </span>
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {WO_TABS.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.id}
                    checked={tab === option.id}
                    onCheckedChange={() => {
                      const next = new URLSearchParams(searchParams)
                      if (option.id === "all") next.delete("tab")
                      else next.set("tab", option.id)
                      setSearchParams(next, { replace: true })
                    }}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Plant
                  {plantFilter !== "all" ? (
                    <span className="ml-2 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                      1
                    </span>
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-64 w-56 overflow-auto">
                <DropdownMenuLabel>Plant</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={plantFilter === "all"}
                  onCheckedChange={() => setPlantFilter("all")}
                >
                  All plants
                </DropdownMenuCheckboxItem>
                {plants.map((plant) => (
                  <DropdownMenuCheckboxItem
                    key={plant.id}
                    checked={plantFilter === plant.id}
                    onCheckedChange={() => setPlantFilter(plant.id)}
                  >
                    {plant.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {activeFilterCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQ("")
                  setPlantFilter("all")
                  setSearchParams(new URLSearchParams(), { replace: true })
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>WO #</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Plant</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
                {/* <TableHead className="text-right">Open</TableHead> */}
              </TableRow>
            </TableHeader>
            <TableBody>
              {!rows ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No work orders in this view.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/dashboard/work-orders/${r.id}`)}
                  >
                    <TableCell className="font-medium">{r.work_order_number}</TableCell>
                    <TableCell>{r.title}</TableCell>
                    <TableCell className="text-muted-foreground">{plantName(Number(r.org_unit_id))}</TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {r.created_at
                        ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
                            new Date(r.created_at),
                          )
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={workOrderStatusBadgeVariant(r.status, r.is_active)}>
                        {workOrderStatusLabel(r.status, r.is_active)}
                      </Badge>
                    </TableCell>
                    {/* <TableCell className="text-right">
                      <Button asChild size="sm" variant="ghost">
                        <Link to={`/dashboard/work-orders/${r.id}`}>Open</Link>
                      </Button>
                    </TableCell> */}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {total > 0 ? (
            <ListPagination
              page={pageSafe}
              pageSize={WO_PAGE_SIZE}
              total={total}
              loading={rows === null}
              onPageChange={setPage}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

export default WorkOrdersPage
