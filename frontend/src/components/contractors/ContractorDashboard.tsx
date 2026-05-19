import * as React from "react"
import { ArrowUpRight, BriefcaseBusiness, CalendarClock, ShieldAlert, ShieldCheck } from "lucide-react"
import { Link } from "react-router-dom"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"

export type ContractorsDashboardModule = {
  total: number
  active: number
  non_compliant: number
  expiring_documents_7_days: number
  expired_documents?: number
  pending?: number
  suspended?: number
  blacklisted?: number
  by_status?: { status: string; count: number }[]
  contractors_by_plant?: { org_unit_id: number; name: string; count: number }[]
  // Backward-compatible legacy fields.
  total_contractors?: number
  documents_with_expiry?: number
}

function StatCard({
  title,
  value,
  hint,
  icon,
  tone,
  loading,
}: {
  title: string
  value: number
  hint?: string
  icon: React.ReactNode
  tone: "neutral" | "success" | "warning" | "danger"
  loading?: boolean
}) {
  const ringClass =
    tone === "success"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "warning"
      ? "bg-amber-50 text-amber-700"
      : tone === "danger"
      ? "bg-red-50 text-red-700"
      : "bg-zinc-50 text-zinc-700"
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          <div className={`flex size-9 items-center justify-center rounded-xl ${ringClass}`}>{icon}</div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <div className="text-2xl font-semibold tracking-tight text-zinc-950">{value}</div>
        )}
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  )
}

export function ContractorDashboard({
  module,
  canCreate,
  onCreate,
  loading,
}: {
  module: ContractorsDashboardModule | null
  canCreate: boolean
  onCreate: () => void
  loading?: boolean
}) {
  const total = module?.total ?? module?.total_contractors ?? 0
  const active = module?.active ?? 0
  const nonCompliant = module?.non_compliant ?? 0
  const expiring = module?.expiring_documents_7_days ?? module?.documents_with_expiry ?? 0

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="text-base font-medium text-zinc-950">Contractors</div>
          <div className="text-sm text-muted-foreground">
            Lifecycle health, compliance and plant coverage at a glance.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/dashboard/contractors">
              Open directory
              <ArrowUpRight className="ml-2 size-4 opacity-70" aria-hidden />
            </Link>
          </Button>
          {canCreate ? (
            <Button size="sm" onClick={onCreate}>
              Add contractor
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total contractors"
          value={total}
          hint="In the workspace"
          tone="neutral"
          loading={loading}
          icon={<BriefcaseBusiness className="size-4" aria-hidden />}
        />
        <StatCard
          title="Active"
          value={active}
          hint="Operational"
          tone="success"
          loading={loading}
          icon={<ShieldCheck className="size-4" aria-hidden />}
        />
        <StatCard
          title="Non-compliant"
          value={nonCompliant}
          hint="Critical docs missing or expired"
          tone="danger"
          loading={loading}
          icon={<ShieldAlert className="size-4" aria-hidden />}
        />
        <StatCard
          title="Expiring soon"
          value={expiring}
          hint="Documents within 7 days"
          tone="warning"
          loading={loading}
          icon={<CalendarClock className="size-4" aria-hidden />}
        />
      </div>
    </div>
  )
}
