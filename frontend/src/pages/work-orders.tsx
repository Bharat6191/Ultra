import * as React from "react"
import { Link } from "react-router-dom"
import { Plus } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getJson } from "@/lib/api"
import { workOrderStatusBadgeVariant } from "@/lib/work-order-status-badge"
import { canListOrgUnitsForAssignments, hasPermission } from "@/lib/permissions"

type WoTab = "all" | "draft" | "approval" | "operating" | "completed"

const WO_TABS: { id: WoTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "approval", label: "In approval" },
  { id: "operating", label: "Active" },
  { id: "completed", label: "Completed" },
]

function workOrdersListPath(tab: WoTab): string {
  const q = new URLSearchParams({ limit: "100" })
  if (tab === "draft") {
    q.append("statuses", "draft")
    q.append("statuses", "rejected")
  } else if (tab === "approval") {
    q.set("status", "pending_approval")
  } else if (tab === "operating") {
    q.append("statuses", "active")
    q.append("statuses", "approved")
  } else if (tab === "completed") {
    q.set("status", "closed")
  }
  return `/work-orders?${q.toString()}`
}

/** Friendly label in lists; raw `status` still drives badges and routing. */
function workOrderStatusLabel(status: string): string {
  switch (String(status || "").toLowerCase()) {
    case "closed":
      return "Completed"
    case "pending_approval":
      return "In approval"
    case "draft":
      return "Draft"
    case "rejected":
      return "Returned"
    default:
      return status
  }
}

export function WorkOrdersPage() {
  const canCreate = hasPermission("work_orders.create")
  const canView = hasPermission("work_orders.view")

  const [tab, setTab] = React.useState<WoTab>("all")
  const [rows, setRows] = React.useState<any[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [plants, setPlants] = React.useState<{ id: number; name: string }[]>([])

  const load = React.useCallback(async () => {
    if (!canView) return
    setError(null)
    try {
      const list = await getJson<any[]>(workOrdersListPath(tab))
      setRows(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load work orders")
      setRows([])
    }
  }, [canView, tab])

  React.useEffect(() => {
    void load()
  }, [load])

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
          <h2 className="text-base font-medium">Work orders</h2>
          <p className="text-sm text-muted-foreground">
            Assign operational work to a contractor with Part Master lines, track completion, and govern downstream invoicing.
          </p>
        </div>
        {canCreate ? (
          <Button asChild type="button">
            <Link to="/dashboard/work-orders/new">
              <Plus className="size-4" /> New work order
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
          <CardTitle className="text-sm font-medium">Work orders</CardTitle>
          <CardDescription>
            <strong>Draft</strong> means not yet live (including returned edits)—not the same as <strong>In approval</strong>, which
            is waiting on approvers in <strong>My tasks</strong>. <strong>Completed</strong> lists closed work orders.
          </CardDescription>
          <div className="mt-3 flex flex-wrap gap-2">
            {WO_TABS.map((t) => (
              <Button
                key={t.id}
                type="button"
                size="sm"
                variant={tab === t.id ? "default" : "outline"}
                className="h-8"
                onClick={() => setTab(t.id)}
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
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!rows ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No work orders in this view.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.work_order_number}</TableCell>
                    <TableCell>{r.title}</TableCell>
                    <TableCell className="text-muted-foreground">{plantName(Number(r.org_unit_id))}</TableCell>
                    <TableCell className="text-xs tabular-nums">{r.work_date}</TableCell>
                    <TableCell>
                      <Badge variant={workOrderStatusBadgeVariant(r.status)}>{workOrderStatusLabel(r.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="ghost">
                        <Link to={`/dashboard/work-orders/${r.id}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

export default WorkOrdersPage
