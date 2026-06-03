import * as React from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { ChevronLeft, ChevronRight, Plus } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getJson, getJsonList } from "@/lib/api"
import { workOrderStatusBadgeVariant, workOrderStatusLabel } from "@/lib/work-order-status-badge"
import { canListOrgUnitsForAssignments, hasPermission } from "@/lib/permissions"

type WoTab = "all" | "draft" | "operating" | "completed" | "inactive"
type WorkOrderStatusFilter = "draft" | "rejected" | "pending_approval" | "active" | "approved" | "closed"

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

function isWorkOrderStatusFilter(value: string | null): value is WorkOrderStatusFilter {
  return ["draft", "rejected", "pending_approval", "active", "approved", "closed"].includes(value ?? "")
}

function workOrdersListPath(tab: WoTab, page: number, statusFilter: WorkOrderStatusFilter | null): string {
  const q = new URLSearchParams({
    limit: String(WO_PAGE_SIZE),
    offset: String(page * WO_PAGE_SIZE),
  })
  if (statusFilter) {
    q.set("status", statusFilter)
  } else if (tab === "draft") {
    q.append("statuses", "draft")
    q.append("statuses", "rejected")
    q.append("statuses", "pending_approval")
  } else if (tab === "operating") {
    q.append("statuses", "active")
    q.append("statuses", "approved")
  } else if (tab === "completed") {
    q.set("status", "closed")
  } else if (tab === "inactive") {
    q.set("active", "false")
  }
  return `/work-orders?${q.toString()}`
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
  const rawTab = searchParams.get("tab")
  const rawStatus = searchParams.get("status")
  const tab: WoTab = isWoTab(rawTab) ? rawTab : "all"
  const statusFilter: WorkOrderStatusFilter | null = isWorkOrderStatusFilter(rawStatus) ? rawStatus : null

  const pageCount = Math.max(1, Math.ceil(total / WO_PAGE_SIZE))
  const pageSafe = Math.min(page, pageCount - 1)
  const rangeStart = total === 0 ? 0 : pageSafe * WO_PAGE_SIZE + 1
  const rangeEnd = Math.min(total, (pageSafe + 1) * WO_PAGE_SIZE)

  const load = React.useCallback(async () => {
    if (!canView) return
    setError(null)
    try {
      const { items, total: t } = await getJsonList<any>(workOrdersListPath(tab, page, statusFilter))
      setRows(items)
      setTotal(t)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load work orders")
      setRows([])
      setTotal(0)
    }
  }, [canView, page, statusFilter, tab])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    setPage(0)
  }, [tab])

  const onTabChange = React.useCallback(
    (nextTab: WoTab) => {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete("status")
      if (nextTab === "all") nextParams.delete("tab")
      else nextParams.set("tab", nextTab)
      setSearchParams(nextParams, { replace: true })
    },
    [searchParams, setSearchParams],
  )

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium">Work Orders</h2>
        </div>
        {canCreate ? (
          <Button asChild type="button">
            <Link to="/dashboard/work-orders/new">
              <Plus className="size-4" /> New Work Order
            </Link>
          </Button>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load work orders</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <div className="mt-3 flex flex-wrap gap-2">
            {WO_TABS.map((t) => (
              <Button
                key={t.id}
                type="button"
                size="sm"
                variant={tab === t.id ? "default" : "outline"}
                className="h-8"
                onClick={() => onTabChange(t.id)}
              >
                {t.label}
              </Button>
            ))}
          </div>
        </CardHeader>
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
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
              <p className="text-xs text-muted-foreground">
                Showing {rangeStart}–{rangeEnd} of {total}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2"
                  disabled={pageSafe <= 0 || rows === null}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="min-w-[4.5rem] text-center text-xs tabular-nums text-muted-foreground">
                  {pageSafe + 1} / {pageCount}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2"
                  disabled={pageSafe >= pageCount - 1 || rows === null}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  aria-label="Next page"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

export default WorkOrdersPage
