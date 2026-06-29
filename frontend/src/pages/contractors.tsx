import * as React from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ContractorTable, type ContractorRow } from "@/components/contractors/ContractorTable"
import { ContractorListStats, type ContractorListStatsData } from "@/components/contractors/ContractorListStats"
import { PageHeader } from "@/components/layout/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"
import { DataTable } from "@/components/shared/DataTable"
import { ListPagination } from "@/components/shared/ListPagination"
import { getJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"
import {
  CONTRACTOR_STATUS_OPTIONS,
  CONTRACTOR_TYPE_OPTIONS,
} from "@/components/contractors/status"
import { BriefcaseBusiness, Filter, Plus, Search, SlidersHorizontal } from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"

type Plant = { id: number; name: string }

const CONTRACTOR_PAGE_SIZE = 20

function contractorStatusFromQuery(value: string | null): string | "all" {
  return CONTRACTOR_STATUS_OPTIONS.some((option) => option.value === value) ? (value as string) : "all"
}

function contractorTypeFromQuery(value: string | null): string | "all" {
  return CONTRACTOR_TYPE_OPTIONS.some((option) => option.value === value) ? (value as string) : "all"
}

function contractorPlantFromQuery(value: string | null): number | "all" {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : "all"
}

export function ContractorsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [rows, setRows] = React.useState<ContractorRow[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [page, setPage] = React.useState(0)
  const [q, setQ] = React.useState(() => searchParams.get("q") ?? "")
  const [statusFilter, setStatusFilter] = React.useState<string | "all">(() =>
    contractorStatusFromQuery(searchParams.get("status")),
  )
  const [typeFilter, setTypeFilter] = React.useState<string | "all">(() =>
    contractorTypeFromQuery(searchParams.get("type")),
  )
  const [plantFilter, setPlantFilter] = React.useState<number | "all">(() =>
    contractorPlantFromQuery(searchParams.get("plant_id")),
  )
  const [expiringOnly, setExpiringOnly] = React.useState(() => searchParams.get("expiring") === "soon")
  const [plants, setPlants] = React.useState<Plant[]>([])

  const canCreate = hasPermission("contractor.create")

  const displayRows = React.useMemo(
    () => (rows ?? []).filter((row) => !expiringOnly || (row.compliance?.expiring_soon ?? 0) > 0),
    [expiringOnly, rows],
  )

  const stats: ContractorListStatsData = React.useMemo(() => {
    const total = displayRows.length
    const active = displayRows.filter((r) => r.status === "active").length
    const nonCompliant =
      displayRows.filter((r) => r.status === "non_compliant" || r.compliance?.state === "non_compliant").length
    const expiringSoon =
      displayRows.reduce((sum, r) => sum + (r.compliance?.expiring_soon ?? 0), 0)
    return { total, active, nonCompliant, expiringSoon }
  }, [displayRows])

  const paginatedRows = React.useMemo(
    () => displayRows.slice(page * CONTRACTOR_PAGE_SIZE, (page + 1) * CONTRACTOR_PAGE_SIZE),
    [displayRows, page],
  )

  async function load() {
    setError(null)
    try {
      const qs = new URLSearchParams()
      qs.set("offset", "0")
      qs.set("limit", "200")
      if (q.trim()) qs.set("q", q.trim())
      if (statusFilter !== "all") qs.set("status", statusFilter)
      if (typeFilter !== "all") qs.set("type", typeFilter)
      if (plantFilter !== "all") qs.set("plant_id", String(plantFilter))
      const data = await getJson<ContractorRow[]>(`/contractors?${qs.toString()}`)
      setRows(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contractors")
      setRows([])
    }
  }

  async function loadPlants() {
    try {
      const data = await getJson<Plant[]>("/admin/org-units?type=PLANT")
      const sorted = [...data].sort((a, b) => a.name.localeCompare(b.name))
      setPlants(sorted)
    } catch {
      setPlants([])
    }
  }

  React.useEffect(() => {
    void load()
    void loadPlants()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    const t = setTimeout(() => void load(), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, statusFilter, typeFilter, plantFilter])

  React.useEffect(() => {
    const next = new URLSearchParams()
    if (q.trim()) next.set("q", q.trim())
    if (statusFilter !== "all") next.set("status", statusFilter)
    if (typeFilter !== "all") next.set("type", typeFilter)
    if (plantFilter !== "all") next.set("plant_id", String(plantFilter))
    if (expiringOnly) next.set("expiring", "soon")
    setSearchParams(next, { replace: true })
  }, [expiringOnly, plantFilter, q, setSearchParams, statusFilter, typeFilter])

  React.useEffect(() => {
    setPage(0)
  }, [expiringOnly, plantFilter, q, statusFilter, typeFilter])

  const activeFilterCount =
    (statusFilter !== "all" ? 1 : 0) +
    (typeFilter !== "all" ? 1 : 0) +
    (plantFilter !== "all" ? 1 : 0) +
    (expiringOnly ? 1 : 0)

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Contractors"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const blob = new Blob([JSON.stringify(rows ?? [], null, 2)], {
                  type: "application/json",
                })
                const url = URL.createObjectURL(blob)
                const a = document.createElement("a")
                a.href = url
                a.download = "contractors.json"
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              <SlidersHorizontal className="mr-2 size-4 opacity-70" aria-hidden />
              Export
            </Button>
            <Button
              disabled={!canCreate}
              onClick={() => navigate("/dashboard/contractors/new")}
              title={!canCreate ? "Missing permission: contractor.create" : undefined}
            >
              <Plus className="mr-2 size-4" aria-hidden />
              Add contractor
            </Button>
          </div>
        }
      />

      <ContractorListStats data={stats} loading={rows === null} />

      {/* Filter bar */}
      <Card className="rounded-2xl">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 opacity-60" aria-hidden />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, code, PAN Number, GSTIN Number or email…"
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Status filter */}
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
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={statusFilter === "all"}
                  onCheckedChange={() => setStatusFilter("all")}
                >
                  All
                </DropdownMenuCheckboxItem>
                {CONTRACTOR_STATUS_OPTIONS.map((opt) => (
                  <DropdownMenuCheckboxItem
                    key={opt.value}
                    checked={statusFilter === opt.value}
                    onCheckedChange={() => setStatusFilter(opt.value)}
                  >
                    {opt.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Type filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Type
                  {typeFilter !== "all" ? (
                    <span className="ml-2 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                      1
                    </span>
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Contractor type</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={typeFilter === "all"}
                  onCheckedChange={() => setTypeFilter("all")}
                >
                  All
                </DropdownMenuCheckboxItem>
                {CONTRACTOR_TYPE_OPTIONS.map((opt) => (
                  <DropdownMenuCheckboxItem
                    key={opt.value}
                    checked={typeFilter === opt.value}
                    onCheckedChange={() => setTypeFilter(opt.value)}
                  >
                    {opt.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Plant filter */}
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
                {plants.map((p) => (
                  <DropdownMenuCheckboxItem
                    key={p.id}
                    checked={plantFilter === p.id}
                    onCheckedChange={() => setPlantFilter(p.id)}
                  >
                    {p.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {activeFilterCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStatusFilter("all")
                  setTypeFilter("all")
                  setPlantFilter("all")
                  setExpiringOnly(false)
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card className="border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Unable to load contractors</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      {rows !== null && displayRows.length === 0 && !error ? (
        <DataTable>
          <EmptyState
            icon={BriefcaseBusiness}
            title="No contractors found"
            description={
              activeFilterCount > 0
                ? "Try clearing some filters or refining your search."
                : "Create your first contractor to get started."
            }
            action={
              canCreate
                ? {
                    label: "Add contractor",
                    onClick: () => navigate("/dashboard/contractors/new"),
                  }
                : undefined
            }
          />
        </DataTable>
      ) : (
        <DataTable>
          <ContractorTable rows={paginatedRows} loading={rows === null} />
          <ListPagination
            page={page}
            pageSize={CONTRACTOR_PAGE_SIZE}
            total={displayRows.length}
            loading={rows === null}
            onPageChange={setPage}
          />
        </DataTable>
      )}
    </div>
  )
}
