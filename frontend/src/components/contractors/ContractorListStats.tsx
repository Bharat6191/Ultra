import * as React from "react"
import { BriefcaseBusiness, CalendarClock, CheckCircle2 } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export type ContractorListStatsData = {
  total: number
  active: number
  nonCompliant: number
  expiringSoon: number
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
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : tone === "warning"
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : tone === "danger"
      ? "bg-red-50 text-red-700 ring-red-200"
      : "bg-gray-50 text-gray-600 ring-gray-200"
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wide text-zinc-950">{title}</div>
          {loading ? (
            <Skeleton className="mt-1 h-8 w-16" />
          ) : (
            <div className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">{value}</div>
          )}
          {hint ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</div> : null}
        </div>
        <span className={`grid size-9 place-items-center rounded-xl ring-2 ${ringClass}`}>{icon}</span>
      </CardContent>
    </Card>
  )
}

export function ContractorListStats({
  data,
  loading,
}: {
  data: ContractorListStatsData
  loading?: boolean
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard
        title="TOTAL"
        value={data.total}
        // hint="Records on this page"
        tone="neutral"
        loading={loading}
        icon={<BriefcaseBusiness className="size-4" aria-hidden />}
      />
      <StatCard
        title="ACTIVE"
        value={data.active}
        // hint="Operational"
        tone="success"
        loading={loading}
        icon={<CheckCircle2 className="size-4" aria-hidden />}
      />
      {/* <StatCard
        title="Non-compliant"
        value={data.nonCompliant}
        hint="Critical docs missing or expired"
        tone="danger"
        loading={loading}
        icon={<AlertTriangle className="size-4" aria-hidden />}
      /> */}
      <StatCard
        title="EXPIRING DOCUMENTS"
        value={data.expiringSoon}
        // hint="Documents within 7 days"
        tone="warning"
        loading={loading}
        icon={<CalendarClock className="size-4" aria-hidden />}
      />
    </div>
  )
}
