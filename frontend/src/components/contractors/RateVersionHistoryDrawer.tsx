import * as React from "react"
import { Link } from "react-router-dom"
import { History } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ApiError, getJson } from "@/lib/api"
import { formatMoney, formatPercent } from "@/components/contractors/rateStatus"

export type RateVersionEntry = {
  id: number
  parent_id: number
  version_number: number
  snapshot_json: Record<string, unknown>
  change_reason: string | null
  created_by: number | null
  created_by_name: string | null
  created_at: string
  diff: Array<{ field: string; old: unknown; new: unknown }> | null
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** API path segment before ``/{id}/versions``. */
  resource: "part-master" | "contractor-rates"
  parentId: number
  /** Visible header above the version list (e.g. job/skill, contractor name). */
  title: string
  /** Optional sub-title (e.g. plant + unit). */
  subtitle?: string | null
}

function formatPrimitive(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "object") {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return iso
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
  } catch {
    return iso
  }
}

const FIELD_LABELS: Record<string, string> = {
  base_rate: "Should cost",
  negotiated_rate: "Negotiated Rate",
  initial_rate: "Initial rate",
  previous_rate: "Previous rate",
  savings_amount: "Savings",
  savings_percentage: "Savings %",
  effective_from: "Effective from",
  effective_to: "Effective to",
  is_active: "Active",
  notes: "Notes",
  status: "Status",
  part_code: "Part code",
  part_name: "Part name",
  unit_type: "Unit type",
  pricing_method: "Pricing method",
  rate_unit_type: "Rate unit type",
  weight_per_piece: "Weight / piece",
  org_unit_id: "Plant ID",
  contractor_id: "Contractor ID",
  part_master_id: "Part master ID",
  remarks: "Remarks",
  approval_request_id: "Approval request",
  current_round: "Round",
}

/** Keys stored on snapshots but not useful in the summary panel. */
const HIDDEN_SNAPSHOT_KEYS = new Set([
  "id",
  "created_at",
  "updated_at",
  "created_by",
  "approval_request_id",
])

const PART_MASTER_FIELD_ORDER = [
  "part_code",
  "part_name",
  "description",
  "unit_type",
  "pricing_method",
  "weight_per_piece",
  "base_rate",
  "rate_unit_type",
  "org_unit_id",
  "effective_from",
  "effective_to",
  "is_active",
  "status",
  "notes",
]

const CONTRACTOR_RATE_FIELD_ORDER = [
  "contractor_id",
  "part_master_id",
  "negotiated_rate",
  "initial_rate",
  "previous_rate",
  "savings_amount",
  "savings_percentage",
  "effective_from",
  "effective_to",
  "status",
  "remarks",
]

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}

function humanizeToken(key: string, text: string): string {
  if (key === "skill_type" || key === "status" || key === "unit" || key === "pricing_method" || key === "rate_unit_type") {
    return text.replace(/_/g, " ")
  }
  return text
}

function formatSnapshotValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (key === "is_active") {
    if (typeof value === "boolean") return value ? "Yes" : "No"
    if (value === "true" || value === "1") return "Yes"
    if (value === "false" || value === "0") return "No"
  }
  if (
    ["base_rate", "negotiated_rate", "initial_rate", "previous_rate", "savings_amount"].includes(key)
  ) {
    return formatMoney(value as number | string)
  }
  if (key === "savings_percentage") {
    return formatPercent(value as number | string)
  }
  if (
    (key === "effective_from" || key === "effective_to") &&
    (typeof value === "string" || typeof value === "number")
  ) {
    const d = new Date(value)
    if (Number.isFinite(d.getTime())) {
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    }
  }
  const raw = formatPrimitive(value)
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return humanizeToken(key, raw)
  }
  return raw
}

function orderedSnapshotEntries(
  snapshot: Record<string, unknown>,
  resource: "part-master" | "contractor-rates",
): Array<[string, unknown]> {
  const preferred = resource === "part-master" ? PART_MASTER_FIELD_ORDER : CONTRACTOR_RATE_FIELD_ORDER
  const keys = Object.keys(snapshot).filter((k) => !HIDDEN_SNAPSHOT_KEYS.has(k))
  const seen = new Set<string>()
  const out: Array<[string, unknown]> = []
  for (const k of preferred) {
    if (keys.includes(k)) {
      out.push([k, snapshot[k]])
      seen.add(k)
    }
  }
  for (const k of [...keys].sort()) {
    if (!seen.has(k)) out.push([k, snapshot[k]])
  }
  return out
}

function SnapshotDetailsPanel({
  snapshot,
  resource,
}: {
  snapshot: Record<string, unknown>
  resource: "part-master" | "contractor-rates"
}) {
  const rows = orderedSnapshotEntries(snapshot, resource)
  if (rows.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">No snapshot fields.</p>
  }
  return (
    <dl className="mt-3 divide-y rounded-md border bg-muted/25">
      {rows.map(([key, val]) => (
        <div
          key={key}
          className="grid gap-1 px-3 py-2.5 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:items-baseline sm:gap-4"
        >
          <dt className="text-xs font-medium text-muted-foreground">{fieldLabel(key)}</dt>
          <dd className="min-w-0 break-words text-sm">{formatSnapshotValue(key, val)}</dd>
        </div>
      ))}
    </dl>
  )
}

export function RateVersionHistoryButton(
  props: Omit<Props, "open" | "onOpenChange"> & { variant?: "outline" | "ghost"; size?: "sm" | "default"; label?: string },
) {
  const [open, setOpen] = React.useState(false)
  const { variant = "outline", size = "sm", label = "View history", ...rest } = props
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <History className="mr-2 h-4 w-4" /> {label}
      </Button>
      <RateVersionHistoryDrawer open={open} onOpenChange={setOpen} {...rest} />
    </>
  )
}

export function RateVersionHistoryDrawer({
  open,
  onOpenChange,
  resource,
  parentId,
  title,
  subtitle,
}: Props) {
  const [versions, setVersions] = React.useState<RateVersionEntry[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const data = await getJson<RateVersionEntry[]>(`/${resource}/${parentId}/versions`)
        // Newest first.
        const sorted = [...data].sort((a, b) => b.version_number - a.version_number)
        setVersions(sorted)
        setSelectedId(sorted[0]?.id ?? null)
      } catch (e) {
        setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to load history")
        setVersions([])
      } finally {
        setLoading(false)
      }
    })()
  }, [open, resource, parentId])

  const selected = React.useMemo(
    () => (versions ?? []).find((v) => v.id === selectedId) ?? null,
    [versions, selectedId],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,880px)] min-h-0 w-full max-w-[calc(100vw-1.5rem)] flex-col gap-4 overflow-hidden sm:max-w-5xl">
        <DialogHeader className="min-w-0 shrink-0 space-y-2">
          <DialogTitle className="flex items-start gap-2 break-words pr-8">
            <History className="mt-0.5 h-4 w-4 shrink-0" /> Version history — {title}
          </DialogTitle>
          {subtitle ? <DialogDescription className="break-words">{subtitle}</DialogDescription> : null}
        </DialogHeader>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading versions…</div>
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : !versions || versions.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No versions recorded for this rate yet.
          </div>
        ) : (
          <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
            <div className="flex max-h-[min(480px,45vh)] min-h-0 min-w-0 flex-col overflow-hidden rounded-md border sm:max-h-none sm:flex-1">
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <ul className="divide-y">
                  {versions.map((v) => {
                    const isSelected = v.id === selectedId
                    return (
                      <li key={v.id}>
                        <button
                          type="button"
                          className={`flex w-full min-w-0 flex-col gap-1 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 ${
                            isSelected ? "bg-muted/70" : ""
                          }`}
                          onClick={() => setSelectedId(v.id)}
                        >
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <span className="shrink-0 font-medium">v{v.version_number}</span>
                            {v.change_reason ? (
                              <Badge variant="outline" className="max-w-[55%] shrink-0 truncate rounded-md text-[10px]">
                                {v.change_reason.replaceAll("_", " ").toLowerCase()}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatDateTime(v.created_at)}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {v.created_by_name ?? "system"}
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>

            <div className="flex max-h-[min(480px,50vh)] min-h-0 min-w-0 flex-col overflow-hidden rounded-md border sm:max-h-none sm:flex-1">
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
                {selected === null ? (
                  <div className="text-sm text-muted-foreground">
                    Select a version to view its diff.
                  </div>
                ) : (
                  <>
                    <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 text-sm font-medium">
                        v{selected.version_number}{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          · {formatDateTime(selected.created_at)} ·{" "}
                          {selected.created_by_name ?? "system"}
                        </span>
                      </div>
                      {selected.change_reason ? (
                        <Badge variant="secondary" className="max-w-full shrink-0 truncate rounded-md text-[10px]">
                          {selected.change_reason.replaceAll("_", " ").toLowerCase()}
                        </Badge>
                      ) : null}
                    </div>

                    {!selected.diff || selected.diff.length === 0 ? (
                      <SnapshotDetailsPanel snapshot={selected.snapshot_json} resource={resource} />
                    ) : (
                      <ul className="divide-y rounded-md border">
                        {selected.diff.map((d, idx) => (
                          <li key={`${d.field}-${idx}`} className="flex min-w-0 flex-col gap-1 px-3 py-2 text-sm">
                            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {fieldLabel(d.field)}
                            </div>
                            <div className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-start">
                              <span className="min-w-0 break-words rounded-md bg-rose-50 px-2 py-1 font-mono text-xs text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                                {formatPrimitive(d.old)}
                              </span>
                              <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">→</span>
                              <span className="min-w-0 break-words rounded-md bg-emerald-50 px-2 py-1 font-mono text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                                {formatPrimitive(d.new)}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
        {!loading && !error && versions && versions.length > 0 ? (
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border pt-3">
            {resource === "part-master" ? (
              <Button asChild>
                <Link to={`/dashboard/part-master/${parentId}`} onClick={() => onOpenChange(false)}>
                  Open Part Master
                </Link>
              </Button>
            ) : (
              <Button asChild>
                <Link
                  to={`/dashboard/negotiated-rates/${parentId}`}
                  onClick={() => onOpenChange(false)}
                >
                  Open Negotiation Page
                </Link>
              </Button>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
