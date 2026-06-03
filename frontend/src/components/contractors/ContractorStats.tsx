import * as React from "react"
import { AlertTriangle, CalendarClock, FileText, History } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type Doc = { expiry_date: string | null; created_at: string }

function daysUntil(dateIso: string): number {
  const d = new Date(dateIso)
  const today = new Date()
  const t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const t1 = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.floor((t1 - t0) / (1000 * 60 * 60 * 24))
}

function fmt(ts: string | null) {
  if (!ts) return "—"
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

export function ContractorStats({
  documents,
  warnDays,
  contractorUpdatedAt,
}: {
  documents: Doc[]
  warnDays: number
  contractorUpdatedAt: string
}) {
  const stats = React.useMemo(() => {
    const total = documents.length
    let expired = 0
    let expiringSoon = 0
    let lastActivity = contractorUpdatedAt
    for (const d of documents) {
      if (d.created_at && d.created_at > lastActivity) lastActivity = d.created_at
      if (!d.expiry_date) continue
      const left = daysUntil(d.expiry_date)
      if (left < 0) expired += 1
      else if (left <= warnDays) expiringSoon += 1
    }
    return { total, expired, expiringSoon, lastActivity }
  }, [documents, warnDays, contractorUpdatedAt])

  const items = [
    { title: "Total documents", value: String(stats.total), icon: FileText, hint: "Uploaded & tracked" },
    { title: "Expiring Documents", value: String(stats.expiringSoon), icon: CalendarClock, hint: `≤ ${warnDays} days` },
    { title: "Expired", value: String(stats.expired), icon: AlertTriangle, hint: "Needs attention" },
    { title: "Last activity", value: fmt(stats.lastActivity), icon: History, hint: "Latest update" },
  ] as const

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {items.map((it) => {
        const Icon = it.icon
        return (
          <Card key={it.title} className="rounded-2xl shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-sm font-bold text-zinc-950">{it.title}</CardTitle>
                <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                  <Icon className="size-4" aria-hidden />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-normal tracking-tight text-zinc-950">{it.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{it.hint}</div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
