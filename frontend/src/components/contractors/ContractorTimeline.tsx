import * as React from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"

type ApprovalTimelineEvent = {
  type: string
  timestamp: string | null
  user?: string | null
  action?: string | null
  step?: number | null
  details?: unknown
}

type LocalEvent = {
  type: string
  timestamp: string
  title: string
  subtitle?: string
}

function fmt(ts: string) {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

export function ContractorTimeline({
  contractor,
  documents,
}: {
  contractor: { id: number; created_at: string; name: string }
  documents: { created_at: string; document_name: string; document_type: string }[]
}) {
  const [approvalEvents, setApprovalEvents] = React.useState<ApprovalTimelineEvent[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const canSeeApprovals = hasPermission("approval.view")

  React.useEffect(() => {
    let cancelled = false
    if (!canSeeApprovals) return
    ;(async () => {
      try {
        const rows = await getJson<ApprovalTimelineEvent[]>(`/audit/entity/contractor_creation/${contractor.id}`)
        if (!cancelled) setApprovalEvents(rows)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load workflow timeline")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canSeeApprovals, contractor.id])

  const local: LocalEvent[] = React.useMemo(() => {
    const out: LocalEvent[] = []
    out.push({
      type: "created",
      timestamp: contractor.created_at,
      title: "Contractor created",
      subtitle: contractor.name,
    })
    for (const d of documents) {
      out.push({
        type: "document_uploaded",
        timestamp: d.created_at,
        title: "Document uploaded",
        subtitle: `${d.document_name} (${d.document_type})`,
      })
    }
    out.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    return out
  }, [contractor, documents])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Timeline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {local.length === 0 ? <div className="text-sm text-muted-foreground">No activity yet.</div> : null}
        <div className="space-y-3">
          {local.map((e, idx) => (
            <div key={`${e.type}-${idx}`} className="rounded-lg border bg-muted/20 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">{e.title}</div>
                <div className="text-xs text-muted-foreground">{fmt(e.timestamp)}</div>
              </div>
              {e.subtitle ? <div className="text-xs text-muted-foreground">{e.subtitle}</div> : null}
            </div>
          ))}
        </div>

        {canSeeApprovals ? (
          <div className="pt-3">
            <div className="mb-2 text-sm font-medium">Workflow activity</div>
            {error ? <div className="text-sm text-destructive">{error}</div> : null}
            {approvalEvents === null ? (
              <div className="text-sm text-muted-foreground">Loading workflow timeline…</div>
            ) : approvalEvents.length === 0 ? (
              <div className="text-sm text-muted-foreground">No workflow events.</div>
            ) : (
              <div className="space-y-2">
                {approvalEvents.map((ev, i) => (
                  <div key={i} className="rounded-lg border px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium">
                        {ev.type === "approval_step"
                          ? `Step ${ev.step ?? "—"}: ${ev.action ?? ev.type}`
                          : ev.type}
                      </div>
                      <div className="text-xs text-muted-foreground">{ev.timestamp ? fmt(ev.timestamp) : "—"}</div>
                    </div>
                    {ev.user ? <div className="text-xs text-muted-foreground">By {ev.user}</div> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="pt-3 text-sm text-muted-foreground">
            Workflow activity is available to users with <code className="rounded bg-muted px-1 py-0.5 text-xs">approval.view</code>.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

