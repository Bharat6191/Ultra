import * as React from "react"
import { CheckCircle2, Hourglass, Receipt, XCircle } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export type InvoicesDashboardModule = {
  total: number
  total_value?: number
  draft?: number
  pass?: number
  pass_value?: number
  blocked?: number
  blocked_value?: number
  pending_exception_approval: number
  pending_exception_approval_value?: number
  by_status?: { status: string; count: number }[]
}

export function InvoicesDashboard({ module }: { module: InvoicesDashboardModule }) {
  const [mode, setMode] = React.useState<"count" | "value">("value")
  const showValues = mode === "value"

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="inline-flex rounded-full border border-violet-200 bg-white p-1">
          <Button
            variant={showValues ? "ghost" : "default"}
            size="xs"
            className={showValues ? "rounded-full text-zinc-600 hover:text-zinc-900" : "rounded-full bg-violet-600 hover:bg-violet-700"}
            onClick={() => setMode("count")}
          >
            Count
          </Button>
          <Button
            variant={showValues ? "default" : "ghost"}
            size="xs"
            className={showValues ? "rounded-full bg-violet-600 hover:bg-violet-700" : "rounded-full text-zinc-600 hover:text-zinc-900"}
            onClick={() => setMode("value")}
          >
            Value
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          title={showValues ? "Total invoice value" : "Total invoices"}
          value={showValues ? (module.total_value ?? 0) : module.total}
          valueText={showValues ? formatCurrency(module.total_value ?? 0) : undefined}
          icon={<Receipt className="size-4" />}
        />
        <Kpi
          title={showValues ? "Pass value" : "Pass"}
          value={showValues ? (module.pass_value ?? 0) : (module.pass ?? 0)}
          valueText={showValues ? formatCurrency(module.pass_value ?? 0) : undefined}
          icon={<CheckCircle2 className="size-4" />}
          tone="success"
        />
        <Kpi
          title={showValues ? "Pending approval value" : "Pending approval"}
          value={showValues ? (module.pending_exception_approval_value ?? 0) : module.pending_exception_approval}
          valueText={showValues ? formatCurrency(module.pending_exception_approval_value ?? 0) : undefined}
          icon={<Hourglass className="size-4" />}
          tone="info"
        />
        <Kpi
          title={showValues ? "Blocked value" : "Blocked"}
          value={showValues ? (module.blocked_value ?? 0) : (module.blocked ?? 0)}
          valueText={showValues ? formatCurrency(module.blocked_value ?? 0) : undefined}
          icon={<XCircle className="size-4" />}
          tone="warning"
        />
      </div>
    </div>
  )
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function Kpi({
  title,
  value,
  valueText,
  icon,
  tone,
}: {
  title: string
  value: number
  valueText?: string
  icon: React.ReactNode
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
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight">{valueText ?? value}</div>
        </div>
        <span className={`grid size-9 place-items-center rounded-xl ring-2 ${cls}`}>{icon}</span>
      </CardContent>
    </Card>
  )
}
