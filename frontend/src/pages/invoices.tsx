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
import { getJson } from "@/lib/api"
import {
  invoiceDisplayStatus,
  invoiceDisplayStatusBadgeVariant,
  invoiceDisplayStatusLabel,
} from "@/lib/invoice-validation-display"
import { canListOrgUnitsForAssignments, hasPermission } from "@/lib/permissions"

type InvoiceStatusTab = "all" | "draft" | "pass" | "blocked" | "rejected" | "pending_exception_approval"

const INVOICE_STATUS_TABS: { id: InvoiceStatusTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "pass", label: "Pass" },
  { id: "blocked", label: "Blocked" },
  { id: "rejected", label: "Rejected" },
  { id: "pending_exception_approval", label: "Pending Approval" },
]

const INVOICE_PAGE_SIZE = 20

function invoicePlantFromQuery(value: string | null): number | "all" {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : "all"
}

export function InvoicesPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const canCreate = hasPermission("invoices.create")
  const canView = hasPermission("invoices.view")

  const [rows, setRows] = React.useState<any[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [page, setPage] = React.useState(0)
  const [q, setQ] = React.useState(() => searchParams.get("q") ?? "")
  const [plantFilter, setPlantFilter] = React.useState<number | "all">(() =>
    invoicePlantFromQuery(searchParams.get("plant_id")),
  )
  const [contractors, setContractors] = React.useState<{ id: number; name: string }[]>([])
  const [plants, setPlants] = React.useState<{ id: number; name: string }[]>([])
  const statusFilter = (searchParams.get("status") ?? "all").trim().toLowerCase()
  const statusTab: InvoiceStatusTab =
    statusFilter === "draft"
      ? "draft"
      : statusFilter === "pass"
        ? "pass"
        : statusFilter === "blocked"
          ? "blocked"
          : statusFilter === "rejected"
            ? "rejected"
          : statusFilter === "pending_exception_approval"
            ? "pending_exception_approval"
          : "all"

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
      const list = await getJson<any[]>("/invoices?limit=200")
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

  const filtered = React.useMemo(() => {
    if (!rows) return []
    const query = q.trim().toLowerCase()
    if (statusFilter === "pending_exception_approval") {
      return rows.filter((r) => {
        if (String(r.status ?? "").toLowerCase() !== "pending_exception_approval") return false
        if (plantFilter !== "all" && Number(r.org_unit_id) !== plantFilter) return false
        if (!query) return true
        const haystack = [
          r.invoice_number ?? "",
          workOrderSummary(r),
          contractorLabel(Number(r.contractor_id)),
          plantLabel(Number(r.org_unit_id)),
        ]
          .join(" ")
          .toLowerCase()
        return haystack.includes(query)
      })
    }
    return rows.filter((r) => {
      if (statusFilter === "draft" && invoiceDisplayStatus(r) !== "draft") return false
      if (statusFilter === "pass" && invoiceDisplayStatus(r) !== "pass") return false
      if (statusFilter === "blocked" && invoiceDisplayStatus(r) !== "blocked") return false
      if (statusFilter === "rejected" && invoiceDisplayStatus(r) !== "rejected") return false
      if (plantFilter !== "all" && Number(r.org_unit_id) !== plantFilter) return false
      if (!query) return true
      const haystack = [
        r.invoice_number ?? "",
        workOrderSummary(r),
        contractorLabel(Number(r.contractor_id)),
        plantLabel(Number(r.org_unit_id)),
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [contractorLabel, plantFilter, plantLabel, q, rows, statusFilter, workOrderSummary])

  const paginatedRows = React.useMemo(
    () => filtered.slice(page * INVOICE_PAGE_SIZE, (page + 1) * INVOICE_PAGE_SIZE),
    [filtered, page],
  )

  React.useEffect(() => {
    setPage(0)
  }, [plantFilter, q, statusFilter])

  React.useEffect(() => {
    const next = new URLSearchParams()
    if (statusTab !== "all") next.set("status", statusTab)
    if (q.trim()) next.set("q", q.trim())
    if (plantFilter !== "all") next.set("plant_id", String(plantFilter))
    setSearchParams(next, { replace: true })
  }, [plantFilter, q, setSearchParams, statusTab])

  const activeFilterCount = (statusTab !== "all" ? 1 : 0) + (plantFilter !== "all" ? 1 : 0) + (q.trim() ? 1 : 0)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Invoices"
        action={
          canCreate ? (
            <Button asChild type="button">
              <Link to="/dashboard/invoices/new">
                <Plus className="size-4" /> New invoice
              </Link>
            </Button>
          ) : null
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load invoices</AlertTitle>
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
              placeholder="Search by Invoice Number, Work Order, Contractor or Plant…"
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Filter className="mr-2 size-4 opacity-70" aria-hidden />
                  Status
                  {statusTab !== "all" ? (
                    <span className="ml-2 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                      1
                    </span>
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {INVOICE_STATUS_TABS.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.id}
                    checked={statusTab === option.id}
                    onCheckedChange={() => {
                      const next = new URLSearchParams(searchParams)
                      if (option.id === "all") next.delete("status")
                      else next.set("status", option.id)
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
                <DropdownMenuCheckboxItem checked={plantFilter === "all"} onCheckedChange={() => setPlantFilter("all")}>
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
        <CardContent className="p-0 overflow-x-auto border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice No.</TableHead>
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
                paginatedRows.map((r) => {
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
          <ListPagination
            page={page}
            pageSize={INVOICE_PAGE_SIZE}
            total={filtered.length}
            loading={rows === null}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>
    </div>
  )
}

export default InvoicesPage
