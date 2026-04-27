import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export function DashboardPage() {
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="border-emerald-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Plant performance</CardTitle>
            <CardDescription className="text-xs">Today</CardDescription>
          </CardHeader>
          <CardContent className="flex items-baseline justify-between">
            <div className="text-2xl font-semibold tracking-tight">92%</div>
            <Badge className="bg-emerald-600">On track</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Open approvals</CardTitle>
            <CardDescription className="text-xs">Pending</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tracking-tight">7</CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Master data updates</CardTitle>
            <CardDescription className="text-xs">This week</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tracking-tight">31</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>
            This is the main application area for standard users. Replace these sections with your
            actual modules.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Recommended next routes: master data, planning, and performance dashboards.
        </CardContent>
      </Card>
    </div>
  )
}

