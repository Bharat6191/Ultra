import * as React from "react"

import type { DashboardIntelligenceResponse } from "@/components/dashboard/intelligence/types"
import { formatMoney } from "@/components/contractors/rateStatus"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ApiError, getJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"

/** Mirrors backend: user needs at least one of these to receive intelligence. */
function mayLoadIntelligence(): boolean {
  return (
    hasPermission("contractor.view") ||
    hasPermission("work_orders.view") ||
    hasPermission("work_orders.create") ||
    hasPermission("invoices.view") ||
    hasPermission("invoices.create") ||
    hasPermission("contractor_rates.view") ||
    hasPermission("approval.view") ||
    hasPermission("task.view") ||
    hasPermission("users.view")
  )
}

export function ExecutiveIntelligenceDashboard() {
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [data, setData] = React.useState<DashboardIntelligenceResponse | null>(null)

  const load = React.useCallback(async () => {
    if (!mayLoadIntelligence()) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await getJson<DashboardIntelligenceResponse>("/dashboard/intelligence")
      setData(res)
    } catch (e) {
      setData(null)
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to load overview")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  if (!mayLoadIntelligence()) {
    return null
  }

  if (data?.enabled === false) {
    return (
      <Alert className="border-dashed border-muted-foreground/30 bg-muted/30">
        <AlertTitle>Overview</AlertTitle>
        <AlertDescription>{data.message ?? "No overview data for your role."}</AlertDescription>
      </Alert>
    )
  }

  const ex = data?.executive ?? {}

  type Kpi = { label: string; value: string; hint?: string }
  const kpis: Kpi[] = []
  if (typeof ex.active_contractors === "number") {
    kpis.push({ label: "Active contractors", value: String(ex.active_contractors) })
  }
  if (typeof ex.work_orders_total === "number") {
    kpis.push({
      label: "Work orders",
      value: String(ex.work_orders_total),
      hint: `Active ${ex.work_orders_active ?? 0} · Pending ${ex.work_orders_pending ?? 0} · Completed ${ex.work_orders_completed ?? 0}`,
    })
  }
  if (typeof ex.invoice_total_value === "number") {
    kpis.push({
      label: "Invoices",
      value: formatMoney(ex.invoice_total_value),
      hint: `Pending ${formatMoney(ex.invoice_pending_value ?? 0)}`,
    })
  }
  if (typeof ex.negotiations_total === "number") {
    kpis.push({
      label: "Negotiations",
      value: String(ex.negotiations_total),
      hint: `In pipeline ${ex.negotiations_pending ?? 0}`,
    })
  }
  if (typeof ex.pending_approval_tasks === "number") {
    kpis.push({ label: "Pending approvals (tasks)", value: String(ex.pending_approval_tasks) })
  }
  if (typeof ex.negotiation_savings_total === "number") {
    kpis.push({ label: "Approved negotiation savings", value: formatMoney(ex.negotiation_savings_total) })
  }
  if (typeof ex.expiring_rates_30d === "number" && ex.expiring_rates_30d > 0) {
    kpis.push({ label: "Rates expiring soon (≤30d)", value: String(ex.expiring_rates_30d) })
  }

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-zinc-950">Workspace overview</h2>
        <p className="text-sm text-muted-foreground">
          Key figures respect your access; only modules you can use contribute here.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load overview</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading && !data ? (
        <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-center text-sm text-muted-foreground">
          Loading overview…
        </div>
      ) : null}

      {kpis.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {kpis.map((k) => (
            <Card key={k.label} className="border-zinc-200/80 shadow-sm">
              <CardHeader className="pb-1">
                <CardDescription className="text-xs font-medium uppercase tracking-wide">{k.label}</CardDescription>
                <CardTitle className="text-2xl font-semibold tabular-nums text-zinc-950">{k.value}</CardTitle>
              </CardHeader>
              {k.hint ? (
                <CardContent className="pt-0 text-xs text-muted-foreground">
                  {k.hint}
                </CardContent>
              ) : null}
            </Card>
          ))}
        </div>
      ) : !loading && data && kpis.length === 0 ? (
        <p className="text-sm text-muted-foreground">No KPI snapshot available.</p>
      ) : null}
    </div>
  )
}
