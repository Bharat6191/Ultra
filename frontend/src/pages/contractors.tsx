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
import { EmptyState } from "@/components/shared/EmptyState"
import { DataTable } from "@/components/shared/DataTable"
import { getJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"
import {
  CONTRACTOR_STATUS_OPTIONS,
  CONTRACTOR_TYPE_OPTIONS,
} from "@/components/contractors/status"
import { BriefcaseBusiness, Filter, Plus, Search, SlidersHorizontal } from "lucide-react"
import { useNavigate } from "react-router-dom"

type Plant = { id: number; name: string }

export function ContractorsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = React.useState<ContractorRow[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [q, setQ] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<string | "all">("all")
  const [typeFilter, setTypeFilter] = React.useState<string | "all">("all")
  const [plantFilter, setPlantFilter] = React.useState<number | "all">("all")
  const [plants, setPlants] = React.useState<Plant[]>([])

  const canCreate = hasPermission("contractor.create")

  const stats: ContractorListStatsData = React.useMemo(() => {
    const total = rows?.length ?? 0
    const active = rows?.filter((r) => r.status === "active").length ?? 0
    const nonCompliant =
      rows?.filter((r) => r.status === "non_compliant" || r.compliance?.state === "non_compliant").length ?? 0
    const expiringSoon =
      rows?.reduce((sum, r) => sum + (r.compliance?.expiring_soon ?? 0), 0) ?? 0
    return { total, active, nonCompliant, expiringSoon }
  }, [rows])

  async function load() {
    setError(null)
    try {
      const qs = new URLSearchParams()
      qs.set("offset", "0")
      qs.set("limit", "100")
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

  const activeFilterCount =
    (statusFilter !== "all" ? 1 : 0) + (typeFilter !== "all" ? 1 : 0) + (plantFilter !== "all" ? 1 : 0)

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Contractors</h1>
          <div className="text-sm text-muted-foreground">
            Manage contractor master, plant mappings and compliance documents.
          </div>
        </div>
        <div className="flex items-center gap-2">
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
      </div>

      <ContractorListStats data={stats} loading={rows === null} />

      {/* Filter bar */}
      <Card className="rounded-2xl">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 opacity-60" aria-hidden />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, code, PAN, GSTIN or email…"
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

      {rows !== null && rows.length === 0 && !error ? (
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
          <ContractorTable rows={rows} loading={rows === null} />
        </DataTable>
      )}
    </div>
  )
}
