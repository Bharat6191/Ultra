import { Hourglass, MessagesSquare } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export type RatesDashboardModule = {
  total_negotiations: number
  pending_approvals: number
  approved: number
  rejected: number
  /** Aggregate savings figures are still returned by the backend, but the
   *  dashboard widget no longer renders them — see commit notes for the
   *  rationale (negotiated savings vs base-rate premium were too noisy as
   *  global KPIs given that contractors typically open above the baseline). */
  total_savings?: number | string
  avg_savings_percentage?: number | string
  total_premium_above_base?: number | string
  total_below_base_savings?: number | string
  approved_above_base?: number
  approved_below_base?: number
  approved_at_base?: number
  by_status?: { status: string; count: number }[]
}

/**
 * Lightweight contractor-rates summary card on the global dashboard.
 *
 * Earlier revisions surfaced "Negotiated savings", "Avg savings %" and
 * "Premium vs base" tiles here, but those aggregate figures were misleading
 * at a glance: contractors usually negotiate UP from the procurement
 * baseline, so the savings story only reads correctly with per-record
 * context. This card now sticks to lifecycle counters, and per-rate savings
 * details live on the negotiation detail page.
 */
export function RatesDashboard({ module }: { module: RatesDashboardModule }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Negotiation workflow</CardTitle>
            <p className="text-xs text-muted-foreground">
              Vendor rate negotiations and pending approvals.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          title="Total negotiations"
          value={module.total_negotiations}
          icon={<MessagesSquare className="size-4" />}
        />
        <Tile
          title="Pending approvals"
          value={module.pending_approvals}
          icon={<Hourglass className="size-4" />}
          tone="warning"
        />
        <Tile
          title="Approved"
          value={module.approved}
          icon={<MessagesSquare className="size-4" />}
          tone="success"
        />
        <Tile
          title="Rejected"
          value={module.rejected}
          icon={<MessagesSquare className="size-4" />}
          tone="neutral"
        />
      </CardContent>
    </Card>
  )
}

function Tile({
  title,
  value,
  icon,
  tone,
}: {
  title: string
  value: React.ReactNode
  icon?: React.ReactNode
  tone?: "success" | "warning" | "info" | "neutral"
}) {
  const toneClasses: Record<string, string> = {
    success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    warning: "bg-amber-50 text-amber-700 ring-amber-200",
    info: "bg-sky-50 text-sky-700 ring-sky-200",
    neutral: "bg-gray-50 text-gray-600 ring-gray-200",
  }
  const cls = toneClasses[tone ?? "neutral"]
  return (
    <div className="flex items-center justify-between rounded-2xl border bg-white p-4 shadow-sm">
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
        <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      </div>
      {icon ? (
        <span className={`grid size-9 place-items-center rounded-xl ring-2 ${cls}`}>{icon}</span>
      ) : null}
    </div>
  )
}
