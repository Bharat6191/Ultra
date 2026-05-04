import * as React from "react"

import { Card, CardContent, CardHeader } from "@/components/ui/card"

export type DataTableProps = {
  title?: string
  description?: string
  children: React.ReactNode
}

export function DataTable({ title, description, children }: DataTableProps) {
  return (
    <Card className="w-full rounded-2xl border border-gray-200 shadow-sm">
      {title || description ? (
        <CardHeader className="pb-3">
          <div className="space-y-1">
            {title ? <div className="text-sm font-medium text-zinc-950">{title}</div> : null}
            {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
          </div>
        </CardHeader>
      ) : null}
      <CardContent className="px-0 pb-0">{children}</CardContent>
    </Card>
  )
}

