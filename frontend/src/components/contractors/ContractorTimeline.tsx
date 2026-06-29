import * as React from "react"
import {
  Building2,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  FileMinus,
  FilePlus,
  History,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TimerReset,
} from "lucide-react"

import { CollapsibleAuditList } from "@/components/shared/collapsible-audit-list"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getJson } from "@/lib/api"

export type ContractorTimelineEvent = {
  type: string
  action: string
  timestamp: string | null
  actor_user_id: number | null
  actor_name: string | null
  title: string
  description: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
}

function orgUnitNameFromEvent(event: ContractorTimelineEvent) {
  for (const source of [event.metadata, event.new_value, event.old_value]) {
    const value = source?.org_unit_name
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

function eventDescription(event: ContractorTimelineEvent) {
  if (event.action.startsWith("PLANT_MAPPING_")) {
    const orgUnitName = orgUnitNameFromEvent(event)
    if (orgUnitName) return `Plant mapping (${orgUnitName}).`
  }
  return event.description
}

function eventActorName(event: ContractorTimelineEvent) {
  return event.actor_name?.trim() || "System"
}

function formatTimestamp(ts: string | null) {
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

function actorInitials(name: string | null) {
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
    case "UPDATED":
      return Pencil
    case "STATUS_CHANGED":
      return TimerReset
    case "DOCUMENT_UPLOADED":
      return FilePlus
    case "DOCUMENT_VERIFIED":
      return ShieldCheck
    case "DOCUMENT_REJECTED":
      return ShieldAlert
    case "DOCUMENT_DELETED":
      return FileMinus
    case "PLANT_MAPPING_ADDED":
    case "PLANT_MAPPING_UPDATED":
    case "PLANT_MAPPING_REMOVED":
      return Building2
    case "REQUEST_CREATED":
      return History
    case "APPROVE":
      return CircleCheck
    case "REJECT":
      return CircleX
    default:
      return History
  }
}

function eventTone(action: string): "neutral" | "success" | "warning" | "danger" | "info" {
  switch (action.toUpperCase()) {
    case "CREATED":
    case "DOCUMENT_VERIFIED":
    case "APPROVE":
    case "PLANT_MAPPING_ADDED":
      return "success"
    case "DOCUMENT_REJECTED":
    case "DOCUMENT_DELETED":
    case "REJECT":
    case "PLANT_MAPPING_REMOVED":
      return "danger"
    case "STATUS_CHANGED":
    case "UPDATED":
    case "PLANT_MAPPING_UPDATED":
      return "warning"
    case "REQUEST_CREATED":
      return "info"
    default:
      return "neutral"
  }
}

function toneClasses(tone: string) {
  switch (tone) {
    case "success":
      return "bg-emerald-50 text-emerald-700 border-emerald-100"
    case "warning":
      return "bg-amber-50 text-amber-700 border-amber-100"
    case "danger":
      return "bg-red-50 text-red-700 border-red-100"
    case "info":
      return "bg-sky-50 text-sky-700 border-sky-100"
    default:
      return "bg-zinc-50 text-zinc-700 border-zinc-100"
  }
}

function fieldLabel(key: string) {
  const labels: Record<string, string> = {
    action: "Action",
    address: "Address",
    alternate_email: "Alternate Email",
    alternate_phone: "Alternate Phone",
    approval_request_id: "Approval Request ID",
    city: "City",
    cin: "CIN",
    contact_person: "Contact Person",
    contact_person_title: "Contact Title",
    contractor_code: "Contractor Code",
    contractor_type: "Contractor Type",
    country: "Country",
    current_step: "Current Step",
    email: "Email",
    entity_type: "Entity Type",
    gst_number: "GST Number",
    gstin: "GSTIN",
    is_active: "Active",
    legal_name: "Legal Name",
    name: "Contractor Name",
    org_unit_name: "Plant / Org Unit",
    org_unit_id: "Org Unit ID",
    pan: "PAN Number",
    pan_number: "PAN Number",
    phone: "Phone",
    postal_code: "Postal Code",
    registration_number: "Registration Number",
    request_id: "Request ID",
    role: "Role",
    start_date: "Start Date",
    end_date: "End Date",
    state: "State",
    notes: "Notes",
    status: "Status",
    document_name: "Document",
    document_type: "Document Type",
    task_id: "Task ID",
    trade_name: "Trade Name",
    website: "Website",
  }
  if (labels[key]) return labels[key]
  const wordOverrides: Record<string, string> = {
    cin: "CIN Number",
    gstin: "GSTIN Number",
    id: "ID",
    pan: "PAN Number",
    po: "PO",
    uom: "UOM",
    wo: "WO",
  }
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => wordOverrides[part.toLowerCase()] ?? `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function renderFieldValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "—"
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return JSON.stringify(value)
}

function DiffBlock({
  oldValue,
  newValue,
}: {
  oldValue: Record<string, unknown> | null
  newValue: Record<string, unknown> | null
}) {
  const keys = Array.from(
    new Set([...(oldValue ? Object.keys(oldValue) : []), ...(newValue ? Object.keys(newValue) : [])]),
  )
    .filter((key) => !(key === "org_unit_id" && ((oldValue?.org_unit_name ?? newValue?.org_unit_name) != null)))
    .sort()
  if (keys.length === 0) return null
  return (
    <div className="mt-3 overflow-hidden rounded-xl border bg-zinc-50">
      <table className="w-full text-xs">
        <thead className="bg-zinc-100 text-left text-[10px] uppercase tracking-wide text-zinc-600">
          <tr>
            <th className="px-3 py-2">Field</th>
            <th className="px-3 py-2">Before</th>
            <th className="px-3 py-2">After</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const before = oldValue?.[k]
            const after = newValue?.[k]
            return (
              <tr key={k} className="border-t border-zinc-200">
                <td className="px-3 py-2 font-medium capitalize text-zinc-700">{fieldLabel(k)}</td>
                <td className="px-3 py-2 font-mono text-zinc-700">
                  {renderFieldValue(before)}
                </td>
                <td className="px-3 py-2 font-mono text-emerald-700">
                  {renderFieldValue(after)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TimelineRow({
  event,
  isLast,
}: {
  event: ContractorTimelineEvent
  isLast: boolean
}) {
  const Icon = eventIcon(event.action)
  const tone = eventTone(event.action)
  const hasDiff =
    (event.old_value && Object.keys(event.old_value).length > 0) ||
    (event.new_value && Object.keys(event.new_value).length > 0)
  const [open, setOpen] = React.useState(false)

  return (
    <div className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <div
          className={`flex size-9 items-center justify-center rounded-full border ${toneClasses(tone)}`}
        >
          <Icon className="size-4" aria-hidden />
        </div>
        {!isLast ? <div className="mt-1 w-px flex-1 bg-zinc-200" /> : null}
      </div>
      <div className="min-w-0 flex-1 pb-6">
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-950">
                {event.title}
                <Badge variant="secondary" className="bg-zinc-50 text-[10px] uppercase tracking-wide text-zinc-600">
                  {event.type}
                </Badge>
              </div>
              {eventDescription(event) ? (
                <div className="text-sm text-muted-foreground">{eventDescription(event)}</div>
              ) : null}
              <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                <div className="rounded-xl border bg-zinc-50/80 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Performed by</div>
                  <div className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-900">
                    <span className="flex size-5 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-medium text-zinc-600">
                      {actorInitials(eventActorName(event))}
                    </span>
                    {eventActorName(event)}
                  </div>
                </div>
                <div className="rounded-xl border bg-zinc-50/80 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Time</div>
                  <div className="mt-1 text-sm font-medium text-zinc-900">{formatTimestamp(event.timestamp)}</div>
                </div>
              </div>
            </div>
            {hasDiff ? (
              <Button
                variant="ghost"
                size="xs"
                className="rounded-lg"
                onClick={() => setOpen((s) => !s)}
                aria-expanded={open}
              >
                {open ? (
                  <ChevronDown className="mr-1 size-3.5 opacity-70" aria-hidden />
                ) : (
                  <ChevronRight className="mr-1 size-3.5 opacity-70" aria-hidden />
                )}
                {open ? "Hide changes" : "View changes"}
              </Button>
            ) : null}
          </div>
          {open && hasDiff ? <DiffBlock oldValue={event.old_value} newValue={event.new_value} /> : null}
        </div>
      </div>
    </div>
  )
}

export function ContractorTimeline({ contractorId }: { contractorId: number }) {
  const [events, setEvents] = React.useState<ContractorTimelineEvent[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      setError(null)
      try {
        const data = await getJson<ContractorTimelineEvent[]>(`/contractors/${contractorId}/timeline`)
        if (!cancelled) setEvents(data)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load timeline")
          setEvents([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [contractorId])

  const visible = events ?? []

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Audit Log</CardTitle>
            {/* <div className="text-sm text-muted-foreground">
              Audit log + approval activity for this contractor.
            </div> */}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error ? <div className="text-sm text-destructive">{error}</div> : null}
        {events === null ? (
          <div className="text-sm text-muted-foreground">Loading timeline…</div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-zinc-50/50 p-10 text-center text-sm text-muted-foreground">
            No activity yet for this view.
          </div>
        ) : (
          <CollapsibleAuditList
            items={visible}
            renderItem={(ev, idx, currentVisible) => (
              <TimelineRow
                key={`${ev.type}-${ev.action}-${idx}`}
                event={ev}
                isLast={idx === currentVisible.length - 1}
              />
            )}
          />
        )}
      </CardContent>
    </Card>
  )
}
