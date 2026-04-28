import * as React from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export type UsersByRoleRow = { role: string; count: number }

export type UsersDashboardModule = {
  total_users: number
  active_users: number
  inactive_users: number
  new_users_last_7_days: number
  users_by_role: UsersByRoleRow[]
}

function StatCard({ title, value, hint }: { title: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {hint ? <CardDescription className="text-xs">{hint}</CardDescription> : null}
      </CardHeader>
      <CardContent className="text-2xl font-semibold tracking-tight">{value}</CardContent>
    </Card>
  )
}

export function UserDashboard({ data }: { data: UsersDashboardModule }) {
  const roleData = React.useMemo(
    () => (data.users_by_role ?? []).map((r) => ({ name: r.role, value: r.count })),
    [data.users_by_role]
  )
  const activeInactive = React.useMemo(
    () => [
      { name: "Active", value: data.active_users },
      { name: "Inactive", value: data.inactive_users },
    ],
    [data.active_users, data.inactive_users]
  )

  return (
    <section className="grid gap-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-zinc-950">
          User dashboard <span className="text-emerald-600">•</span>
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Total users" value={data.total_users} />
        <StatCard title="Active users" value={data.active_users} />
        <StatCard title="Inactive users" value={data.inactive_users} />
        <StatCard title="New users" hint="Last 7 days" value={data.new_users_last_7_days} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="border-emerald-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Users by role</CardTitle>
            <CardDescription className="text-xs">Distinct users assigned to each role</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={roleData} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#10b981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-emerald-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active vs inactive</CardTitle>
            <CardDescription className="text-xs">Current user status distribution</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip />
                <Pie
                  data={activeInactive}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                  fill="#10b981"
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

