import * as React from "react"
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
import { ScrollArea } from "@/components/ui/scroll-area"
import { ApiError, getJson } from "@/lib/api"

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
  /** "rate-master" or "contractor-rates" — segment used for the API path. */
  resource: "rate-master" | "contractor-rates"
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
  base_rate: "Base rate",
  negotiated_rate: "Negotiated rate",
  initial_rate: "Initial rate",
  previous_rate: "Previous rate",
  savings_amount: "Savings",
  savings_percentage: "Savings %",
  effective_from: "Effective from",
  effective_to: "Effective to",
  is_active: "Active",
  notes: "Notes",
  status: "Status",
  job_type: "Job",
  skill_type: "Skill",
  unit: "Unit",
  org_unit_id: "Plant",
  remarks: "Remarks",
  approval_request_id: "Approval request",
  current_round: "Round",
}

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
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
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" /> Version history — {title}
          </DialogTitle>
          {subtitle ? <DialogDescription>{subtitle}</DialogDescription> : null}
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
          <div className="grid gap-4 sm:grid-cols-[260px_1fr]">
            <ScrollArea className="max-h-[480px] rounded-md border">
              <ul className="divide-y">
                {versions.map((v) => {
                  const isSelected = v.id === selectedId
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        className={`flex w-full flex-col gap-1 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 ${
                          isSelected ? "bg-muted/70" : ""
                        }`}
                        onClick={() => setSelectedId(v.id)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">v{v.version_number}</span>
                          {v.change_reason ? (
                            <Badge variant="outline" className="rounded-md text-[10px]">
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
            </ScrollArea>

            <ScrollArea className="max-h-[480px] rounded-md border">
              <div className="p-3">
                {selected === null ? (
                  <div className="text-sm text-muted-foreground">
                    Select a version to view its diff.
                  </div>
                ) : (
                  <>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">
                        v{selected.version_number}{" "}
                        <span className="text-xs text-muted-foreground">
                          · {formatDateTime(selected.created_at)} ·{" "}
                          {selected.created_by_name ?? "system"}
                        </span>
                      </div>
                      {selected.change_reason ? (
                        <Badge variant="secondary" className="rounded-md text-[10px]">
                          {selected.change_reason.replaceAll("_", " ").toLowerCase()}
                        </Badge>
                      ) : null}
                    </div>

                    {!selected.diff || selected.diff.length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        Initial version — no diff to display.
                        <pre className="mt-3 max-h-[320px] overflow-auto rounded-md bg-muted/40 p-3 text-xs">
                          {JSON.stringify(selected.snapshot_json, null, 2)}
                        </pre>
                      </div>
                    ) : (
                      <ul className="divide-y rounded-md border">
                        {selected.diff.map((d, idx) => (
                          <li key={`${d.field}-${idx}`} className="flex flex-col gap-1 px-3 py-2 text-sm">
                            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {fieldLabel(d.field)}
                            </div>
                            <div className="grid gap-1 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                              <span className="rounded-md bg-rose-50 px-2 py-1 font-mono text-xs text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                                {formatPrimitive(d.old)}
                              </span>
                              <span className="hidden text-xs text-muted-foreground sm:inline">→</span>
                              <span className="rounded-md bg-emerald-50 px-2 py-1 font-mono text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
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
            </ScrollArea>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
