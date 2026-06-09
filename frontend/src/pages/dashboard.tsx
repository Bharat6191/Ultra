import * as React from "react"

import {
  WorkspaceOverviewDashboard,
  type WorkspaceOverviewSummary,
} from "@/components/dashboard/workspace-overview-dashboard"
import { getJson } from "@/lib/api"
import { APP_PAGE_BACKGROUND_STYLE } from "@/lib/appearance"

type MeResponse = {
  full_name?: string | null
  username?: string | null
  email?: string | null
}

export function DashboardPage() {
  const [summary, setSummary] = React.useState<WorkspaceOverviewSummary | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [userName, setUserName] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const [s, me] = await Promise.all([
          getJson<WorkspaceOverviewSummary>("/dashboard/summary"),
          getJson<MeResponse>("/me").catch(() => null),
        ])
        if (cancelled) return
        setSummary(s)
        setUserName(me?.full_name ?? me?.username ?? me?.email ?? null)
        setLoadError(null)
      } catch (e) {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : "Failed to load dashboard")
        setSummary(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="min-h-full pb-8" style={APP_PAGE_BACKGROUND_STYLE}>
      <WorkspaceOverviewDashboard summary={summary} loading={loading} error={loadError} userName={userName} />
    </div>
  )
}
