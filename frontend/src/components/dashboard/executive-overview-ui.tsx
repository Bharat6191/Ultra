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
  Users,
  XCircle,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import type { RatesDashboardModule } from "@/components/contractors/RatesDashboard"
import type { ContractorsDashboardModule } from "@/components/contractors/ContractorDashboard"
import type { InvoicesDashboardModule } from "@/components/dashboard/invoices-dashboard"
import type { WorkOrdersDashboardModule } from "@/components/dashboard/work-orders-dashboard"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type ExecutiveOverviewData = {
  contractors: ContractorsDashboardModule
  contractor_rates: RatesDashboardModule
  work_orders: WorkOrdersDashboardModule
  invoices: InvoicesDashboardModule
}

type MetricTone = "default" | "success" | "warning" | "danger" | "info"

type ModuleMetricItem = {
  key: string
  label: string
  shortLabel: string
  value: number
  valueText?: string
  icon: React.ReactNode
  tone?: MetricTone
}

type ModuleTheme = {
  sidebar: string
  accent: string
  icon: React.ReactNode
  title: string
  subtitle: string
  healthLabel: string
}

function toRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const normalized =
    clean.length === 3
      ? clean
          .split("")
          .map((part) => part + part)
          .join("")
      : clean
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(value)
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value)
}

function ModuleMetricChart({
  items,
  accent,
}: {
  items: ModuleMetricItem[]
  accent: string
}) {
  const data = React.useMemo(
    () =>
      items.map((item, index) => ({
        ...item,
        fill: toRgba(accent, 0.28 + index * 0.14),
        tooltipValue: item.valueText ?? formatNumber(item.value),
      })),
    [accent, items],
  )

  const hasAnyValue = data.some((item) => item.value > 0)
  const maxValue = data.reduce((max, item) => Math.max(max, item.value), 0)
  const yAxisWidth = maxValue >= 100000 ? 56 : maxValue >= 1000 ? 46 : 36
  const yAxisTickFormatter = (value: number) => (maxValue >= 1000 ? formatCompactNumber(value) : formatNumber(value))
  const compactMetricLayout = items.length <= 3

  return (
    <Card className="rounded-2xl border-zinc-200/80 shadow-none">
      <CardContent className="space-y-3 p-4">
        <div className="h-40 min-h-[160px] w-full min-w-0">
          {hasAnyValue ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                barCategoryGap={compactMetricLayout ? "8%" : "14%"}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                <XAxis
                  dataKey="shortLabel"
                  tick={{ fontSize: 10, fill: "#71717a" }}
                  interval={0}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10, fill: "#71717a" }}
                  width={yAxisWidth}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={yAxisTickFormatter}
                />
                <Tooltip
                  cursor={{ fill: "rgba(15, 23, 42, 0.04)" }}
                  contentStyle={{ borderRadius: 14, borderColor: "#e4e4e7" }}
                  formatter={(value, _name, entry) => {
                    const row = entry?.payload as { tooltipValue?: string; label?: string } | undefined
                    return [row?.tooltipValue ?? formatNumber(Number(value ?? 0)), row?.label ?? ""]
                  }}
                />
                <Bar
                  dataKey="value"
                  radius={[12, 12, 0, 0]}
                  stroke={accent}
                  strokeWidth={1.25}
                  maxBarSize={compactMetricLayout ? 88 : 72}
                >
                  {data.map((item) => (
                    <Cell key={item.key} fill={item.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/60 text-sm text-muted-foreground">
              No chart data yet.
            </div>
          )}
        </div>

        <div
          className={cn(
            "grid gap-x-4 gap-y-3 border-t border-zinc-100 pt-3 sm:grid-cols-2",
            compactMetricLayout ? "xl:grid-cols-3" : "xl:grid-cols-4",
          )}
        >
          {items.map((item) => (
            <div key={item.key} className="min-w-0">
              <div className="text-[11px] font-semibold leading-4 text-zinc-900">{item.label}</div>
              <div
                className={cn(
                  "mt-1 font-medium tracking-tight text-zinc-700",
                  item.valueText ? "text-sm leading-5 sm:text-base" : "text-xl tabular-nums",
                )}
              >
                {item.valueText ?? formatNumber(item.value)}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function ModuleRow({
  theme,
  chart,
  sidebarFooter,
}: {
  theme: ModuleTheme
  chart: React.ReactNode
  sidebarFooter?: React.ReactNode
}) {
  return (
    <div className="h-full overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm">
      <div className={cn("border-b border-zinc-100 px-5 py-4", theme.sidebar)}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
              {theme.icon}
            </div>
            <div className="min-w-0">
              <h3 className="text-2xl font-semibold tracking-tight text-zinc-950">{theme.title}</h3>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-zinc-600">{theme.subtitle}</p>
            </div>
          </div>
          {sidebarFooter ? <div className="shrink-0 self-start">{sidebarFooter}</div> : null}
        </div>
      </div>

      <div className="p-3 lg:p-4">
        <div className="min-w-0">{chart}</div>
      </div>
    </div>
  )
}

export function ExecutiveModuleRows({ data }: { data: ExecutiveOverviewData }) {
  const { contractors: c, contractor_rates: r, work_orders: wo, invoices: inv } = data
  const [invoiceMetricMode, setInvoiceMetricMode] = React.useState<"count" | "value">("value")

  const showInvoiceValues = invoiceMetricMode === "value"

  const contractorItems: ModuleMetricItem[] = [
    {
      key: "total",
      label: "Total contractors",
      shortLabel: "Total",
      value: c.total,
      icon: <Users className="size-3.5" />,
    },
    {
      key: "active",
      label: "Active",
      shortLabel: "Active",
      value: c.active,
      icon: <CheckCircle2 className="size-3.5" />,
      tone: "success",
    },
    {
      key: "expiring",
      label: "Expiring docs",
      shortLabel: "Expiring",
      value: c.expiring_documents_7_days,
      icon: <Clock3 className="size-3.5" />,
      tone: "warning",
    },
  ]

  const negotiationItems: ModuleMetricItem[] = [
    {
      key: "total",
      label: "Total negotiations",
      shortLabel: "Total",
      value: r.total_negotiations,
      icon: <Handshake className="size-3.5" />,
    },
    {
      key: "pending",
      label: "Pending approval",
      shortLabel: "Pending",
      value: r.pending_approvals,
      icon: <Hourglass className="size-3.5" />,
      tone: "warning",
    },
    {
      key: "approved",
      label: "Approved",
      shortLabel: "Approved",
      value: r.approved,
      icon: <CheckCircle2 className="size-3.5" />,
      tone: "success",
    },
    {
      key: "rejected",
      label: "Rejected",
      shortLabel: "Rejected",
      value: r.rejected,
      icon: <XCircle className="size-3.5" />,
    },
  ]

  const workOrderItems: ModuleMetricItem[] = [
    {
      key: "total",
      label: "Total work orders",
      shortLabel: "Total",
      value: wo.total,
      icon: <BriefcaseBusiness className="size-3.5" />,
    },
    {
      key: "active",
      label: "Active",
      shortLabel: "Active",
      value: wo.active,
      icon: <CheckCircle2 className="size-3.5" />,
      tone: "success",
    },
    {
      key: "pending",
      label: "Pending approval",
      shortLabel: "Pending",
      value: wo.pending_approval,
      icon: <Hourglass className="size-3.5" />,
      tone: "warning",
    },
    {
      key: "drafts",
      label: "Drafts",
      shortLabel: "Drafts",
      value: wo.draft,
      icon: <FileEdit className="size-3.5" />,
      tone: "info",
    },
  ]

  const invoiceItems: ModuleMetricItem[] = [
    {
      key: "total",
      label: showInvoiceValues ? "Total invoice value" : "Total invoices",
      shortLabel: "Total",
      value: showInvoiceValues ? (inv.total_value ?? 0) : inv.total,
      valueText: showInvoiceValues ? formatCurrency(inv.total_value ?? 0) : undefined,
      icon: <Receipt className="size-3.5" />,
    },
    {
      key: "pass",
      label: showInvoiceValues ? "Pass value" : "Pass",
      shortLabel: "Pass",
      value: showInvoiceValues ? (inv.pass_value ?? 0) : (inv.pass ?? 0),
      valueText: showInvoiceValues ? formatCurrency(inv.pass_value ?? 0) : undefined,
      icon: <CheckCircle2 className="size-3.5" />,
      tone: "success",
    },
    {
      key: "pending",
      label: showInvoiceValues ? "Pending approval value" : "Pending approval",
      shortLabel: "Pending",
      value: showInvoiceValues ? (inv.pending_exception_approval_value ?? 0) : inv.pending_exception_approval,
      valueText: showInvoiceValues ? formatCurrency(inv.pending_exception_approval_value ?? 0) : undefined,
      icon: <Lock className="size-3.5" />,
      tone: "warning",
    },
    {
      key: "blocked",
      label: showInvoiceValues ? "Blocked value" : "Blocked",
      shortLabel: "Blocked",
      value: showInvoiceValues ? (inv.blocked_value ?? 0) : (inv.blocked ?? 0),
      valueText: showInvoiceValues ? formatCurrency(inv.blocked_value ?? 0) : undefined,
      icon: <XCircle className="size-3.5" />,
      tone: "danger",
    },
  ]

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ModuleRow
        theme={{
          sidebar: "bg-amber-50/90",
          accent: "#f59e0b",
          icon: <Users className="size-5 text-amber-700" />,
          title: "Contractors",
          subtitle: "Lifecycle, compliance and plant coverage.",
          healthLabel: "Active contractors",
        }}
        chart={<ModuleMetricChart items={contractorItems} accent="#f59e0b" />}
      />

      <ModuleRow
        theme={{
          sidebar: "bg-blue-50/90",
          accent: "#3b82f6",
          icon: <Handshake className="size-5 text-blue-700" />,
          title: "Negotiation",
          subtitle: "Vendor rate negotiations and approvals.",
          healthLabel: "Approved rate share",
        }}
        chart={<ModuleMetricChart items={negotiationItems} accent="#3b82f6" />}
      />

      <ModuleRow
        theme={{
          sidebar: "bg-emerald-50/90",
          accent: "#10b981",
          icon: <BriefcaseBusiness className="size-5 text-emerald-700" />,
          title: "Work Orders",
          subtitle: "Execution and approval across plants.",
          healthLabel: "Active work orders",
        }}
        chart={<ModuleMetricChart items={workOrderItems} accent="#10b981" />}
      />

      <ModuleRow
        theme={{
          sidebar: "bg-violet-50/90",
          accent: "#8b5cf6",
          icon: <Receipt className="size-5 text-violet-700" />,
          title: "Invoices",
          subtitle: "Validation pass, blocked and exceptions.",
          healthLabel: "Invoice pass rate",
        }}
        sidebarFooter={
          <div className="inline-flex rounded-full border border-violet-200 bg-white p-1">
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
          </div>
        }
        chart={<ModuleMetricChart items={invoiceItems} accent="#8b5cf6" />}
      />
    </div>
  )
}
