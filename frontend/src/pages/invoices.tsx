import * as React from "react"
import { Link } from "react-router-dom"
import { Plus } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getJson } from "@/lib/api"
import { canListOrgUnitsForAssignments, hasPermission } from "@/lib/permissions"

export function InvoicesPage() {
  const canCreate = hasPermission("invoices.create")
  const canView = hasPermission("invoices.view")

  const [rows, setRows] = React.useState<any[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [contractors, setContractors] = React.useState<{ id: number; name: string }[]>([])
  const [plants, setPlants] = React.useState<{ id: number; name: string }[]>([])

  const contractorLabel = React.useCallback(
    (id: number) => contractors.find((c) => c.id === id)?.name ?? `#${id}`,
    [contractors],
  )

  const plantLabel = React.useCallback(
    (id: number) => plants.find((p) => p.id === id)?.name ?? `#${id}`,
    [plants],
  )

  const validationBadgeVariant = React.useCallback((status: string): React.ComponentProps<typeof Badge>["variant"] => {
    switch (String(status || "").toLowerCase()) {
      case "pass":
        return "success"
      case "warn":
        return "warning"
      case "fail":
        return "destructive"
      case "blocked":
        return "destructive"
      default:
        return "outline"
    }
  }, [])

  const load = React.useCallback(async () => {
    if (!canView) return
    setError(null)
    try {
      const list = await getJson<any[]>("/invoices?limit=100")
      setRows(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load invoices")
      setRows([])
    }
  }, [canView])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    if (!canView && !canCreate) return
    void (async () => {
      try {
        const [clist, plist] = await Promise.all([
          getJson<{ id: number; name: string }[]>("/contractors/lookup?limit=200&status=active").catch(() => []),
          canListOrgUnitsForAssignments()
            ? getJson<{ id: number; name: string }[]>("/admin/org-units?type=PLANT").catch(() => [])
            : Promise.resolve([]),
        ])
        setContractors(clist)
        setPlants(plist)
      } catch {
        setContractors([])
        setPlants([])
      }
    })()
  }, [canView, canCreate])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium">Invoices</h2>
          <p className="text-sm text-muted-foreground">
            Finance-grade validation: active work orders, latest completion snapshots, negotiated rates,
            configurable tolerance, cumulative caps, variance workflow.
          </p>
        </div>
        {canCreate ? (
          <Button asChild type="button">
            <Link to="/dashboard/invoices/new">
              <Plus className="size-4" /> New invoice
            </Link>
          </Button>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load invoices</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Invoices</CardTitle>
          <CardDescription>Blocked rows invoke variance approvals after justification + attachment package.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Contractor</TableHead>
                <TableHead>Plant</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Validation</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!rows ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    No invoices yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.invoice_number}</TableCell>
                    <TableCell className="text-muted-foreground">{contractorLabel(Number(r.contractor_id))}</TableCell>
                    <TableCell className="text-muted-foreground">{plantLabel(Number(r.org_unit_id))}</TableCell>
                    <TableCell className="text-xs tabular-nums">{r.invoice_date}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "blocked" ? "destructive" : "outline"}>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.validation_status ? (
                        <Badge variant={validationBadgeVariant(r.validation_status)}>{r.validation_status}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="ghost">
                        <Link to={`/dashboard/invoices/${r.id}`}>Open</Link>
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

export default InvoicesPage
