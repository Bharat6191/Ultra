import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, getJson, postJson } from "@/lib/api"
import { cn } from "@/lib/utils"

export type LineCompletion = {
  progress_type: string
  unit: string
  approved_quantity: number | null
  approved_percentage: number | null
  completed_quantity: number | null
  completed_percentage: number | null
  remaining_quantity: number | null
  last_updated_at: string | null
  last_updated_by: number | null
  last_updated_by_name: string | null
}

export type LineWithCompletion = {
  id: number
  job_type: string
  skill_type: string
  unit: string
  progress_type: string
  planned_quantity: string | number | null
  planned_percentage: string | number | null
  completion: LineCompletion
}

type HistoryEntry = {
  id: number
  completed_quantity: number | null
  completed_percentage: number | null
  remarks: string | null
  updated_by: number | null
  updated_by_name: string | null
  updated_at: string | null
  previous_completed_quantity: number | null
  previous_completed_percentage: number | null
}

function parseNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return NaN
  return typeof v === "number" ? v : Number(String(v).replace(/,/g, ""))
}

function barTone(pct: number): string {
  if (pct <= 0) return "bg-zinc-200 dark:bg-zinc-700"
  if (pct >= 100) return "bg-emerald-500"
  return "bg-amber-500"
}

type LineEditorProps = {
  item: LineWithCompletion
  contractorLabel: string
  lineSr: number
  onSaved: () => void
}

export function WorkOrderLineCompletionEditor({ item, contractorLabel, lineSr, onSaved }: LineEditorProps) {
  const c = item.completion
  const fromPlan = parseNum(item.planned_quantity)
  const approved =
    typeof c.approved_quantity === "number" && Number.isFinite(c.approved_quantity)
      ? c.approved_quantity
      : Number.isFinite(fromPlan)
        ? fromPlan
        : NaN
  const denomOk = Number.isFinite(approved) && approved > 0

  const [qtyStr, setQtyStr] = React.useState("")
  const [pctStr, setPctStr] = React.useState("")
  const [remarks, setRemarks] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [history, setHistory] = React.useState<HistoryEntry[] | null>(null)
  const [historyLoading, setHistoryLoading] = React.useState(false)

  const displayPct =
    typeof c.completed_percentage === "number" && Number.isFinite(c.completed_percentage)
      ? Math.min(100, Math.max(0, c.completed_percentage))
      : 0
  const syncFromQty = React.useCallback(
    (raw: string) => {
      setQtyStr(raw)
      const q = Number(String(raw).replace(/,/g, ""))
      if (!raw.trim() || !denomOk) {
        if (!raw.trim()) setPctStr("")
        return
      }
      if (!Number.isFinite(q)) {
        setPctStr("")
        return
      }
      const pct = (q / (approved as number)) * 100
      setPctStr(Number.isFinite(pct) ? String(Math.round(pct * 100) / 100) : "")
    },
    [denomOk, approved],
  )

  const syncFromPct = React.useCallback(
    (raw: string) => {
      setPctStr(raw)
      const p = Number(String(raw).replace(/,/g, ""))
      if (!Number.isFinite(p) || !denomOk) return
      const q = ((approved as number) * p) / 100
      setQtyStr(String(Math.round(q * 1000) / 1000))
    },
    [denomOk, approved],
  )

  React.useEffect(() => {
    if (!denomOk && item.progress_type === "percentage" && !(c.approved_quantity && approved > 0)) {
      if (typeof c.completed_percentage === "number" && Number.isFinite(c.completed_percentage)) {
        setPctStr(String(c.completed_percentage))
      } else {
        setPctStr("")
      }
      setQtyStr("")
      return
    }

    const cq = typeof c.completed_quantity === "number" && Number.isFinite(c.completed_quantity) ? c.completed_quantity : null
    const cp =
      typeof c.completed_percentage === "number" && Number.isFinite(c.completed_percentage) ? c.completed_percentage : null
    if (cq !== null) setQtyStr(String(cq))
    else setQtyStr("")
    if (cp !== null) setPctStr(String(cp))
    else if (cq !== null && denomOk) setPctStr((((cq as number) / (approved as number)) * 100).toFixed(2))
    else setPctStr("")
  }, [
    approved,
    c.completed_quantity,
    c.completed_percentage,
    denomOk,
    item.progress_type,
    item.id,
  ])

  async function loadHistory() {
    setHistoryLoading(true)
    try {
      const rows = await getJson<HistoryEntry[]>(`/work-orders/items/${item.id}/completion-history`)
      setHistory(rows)
    } catch {
      toast.error("Could not load completion history.")
    } finally {
      setHistoryLoading(false)
    }
  }

  async function save() {
    const qtyTrim = qtyStr.trim()
    const pctTrim = pctStr.trim()
    if (!qtyTrim && !pctTrim) {
      toast.error("Enter completed quantity or completion %.")
      return
    }
    setSaving(true)
    try {
      await postJson(`/work-orders/items/${item.id}/progress`, {
        completed_quantity: qtyTrim !== "" ? qtyTrim : null,
        completed_percentage: pctTrim !== "" ? pctTrim : null,
        remarks: remarks.trim() || null,
      })
      toast.success("Completion updated.")
      setRemarks("")
      onSaved()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save completion.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="overflow-hidden border-border/80">
      <CardHeader className="border-b bg-muted/20 py-3">
        <CardTitle className="text-sm font-semibold">{item.job_type} · {String(item.skill_type).replace(/_/g, " ")}</CardTitle>
        <CardDescription className="text-xs">{contractorLabel} · SR {lineSr}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>Approved qty: <span className="font-medium tabular-nums text-foreground">{denomOk ? approved : "—"}</span> {item.unit}</span>
            {typeof c.remaining_quantity === "number" ? (
              <span>
                Remaining: <span className="font-medium tabular-nums text-foreground">{c.remaining_quantity}</span>
              </span>
            ) : null}
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full transition-all duration-300", barTone(displayPct))}
              style={{ width: `${Math.min(100, displayPct)}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>{displayPct <= 0 ? "Pending" : displayPct >= 100 ? "Completed" : "In progress"}</span>
            <span className="tabular-nums">{displayPct.toFixed(1)}%</span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {(item.progress_type === "quantity" || (item.progress_type === "percentage" && denomOk)) ? (
            <div className="grid gap-1.5">
              <Label htmlFor={`cq-${item.id}`} className="text-xs">
                Completed qty ({item.unit})
              </Label>
              <Input
                id={`cq-${item.id}`}
                inputMode="decimal"
                className="h-9 tabular-nums"
                value={qtyStr}
                onChange={(e) => syncFromQty(e.target.value)}
              />
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor={`cp-${item.id}`} className="text-xs">
              Completion %
            </Label>
            <Input
              id={`cp-${item.id}`}
              inputMode="decimal"
              className="h-9 tabular-nums"
              value={pctStr}
              onChange={(e) => syncFromPct(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={`rm-${item.id}`} className="text-xs">
            Remarks
          </Label>
          <Input
            id={`rm-${item.id}`}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className="h-9"
            placeholder="Notes for audit trail…"
          />
        </div>

        {(c.last_updated_at || c.last_updated_by_name) ? (
          <p className="text-[11px] text-muted-foreground">
            Last update:{" "}
            {c.last_updated_by_name ?? (c.last_updated_by != null ? `#${c.last_updated_by}` : "—")}
            {c.last_updated_at ? ` · ${new Date(c.last_updated_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}` : ""}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save completion"}
          </Button>
          <Dialog open={historyOpen} onOpenChange={(open) => { setHistoryOpen(open); if (open) void loadHistory() }}>
            <DialogTrigger asChild>
              <Button type="button" size="sm" variant="outline">
                History
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Completion history</DialogTitle>
                <DialogDescription>Line item #{item.id} — cumulative snapshots with prior values.</DialogDescription>
              </DialogHeader>
              {historyLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <ul className="space-y-3 text-sm">
                  {(history ?? []).length === 0 ? (
                    <li className="text-muted-foreground">No completion updates yet.</li>
                  ) : (
                    (history ?? []).map((h, idx) => (
                      <li key={`${h.id}-${idx}`} className="rounded-md border bg-muted/30 px-3 py-2">
                        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                          <span>{h.updated_by_name ?? `#${h.updated_by ?? ""}`}</span>
                          <span>{h.updated_at ? new Date(h.updated_at).toLocaleString() : "—"}</span>
                        </div>
                        <div className="mt-1 tabular-nums text-foreground">
                          Qty: {h.completed_quantity ?? "—"} · %:{" "}
                          {typeof h.completed_percentage === "number" ? h.completed_percentage.toFixed(2) : "—"}
                        </div>
                        {(h.previous_completed_quantity !== null ||
                          h.previous_completed_percentage !== null) ? (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            Prev:{" "}
                            {h.previous_completed_quantity ?? "—"} qty /{" "}
                            {h.previous_completed_percentage != null ? `${h.previous_completed_percentage}%` : "—"}

                          </div>
                        ) : null}
                        {h.remarks?.trim() ? (
                          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{h.remarks}</p>
                        ) : null}
                      </li>
                    ))
                  )}
                </ul>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  )
}

export function WorkOrderLineCompletionInline({ item, onSaved }: LineEditorProps) {
  const c = item.completion
  const fromPlan = parseNum(item.planned_quantity)
  const approved =
    typeof c.approved_quantity === "number" && Number.isFinite(c.approved_quantity)
      ? c.approved_quantity
      : Number.isFinite(fromPlan)
        ? fromPlan
        : NaN
  const denomOk = Number.isFinite(approved) && approved > 0

  const [qtyStr, setQtyStr] = React.useState("")
  const [pctStr, setPctStr] = React.useState("")
  const [remarks, setRemarks] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [history, setHistory] = React.useState<HistoryEntry[] | null>(null)
  const [historyLoading, setHistoryLoading] = React.useState(false)

  const displayPct =
    typeof c.completed_percentage === "number" && Number.isFinite(c.completed_percentage)
      ? Math.min(100, Math.max(0, c.completed_percentage))
      : null

  const syncFromQty = React.useCallback(
    (raw: string) => {
      setQtyStr(raw)
      const q = Number(String(raw).replace(/,/g, ""))
      if (!raw.trim() || !denomOk) {
        if (!raw.trim()) setPctStr("")
        return
      }
      if (!Number.isFinite(q)) {
        setPctStr("")
        return
      }
      const pct = (q / (approved as number)) * 100
      setPctStr(Number.isFinite(pct) ? String(Math.round(pct * 100) / 100) : "")
    },
    [denomOk, approved],
  )

  const syncFromPct = React.useCallback(
    (raw: string) => {
      setPctStr(raw)
      const p = Number(String(raw).replace(/,/g, ""))
      if (!Number.isFinite(p) || !denomOk) return
      const q = ((approved as number) * p) / 100
      setQtyStr(String(Math.round(q * 1000) / 1000))
    },
    [denomOk, approved],
  )

  React.useEffect(() => {
    if (!denomOk && item.progress_type === "percentage" && !(c.approved_quantity && approved > 0)) {
      if (typeof c.completed_percentage === "number" && Number.isFinite(c.completed_percentage)) {
        setPctStr(String(c.completed_percentage))
      } else {
        setPctStr("")
      }
      setQtyStr("")
      return
    }

    const cq = typeof c.completed_quantity === "number" && Number.isFinite(c.completed_quantity) ? c.completed_quantity : null
    const cp =
      typeof c.completed_percentage === "number" && Number.isFinite(c.completed_percentage) ? c.completed_percentage : null
    if (cq !== null) setQtyStr(String(cq))
    else setQtyStr("")
    if (cp !== null) setPctStr(String(cp))
    else if (cq !== null && denomOk) setPctStr((((cq as number) / (approved as number)) * 100).toFixed(2))
    else setPctStr("")
  }, [approved, c.completed_quantity, c.completed_percentage, denomOk, item.progress_type, item.id])

  async function loadHistory() {
    setHistoryLoading(true)
    try {
      const rows = await getJson<HistoryEntry[]>(`/work-orders/items/${item.id}/completion-history`)
      setHistory(rows)
    } catch {
      toast.error("Could not load completion history.")
    } finally {
      setHistoryLoading(false)
    }
  }

  async function save() {
    const qtyTrim = qtyStr.trim()
    const pctTrim = pctStr.trim()
    if (!qtyTrim && !pctTrim) {
      toast.error("Enter completed quantity or completion %.")
      return
    }
    setSaving(true)
    try {
      await postJson(`/work-orders/items/${item.id}/progress`, {
        completed_quantity: qtyTrim !== "" ? qtyTrim : null,
        completed_percentage: pctTrim !== "" ? pctTrim : null,
        remarks: remarks.trim() || null,
      })
      toast.success("Completion updated.")
      setRemarks("")
      onSaved()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save completion.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-md border border-border/60 bg-background px-2 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">
          Appr: <span className="font-medium tabular-nums text-foreground">{denomOk ? approved : "—"}</span> {item.unit}
          <span className="mx-2 text-muted-foreground/60">•</span>
          Rem:{" "}
          <span className="font-medium tabular-nums text-foreground">
            {typeof c.remaining_quantity === "number" ? c.remaining_quantity : "—"}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {displayPct != null ? `${displayPct.toFixed(1)}%` : "—"}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-12 items-center gap-2">
        <div className="col-span-4">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Completed qty</div>
          {(item.progress_type === "quantity" || (item.progress_type === "percentage" && denomOk)) ? (
            <Input
              inputMode="decimal"
              className="h-8 tabular-nums"
              value={qtyStr}
              onChange={(e) => syncFromQty(e.target.value)}
              placeholder="0"
            />
          ) : (
            <div className="h-8 rounded-md border bg-muted/20 px-2 text-xs leading-8 text-muted-foreground">—</div>
          )}
        </div>

        <div className="col-span-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">%</div>
          <Input inputMode="decimal" className="h-8 tabular-nums" value={pctStr} onChange={(e) => syncFromPct(e.target.value)} placeholder="0" />
        </div>

        <div className="col-span-5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Remarks</div>
          <Input className="h-8" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
        </div>

        <div className="col-span-12 flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" className="h-8 px-3" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Dialog
              open={historyOpen}
              onOpenChange={(open) => {
                setHistoryOpen(open)
                if (open) void loadHistory()
              }}
            >
              <DialogTrigger asChild>
                <Button type="button" size="sm" variant="outline" className="h-8 px-3">
                  History
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Completion history</DialogTitle>
                  <DialogDescription>Most recent updates for this line item.</DialogDescription>
                </DialogHeader>
                {historyLoading ? (
                  <div className="py-6 text-sm text-muted-foreground">Loading…</div>
                ) : (
                  <ul className="space-y-3">
                    {(history ?? []).length === 0 ? (
                      <li className="text-sm text-muted-foreground">No history yet.</li>
                    ) : (
                      (history ?? []).map((h) => (
                        <li key={h.id} className="rounded-lg border p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span className="font-medium tabular-nums">
                              {h.completed_quantity ?? "—"} qty · {h.completed_percentage != null ? `${h.completed_percentage}%` : "—"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {h.updated_by_name ?? (h.updated_by != null ? `#${h.updated_by}` : "—")}
                              {h.updated_at ? ` · ${new Date(h.updated_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}` : ""}
                            </span>
                          </div>
                          {(h.previous_completed_quantity !== null || h.previous_completed_percentage !== null) ? (
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              Prev: {h.previous_completed_quantity ?? "—"} qty /{" "}
                              {h.previous_completed_percentage != null ? `${h.previous_completed_percentage}%` : "—"}
                            </div>
                          ) : null}
                          {h.remarks?.trim() ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{h.remarks}</p> : null}
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </DialogContent>
            </Dialog>
          </div>

          <div className="text-[11px] text-muted-foreground">
            {c.last_updated_at || c.last_updated_by_name ? (
              <>
                Last: {c.last_updated_by_name ?? (c.last_updated_by != null ? `#${c.last_updated_by}` : "—")}
                {c.last_updated_at
                  ? ` · ${new Date(c.last_updated_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}`
                  : ""}
              </>
            ) : (
              <>Last: —</>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

type Props = {
  workOrderTitle: string
  workOrderNumber: string
  contractors: { contractor_id: number; items: LineWithCompletion[] }[]
  contractorName: (id: number) => string
  onRefresh: () => void
}

export function WorkOrderCompletionTracker({ workOrderTitle, workOrderNumber, contractors, contractorName, onRefresh }: Props) {
  let plannedSum = 0
  let doneSum = 0
  let modeLines = 0

  let sr = 0
  const keyed = contractors.flatMap((c) =>
    (c.items ?? []).map((item) => {
      sr += 1
      return { c, item, lineSr: sr }
    }),
  )

  for (const { item: it } of keyed) {
      const comp = it.completion
      const ap =
        typeof comp.approved_quantity === "number" && Number.isFinite(comp.approved_quantity)
          ? comp.approved_quantity
          : parseNum(it.planned_quantity)
      if (it.progress_type === "quantity" && Number.isFinite(ap) && ap > 0) {
        plannedSum += ap
        const cq = typeof comp.completed_quantity === "number" && Number.isFinite(comp.completed_quantity) ? comp.completed_quantity : 0
        doneSum += Math.min(cq, ap)
        modeLines += 1
      }
  }
  const overallPct = plannedSum > 0 ? Math.min(100, (doneSum / plannedSum) * 100) : null

  return (
    <section className="space-y-4">
      <div className="sticky top-16 z-[5] rounded-xl border border-border/80 bg-card/95 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{workOrderNumber}</div>
            <div className="text-sm font-semibold tracking-tight">Overall completion</div>
            <div className="text-xs text-muted-foreground">{workOrderTitle}</div>
          </div>
          {overallPct !== null ? (
            <div className="flex min-w-[10rem] flex-col gap-1 text-right">
              <span className="text-xl font-semibold tabular-nums">{overallPct.toFixed(1)}%</span>
              <span className="text-[11px] text-muted-foreground">
                Across quantity lines ({modeLines}); weighted by approved qty.
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">No quantity baselines — see each line.</span>
          )}
        </div>
        {overallPct !== null ? (
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full", barTone(overallPct))} style={{ width: `${Math.min(100, overallPct)}%` }} />
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {keyed.map(({ c, item, lineSr }) => (
          <WorkOrderLineCompletionEditor
            key={item.id}
            item={item}
            lineSr={lineSr}
            contractorLabel={contractorName(c.contractor_id)}
            onSaved={onRefresh}
          />
        ))}
      </div>
    </section>
  )
}
