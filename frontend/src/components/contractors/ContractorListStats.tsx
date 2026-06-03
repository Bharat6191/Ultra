import * as React from "react"
import { BriefcaseBusiness, CalendarClock, CheckCircle2 } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
          <CardTitle className="text-sm font-bold uppercase tracking-wide text-zinc-950">{title}</CardTitle>
          <div className={`flex size-9 items-center justify-center rounded-xl ${ringClass}`}>{icon}</div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <div className="text-2xl font-normal tracking-tight text-zinc-950">{value}</div>
        )}
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
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
        hint="Records on this page"
        tone="neutral"
        loading={loading}
        icon={<BriefcaseBusiness className="size-4" aria-hidden />}
      />
      <StatCard
        title="ACTIVE"
        value={data.active}
        hint="Operational"
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
        hint="Documents within 7 days"
        tone="warning"
        loading={loading}
        icon={<CalendarClock className="size-4" aria-hidden />}
      />
    </div>
  )
}
