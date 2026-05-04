import * as React from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type ByStatus = { status: string; count: number }
type ByPlant = { org_unit_id: number; name: string; count: number }

const STATUS_COLORS: Record<string, string> = {
  active: "#10b981",
  pending: "#fbbf24",
  non_compliant: "#ef4444",
  expired: "#f97316",
  suspended: "#a3a3a3",
  blacklisted: "#dc2626",
  draft: "#94a3b8",
}

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  pending: "Pending",
  non_compliant: "Non-compliant",
  expired: "Expired",
  suspended: "Suspended",
  blacklisted: "Blacklisted",
  draft: "Draft",
}

export function ContractorCharts({
  byStatus,
  byPlant,
}: {
  byStatus: ByStatus[]
  byPlant: ByPlant[]
}) {
  const statusData = React.useMemo(
    () =>
      byStatus.map((row) => ({
        name: STATUS_LABEL[row.status] ?? row.status,
        value: row.count,
        color: STATUS_COLORS[row.status] ?? "#94a3b8",
      })),
    [byStatus],
  )

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Compliance distribution</CardTitle>
          <CardDescription className="text-xs">Contractors by lifecycle status</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip />
              <Pie
                data={statusData}
                dataKey="value"
                nameKey="name"
                innerRadius={60}
                outerRadius={95}
                paddingAngle={2}
              >
                {statusData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-700">
            {statusData.map((s) => (
              <div key={s.name} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: s.color }} />
                {s.name}
                <span className="text-muted-foreground">({s.value})</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Contractors by plant</CardTitle>
          <CardDescription className="text-xs">Top operating sites</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byPlant} margin={{ left: 8, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 12 }}
                interval={0}
                angle={-15}
                height={50}
              />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" radius={[8, 8, 0, 0]} fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
