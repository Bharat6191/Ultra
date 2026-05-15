import * as React from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatMoney } from "@/components/contractors/rateStatus"
import type { PartContractorsAnalytics, PartWorkOrderAnalytics } from "@/components/parts/analytics/types"

const STATUS_COLORS = ["#059669", "#0ea5e9", "#f59e0b", "#94a3b8", "#ef4444", "#8b5cf6"]

function statusLabel(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

type Props = {
  contractors: PartContractorsAnalytics
  workOrders: PartWorkOrderAnalytics
}

export function PartIntelligenceCharts({ contractors, workOrders }: Props) {
  const rateBars = React.useMemo(() => {
    if (contractors.bar_by_contractor.length > 0) {
      return contractors.bar_by_contractor.slice(0, 10).map((d) => ({
        name: d.name.length > 14 ? `${d.name.slice(0, 12)}…` : d.name,
        fullName: d.name,
        base: d.base_rate,
        negotiated: d.negotiated_rate,
      }))
    }
    return contractors.rows.slice(0, 10).map((r) => ({
      name: r.contractor_name.length > 14 ? `${r.contractor_name.slice(0, 12)}…` : r.contractor_name,
      fullName: r.contractor_name,
      base: Number(r.base_rate),
      negotiated: Number(r.final_negotiated_rate),
    }))
  }, [contractors])

  const woStatusPie = React.useMemo(() => {
    const slices = workOrders.donut_status.filter((d) => d.value > 0)
    return slices.length ? slices : [{ name: "none", value: 1 }]
  }, [workOrders.donut_status])

  const woStatusTotal = React.useMemo(
    () => woStatusPie.reduce((sum, d) => sum + Number(d.value), 0),
    [woStatusPie],
  )

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-1 pt-4">
          <CardTitle className="text-sm font-semibold">Negotiated rate vs base</CardTitle>
          <CardDescription className="text-xs">By contractor — compare quotes to standard base rate.</CardDescription>
        </CardHeader>
        <CardContent className="h-60 min-h-[240px] w-full min-w-0 pb-4 pt-1">
          {rateBars.length === 0 ? (
            <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No rate data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rateBars} margin={{ left: 4, right: 12, bottom: 48, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-22} textAnchor="end" height={48} />
                <YAxis tick={{ fontSize: 10 }} width={48} />
                <Tooltip
                  formatter={(v) => formatMoney(Number(v ?? 0))}
                  labelFormatter={(_, payload) => {
                    const row = payload?.[0]?.payload as { fullName?: string } | undefined
                    return row?.fullName ?? ""
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                <Bar dataKey="base" name="Base" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                <Bar dataKey="negotiated" name="Negotiated" fill="#059669" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-1 pt-4">
          <CardTitle className="text-sm font-semibold">Work order status mix</CardTitle>
          <CardDescription className="text-xs">Orders that include this part — by lifecycle status.</CardDescription>
        </CardHeader>
        <CardContent className="h-60 min-h-[240px] w-full min-w-0 pb-4 pt-1">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <Pie
                data={woStatusPie}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="44%"
                innerRadius={42}
                outerRadius={62}
                paddingAngle={2}
                label={false}
              >
                {woStatusPie.map((_, i) => (
                  <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v, name) => [v, statusLabel(String(name))]}
                labelFormatter={(name) => statusLabel(String(name))}
              />
              <Legend
                formatter={(value) => {
                  const slice = woStatusPie.find((d) => String(d.name) === String(value))
                  const pct =
                    woStatusTotal > 0 && slice ? Math.round((Number(slice.value) / woStatusTotal) * 100) : 0
                  return `${statusLabel(String(value))} ${pct}%`
                }}
                wrapperStyle={{ fontSize: 11, lineHeight: "18px", paddingTop: 6 }}
                layout="horizontal"
                align="center"
                verticalAlign="bottom"
              />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
