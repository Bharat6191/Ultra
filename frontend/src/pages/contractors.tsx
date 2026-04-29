import * as React from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ContractorTable, type ContractorRow } from "@/components/contractors/ContractorTable"
import { CreateContractorDialog } from "@/components/contractors/CreateContractorDialog"
import { getJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"

export function ContractorsPage() {
  const [rows, setRows] = React.useState<ContractorRow[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [q, setQ] = React.useState("")
  const [status, setStatus] = React.useState<"all" | "active" | "inactive">("all")

  const canCreate = hasPermission("contractor.create")

  async function load() {
    setError(null)
    try {
      const qs = new URLSearchParams()
      qs.set("offset", "0")
      qs.set("limit", "50")
      if (q.trim()) qs.set("q", q.trim())
      if (status !== "all") qs.set("status", status)
      const data = await getJson<ContractorRow[]>(`/contractors?${qs.toString()}`)
      setRows(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contractors")
      setRows([])
    }
  }

  React.useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    const t = setTimeout(() => void load(), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status])

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-950">Contractors</h1>
          <div className="text-sm text-muted-foreground">Search, review, and manage contractors.</div>
        </div>
        {canCreate ? <CreateContractorDialog onCreated={load} /> : null}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Directory</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or email…"
            className="sm:max-w-sm"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" variant={status === "all" ? "default" : "outline"} onClick={() => setStatus("all")}>
              All
            </Button>
            <Button
              size="sm"
              variant={status === "active" ? "default" : "outline"}
              onClick={() => setStatus("active")}
            >
              Active
            </Button>
            <Button
              size="sm"
              variant={status === "inactive" ? "default" : "outline"}
              onClick={() => setStatus("inactive")}
            >
              Inactive
            </Button>
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

      <Card className="gap-0 py-0">
        <CardContent className="px-0">
          <ContractorTable rows={rows} />
        </CardContent>
      </Card>
    </div>
  )
}

