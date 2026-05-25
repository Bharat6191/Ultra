import * as React from "react"
import {
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  FileEdit,
  Handshake,
  Hourglass,
  Lock,
  Receipt,
  ShieldAlert,
  Users,
  XCircle,
} from "lucide-react"
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer } from "recharts"

import type { InvoicesDashboardModule } from "@/components/dashboard/invoices-dashboard"
import type { WorkOrdersDashboardModule } from "@/components/dashboard/work-orders-dashboard"
import type { RatesDashboardModule } from "@/components/contractors/RatesDashboard"
import type { ContractorsDashboardModule } from "@/components/contractors/ContractorDashboard"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type ExecutiveOverviewData = {
  contractors: ContractorsDashboardModule
  contractor_rates: RatesDashboardModule
  work_orders: WorkOrdersDashboardModule
  invoices: InvoicesDashboardModule
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 100)
}

function sparkSeries(seed: number): { i: number; v: number }[] {
  const base = Math.max(seed, 1)
  return Array.from({ length: 7 }, (_, i) => ({
    i,
    v: Math.max(0, Math.round(base * (0.55 + (i / 6) * 0.45 + Math.sin(i * 1.2) * 0.08))),
  }))
}

function MiniSparkline({ value, color }: { value: number; color: string }) {
  const data = React.useMemo(() => sparkSeries(value), [value])
  if (value <= 0) {
    return (
      <svg viewBox="0 0 80 28" className="h-7 w-full text-muted-foreground/40" aria-hidden>
        <line x1="4" y1="14" x2="76" y2="14" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
      </svg>
    )
  }
  return (
    <div className="h-7 w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <Area type="monotone" dataKey="v" stroke={color} fill={color} fillOpacity={0.15} strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function HealthDonut({
  percent,
  label,
  color,
}: {
  percent: number
  label: string
  color: string
}) {
  const data = [
    { name: "ok", value: percent },
    { name: "rest", value: Math.max(0, 100 - percent) },
  ]
  return (
    <div className="flex flex-col items-center justify-center gap-1">
      <div className="relative h-[88px] w-[88px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius={30}
              outerRadius={42}
              startAngle={90}
              endAngle={-270}
              strokeWidth={0}
            >
              <Cell fill={color} />
              <Cell fill="#e5e7eb" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold tabular-nums text-zinc-900">{percent}%</span>
        </div>
      </div>
      <span className="max-w-[7rem] text-center text-[10px] font-medium leading-tight text-muted-foreground">{label}</span>
    </div>
  )
}

type MetricTone = "default" | "success" | "warning" | "danger" | "info"

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function MetricTile({
  label,
  value,
  valueText,
  icon,
  tone = "default",
  sparkColor,
}: {
  label: string
  value: number
  valueText?: string
  icon: React.ReactNode
  tone?: MetricTone
  sparkColor: string
}) {
  const iconRing =
    tone === "success"
      ? "bg-emerald-50 text-emerald-600"
      : tone === "warning"
        ? "bg-amber-50 text-amber-600"
        : tone === "danger"
          ? "bg-red-50 text-red-600"
          : tone === "info"
            ? "bg-sky-50 text-sky-600"
            : "bg-zinc-50 text-zinc-500"

  return (
    <Card className="rounded-xl border-zinc-200/80 shadow-none">
      <CardContent className="flex h-full flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
          <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", iconRing)}>{icon}</span>
        </div>
        <div className="text-2xl font-semibold tabular-nums tracking-tight text-zinc-950">{valueText ?? value.toLocaleString()}</div>
        <MiniSparkline value={value} color={sparkColor} />
      </CardContent>
    </Card>
  )
}

type ModuleTheme = {
  sidebar: string
  accent: string
  spark: string
  icon: React.ReactNode
  title: string
  subtitle: string
  healthLabel: string
}

function ModuleRow({
  theme,
  healthPercent,
  metrics,
  sidebarFooter,
}: {
  theme: ModuleTheme
  healthPercent: number
  metrics: React.ReactNode
  sidebarFooter?: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm">
      <div className="flex flex-col lg:flex-row">
        <div className={cn("flex shrink-0 flex-col gap-3 p-5 lg:w-52", theme.sidebar)}>
          <div className="grid size-10 place-items-center rounded-xl bg-white/80 shadow-sm">{theme.icon}</div>
          <h3 className="text-sm font-semibold text-zinc-900">{theme.title}</h3>
          <p className="text-xs leading-relaxed text-zinc-600">{theme.subtitle}</p>
          {sidebarFooter ? <div className="pt-1">{sidebarFooter}</div> : null}
        </div>

        <div className="grid flex-1 grid-cols-2 gap-2 p-3 sm:grid-cols-4 lg:p-4">{metrics}</div>

        <div className="flex items-center justify-center border-t border-zinc-100 px-4 py-4 lg:w-36 lg:border-l lg:border-t-0">
          <HealthDonut percent={healthPercent} label={theme.healthLabel} color={theme.accent} />
        </div>
      </div>
    </div>
  )
}

export function ExecutiveModuleRows({ data }: { data: ExecutiveOverviewData }) {
  const { contractors: c, contractor_rates: r, work_orders: wo, invoices: inv } = data
  const [invoiceMetricMode, setInvoiceMetricMode] = React.useState<"count" | "value">("count")

  const contractorHealth = pct(c.active, c.total)
  const negotiationHealth = pct(r.approved, r.total_negotiations)
  const woHealth = pct(wo.active, wo.total)
  const invoiceHealth = pct(inv.pass ?? 0, inv.total)
  const showInvoiceValues = invoiceMetricMode === "value"

  return (
    <div className="grid gap-4">
      <ModuleRow
        theme={{
          sidebar: "bg-amber-50/90",
          accent: "#f59e0b",
          spark: "#f59e0b",
          icon: <Users className="size-5 text-amber-700" />,
          title: "Contractors",
          subtitle: "Lifecycle, compliance and plant coverage.",
          healthLabel: "Active contractors",
        }}
        healthPercent={contractorHealth}
        metrics={
          <>
            <MetricTile label="Total" value={c.total} icon={<Users className="size-3.5" />} sparkColor="#f59e0b" />
            <MetricTile
              label="Active"
              value={c.active}
              icon={<CheckCircle2 className="size-3.5" />}
              tone="success"
              sparkColor="#f59e0b"
            />
            <MetricTile
              label="Non-compliant"
              value={c.non_compliant}
              icon={<ShieldAlert className="size-3.5" />}
              tone="danger"
              sparkColor="#f59e0b"
            />
            <MetricTile
              label="Expiring docs"
              value={c.expiring_documents_7_days}
              icon={<Clock3 className="size-3.5" />}
              tone="warning"
              sparkColor="#f59e0b"
            />
          </>
        }
      />

      <ModuleRow
        theme={{
          sidebar: "bg-blue-50/90",
          accent: "#3b82f6",
          spark: "#3b82f6",
          icon: <Handshake className="size-5 text-blue-700" />,
          title: "Negotiation",
          subtitle: "Vendor rate negotiations and approvals.",
          healthLabel: "Approved rate share",
        }}
        healthPercent={negotiationHealth}
        metrics={
          <>
            <MetricTile
              label="Total"
              value={r.total_negotiations}
              icon={<Handshake className="size-3.5" />}
              sparkColor="#3b82f6"
            />
            <MetricTile
              label="Pending approval"
              value={r.pending_approvals}
              icon={<Hourglass className="size-3.5" />}
              tone="warning"
              sparkColor="#3b82f6"
            />
            <MetricTile
              label="Approved"
              value={r.approved}
              icon={<CheckCircle2 className="size-3.5" />}
              tone="success"
              sparkColor="#3b82f6"
            />
            <MetricTile
              label="Rejected"
              value={r.rejected}
              icon={<XCircle className="size-3.5" />}
              tone="default"
              sparkColor="#3b82f6"
            />
          </>
        }
      />

      <ModuleRow
        theme={{
          sidebar: "bg-emerald-50/90",
          accent: "#10b981",
          spark: "#10b981",
          icon: <BriefcaseBusiness className="size-5 text-emerald-700" />,
          title: "Work Orders",
          subtitle: "Execution and approval across plants.",
          healthLabel: "Active work orders",
        }}
        healthPercent={woHealth}
        metrics={
          <>
            <MetricTile
              label="Total"
              value={wo.total}
              icon={<BriefcaseBusiness className="size-3.5" />}
              sparkColor="#10b981"
            />
            <MetricTile
              label="Active"
              value={wo.active}
              icon={<CheckCircle2 className="size-3.5" />}
              tone="success"
              sparkColor="#10b981"
            />
            <MetricTile
              label="Pending approval"
              value={wo.pending_approval}
              icon={<Hourglass className="size-3.5" />}
              tone="warning"
              sparkColor="#10b981"
            />
            <MetricTile
              label="Drafts"
              value={wo.draft}
              icon={<FileEdit className="size-3.5" />}
              tone="info"
              sparkColor="#10b981"
            />
          </>
        }
      />

      <ModuleRow
        theme={{
          sidebar: "bg-violet-50/90",
          accent: "#8b5cf6",
          spark: "#8b5cf6",
          icon: <Receipt className="size-5 text-violet-700" />,
          title: "Invoices",
          subtitle: "Validation pass, blocked and exceptions.",
          healthLabel: "Invoice pass rate",
        }}
        healthPercent={invoiceHealth}
        sidebarFooter={
          <div className="inline-flex rounded-full border border-violet-200 bg-white p-1">
            <Button
              variant={showInvoiceValues ? "ghost" : "default"}
              size="xs"
              className={
                showInvoiceValues
                  ? "rounded-full text-zinc-600 hover:text-zinc-900"
                  : "rounded-full bg-violet-600 hover:bg-violet-700"
              }
              onClick={() => setInvoiceMetricMode("count")}
            >
              Count
            </Button>
            <Button
              variant={showInvoiceValues ? "default" : "ghost"}
              size="xs"
              className={
                showInvoiceValues
                  ? "rounded-full bg-violet-600 hover:bg-violet-700"
                  : "rounded-full text-zinc-600 hover:text-zinc-900"
              }
              onClick={() => setInvoiceMetricMode("value")}
            >
              Value
            </Button>
          </div>
        }
        metrics={
          <>
            <MetricTile
              label={showInvoiceValues ? "Total invoice value" : "Total invoices"}
              value={showInvoiceValues ? (inv.total_value ?? 0) : inv.total}
              valueText={showInvoiceValues ? formatCurrency(inv.total_value ?? 0) : undefined}
              icon={<Receipt className="size-3.5" />}
              sparkColor="#8b5cf6"
            />
            <MetricTile
              label={showInvoiceValues ? "Pass value" : "Pass"}
              value={showInvoiceValues ? (inv.pass_value ?? 0) : (inv.pass ?? 0)}
              valueText={showInvoiceValues ? formatCurrency(inv.pass_value ?? 0) : undefined}
              icon={<CheckCircle2 className="size-3.5" />}
              tone="success"
              sparkColor="#8b5cf6"
            />
            <MetricTile
              label={showInvoiceValues ? "Pending approval value" : "Pending approval"}
              value={showInvoiceValues ? (inv.pending_exception_approval_value ?? 0) : inv.pending_exception_approval}
              valueText={showInvoiceValues ? formatCurrency(inv.pending_exception_approval_value ?? 0) : undefined}
              icon={<Lock className="size-3.5" />}
              tone="warning"
              sparkColor="#8b5cf6"
            />
            <MetricTile
              label={showInvoiceValues ? "Blocked value" : "Blocked"}
              value={showInvoiceValues ? (inv.blocked_value ?? 0) : (inv.blocked ?? 0)}
              valueText={showInvoiceValues ? formatCurrency(inv.blocked_value ?? 0) : undefined}
              icon={<XCircle className="size-3.5" />}
              tone="danger"
              sparkColor="#8b5cf6"
            />
          </>
        }
      />
    </div>
  )
}
