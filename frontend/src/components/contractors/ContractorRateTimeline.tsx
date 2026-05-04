import * as React from "react"
import {
  CheckCircle2,
  CircleX,
  History,
  MessagesSquare,
  Send,
  Sparkles,
  TimerReset,
  XCircle,
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getJson } from "@/lib/api"
import { formatMoney } from "@/components/contractors/rateStatus"

export type RateTimelineEvent = {
  occurred_at: string | null
  kind: "audit" | "negotiation" | "approval"
  action: string
  actor_user_id: number | null
  actor_name: string | null
  title: string
  description: string | null
  payload: Record<string, unknown> | null
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "—"
  try {
    return new Date(ts).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return ts
  }
}

function actorInitials(name: string | null): string {
  if (!name) return "·"
  const parts = name.trim().split(/\s+/)
  const a = (parts[0]?.[0] ?? "?").toUpperCase()
  const b = (parts[1]?.[0] ?? "").toUpperCase()
  return `${a}${b}`.slice(0, 2)
}

function eventIcon(action: string) {
  switch (action.toUpperCase()) {
    case "CREATED":
      return Sparkles
    case "ROUND":
    case "NEGOTIATION_ADDED":
      return MessagesSquare
    case "SENT_FOR_APPROVAL":
      return Send
    case "APPROVED":
    case "APPROVE":
    case "RATE_ACTIVATED":
      return CheckCircle2
    case "REJECTED":
    case "REJECT":
      return XCircle
    case "CANCELLED":
      return CircleX
    case "RATE_DEACTIVATED":
    case "EXPIRED":
      return TimerReset
    default:
      return History
  }
}

function tone(
  action: string,
  kind: "audit" | "negotiation" | "approval",
): "neutral" | "success" | "warning" | "danger" | "info" {
  if (kind === "negotiation") return "info"
  switch (action.toUpperCase()) {
    case "CREATED":
      return "info"
    case "SENT_FOR_APPROVAL":
      return "warning"
    case "APPROVED":
    case "APPROVE":
    case "RATE_ACTIVATED":
      return "success"
    case "REJECTED":
    case "REJECT":
    case "CANCELLED":
      return "danger"
    case "RATE_DEACTIVATED":
    case "EXPIRED":
      return "neutral"
    default:
      return "neutral"
  }
}

const TONE_CLASSES: Record<string, { ring: string; bg: string; text: string }> = {
  neutral: { ring: "ring-gray-200", bg: "bg-gray-50", text: "text-gray-700" },
  info: { ring: "ring-sky-200", bg: "bg-sky-50", text: "text-sky-700" },
  success: { ring: "ring-emerald-200", bg: "bg-emerald-50", text: "text-emerald-700" },
  warning: { ring: "ring-amber-200", bg: "bg-amber-50", text: "text-amber-700" },
  danger: { ring: "ring-red-200", bg: "bg-red-50", text: "text-red-700" },
}

export function ContractorRateTimeline({ rateId }: { rateId: number }) {
  const [events, setEvents] = React.useState<RateTimelineEvent[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await getJson<RateTimelineEvent[]>(`/contractor-rates/${rateId}/timeline`)
        if (!cancelled) setEvents(rows)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load timeline")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [rateId])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Negotiation timeline</CardTitle>
        <p className="text-xs text-muted-foreground">
          Chronological audit of every change, round, and approval action.
        </p>
      </CardHeader>
      <CardContent>
        {error ? <div className="text-sm text-destructive">{error}</div> : null}
        {events === null && !error ? (
          <div className="text-sm text-muted-foreground">Loading timeline…</div>
        ) : null}
        {events && events.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-gray-50 p-6 text-center text-sm text-muted-foreground">
            No timeline events yet.
          </div>
        ) : null}
        {events && events.length > 0 ? (
          <ol className="relative space-y-4 pl-6">
            <span className="absolute left-3 top-2 bottom-2 w-px bg-gray-200" aria-hidden />
            {events.map((evt, i) => {
              const Icon = eventIcon(evt.action)
              const t = tone(evt.action, evt.kind)
              const cls = TONE_CLASSES[t]
              const isRound = evt.kind === "negotiation"
              return (
                <li key={i} className="relative">
                  <span
                    className={`absolute -left-[26px] flex size-6 items-center justify-center rounded-full ring-2 ${cls.ring} ${cls.bg} ${cls.text}`}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <div className="rounded-xl border bg-white p-3 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{evt.title}</span>
                        {evt.kind === "approval" ? (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-600">
                            Approval
                          </span>
                        ) : null}
                        {isRound ? (
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-sky-700">
                            Round
                          </span>
                        ) : null}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatTimestamp(evt.occurred_at)}
                      </span>
                    </div>
                    {evt.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">{evt.description}</p>
                    ) : null}
                    {isRound && evt.payload ? (
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                        {(evt.payload as Record<string, unknown>).proposed_rate ? (
                          <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">
                            Proposed{" "}
                            {formatMoney(
                              String((evt.payload as Record<string, unknown>).proposed_rate),
                            )}
                          </span>
                        ) : null}
                        {(evt.payload as Record<string, unknown>).counter_rate ? (
                          <span className="rounded-md bg-sky-50 px-2 py-1 text-sky-700">
                            Counter{" "}
                            {formatMoney(
                              String((evt.payload as Record<string, unknown>).counter_rate),
                            )}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-600">
                        {actorInitials(evt.actor_name)}
                      </span>
                      <span>{evt.actor_name ?? "System"}</span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        ) : null}
      </CardContent>
    </Card>
  )
}
