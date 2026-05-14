import * as React from "react"
import { History, Loader2 } from "lucide-react"
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
  unit_type: string
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
  part_code: string | null
  part_name: string | null
  unit_type: string
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

function parseEntry(s: string): number {
  const t = s.trim().replace(/,/g, "")
  if (t === "") return NaN
  return Number(t)
}

const completionHistoryDialogClass = cn(
  "flex h-full max-h-[100dvh] w-full max-w-md flex-col gap-0 overflow-hidden rounded-none border border-border/80 p-0 shadow-xl outline-none sm:rounded-l-xl",
  "fixed inset-y-0 top-0 right-0 left-auto z-50 translate-x-0 translate-y-0",
)

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

  React.useEffect(() => {
    const cp =
      typeof c.completed_percentage === "number" && Number.isFinite(c.completed_percentage) ? c.completed_percentage : null
    if (cp !== null) setPctStr(String(cp))
    else setPctStr("")
  }, [c.completed_percentage, item.id])

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
    const pctTrim = pctStr.trim()
    if (!pctTrim) {
      toast.error("Enter completion %.")
      return
    }
    setSaving(true)
    try {
      await postJson(`/work-orders/items/${item.id}/progress`, {
        completed_quantity: null,
        completed_percentage: pctTrim,
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
        <CardTitle className="text-sm font-semibold">
          <span className="font-mono text-xs">{item.part_code ?? "—"}</span> · {item.part_name ?? "—"}
        </CardTitle>
        <CardDescription className="text-xs">{contractorLabel} · SR {lineSr}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>Approved qty: <span className="font-medium tabular-nums text-foreground">{denomOk ? approved : "—"}</span> {item.unit_type}</span>
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

        <div className="grid gap-1.5">
          <Label htmlFor={`cp-${item.id}`} className="text-xs">
            Completion %
          </Label>
          <Input
            id={`cp-${item.id}`}
            inputMode="decimal"
            className="h-9 tabular-nums"
            value={pctStr}
            onChange={(e) => setPctStr(e.target.value)}
          />
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
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                title="Completion history"
                aria-label="Open completion history"
              >
                <History className="size-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className={completionHistoryDialogClass} showCloseButton={true}>
              <div className="border-b border-border/60 px-4 py-3 pr-12">
                <DialogHeader className="space-y-1 text-left">
                  <DialogTitle className="text-base">Completion history</DialogTitle>
                  <DialogDescription>
                    SR {lineSr} · {item.part_code ?? `Item #${item.id}`} · {contractorLabel}
                  </DialogDescription>
                </DialogHeader>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {historyLoading ? (
                  <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading…
                  </div>
                ) : (
                  <ul className="space-y-3 text-sm">
                    {(history ?? []).length === 0 ? (
                      <li className="text-muted-foreground">No completion updates yet.</li>
                    ) : (
                      (history ?? []).map((h, idx) => (
                        <li key={`${h.id}-${idx}`} className="rounded-lg border border-border/60 bg-card px-3 py-2.5 shadow-sm">
                          <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {h.updated_by_name ?? `#${h.updated_by ?? ""}`}
                            </span>
                            <span className="tabular-nums">
                              {h.updated_at ? new Date(h.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—"}
                            </span>
                          </div>
                          <div className="mt-1.5 tabular-nums text-foreground">
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
                            <p className="mt-2 whitespace-pre-wrap border-t border-border/50 pt-2 text-xs text-muted-foreground">
                              {h.remarks}
                            </p>
                          ) : null}
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  )
}

export function WorkOrderLineCompletionInline({ item, contractorLabel, lineSr, onSaved }: LineEditorProps) {
  const c = item.completion
  const fromPlan = parseNum(item.planned_quantity)
  const approved =
    typeof c.approved_quantity === "number" && Number.isFinite(c.approved_quantity)
      ? c.approved_quantity
      : Number.isFinite(fromPlan)
        ? fromPlan
        : NaN
  const denomOk = Number.isFinite(approved) && approved > 0
  const qtyBlocked = !denomOk && item.progress_type === "quantity"

  const [pctStr, setPctStr] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [history, setHistory] = React.useState<HistoryEntry[] | null>(null)
  const [historyLoading, setHistoryLoading] = React.useState(false)

  const serverPct =
    typeof c.completed_percentage === "number" && Number.isFinite(c.completed_percentage) ? c.completed_percentage : null

  const parsedPct = parseEntry(pctStr)

  React.useEffect(() => {
    if (qtyBlocked) return
    if (serverPct != null && Number.isFinite(serverPct)) setPctStr(String(serverPct))
    else setPctStr("")
  }, [serverPct, item.id, qtyBlocked])

  const baselinePct = serverPct != null && Number.isFinite(serverPct) ? String(serverPct) : ""
  const dirty = pctStr.trim() !== baselinePct.trim()

  const canSave =
    !qtyBlocked &&
    pctStr.trim() !== "" &&
    Number.isFinite(parsedPct) &&
    parsedPct >= 0 &&
    parsedPct <= 100 + 1e-9

  const saveDisabled = saving || !canSave

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
    if (qtyBlocked || saveDisabled) return
    setSaving(true)
    try {
      await postJson(`/work-orders/items/${item.id}/progress`, {
        completed_quantity: null,
        completed_percentage: pctStr.trim(),
        remarks: null,
      })
      toast.success("Completion saved.")
      onSaved()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save completion.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      data-completion-dirty={dirty ? "true" : undefined}
      role="group"
      aria-label={`Completion line ${lineSr}`}
      className="flex w-full min-w-0 items-center justify-end gap-0"
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.nativeEvent.isComposing || qtyBlocked) return
        e.preventDefault()
        if (!saveDisabled) void save()
      }}
    >
      {qtyBlocked ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : (
        <div className="inline-flex h-11 max-w-full overflow-hidden rounded-lg border-2 border-border/80 bg-background shadow-md">
          <div className="relative flex min-w-0 items-stretch border-r border-border/60">
            <Input
              inputMode="decimal"
              className="h-11 w-[4.5rem] min-w-[3.5rem] rounded-none border-0 bg-transparent py-0 pr-7 pl-1 text-center text-base font-semibold tabular-nums leading-none shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              value={pctStr}
              onChange={(e) => setPctStr(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp") {
                  e.preventDefault()
                  const base = Number.isFinite(parsedPct) ? parsedPct : serverPct ?? 0
                  setPctStr(String(Math.min(100, Math.round((base + (e.shiftKey ? 1 : 0.5)) * 10) / 10)))
                } else if (e.key === "ArrowDown") {
                  e.preventDefault()
                  const base = Number.isFinite(parsedPct) ? parsedPct : serverPct ?? 0
                  setPctStr(String(Math.max(0, Math.round((base - (e.shiftKey ? 1 : 0.5)) * 10) / 10)))
                }
              }}
              placeholder="0"
              aria-label="Completion percent"
            />
            <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
              %
            </span>
          </div>
          <Button
            type="button"
            variant="default"
            className="h-11 shrink-0 rounded-none border-0 px-4 text-sm font-semibold shadow-none"
            onClick={() => void save()}
            disabled={saveDisabled}
          >
            {saving ? <Loader2 className="size-5 animate-spin" aria-label="Saving" /> : "Save"}
          </Button>
          <Dialog
            open={historyOpen}
            onOpenChange={(open) => {
              setHistoryOpen(open)
              if (open) void loadHistory()
            }}
          >
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                className="size-11 shrink-0 rounded-none border-0 border-l border-border/60 bg-muted/40 p-0 hover:bg-muted/70"
                title="Completion history"
                aria-label="Open completion history"
              >
                <History className="size-5 text-muted-foreground" />
              </Button>
            </DialogTrigger>
            <DialogContent className={completionHistoryDialogClass} showCloseButton={true}>
              <div className="border-b border-border/60 px-4 py-3 pr-12">
                <DialogHeader className="space-y-1 text-left">
                  <DialogTitle className="text-base">Completion history</DialogTitle>
                  <DialogDescription>
                    SR {lineSr} · {item.part_code ?? `Item #${item.id}`}
                    {contractorLabel ? ` · ${contractorLabel}` : ""}
                  </DialogDescription>
                </DialogHeader>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {historyLoading ? (
                  <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading…
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {(history ?? []).length === 0 ? (
                      <li className="text-sm text-muted-foreground">No history yet.</li>
                    ) : (
                      (history ?? []).map((h) => (
                        <li key={h.id} className="rounded-lg border border-border/60 bg-card px-3 py-2.5 text-sm shadow-sm">
                          <div className="flex flex-wrap items-start justify-between gap-2 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {h.updated_by_name ?? (h.updated_by != null ? `#${h.updated_by}` : "—")}
                            </span>
                            <span className="tabular-nums">
                              {h.updated_at
                                ? new Date(h.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
                                : "—"}
                            </span>
                          </div>
                          <div className="mt-1.5 tabular-nums text-foreground">
                            Qty: {h.completed_quantity ?? "—"} · %:{" "}
                            {typeof h.completed_percentage === "number" ? h.completed_percentage.toFixed(2) : "—"}
                          </div>
                          {(h.previous_completed_quantity !== null || h.previous_completed_percentage !== null) ? (
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              Prev: {h.previous_completed_quantity ?? "—"} qty /{" "}
                              {h.previous_completed_percentage != null ? `${h.previous_completed_percentage}%` : "—"}
                            </div>
                          ) : null}
                          {h.remarks?.trim() ? (
                            <p className="mt-2 whitespace-pre-wrap border-t border-border/50 pt-2 text-xs text-muted-foreground">
                              {h.remarks}
                            </p>
                          ) : null}
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}
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
