import * as React from "react"

import { TaskDashboard, type TasksDashboardModule } from "@/components/dashboard/task-dashboard"
import { UserDashboard, type UsersDashboardModule } from "@/components/dashboard/user-dashboard"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"
import { Button } from "@/components/ui/button"
import { Link } from "react-router-dom"

type DashboardSummary = {
  modules: {
    users?: UsersDashboardModule
    tasks?: TasksDashboardModule
    contractors?: { total_contractors: number; documents_with_expiry: number }
    [k: string]: unknown
  }
}

export function DashboardPage() {
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

  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-950">Dashboard</h1>
        <span className="text-emerald-600">•</span>
        <span className="text-sm font-medium text-muted-foreground">Workspace</span>
      </div>

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
              <code className="rounded bg-muted px-1 py-0.5 text-xs">task.view</code>.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {usersModule && hasPermission("users.view") ? <UserDashboard data={usersModule} /> : null}
      {tasksModule && (hasPermission("approval.view") || hasPermission("task.view")) ? (
        <TaskDashboard data={tasksModule} />
      ) : null}
      {contractorsModule && hasPermission("contractor.view") ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Contractors</CardTitle>
            <CardDescription>
              Total contractors: <strong>{contractorsModule.total_contractors}</strong> · Documents with expiry:{" "}
              <strong>{contractorsModule.documents_with_expiry}</strong>
            </CardDescription>
          </CardHeader>
          <div className="px-6 pb-6">
            <Button asChild size="sm" variant="outline">
              <Link to="/dashboard/contractors">Open Contractors</Link>
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  )
}

