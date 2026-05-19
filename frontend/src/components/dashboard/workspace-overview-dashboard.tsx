import { Bell } from "lucide-react"

import type { InvoicesDashboardModule } from "@/components/dashboard/invoices-dashboard"
import { ExecutiveModuleRows, type ExecutiveOverviewData } from "@/components/dashboard/executive-overview-ui"
import type { WorkOrdersDashboardModule } from "@/components/dashboard/work-orders-dashboard"
import type { RatesDashboardModule } from "@/components/contractors/RatesDashboard"
import type { ContractorsDashboardModule } from "@/components/contractors/ContractorDashboard"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export type WorkspaceOverviewSummary = {
  modules: {
    contractors: ContractorsDashboardModule
    contractor_rates: RatesDashboardModule
    work_orders: WorkOrdersDashboardModule
    invoices: InvoicesDashboardModule
  }
}

export function WorkspaceOverviewDashboard({
  summary,
  loading,
  error,
  userName,
}: {
  summary: WorkspaceOverviewSummary | null
  loading: boolean
  error: string | null
  userName?: string | null
}) {
  if (loading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-36 w-full rounded-2xl" />
        <Skeleton className="h-36 w-full rounded-2xl" />
        <Skeleton className="h-36 w-full rounded-2xl" />
        <Skeleton className="h-36 w-full rounded-2xl" />
      </div>
    )
  }

  if (error) {
    return (
      <Card className="border-dashed rounded-2xl">
        <CardHeader>
          <CardTitle className="text-base">Could not load overview</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const modules = summary?.modules
  if (!modules?.contractors || !modules.contractor_rates || !modules.work_orders || !modules.invoices) {
    return (
      <Card className="border-dashed rounded-2xl">
        <CardHeader>
          <CardTitle className="text-base">Overview unavailable</CardTitle>
          <CardDescription>Dashboard summary data is missing. Try refreshing the page.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const data: ExecutiveOverviewData = {
    contractors: modules.contractors,
    contractor_rates: modules.contractor_rates,
    work_orders: modules.work_orders,
    invoices: modules.invoices,
  }

  const displayName = userName?.trim() || "User"

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Welcome {displayName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s what&apos;s happening across contractors, negotiations, work orders and invoices.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-9 items-center rounded-lg border border-zinc-200 bg-white px-3 text-xs text-muted-foreground">
            All time
          </span>
          <span className="inline-flex h-9 items-center rounded-lg border border-zinc-200 bg-white px-3 text-xs text-muted-foreground">
            All plants
          </span>
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-muted-foreground"
            aria-label="Notifications"
          >
            <Bell className="size-4" />
          </button>
        </div>
      </div>

      <ExecutiveModuleRows data={data} />
    </div>
  )
}
