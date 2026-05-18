import * as React from "react"
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleX,
  History,
  MessagesSquare,
  Send,
  Sparkles,
  TimerReset,
  XCircle,
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getJson } from "@/lib/api"
import { formatMoney, type VsBaseTolerance } from "@/components/contractors/rateStatus"
import { VsBaseToleranceBadge } from "@/components/contractors/VsBaseToleranceBadge"

export type TimelineChange = {
  field: string
  label: string
  old: string | null
  new: string | null
}

export type RateTimelineEvent = {
  occurred_at: string | null
  kind: "audit" | "negotiation" | "approval"
  action: string
  actor_user_id: number | null
  actor_name: string | null
  title: string
  description: string | null
  payload: {
    changes?: TimelineChange[]
    highlights?: Record<string, string>
    comment?: string
    is_resubmit?: boolean
    round_number?: number
    proposed_rate?: string | null
    counter_rate?: string | null
    remarks?: string | null
    delta_from_prior_round?: string
    vs_base_tolerance?: VsBaseTolerance & {
      amount_display: string
      pct_display: string
    }
  } | null
}

function apiVsBaseTolerance(
  raw: NonNullable<RateTimelineEvent["payload"]>["vs_base_tolerance"],
): VsBaseTolerance | null {
  if (!raw) return null
  return {
    amount: Number(raw.amount),
    pct: Number(raw.pct),
    amount_display: raw.amount_display,
    pct_display: raw.pct_display,
    tone: raw.tone,
  }
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
    case "UPDATED":
    case "VALIDITY_CHANGED":
      return History
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

const HIGHLIGHT_LABELS: Record<string, string> = {
  negotiated_rate: "Negotiated rate",
  proposed_rate: "Proposed rate",
  counter_rate: "Counter offer",
  base_rate: "Part base rate",
  previous_rate: "Previous rate",
  savings_amount: "Savings vs opening ask",
  savings_percentage: "Savings %",
  delta_from_prior_round: "Change from prior round",
  effective_from: "Effective from",
  effective_to: "Effective to",
}

function formatHighlightValue(key: string, value: string): string {
  if (
    key.includes("rate") ||
    key === "savings_amount" ||
    key === "delta_from_prior_round"
  ) {
    if (value.startsWith("₹")) return value
    return formatMoney(value)
  }
  return value
}

function TimelineHighlights({ highlights }: { highlights: Record<string, string> }) {
  const entries = Object.entries(highlights).filter(([, v]) => v)
  if (entries.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {entries.map(([key, value]) => (
        <span
          key={key}
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            key === "savings_amount" || key === "savings_percentage"
              ? "bg-emerald-50 text-emerald-800"
              : key === "counter_rate"
                ? "bg-sky-50 text-sky-800"
                : "bg-gray-100 text-gray-800"
          }`}
        >
          <span className="font-normal text-muted-foreground">
            {HIGHLIGHT_LABELS[key] ?? key}:{" "}
          </span>
          {formatHighlightValue(key, value)}
        </span>
      ))}
    </div>
  )
}

function TimelineChanges({ changes }: { changes: TimelineChange[] }) {
  if (changes.length === 0) return null
  return (
    <div className="space-y-1.5 text-xs">
      {changes.map((ch) => (
        <div
          key={ch.field}
          className="grid gap-1 rounded-md border border-border/60 bg-background px-2.5 py-2 sm:grid-cols-[9rem_minmax(0,1fr)_1rem_minmax(0,1fr)] sm:items-center"
        >
          <div className="font-medium text-foreground">{ch.label}</div>
          <div className="min-w-0 truncate text-muted-foreground" title={ch.old ?? "—"}>
            {ch.old ?? "—"}
          </div>
          <div className="hidden justify-center text-muted-foreground sm:flex">
            <ArrowRight className="size-3.5" />
          </div>
          <div className="min-w-0 truncate font-medium text-foreground" title={ch.new ?? "—"}>
            {ch.new ?? "—"}
          </div>
        </div>
      ))}
    </div>
  )
}

function kindLabel(kind: RateTimelineEvent["kind"]): string {
  if (kind === "approval") return "Approval"
  if (kind === "negotiation") return "Round"
  return "Audit"
}

export function ContractorRateTimeline({
  rateId,
  refreshKey,
}: {
  rateId: number
  /** Bumps when the parent rate row changes (submit, negotiate, etc.) so the log refetches. */
  refreshKey?: string | number | null
}) {
  const [events, setEvents] = React.useState<RateTimelineEvent[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setEvents(null)
    setError(null)
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
  }, [rateId, refreshKey])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Negotiation Log</CardTitle>
        <p className="text-xs text-muted-foreground">
          Compact audit trail with its own scroll area so the rate view stays easier to scan.
        </p>
      </CardHeader>
      <CardContent>
        {error ? <div className="text-sm text-destructive">{error}</div> : null}
        {events === null && !error ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : null}
        {events && events.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-gray-50 p-6 text-center text-sm text-muted-foreground">
            No activity recorded yet.
          </div>
        ) : null}
        {events && events.length > 0 ? (
          <ScrollArea className="h-[min(68vh,44rem)]">
            <div className="pr-4">
              <ol className="relative space-y-3 pl-5">
                <span className="absolute left-2 top-2 bottom-2 w-px bg-gray-200" aria-hidden />
                {events.map((evt, i) => {
                  const Icon = eventIcon(evt.action)
                  const t = tone(evt.action, evt.kind)
                  const cls = TONE_CLASSES[t]
                  const payload = evt.payload
                  const comment = payload?.comment ?? evt.description
                  const highlights = payload?.highlights
                  const changes = payload?.changes
                  const vsBaseTolerance = apiVsBaseTolerance(payload?.vs_base_tolerance)
                  const hasExpandableDetails = Boolean((changes && changes.length) || comment)

                  return (
                    <li key={`${evt.occurred_at}-${evt.action}-${i}`} className="relative">
                      <span
                        className={`absolute -left-[22px] flex size-5 items-center justify-center rounded-full ring-2 ${cls.ring} ${cls.bg} ${cls.text}`}
                      >
                        <Icon className="size-3" />
                      </span>
                      <div className="rounded-xl border bg-white p-3 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                {kindLabel(evt.kind)}
                              </span>
                              {payload?.is_resubmit ? (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
                                  Resubmit
                                </span>
                              ) : null}
                            </div>
                            <div className="text-sm font-semibold text-foreground">{evt.title}</div>
                          </div>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {formatTimestamp(evt.occurred_at)}
                          </span>
                        </div>

                        {highlights ? <TimelineHighlights highlights={highlights} /> : null}
                        {vsBaseTolerance ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-[11px] text-muted-foreground">Tolerance</span>
                            <VsBaseToleranceBadge
                              negotiated={null}
                              baseRate={null}
                              tolerance={vsBaseTolerance}
                              className="w-fit"
                            />
                          </div>
                        ) : null}

                        {hasExpandableDetails ? (
                          <details className="group mt-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 [&_summary::-webkit-details-marker]:hidden">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                              <span>View details</span>
                              <ChevronDown className="size-3.5 transition-transform duration-200 group-open:rotate-180" />
                            </summary>
                            <div className="mt-2 space-y-2">
                              {changes ? <TimelineChanges changes={changes} /> : null}
                              {comment ? (
                                <blockquote className="rounded-md border-l-2 border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                                  {comment}
                                </blockquote>
                              ) : null}
                            </div>
                          </details>
                        ) : null}

                        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="grid h-5 w-5 place-items-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-600">
                            {actorInitials(evt.actor_name)}
                          </span>
                          <span>
                            {(() => {
                              const a = evt.action.toUpperCase()
                              const name = evt.actor_name
                              if (a === "APPROVED" || (a === "APPROVE" && evt.kind === "approval")) {
                                return name ? `Approved by ${name}` : "Approved"
                              }
                              if (a === "REJECTED" || (a === "REJECT" && evt.kind === "approval")) {
                                return name ? `Rejected by ${name}` : "Rejected"
                              }
                              return name ?? "System"
                            })()}
                          </span>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </div>
          </ScrollArea>
        ) : null}
      </CardContent>
    </Card>
  )
}
