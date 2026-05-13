import * as React from "react"
import { useNavigate } from "react-router-dom"

import { TaskDashboard, type TasksDashboardModule } from "@/components/dashboard/task-dashboard"
import { UserDashboard, type UsersDashboardModule } from "@/components/dashboard/user-dashboard"
import {
  ContractorDashboard,
  type ContractorsDashboardModule,
} from "@/components/contractors/ContractorDashboard"
import { ContractorCharts } from "@/components/contractors/ContractorCharts"
import { RatesDashboard, type RatesDashboardModule } from "@/components/contractors/RatesDashboard"
import { WorkOrdersDashboard, type WorkOrdersDashboardModule } from "@/components/dashboard/work-orders-dashboard"
import { InvoicesDashboard, type InvoicesDashboardModule } from "@/components/dashboard/invoices-dashboard"
import { ExecutiveIntelligenceDashboard } from "@/components/dashboard/intelligence/ExecutiveIntelligenceDashboard"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"

type DashboardSummary = {
  modules: {
    users?: UsersDashboardModule
    tasks?: TasksDashboardModule
    contractors?: ContractorsDashboardModule
    contractor_rates?: RatesDashboardModule
    work_orders?: WorkOrdersDashboardModule
    invoices?: InvoicesDashboardModule
    [k: string]: unknown
  }
}

export function DashboardPage() {
  const navigate = useNavigate()
  const [summary, setSummary] = React.useState<DashboardSummary | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s = await getJson<DashboardSummary>("/dashboard/summary")
        if (cancelled) return
        setSummary(s)
        setLoadError(null)
      } catch (e) {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : "Failed to load dashboard stats")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const usersModule = summary?.modules?.users
  const tasksModule = summary?.modules?.tasks
  const contractorsModule = summary?.modules?.contractors
  const ratesModule = summary?.modules?.contractor_rates
  const workOrdersModule = summary?.modules?.work_orders
  const invoicesModule = summary?.modules?.invoices
  const canCreateContractor = hasPermission("contractor.create")
  const canViewRates = hasPermission("contractor_rates.view")

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Workspace</h1>
        <p className="text-sm text-muted-foreground">Overview and modules available to your account.</p>
      </div>

      <ExecutiveIntelligenceDashboard />

      {loadError ? (
        <Card className="border-dashed border-emerald-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Dashboard data unavailable</CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {!usersModule && !tasksModule && !contractorsModule && !loadError ? (
        <Card className="border-dashed border-emerald-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">No modules available</CardTitle>
            <CardDescription>
              You don’t have access to any modules. Ask an admin to grant permissions like{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">users.view</code> or{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">contractor.view</code>.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {usersModule && hasPermission("users.view") ? <UserDashboard data={usersModule} /> : null}
      {tasksModule && (hasPermission("approval.view") || hasPermission("task.view")) ? (
        <TaskDashboard data={tasksModule} />
      ) : null}

      {contractorsModule && hasPermission("contractor.view") ? (
        <div className="grid gap-4">
          <ContractorDashboard
            module={contractorsModule}
            canCreate={canCreateContractor}
            onCreate={() => navigate("/dashboard/contractors/new")}
            loading={!summary}
          />
          {contractorsModule.by_status || contractorsModule.contractors_by_plant ? (
            <ContractorCharts
              byStatus={contractorsModule.by_status ?? []}
              byPlant={contractorsModule.contractors_by_plant ?? []}
            />
          ) : null}
        </div>
      ) : null}

      {ratesModule && canViewRates ? <RatesDashboard module={ratesModule} /> : null}
      {workOrdersModule && (hasPermission("work_orders.view") || hasPermission("work_orders.create")) ? (
        <WorkOrdersDashboard module={workOrdersModule} />
      ) : null}
      {invoicesModule && (hasPermission("invoices.view") || hasPermission("invoices.create")) ? (
        <InvoicesDashboard module={invoicesModule} />
      ) : null}
    </div>
  )
}
