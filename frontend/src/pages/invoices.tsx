import * as React from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { Plus } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getJson } from "@/lib/api"
import {
  invoiceDisplayStatus,
  invoiceDisplayStatusBadgeVariant,
  invoiceDisplayStatusLabel,
} from "@/lib/invoice-validation-display"
import { canListOrgUnitsForAssignments, hasPermission } from "@/lib/permissions"

type InvoiceStatusTab = "all" | "pass" | "blocked"

const INVOICE_STATUS_TABS: { id: InvoiceStatusTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pass", label: "Pass" },
  { id: "blocked", label: "Blocked" },
]

export function InvoicesPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const canCreate = hasPermission("invoices.create")
  const canView = hasPermission("invoices.view")

  const [rows, setRows] = React.useState<any[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [contractors, setContractors] = React.useState<{ id: number; name: string }[]>([])
  const [plants, setPlants] = React.useState<{ id: number; name: string }[]>([])
  const statusFilter = (searchParams.get("status") ?? "all").trim().toLowerCase()
  const statusTab: InvoiceStatusTab =
    statusFilter === "pass" ? "pass" : statusFilter === "blocked" ? "blocked" : "all"

  const contractorLabel = React.useCallback(
    (id: number) => contractors.find((c) => c.id === id)?.name ?? `#${id}`,
    [contractors],
  )

  const plantLabel = React.useCallback(
    (id: number) => plants.find((p) => p.id === id)?.name ?? `#${id}`,
    [plants],
  )

  const workOrderSummary = React.useCallback((row: any) => {
    const labels: string[] = Array.from(
      new Set<string>(
        Array.isArray(row?.lines)
          ? row.lines
              .map((line: any) =>
                typeof line?.work_order_number === "string" ? line.work_order_number.trim() : "",
              )
              .filter((value: string) => Boolean(value))
          : [],
      ),
    )
    if (labels.length === 0) return "—"
    if (labels.length === 1) return labels[0]
    return `${labels[0]} +${labels.length - 1} more`
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

  const statusCounts = React.useMemo(() => {
    let pass = 0
    let blocked = 0
    if (!rows) return { pass, blocked }
    for (const r of rows) {
      const d = invoiceDisplayStatus(r)
      if (d === "pass") pass += 1
      else if (d === "blocked") blocked += 1
    }
    return { pass, blocked }
  }, [rows])

  const filtered = React.useMemo(() => {
    if (!rows) return []
    if (statusFilter === "pending_exception_approval") {
      return rows.filter((r) => String(r.status ?? "").toLowerCase() === "pending_exception_approval")
    }
    if (statusFilter === "pass") return rows.filter((r) => invoiceDisplayStatus(r) === "pass")
    if (statusFilter === "blocked") return rows.filter((r) => invoiceDisplayStatus(r) === "blocked")
    return rows
  }, [rows, statusFilter])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium">Invoices</h2>
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
          <div className="mt-3 flex flex-wrap gap-2">
            {INVOICE_STATUS_TABS.map((t) => {
              const n =
                t.id === "all"
                  ? (rows?.length ?? 0)
                  : t.id === "pass"
                    ? statusCounts.pass
                    : statusCounts.blocked
              return (
                <Button
                  key={t.id}
                  type="button"
                  size="sm"
                  variant={statusTab === t.id ? "default" : "outline"}
                  className="h-8"
                  onClick={() => {
                    const next = new URLSearchParams(searchParams)
                    if (t.id === "all") next.delete("status")
                    else next.set("status", t.id)
                    setSearchParams(next, { replace: true })
                  }}
                >
                  {t.label}
                  <span
                    className={
                      statusTab === t.id
                        ? "ml-1.5 tabular-nums text-primary-foreground/85"
                        : "ml-1.5 tabular-nums text-muted-foreground"
                    }
                  >
                    ({n})
                  </span>
                </Button>
              )
            })}
          </div>
          {statusFilter === "pending_exception_approval" ? (
            <div className="mt-2 text-xs text-muted-foreground">Showing pending approval invoices.</div>
          ) : null}
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Work Order</TableHead>
                <TableHead>Contractor</TableHead>
                <TableHead>Plant</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                {/* <TableHead className="text-right">Open</TableHead> */}
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
                    No invoices yet.
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No invoices in this view.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => {
                  const d = invoiceDisplayStatus(r)
                  return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/dashboard/invoices/${r.id}`)}
                    >
                      <TableCell className="font-medium">{r.invoice_number}</TableCell>
                      <TableCell className="text-muted-foreground">{workOrderSummary(r)}</TableCell>
                      <TableCell className="text-muted-foreground">{contractorLabel(Number(r.contractor_id))}</TableCell>
                      <TableCell className="text-muted-foreground">{plantLabel(Number(r.org_unit_id))}</TableCell>
                      <TableCell className="text-xs tabular-nums">{r.invoice_date}</TableCell>
                      <TableCell>
                        <Badge variant={invoiceDisplayStatusBadgeVariant(d)}>
                          {invoiceDisplayStatusLabel(d)}
                        </Badge>
                      </TableCell>
                      {/* <TableCell className="text-right">
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/dashboard/invoices/${r.id}`}>Open</Link>
                        </Button>
                      </TableCell> */}
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

export default InvoicesPage
