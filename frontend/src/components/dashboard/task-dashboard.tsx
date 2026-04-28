import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export type TasksDashboardModule = {
  pending: number
  approved: number
  rejected: number
  completed: number
}

function StatCard({ title, value }: { title: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-2xl font-semibold tracking-tight">{value}</CardContent>
    </Card>
  )
}

export function TaskDashboard({ data }: { data: TasksDashboardModule }) {
  const chartData = [
    { name: "Pending", value: data.pending },
    { name: "Approved", value: data.approved },
    { name: "Rejected", value: data.rejected },
    { name: "Completed", value: data.completed },
  ]

  return (
    <section className="grid gap-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-zinc-950">
          Task dashboard <span className="text-emerald-600">•</span>
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Pending" value={data.pending} />
        <StatCard title="Approved" value={data.approved} />
        <StatCard title="Rejected" value={data.rejected} />
        <StatCard title="Completed" value={data.completed} />
      </div>

      <Card className="border-emerald-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Status breakdown</CardTitle>
          <CardDescription className="text-xs">Counts across your assigned tasks</CardDescription>
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" fill="#10b981" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </section>
  )
}

