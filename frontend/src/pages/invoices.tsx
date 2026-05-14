import * as React from "react"
import { Link } from "react-router-dom"
import { Plus } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getJson } from "@/lib/api"
import { canListOrgUnitsForAssignments, hasPermission } from "@/lib/permissions"

/** Tabs follow ``validation_status`` (no payment-based grouping). */
type InvoiceValidationTab = "all" | "not_validated" | "pass" | "warn" | "fail" | "blocked"

const INVOICE_VALIDATION_TABS: { id: InvoiceValidationTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "not_validated", label: "Not validated" },
  { id: "pass", label: "Pass" },
  { id: "warn", label: "Warn" },
  { id: "fail", label: "Fail" },
  { id: "blocked", label: "Blocked" },
]

function normalizedValidation(row: { validation_status?: string | null }): string | null {
  const v = row?.validation_status
  if (v == null || String(v).trim() === "") return null
  return String(v).trim().toLowerCase()
}

function invoiceStatusLabel(status: string): string {
  switch (String(status || "").toLowerCase()) {
    case "pending_exception_approval":
      return "Exception approval"
    default:
      return status
  }
}

function invoiceStatusBadgeVariant(
  status: string,
): React.ComponentProps<typeof Badge>["variant"] {
  switch (String(status || "").toLowerCase()) {
    case "approved":
      return "success"
    case "blocked":
    case "rejected":
      return "destructive"
    case "submitted":
    case "pending_exception_approval":
      return "warning"
    case "draft":
      return "secondary"
    default:
      return "outline"
  }
}

export function InvoicesPage() {
  const canCreate = hasPermission("invoices.create")
  const canView = hasPermission("invoices.view")

  const [rows, setRows] = React.useState<any[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [validationTab, setValidationTab] = React.useState<InvoiceValidationTab>("all")
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

  const validationLabel = React.useCallback((status: string | null | undefined) => {
    const k = normalizedValidation({ validation_status: status ?? null })
    if (k === null) return "—"
    return k.charAt(0).toUpperCase() + k.slice(1)
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

  const validationCounts = React.useMemo(() => {
    const m = new Map<string, number>()
    if (!rows) return m
    for (const r of rows) {
      const k = normalizedValidation(r) ?? "__none__"
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [rows])

  const filtered = React.useMemo(() => {
    if (!rows) return []
    if (validationTab === "all") return rows
    if (validationTab === "not_validated") return rows.filter((r) => normalizedValidation(r) === null)
    return rows.filter((r) => normalizedValidation(r) === validationTab)
  }, [rows, validationTab])

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
          {/* <CardTitle className="text-sm font-medium">Invoices</CardTitle> */}
          {/* <CardDescription> */}
            {/* Tabs filter by validation engine outcome. Blocked / fail usually need fixes or exception approval before an */}
            {/* invoice can progress. */}
          {/* </CardDescription> */}
          <div className="mt-3 flex flex-wrap gap-2">
            {INVOICE_VALIDATION_TABS.map((t) => {
              const n =
                t.id === "all"
                  ? (rows?.length ?? 0)
                  : t.id === "not_validated"
                    ? (validationCounts.get("__none__") ?? 0)
                    : (validationCounts.get(t.id) ?? 0)
              return (
                <Button
                  key={t.id}
                  type="button"
                  size="sm"
                  variant={validationTab === t.id ? "default" : "outline"}
                  className="h-8"
                  onClick={() => setValidationTab(t.id)}
                >
                  {t.label}
                  <span
                    className={
                      validationTab === t.id
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
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Contractor</TableHead>
                <TableHead>Plant</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Workflow</TableHead>
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
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    No invoices in this view.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.invoice_number}</TableCell>
                    <TableCell className="text-muted-foreground">{contractorLabel(Number(r.contractor_id))}</TableCell>
                    <TableCell className="text-muted-foreground">{plantLabel(Number(r.org_unit_id))}</TableCell>
                    <TableCell className="text-xs tabular-nums">{r.invoice_date}</TableCell>
                    <TableCell>
                      <Badge variant={invoiceStatusBadgeVariant(r.status)}>
                        {invoiceStatusLabel(r.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.validation_status ? (
                        <Badge variant={validationBadgeVariant(r.validation_status)}>
                          {validationLabel(r.validation_status)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">Not validated</span>
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
