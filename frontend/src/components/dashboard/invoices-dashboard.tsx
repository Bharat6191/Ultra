import { AlertTriangle, Receipt } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"

export type InvoicesDashboardModule = {
  total: number
  blocked: number
  pending_exception_approval: number
}

export function InvoicesDashboard({ module }: { module: InvoicesDashboardModule }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Kpi title="Invoices" value={module.total} icon={<Receipt className="size-4" />} />
      <Kpi title="Blocked" value={module.blocked} icon={<AlertTriangle className="size-4" />} tone="warning" />
      <Kpi title="Pending exceptions" value={module.pending_exception_approval} icon={<Receipt className="size-4" />} tone="neutral" />
    </div>
  )
}

function Kpi({
  title,
  value,
  icon,
  tone,
}: {
  title: string
  value: number
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
          <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
        </div>
        <span className={`grid size-9 place-items-center rounded-xl ring-2 ${cls}`}>{icon}</span>
      </CardContent>
    </Card>
  )
}

