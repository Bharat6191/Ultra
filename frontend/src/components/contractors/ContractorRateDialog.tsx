import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { formatMoney } from "@/components/contractors/rateStatus"

export type PartMasterPick = {
  id: number
  part_code: string
  part_name: string
  unit_type: string
  pricing_method: string
  rate_unit_type: string
  base_rate: number | string
  org_unit_id: number
  org_unit_name: string | null
}

export type NewRateForm = {
  part_master_id: number | null
  /** Contractor's opening ask. Drives the savings calculation (initial − final).
   *  Optional in the form: when blank we send only ``negotiated_rate`` and the
   *  backend treats that as the opening ask. */
  initial_rate: string
  negotiated_rate: string
  effective_from: string
  effective_to: string
  remarks: string
}

const todayIso = (): string => new Date().toISOString().slice(0, 10)

export const EMPTY_RATE_FORM: NewRateForm = {
  part_master_id: null,
  initial_rate: "",
  negotiated_rate: "",
  effective_from: todayIso(),
  effective_to: "",
  remarks: "",
}

export function NewNegotiationDialog({
  open,
  onOpenChange,
  partMasters,
  saving,
  error,
  onSave,
  fixedContractorId,
  contractorChoices,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  partMasters: PartMasterPick[]
  saving: boolean
  error: string | null
  onSave: (form: NewRateForm, ctx: { contractorId: number }) => Promise<void>
  fixedContractorId?: number
  contractorChoices?: { id: number; name: string }[]
}) {
  const [form, setForm] = React.useState<NewRateForm>(() => ({ ...EMPTY_RATE_FORM }))
  const [search, setSearch] = React.useState("")
  const [pickedContractorId, setPickedContractorId] = React.useState<number | "">("")

  React.useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_RATE_FORM })
      setSearch("")
      setPickedContractorId("")
    }
  }, [open])

  const effectiveContractorId: number | null =
    fixedContractorId ??
    (typeof pickedContractorId === "number" ? pickedContractorId : null)

  const needContractorPick = Boolean(contractorChoices?.length && fixedContractorId == null)

  const selected = React.useMemo(
    () => partMasters.find((pm) => pm.id === form.part_master_id) ?? null,
    [partMasters, form.part_master_id],
  )

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return partMasters.slice(0, 8)
    return partMasters
      .filter((pm) =>
        [
          pm.part_code,
          pm.part_name,
          pm.unit_type,
          pm.pricing_method,
          pm.rate_unit_type,
          pm.org_unit_name ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 8)
  }, [partMasters, search])

  const baseRate = selected ? Number(selected.base_rate) : NaN
  const negRate = Number(form.negotiated_rate)
  const initialRateRaw = Number(form.initial_rate)
  // Effective opening ask = explicit input if present, else the proposed rate.
  const effectiveInitial = Number.isFinite(initialRateRaw) && initialRateRaw > 0
    ? initialRateRaw
    : negRate

  // Negotiation savings preview: opening ask -> final, clamped at 0.
  const previewNegotiationSavings =
    Number.isFinite(effectiveInitial) && Number.isFinite(negRate) && effectiveInitial > 0
      ? {
          amount: Math.max(0, effectiveInitial - negRate),
          pct:
            effectiveInitial > 0
              ? (Math.max(0, effectiveInitial - negRate) / effectiveInitial) * 100
              : 0,
        }
      : null

  // Vs-base preview: signed. Positive => paying ABOVE the procurement baseline.
  const previewVsBase =
    Number.isFinite(baseRate) && Number.isFinite(negRate) && baseRate > 0
      ? {
          amount: negRate - baseRate,
          pct: ((negRate - baseRate) / baseRate) * 100,
        }
      : null

  const canSave =
    effectiveContractorId !== null &&
    form.part_master_id !== null &&
    !!form.negotiated_rate.trim() &&
    Number.isFinite(negRate) &&
    !!form.effective_from

  const SELECT_ROW_CLASS =
    "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Start a new negotiation</DialogTitle>
          <DialogDescription>
            Pick the contractor (if needed), then choose the Part Master baseline (part code, pricing method,
            plant), enter the proposed negotiated rate, and add any remarks. The contractor&apos;s previous
            approved rate is fetched automatically when calculating savings.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {needContractorPick ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Contractor</label>
              <select
                className={SELECT_ROW_CLASS}
                value={pickedContractorId === "" ? "" : String(pickedContractorId)}
                onChange={(e) => {
                  const v = e.target.value
                  setPickedContractorId(v === "" ? "" : Number(v))
                }}
              >
                <option value="">Select contractor…</option>
                {contractorChoices!.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Or open a contractor&apos;s profile — their <strong>Rates</strong> tab has the same flow.
              </p>
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Part baseline</label>
            {selected ? (
              <div className="flex items-start justify-between gap-3 rounded-lg border bg-gray-50 p-3 text-sm">
                <div className="space-y-0.5">
                  <div className="font-medium text-gray-900">
                    <span className="font-mono">{selected.part_code}</span>{" "}
                    <span className="text-muted-foreground">·</span> {selected.part_name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {selected.org_unit_name ?? "—"} · {selected.pricing_method.replace(/_/g, " ")} ·{" "}
                    {selected.rate_unit_type.replace(/_/g, " ")} · unit {selected.unit_type}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-base font-semibold text-foreground">
                    {formatMoney(selected.base_rate)}
                  </div>
                  <button
                    type="button"
                    className="text-xs text-primary underline-offset-2 hover:underline"
                    onClick={() => setForm((s) => ({ ...s, part_master_id: null }))}
                  >
                    Change
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Input
                  placeholder="Search by part code, name, plant…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="max-h-56 divide-y overflow-y-auto rounded-lg border bg-white">
                  {filtered.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      No matching base rates.
                    </div>
                  ) : (
                    filtered.map((pm) => (
                      <button
                        key={pm.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50"
                        onClick={() => setForm((s) => ({ ...s, part_master_id: pm.id }))}
                      >
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            <span className="font-mono">{pm.part_code}</span>{" "}
                            <span className="text-muted-foreground">·</span> {pm.part_name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {pm.org_unit_name ?? "—"} · {pm.pricing_method.replace(/_/g, " ")} ·{" "}
                            {pm.unit_type}
                          </div>
                        </div>
                        <div className="text-sm font-semibold">{formatMoney(pm.base_rate)}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Initial ask <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="Contractor's opening price"
                value={form.initial_rate}
                onChange={(e) =>
                  setForm((s) => ({ ...s, initial_rate: e.target.value }))
                }
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                The opening price the contractor proposed. Leave blank if you're
                already entering the agreed rate; you can capture it on round 1
                later.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Agreed rate
              </label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="0.00"
                value={form.negotiated_rate}
                onChange={(e) =>
                  setForm((s) => ({ ...s, negotiated_rate: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Effective from
              </label>
              <Input
                type="date"
                value={form.effective_from}
                onChange={(e) =>
                  setForm((s) => ({ ...s, effective_from: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Effective to
              </label>
              <Input
                type="date"
                value={form.effective_to}
                onChange={(e) =>
                  setForm((s) => ({ ...s, effective_to: e.target.value }))
                }
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Leave empty for an open-ended rate.
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-foreground">Remarks</label>
              <Textarea
                value={form.remarks}
                onChange={(e) => setForm((s) => ({ ...s, remarks: e.target.value }))}
                rows={2}
                placeholder="Negotiation notes (visible in the timeline)…"
              />
            </div>
          </div>

          {previewNegotiationSavings || previewVsBase ? (
            <div className="space-y-2">
              {previewNegotiationSavings && previewNegotiationSavings.amount > 0 ? (
                <div className="rounded-lg border bg-emerald-50/60 p-3 text-sm text-emerald-900">
                  <div className="flex items-center justify-between">
                    <span>Negotiated down by</span>
                    <Badge variant="success">
                      {formatMoney(previewNegotiationSavings.amount)} (
                      {previewNegotiationSavings.pct.toFixed(2)}%)
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-emerald-900/80">
                    From contractor's opening ask of {formatMoney(effectiveInitial)} down to{" "}
                    {formatMoney(negRate)}.
                  </p>
                </div>
              ) : null}
              {previewVsBase ? (
                <div
                  className={
                    "rounded-lg border p-3 text-sm " +
                    (previewVsBase.amount > 0
                      ? "bg-amber-50/70 text-amber-900"
                      : previewVsBase.amount < 0
                      ? "bg-emerald-50/70 text-emerald-900"
                      : "bg-gray-50 text-gray-700")
                  }
                >
                  <div className="flex items-center justify-between">
                    <span>
                      vs base rate ({formatMoney(baseRate)})
                    </span>
                    <Badge
                      variant={
                        previewVsBase.amount > 0
                          ? "warning"
                          : previewVsBase.amount < 0
                          ? "success"
                          : "secondary"
                      }
                    >
                      {previewVsBase.amount > 0
                        ? `+${formatMoney(previewVsBase.amount)} above base`
                        : previewVsBase.amount < 0
                        ? `${formatMoney(Math.abs(previewVsBase.amount))} below base`
                        : "at base"}{" "}
                      ({previewVsBase.pct >= 0 ? "+" : ""}
                      {previewVsBase.pct.toFixed(2)}%)
                    </Badge>
                  </div>
                  {previewVsBase.amount > 0 ? (
                    <p className="mt-1 text-xs">
                      The agreed rate is above the procurement baseline. This will show as a
                      <span className="font-medium"> premium</span> on the dashboard, separate from
                      negotiation savings.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? <div className="text-sm text-destructive">{error}</div> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            disabled={!canSave || saving}
            onClick={() =>
              effectiveContractorId != null
                ? void onSave(form, { contractorId: effectiveContractorId })
                : undefined
            }
          >
            {saving ? "Saving…" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


// ---------- Round (counter / proposal) dialog ----------

export type RoundForm = {
  proposed_rate: string
  counter_rate: string
  remarks: string
  apply_to_negotiated_rate: boolean
}

const EMPTY_ROUND_FORM: RoundForm = {
  proposed_rate: "",
  counter_rate: "",
  remarks: "",
  apply_to_negotiated_rate: true,
}

export function NegotiationRoundDialog({
  open,
  onOpenChange,
  saving,
  error,
  currentRate,
  baseRate,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  saving: boolean
  error: string | null
  currentRate: number | string | null
  baseRate: number | string | null
  onSave: (form: RoundForm) => Promise<void>
}) {
  const [form, setForm] = React.useState<RoundForm>(() => ({ ...EMPTY_ROUND_FORM }))
  React.useEffect(() => {
    if (open) setForm({ ...EMPTY_ROUND_FORM })
  }, [open])

  const canSave =
    Boolean(form.proposed_rate.trim() || form.counter_rate.trim()) &&
    !saving

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add negotiation round</DialogTitle>
          <DialogDescription>
            Record a proposal, counter-offer, or remark. Apply the latest rate to update the
            contractor's negotiated rate before submission.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="rounded-lg border bg-gray-50 p-3 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Base rate</span>
              <span className="font-medium text-foreground">{formatMoney(baseRate)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Current negotiated</span>
              <span className="font-medium text-foreground">{formatMoney(currentRate)}</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Proposed rate</label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="0.00"
                value={form.proposed_rate}
                onChange={(e) =>
                  setForm((s) => ({ ...s, proposed_rate: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Counter rate</label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="0.00"
                value={form.counter_rate}
                onChange={(e) => setForm((s) => ({ ...s, counter_rate: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Remarks</label>
            <Textarea
              rows={2}
              placeholder="Optional notes…"
              value={form.remarks}
              onChange={(e) => setForm((s) => ({ ...s, remarks: e.target.value }))}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.apply_to_negotiated_rate}
              onChange={(e) =>
                setForm((s) => ({ ...s, apply_to_negotiated_rate: e.target.checked }))
              }
            />
            <span>Apply this round's rate as the new negotiated rate</span>
          </label>

          {error ? <div className="text-sm text-destructive">{error}</div> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={() => void onSave(form)}>
            {saving ? "Saving…" : "Add round"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
