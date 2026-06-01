import * as React from "react"
import { Printer, RefreshCcw } from "lucide-react"

import { formatMoney } from "@/components/contractors/rateStatus"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getJson } from "@/lib/api"
import { canListOrgUnitsForAssignments } from "@/lib/permissions"

type LookupOption = {
  id: number
  name: string
}

type InvoiceReportBucket = {
  entity_id: number | null
  entity_name: string
  invoice_count: number
  total_value: number | string
}

type InvoiceReportRow = {
  id: number
  invoice_number: string
  invoice_date: string
  status: string
  contractor_id: number | null
  contractor_name: string | null
  org_unit_id: number | null
  org_unit_name: string | null
  total_amount: number | string
}

type InvoiceReportSummary = {
  total_invoices: number
  total_value: number | string
  rows: InvoiceReportRow[]
  by_plant: InvoiceReportBucket[]
  by_contractor: InvoiceReportBucket[]
}

const STATUS_OPTIONS = [
  { value: "all", label: "All Status" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "pending_exception_approval", label: "Pending Approval" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
  { value: "blocked", label: "Blocked" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
] as const

type StatusValue = (typeof STATUS_OPTIONS)[number]["value"]

type ReportFilters = {
  dateFrom: string
  dateTo: string
  status: StatusValue
  contractorId: string
  orgUnitId: string
}

const EMPTY_FILTERS: ReportFilters = {
  dateFrom: "",
  dateTo: "",
  status: "all",
  contractorId: "",
  orgUnitId: "",
}

function formatDateLabel(value: string): string {
  if (!value) return "All"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function formatDateTimeLabel(value: Date | null): string {
  if (!value) return "—"
  return value.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function invoiceStatusLabel(status: string): string {
  const normalized = status.trim().toLowerCase()
  switch (normalized) {
    case "draft":
      return "Draft"
    case "submitted":
      return "Submitted"
    case "pending_exception_approval":
      return "Pending Approval"
    case "approved":
      return "Approved"
    case "paid":
      return "Paid"
    case "blocked":
      return "Blocked"
    case "rejected":
      return "Rejected"
    case "cancelled":
      return "Cancelled"
    default:
      return normalized ? normalized.replaceAll("_", " ") : "—"
  }
}

function findName(options: LookupOption[], value: string, fallback: string): string {
  if (!value) return fallback
  const matched = options.find((option) => String(option.id) === value)
  return matched?.name ?? fallback
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function FilterField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-sm font-medium text-zinc-900">{label}</span>
      {children}
    </label>
  )
}

function SummaryTable({
  title,
  nameLabel,
  rows,
}: {
  title: string
  nameLabel: string
  rows: InvoiceReportBucket[]
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-emerald-100 print:rounded-none print:border-zinc-300">
      <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-3 print:bg-white">
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-800 print:text-zinc-950">
          {title}
        </h3>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-zinc-50 hover:bg-zinc-50">
            <TableHead className="w-16">S. No</TableHead>
            <TableHead>{nameLabel}</TableHead>
            <TableHead className="text-right">Count</TableHead>
            <TableHead className="text-right">Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                No rows found.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, index) => (
              <TableRow key={`${title}-${row.entity_id ?? "x"}-${row.entity_name}`}>
                <TableCell>{index + 1}</TableCell>
                <TableCell className="font-medium text-zinc-900">{row.entity_name}</TableCell>
                <TableCell className="text-right tabular-nums">{row.invoice_count}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(row.total_value)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

export function ReportsPage() {
  const [filters, setFilters] = React.useState<ReportFilters>(EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = React.useState<ReportFilters>(EMPTY_FILTERS)
  const [report, setReport] = React.useState<InvoiceReportSummary | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [loadedAt, setLoadedAt] = React.useState<Date | null>(null)
  const [contractors, setContractors] = React.useState<LookupOption[]>([])
  const [plants, setPlants] = React.useState<LookupOption[]>([])

  React.useEffect(() => {
    void (async () => {
      try {
        const [contractorList, plantList] = await Promise.all([
          getJson<LookupOption[]>("/contractors/lookup?limit=200&status=active").catch(() => []),
          canListOrgUnitsForAssignments()
            ? getJson<LookupOption[]>("/admin/org-units?type=PLANT").catch(() => [])
            : Promise.resolve([]),
        ])
        setContractors(contractorList)
        setPlants(plantList)
      } catch {
        setContractors([])
        setPlants([])
      }
    })()
  }, [])

  const loadReport = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (appliedFilters.dateFrom) qs.set("date_from", appliedFilters.dateFrom)
      if (appliedFilters.dateTo) qs.set("date_to", appliedFilters.dateTo)
      if (appliedFilters.status !== "all") qs.set("status", appliedFilters.status)
      if (appliedFilters.contractorId) qs.set("contractor_id", appliedFilters.contractorId)
      if (appliedFilters.orgUnitId) qs.set("org_unit_id", appliedFilters.orgUnitId)

      const query = qs.toString()
      const data = await getJson<InvoiceReportSummary>(`/invoices/reports/summary${query ? `?${query}` : ""}`)
      setReport(data)
      setLoadedAt(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load invoice report")
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [appliedFilters])

  React.useEffect(() => {
    void loadReport()
  }, [loadReport])

  const selectedStatusLabel =
    STATUS_OPTIONS.find((option) => option.value === appliedFilters.status)?.label ?? "All Status"
  const selectedPlantLabel = findName(plants, appliedFilters.orgUnitId, "All Plants")
  const selectedContractorLabel = findName(contractors, appliedFilters.contractorId, "All Contractors")

  function printReport() {
    if (typeof window === "undefined" || !report) return

    const issuedAt = formatDateTimeLabel(loadedAt)
    const logoSrc = escapeHtml(`${window.location.origin}/logo/logo.png`)
    const invoiceRows = report.rows
      .map(
        (row, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(row.invoice_number)}</td>
            <td>${escapeHtml(row.invoice_date)}</td>
            <td>${escapeHtml(row.org_unit_name ?? "—")}</td>
            <td>${escapeHtml(row.contractor_name ?? "—")}</td>
            <td>${escapeHtml(invoiceStatusLabel(row.status))}</td>
            <td class="num">${escapeHtml(formatMoney(row.total_amount))}</td>
          </tr>
        `,
      )
      .join("")

    const plantSummaryRows = report.by_plant
      .map(
        (row, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(row.entity_name)}</td>
            <td class="num">${row.invoice_count}</td>
            <td class="num">${escapeHtml(formatMoney(row.total_value))}</td>
          </tr>
        `,
      )
      .join("")

    const contractorSummaryRows = report.by_contractor
      .map(
        (row, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(row.entity_name)}</td>
            <td class="num">${row.invoice_count}</td>
            <td class="num">${escapeHtml(formatMoney(row.total_value))}</td>
          </tr>
        `,
      )
      .join("")

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Invoice Report</title>
    <style>
      @page {
        size: A4 landscape;
        margin: 10mm;
      }
      * {
        box-sizing: border-box;
      }
      html, body {
        margin: 0;
        padding: 0;
        color: #18181b;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 11px;
        line-height: 1.35;
      }
      body {
        padding: 0;
      }
      .report {
        width: 100%;
      }
      .report-header {
        display: grid;
        grid-template-columns: 190px 1fr 190px;
        align-items: center;
        gap: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid #d4d4d8;
        margin-bottom: 14px;
      }
      .logo-wrap {
        display: flex;
        align-items: center;
        justify-content: flex-start;
      }
      .logo {
        width: 150px;
        height: auto;
        display: block;
      }
      .header-title {
        margin: 0;
        text-align: center;
        font-size: 24px;
        font-weight: 700;
        color: #047857;
      }
      .header-spacer {
        width: 100%;
      }
      .filter-grid,
      .stats-grid {
        display: grid;
        gap: 10px;
        margin-bottom: 14px;
      }
      .filter-grid {
        grid-template-columns: repeat(5, minmax(0, 1fr));
      }
      .stats-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
      .label {
        font-size: 9px;
        font-weight: 700;
        color: #047857;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 3px;
      }
      .value {
        font-size: 13px;
        font-weight: 600;
      }
      .stat {
        border: 1px solid #d1fae5;
        padding: 10px;
      }
      .stat .value {
        font-size: 20px;
      }
      .section {
        margin-top: 16px;
      }
      .section-title {
        margin: 0 0 8px;
        font-size: 12px;
        font-weight: 700;
        color: #047857;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .summary-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
        page-break-inside: avoid;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      th, td {
        border: 1px solid #d4d4d8;
        padding: 6px 7px;
        vertical-align: top;
        word-break: break-word;
        overflow-wrap: anywhere;
      }
      th {
        background: #ecfdf5;
        color: #065f46;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
      }
      td.num, th.num {
        text-align: right;
        white-space: nowrap;
      }
      .invoice-list th:nth-child(1),
      .invoice-list td:nth-child(1) { width: 5%; }
      .invoice-list th:nth-child(2),
      .invoice-list td:nth-child(2) { width: 18%; }
      .invoice-list th:nth-child(3),
      .invoice-list td:nth-child(3) { width: 10%; }
      .invoice-list th:nth-child(4),
      .invoice-list td:nth-child(4) { width: 18%; }
      .invoice-list th:nth-child(5),
      .invoice-list td:nth-child(5) { width: 23%; }
      .invoice-list th:nth-child(6),
      .invoice-list td:nth-child(6) { width: 11%; }
      .invoice-list th:nth-child(7),
      .invoice-list td:nth-child(7) { width: 15%; }
      .footer {
        margin-top: 16px;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        color: #52525b;
        font-size: 10px;
      }
      .page-break-avoid {
        page-break-inside: avoid;
      }
    </style>
  </head>
  <body>
    <div class="report">
      <div class="report-header">
        <div class="logo-wrap">
          <img class="logo" src="${logoSrc}" alt="Ultra Corpotech Pvt. Ltd." />
        </div>
        <h1 class="header-title">Invoice Report</h1>
        <div class="header-spacer"></div>
      </div>

      <div class="filter-grid">
        <div><div class="label">From Date</div><div class="value">${escapeHtml(formatDateLabel(appliedFilters.dateFrom))}</div></div>
        <div><div class="label">To Date</div><div class="value">${escapeHtml(formatDateLabel(appliedFilters.dateTo))}</div></div>
        <div><div class="label">Plant</div><div class="value">${escapeHtml(selectedPlantLabel)}</div></div>
        <div><div class="label">Contractor</div><div class="value">${escapeHtml(selectedContractorLabel)}</div></div>
        <div><div class="label">Status</div><div class="value">${escapeHtml(selectedStatusLabel)}</div></div>
      </div>

      <div class="stats-grid page-break-avoid">
        <div class="stat"><div class="label">Total Invoices</div><div class="value">${report.total_invoices}</div></div>
        <div class="stat"><div class="label">Total Value</div><div class="value">${escapeHtml(formatMoney(report.total_value))}</div></div>
        <div class="stat"><div class="label">Plants Covered</div><div class="value">${report.by_plant.length}</div></div>
        <div class="stat"><div class="label">Contractors Covered</div><div class="value">${report.by_contractor.length}</div></div>
      </div>

      <div class="section">
        <h2 class="section-title">Invoice List</h2>
        <table class="invoice-list">
          <thead>
            <tr>
              <th>S. No</th>
              <th>Invoice No.</th>
              <th>Date</th>
              <th>Plant</th>
              <th>Contractor</th>
              <th>Status</th>
              <th class="num">Value</th>
            </tr>
          </thead>
          <tbody>
            ${invoiceRows || `<tr><td colspan="7">No invoices found for the selected filters.</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="section summary-grid">
        <div>
          <h2 class="section-title">Plant Wise Summary</h2>
          <table>
            <thead>
              <tr>
                <th>S. No</th>
                <th>Plant</th>
                <th class="num">Count</th>
                <th class="num">Value</th>
              </tr>
            </thead>
            <tbody>
              ${plantSummaryRows || `<tr><td colspan="4">No rows found.</td></tr>`}
            </tbody>
          </table>
        </div>

        <div>
          <h2 class="section-title">Contractor Wise Summary</h2>
          <table>
            <thead>
              <tr>
                <th>S. No</th>
                <th>Contractor</th>
                <th class="num">Count</th>
                <th class="num">Value</th>
              </tr>
            </thead>
            <tbody>
              ${contractorSummaryRows || `<tr><td colspan="4">No rows found.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div class="footer">
        <div>Generated By: System</div>
        <div>Generated Date &amp; Time: ${escapeHtml(issuedAt)}</div>
      </div>
    </div>
  </body>
</html>`

    const iframe = document.createElement("iframe")
    iframe.style.position = "fixed"
    iframe.style.right = "0"
    iframe.style.bottom = "0"
    iframe.style.width = "0"
    iframe.style.height = "0"
    iframe.style.border = "0"
    iframe.setAttribute("aria-hidden", "true")
    document.body.appendChild(iframe)

    const frameDoc = iframe.contentDocument
    const frameWindow = iframe.contentWindow
    if (!frameDoc || !frameWindow) {
      iframe.remove()
      return
    }

    const cleanup = () => {
      window.setTimeout(() => {
        iframe.remove()
      }, 500)
    }

    frameWindow.onafterprint = cleanup
    frameDoc.open()
    frameDoc.write(html)
    frameDoc.close()
    window.setTimeout(() => {
      frameWindow.focus()
      frameWindow.print()
    }, 150)
  }

  return (
    <div className="w-full space-y-6 print:space-y-4">
      <div className="border-b border-emerald-100 pb-4 text-center print:hidden">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Invoice Report</h1>
      </div>

      <Card className="rounded-3xl border border-emerald-100 shadow-sm print:hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg text-zinc-950">Invoice Report Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              setAppliedFilters(filters)
            }}
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <FilterField label="Date From">
                <Input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      dateFrom: event.target.value,
                    }))
                  }
                />
              </FilterField>

              <FilterField label="Date To">
                <Input
                  type="date"
                  value={filters.dateTo}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      dateTo: event.target.value,
                    }))
                  }
                />
              </FilterField>

              <FilterField label="Plant">
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={filters.orgUnitId}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      orgUnitId: event.target.value,
                    }))
                  }
                >
                  <option value="">All Plants</option>
                  {plants.map((plant) => (
                    <option key={plant.id} value={String(plant.id)}>
                      {plant.name}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label="Contractor">
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={filters.contractorId}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      contractorId: event.target.value,
                    }))
                  }
                >
                  <option value="">All Contractors</option>
                  {contractors.map((contractor) => (
                    <option key={contractor.id} value={String(contractor.id)}>
                      {contractor.name}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label="Status">
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={filters.status}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      status: event.target.value as StatusValue,
                    }))
                  }
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FilterField>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={loading}>
                <RefreshCcw className="size-4" />
                Generate Report
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={loading}
                onClick={() => {
                  setFilters(EMPTY_FILTERS)
                  setAppliedFilters(EMPTY_FILTERS)
                }}
              >
                Reset Filters
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive" className="print:hidden">
          <AlertTitle>Invoice Report</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-sm print:rounded-none print:border-0 print:shadow-none">
        <div className="border-b border-emerald-100 px-6 py-6 print:px-0 print:py-0">
          <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">
                Reports
              </div>
              <h2 className="text-3xl font-semibold tracking-tight text-zinc-950">Invoice Report</h2>
              <p className="text-sm text-zinc-600">
                Detailed invoice list with plant-wise and contractor-wise totals.
              </p>
            </div>

              <Button
                variant="outline"
                onClick={printReport}
              >
                <Printer className="size-4" />
                Print Report
            </Button>
          </div>

          <div className="hidden print:block print:pb-4">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">INVOICE REPORT</h2>
          </div>

          <div className="mt-6 grid gap-4 border-t border-emerald-100 pt-6 md:grid-cols-2 xl:grid-cols-5 print:mt-0 print:border-t-0 print:pt-0">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">From Date</div>
              <div className="mt-1 font-medium text-zinc-900">{formatDateLabel(appliedFilters.dateFrom)}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">To Date</div>
              <div className="mt-1 font-medium text-zinc-900">{formatDateLabel(appliedFilters.dateTo)}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Plant</div>
              <div className="mt-1 font-medium text-zinc-900">{selectedPlantLabel}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Contractor</div>
              <div className="mt-1 font-medium text-zinc-900">{selectedContractorLabel}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Status</div>
              <div className="mt-1 font-medium text-zinc-900">{selectedStatusLabel}</div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 border-b border-emerald-100 bg-emerald-50/50 px-6 py-5 md:grid-cols-2 xl:grid-cols-4 print:bg-white print:px-0">
          <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3 print:rounded-none print:border-zinc-300">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Total Invoices</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
              {loading ? "—" : report?.total_invoices ?? 0}
            </div>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3 print:rounded-none print:border-zinc-300">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Total Value</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
              {loading ? "—" : formatMoney(report?.total_value ?? 0)}
            </div>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3 print:rounded-none print:border-zinc-300">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Plants Covered</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
              {loading ? "—" : report?.by_plant.length ?? 0}
            </div>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3 print:rounded-none print:border-zinc-300">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Contractors Covered</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
              {loading ? "—" : report?.by_contractor.length ?? 0}
            </div>
          </div>
        </div>

        <div className="space-y-6 px-6 py-6 print:px-0">
          <div className="overflow-hidden rounded-2xl border border-emerald-100 print:rounded-none print:border-zinc-300">
            <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-3 print:bg-white">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-800 print:text-zinc-950">
                Invoice List
              </h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-zinc-50 hover:bg-zinc-50">
                  <TableHead className="w-16">S. No</TableHead>
                  <TableHead>Invoice No.</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Plant</TableHead>
                  <TableHead>Contractor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      Loading report...
                    </TableCell>
                  </TableRow>
                ) : !report || report.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      No invoices found for the selected filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  report.rows.map((row, index) => (
                    <TableRow key={row.id}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell className="font-medium text-zinc-950">{row.invoice_number}</TableCell>
                      <TableCell className="tabular-nums">{row.invoice_date}</TableCell>
                      <TableCell>{row.org_unit_name ?? "—"}</TableCell>
                      <TableCell>{row.contractor_name ?? "—"}</TableCell>
                      <TableCell>{invoiceStatusLabel(row.status)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(row.total_amount)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-6 xl:grid-cols-2 print:grid-cols-1">
            <SummaryTable title="Plant Wise Summary" nameLabel="Plant" rows={report?.by_plant ?? []} />
            <SummaryTable title="Contractor Wise Summary" nameLabel="Contractor" rows={report?.by_contractor ?? []} />
          </div>
        </div>

        <div className="border-t border-emerald-100 bg-zinc-50 px-6 py-4 text-sm text-zinc-600 print:bg-white print:px-0">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              Generated By: <span className="font-medium text-zinc-950">System</span>
            </div>
            <div>
              Generated Date &amp; Time:{" "}
              <span className="font-medium text-zinc-950">
                {loading ? "Refreshing..." : formatDateTimeLabel(loadedAt)}
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
