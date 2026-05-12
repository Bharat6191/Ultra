import * as React from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SectionHint } from "@/components/ui/section-hint"
import { ApiError, getJson, postForm, postJson } from "@/lib/api"
import { formatMoney } from "@/components/contractors/rateStatus"
import { hasPermission, isSuperuser } from "@/lib/permissions"
import {
  EMPTY_RATE_FORM,
  type NewRateForm,
  type PartMasterPick,
} from "@/components/contractors/ContractorRateDialog"

const SELECT_ROW_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"

export function NegotiatedRateNewPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const preContractorId = Number(searchParams.get("contractorId") ?? "")

  const canCreate = hasPermission("contractor_rates.create") || isSuperuser()

  const [form, setForm] = React.useState<NewRateForm>(() => ({ ...EMPTY_RATE_FORM }))
  const [search, setSearch] = React.useState("")
  const [pickedContractorId, setPickedContractorId] = React.useState<number | "">(
    Number.isFinite(preContractorId) && preContractorId > 0 ? preContractorId : "",
  )

  const [contractorChoices, setContractorChoices] = React.useState<{ id: number; name: string }[]>([])
  const [partMasters, setPartMasters] = React.useState<PartMasterPick[]>([])
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [attachments, setAttachments] = React.useState<File[]>([])

  React.useEffect(() => {
    if (!canCreate) return
    let cancelled = false
    ;(async () => {
      setLoadError(null)
      try {
        const [clist, raws] = await Promise.all([
          getJson<{ id: number; name: string }[]>("/contractors/lookup?limit=200&status=active"),
          getJson<
            {
              id: number
              part_code: string
              part_name: string
              unit_type: string
              pricing_method: string
              rate_unit_type: string
              base_rate: number | string
              org_unit_id: number
              org_unit_name: string | null
            }[]
          >("/part-master?active=true").catch(() => []),
        ])
        if (cancelled) return
        setContractorChoices(Array.isArray(clist) ? clist : [])
        setPartMasters(
          (Array.isArray(raws) ? raws : []).map((pm) => ({
            id: pm.id,
            part_code: pm.part_code,
            part_name: pm.part_name,
            unit_type: pm.unit_type,
            pricing_method: pm.pricing_method,
            rate_unit_type: pm.rate_unit_type,
            base_rate: pm.base_rate,
            org_unit_id: pm.org_unit_id,
            org_unit_name: pm.org_unit_name,
          })),
        )
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Failed to load form data")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canCreate])

  const fixedContractorId = Number.isFinite(preContractorId) && preContractorId > 0 ? preContractorId : undefined
  const effectiveContractorId: number | null =
    fixedContractorId ?? (typeof pickedContractorId === "number" ? pickedContractorId : null)
  const needContractorPick = fixedContractorId == null && contractorChoices.length > 0

  const selected = React.useMemo(
    () => partMasters.find((pm) => pm.id === form.part_master_id) ?? null,
    [partMasters, form.part_master_id],
  )

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return partMasters.slice(0, 12)
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
      .slice(0, 12)
  }, [partMasters, search])

  const baseRate = selected ? Number(selected.base_rate) : NaN
  const negRate = Number(form.negotiated_rate)
  const initialRateRaw = Number(form.initial_rate)
  const effectiveInitial =
    Number.isFinite(initialRateRaw) && initialRateRaw > 0 ? initialRateRaw : negRate

  const previewNegotiationSavings =
    Number.isFinite(effectiveInitial) && Number.isFinite(negRate) && effectiveInitial > 0
      ? {
          amount: Math.max(0, effectiveInitial - negRate),
          pct: effectiveInitial > 0 ? (Math.max(0, effectiveInitial - negRate) / effectiveInitial) * 100 : 0,
        }
      : null

  const previewVsBase =
    Number.isFinite(baseRate) && Number.isFinite(negRate) && baseRate > 0
      ? { amount: negRate - baseRate, pct: ((negRate - baseRate) / baseRate) * 100 }
      : null

  const canSave =
    effectiveContractorId !== null &&
    form.part_master_id !== null &&
    !!form.negotiated_rate.trim() &&
    Number.isFinite(negRate) &&
    negRate > 0 &&
    !!form.effective_from

  async function submit() {
    if (!effectiveContractorId || form.part_master_id === null) return
    setSaving(true)
    setSaveError(null)
    try {
      const created = await postJson<{ id: number }>("/contractor-rates", {
        contractor_id: effectiveContractorId,
        part_master_id: form.part_master_id,
        negotiated_rate: form.negotiated_rate,
        initial_rate: form.initial_rate.trim() ? form.initial_rate : null,
        effective_from: form.effective_from,
        effective_to: null,
        remarks: form.remarks.trim() ? form.remarks : null,
      })
      if (attachments.length > 0) {
        const fd = new FormData()
        for (const f of attachments) {
          fd.append("file", f)
        }
        await postForm<{ negotiation_log_id: number; attachments: unknown[] }>(
          `/contractor-rates/${created.id}/opening-evidence`,
          fd,
        )
      }
      toast.success(
        attachments.length
          ? `Draft created with ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}`
          : "Draft negotiation created",
      )
      navigate(`/dashboard/negotiated-rates/${created.id}`)
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to create draft"
      setSaveError(msg)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  if (!canCreate) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>New negotiation</CardTitle>
          <CardDescription>
            You need <span className="font-mono">contractor_rates.create</span>.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <header className="space-y-1 border-b border-border/70 pb-6">
        <div className="text-xs text-muted-foreground">
          <Link to="/dashboard/negotiated-rates" className="underline-offset-2 hover:underline">
            Negotiated rates
          </Link>
          <span className="mx-1">/</span>
          <span>New</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Start a negotiation</h1>
          <SectionHint text="Pick a Part Master baseline, then set the agreed rate for this draft. Optional initial ask anchors savings. Optional files are stored on an opening evidence round (round 1) on the timeline. Submit for approval when ready; the approved row becomes the binding rate for this contractor and part." />
        </div>
      </header>

      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : null}
      {!loadError && fixedContractorId == null && contractorChoices.length === 0 ? (
        <Alert>
          <AlertTitle>No active contractors</AlertTitle>
          <AlertDescription>
            Add or activate a contractor before starting a negotiation from this screen.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid w-full min-w-0 gap-6 xl:grid-cols-12 xl:items-start">
        <Card className="min-w-0 rounded-2xl border-border/50 shadow-sm xl:col-span-5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Contractor & part</CardTitle>
            <CardDescription>Commercial baseline comes from Part Master for the plant you select.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {needContractorPick ? (
              <div className="grid gap-1">
                <Label>Contractor</Label>
                <select
                  className={SELECT_ROW_CLASS}
                  value={pickedContractorId === "" ? "" : String(pickedContractorId)}
                  onChange={(e) => {
                    const v = e.target.value
                    setPickedContractorId(v === "" ? "" : Number(v))
                  }}
                >
                  <option value="">Select contractor…</option>
                  {contractorChoices.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : fixedContractorId ? (
              <p className="text-sm text-muted-foreground">
                Creating for contractor #{fixedContractorId}.{" "}
                <Link
                  to="/dashboard/negotiated-rates/new"
                  className="font-medium underline underline-offset-2"
                >
                  Change
                </Link>
              </p>
            ) : null}

            <div className="grid gap-1">
              <Label>Search parts</Label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Code, name, plant…" />
            </div>

            <div className="grid gap-1">
              <Label>Part baseline</Label>
              {selected ? (
                <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                  <div className="font-medium">
                    <span className="font-mono">{selected.part_code}</span>{" "}
                    <span className="text-muted-foreground">·</span> {selected.part_name}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {selected.org_unit_name ?? "—"} · {selected.pricing_method.replace(/_/g, " ")} ·{" "}
                    {selected.rate_unit_type.replace(/_/g, " ")} · unit {selected.unit_type}
                  </div>
                  <div className="mt-2 text-xs">
                    Base rate: <span className="font-medium text-foreground">{formatMoney(selected.base_rate)}</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2 h-8 px-2 text-xs"
                    onClick={() => setForm((f) => ({ ...f, part_master_id: null }))}
                  >
                    Choose different part
                  </Button>
                </div>
              ) : (
                <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-1">
                  {filtered.length === 0 ? (
                    <li className="px-2 py-6 text-center text-xs text-muted-foreground">No matches.</li>
                  ) : (
                    filtered.map((pm) => (
                      <li key={pm.id}>
                        <button
                          type="button"
                          className="w-full rounded-md px-2 py-2 text-left text-sm transition hover:bg-muted"
                          onClick={() => setForm((f) => ({ ...f, part_master_id: pm.id }))}
                        >
                          <span className="font-mono text-xs">{pm.part_code}</span>{" "}
                          <span className="text-muted-foreground">·</span> {pm.part_name}
                          <div className="text-[11px] text-muted-foreground">
                            {pm.org_unit_name ?? "—"} · {formatMoney(pm.base_rate)}
                          </div>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 rounded-2xl border-border/50 shadow-sm xl:col-span-5">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Rates & notes</CardTitle>
            <SectionHint text="Effective dates default to today with an open end; adjust later on the rate detail page if needed." />
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1">
              <Label>Initial ask (optional)</Label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="Leave blank to use agreed rate as opening ask"
                value={form.initial_rate}
                onChange={(e) => setForm((f) => ({ ...f, initial_rate: e.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <Label>Agreed rate</Label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="0.00"
                value={form.negotiated_rate}
                onChange={(e) => setForm((f) => ({ ...f, negotiated_rate: e.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <Label>Remarks</Label>
              <Textarea
                rows={4}
                placeholder="Context for approvers…"
                value={form.remarks}
                onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
              />
            </div>

            <div className="grid gap-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="grid gap-1">
                  <Label>Attachments (optional)</Label>
                  <p className="text-xs text-muted-foreground">
                    Multiple files allowed. They are saved with round 1 as opening evidence after the draft
                    is created.
                  </p>
                </div>
                {attachments.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-muted-foreground"
                    onClick={() => setAttachments([])}
                  >
                    Clear all
                  </Button>
                ) : null}
              </div>
              <Input
                type="file"
                multiple
                onChange={(e) => {
                  const next = Array.from(e.target.files ?? [])
                  if (next.length) {
                    setAttachments((prev) => {
                      const merged = [...prev, ...next]
                      const seen = new Set<string>()
                      return merged.filter((f) => {
                        const k = `${f.name}:${f.size}`
                        if (seen.has(k)) return false
                        seen.add(k)
                        return true
                      })
                    })
                  }
                  e.target.value = ""
                }}
                className="cursor-pointer text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1 file:text-xs"
              />
              {attachments.length > 0 ? (
                <ul className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border bg-muted/30 p-2 text-sm">
                  {attachments.map((f, i) => (
                    <li
                      key={`${f.name}-${f.size}-${i}`}
                      className="flex items-center justify-between gap-2 rounded-md bg-background px-2 py-1.5"
                    >
                      <span className="min-w-0 truncate" title={f.name}>
                        {f.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {(f.size / 1024).toFixed(f.size < 10240 ? 1 : 0)} KB
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 px-2 text-xs"
                        onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {previewNegotiationSavings && previewNegotiationSavings.amount > 0 ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-900">
                Negotiation savings vs opening ask:{" "}
                <strong>{formatMoney(previewNegotiationSavings.amount)}</strong> (
                {previewNegotiationSavings.pct.toFixed(1)}%)
              </div>
            ) : null}
            {previewVsBase && previewVsBase.amount !== 0 ? (
              <div
                className={`rounded-lg border p-3 text-xs ${
                  previewVsBase.amount > 0
                    ? "border-amber-200 bg-amber-50/70 text-amber-900"
                    : "border-emerald-200 bg-emerald-50/50 text-emerald-900"
                }`}
              >
                {previewVsBase.amount > 0 ? (
                  <>
                    <strong>{formatMoney(previewVsBase.amount)}</strong> above Part Master base (
                    {previewVsBase.pct.toFixed(1)}%).
                  </>
                ) : (
                  <>
                    <strong>{formatMoney(Math.abs(previewVsBase.amount))}</strong> below base (
                    {Math.abs(previewVsBase.pct).toFixed(1)}%).
                  </>
                )}
              </div>
            ) : null}

            {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}

            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={!canSave || saving} onClick={() => void submit()}>
                {saving ? "Creating…" : "Create draft"}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link to="/dashboard/negotiated-rates">Cancel</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default NegotiatedRateNewPage
