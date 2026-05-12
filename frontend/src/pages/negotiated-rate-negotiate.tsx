import * as React from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SectionHint } from "@/components/ui/section-hint"
import { formatMoney } from "@/components/contractors/rateStatus"
import { ApiError, getJson, postForm, postJson } from "@/lib/api"
import { hasPermission, isSuperuser } from "@/lib/permissions"
import type { ContractorRatePublic } from "@/components/contractors/ContractorRatesPanel"

type NegotiationRoundResponse = {
  id: number
  contractor_rate_id: number
  round_number: number
}

export function NegotiatedRateNegotiatePage() {
  const params = useParams()
  const navigate = useNavigate()
  const rateId = Number(params.rateId)

  const canUpdate = hasPermission("contractor_rates.update") || isSuperuser()

  const [rate, setRate] = React.useState<ContractorRatePublic | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const [agreedRate, setAgreedRate] = React.useState("")
  const [remarks, setRemarks] = React.useState("")
  const [attachments, setAttachments] = React.useState<File[]>([])
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    if (!Number.isFinite(rateId)) return
    setLoadError(null)
    try {
      const r = await getJson<ContractorRatePublic>(`/contractor-rates/${rateId}`)
      setRate(r)
      setAgreedRate(String(r.negotiated_rate ?? ""))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load rate")
      setRate(null)
    }
  }, [rateId])

  React.useEffect(() => {
    if (canUpdate) void load()
  }, [canUpdate, load])

  const canRound =
    rate &&
    (rate.status === "draft" || rate.status === "pending_approval" || rate.status === "rejected")

  async function submit() {
    if (!rate || !canRound) return
    const n = Number(agreedRate)
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter a valid agreed rate")
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const round = await postJson<NegotiationRoundResponse>(`/contractor-rates/${rate.id}/negotiate`, {
        proposed_rate: null,
        counter_rate: agreedRate,
        remarks: remarks.trim() ? remarks : null,
        apply_to_negotiated_rate: true,
      })
      for (const f of attachments) {
        const fd = new FormData()
        fd.append("file", f)
        await postForm(`/contractor-rates/${rate.id}/negotiation-logs/${round.id}/attachments`, fd)
      }
      toast.success(
        attachments.length
          ? `Negotiation round saved (${attachments.length} attachment${attachments.length === 1 ? "" : "s"})`
          : "Negotiation round saved",
      )
      navigate(`/dashboard/negotiated-rates/${rate.id}`)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Save failed"
      setSaveError(msg)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  if (!canUpdate) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Negotiate</CardTitle>
          <CardDescription>
            You need <span className="font-mono">contractor_rates.update</span>.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (loadError && !rate) {
    return (
      <div className="space-y-3">
        <Link
          to="/dashboard/negotiated-rates"
          className="inline-flex text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          ← Negotiated rates
        </Link>
        <Alert variant="destructive">
          <AlertTitle>Could not load negotiation</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!rate) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Loading…</CardTitle>
        </CardHeader>
      </Card>
    )
  }

  if (!canRound) {
    return (
      <div className="w-full min-w-0 space-y-4">
        <Link
          to={`/dashboard/negotiated-rates/${rate.id}`}
          className="inline-flex text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          ← Back to rate
        </Link>
        <Alert>
          <AlertTitle>No further rounds</AlertTitle>
          <AlertDescription>
            Rounds can only be added while this rate is draft, pending approval, or rejected. Current
            status: <span className="font-mono">{rate.status}</span>.
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline">
          <Link to={`/dashboard/negotiated-rates/${rate.id}`}>Open rate detail</Link>
        </Button>
      </div>
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
          <Link
            to={`/dashboard/negotiated-rates/${rate.id}`}
            className="underline-offset-2 hover:underline"
          >
            {rate.part_code ?? `#${rate.id}`}
          </Link>
          <span className="mx-1">/</span>
          <span>Negotiate</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Record a negotiation round</h1>
          <SectionHint text="The agreed rate updates this draft (or in-flight approval) until the workflow is approved; once approved, that rate is the binding commercial price for this contractor and part." />
        </div>
        <p className="text-sm text-muted-foreground">
          {rate.contractor_name ?? `Contractor #${rate.contractor_id}`} · {rate.part_name ?? "—"} ·{" "}
          {rate.org_unit_name ?? "—"}
        </p>
      </header>

      <div className="grid w-full min-w-0 gap-6 lg:grid-cols-12 lg:items-start">
        <Card className="rounded-2xl border-border/50 shadow-sm lg:col-span-5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Context</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Base rate</span>
              <span className="font-medium">{formatMoney(rate.base_rate)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Current agreed rate</span>
              <span className="font-medium">{formatMoney(rate.negotiated_rate)}</span>
            </div>
            {rate.initial_rate != null ? (
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Initial ask</span>
                <span className="font-medium">{formatMoney(rate.initial_rate)}</span>
              </div>
            ) : null}
            <div className="flex justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
              <span>Round</span>
              <span>{rate.current_round + 1} (next)</span>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50 shadow-sm lg:col-span-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Agreed rate & evidence</CardTitle>
            <CardDescription>
              One rate field, optional remarks, and optional evidence files (multiple uploads allowed).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1">
              <Label>Agreed rate</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={agreedRate}
                onChange={(e) => setAgreedRate(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label>Remarks</Label>
              <Textarea
                rows={4}
                placeholder="Notes for the timeline and approvers…"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="grid gap-1">
                  <Label>Attachments (optional)</Label>
                  <p className="text-xs text-muted-foreground">
                    Select multiple files at once, or add another batch. Each file is stored on this
                    negotiation round.
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
            {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={saving} onClick={() => void submit()}>
                {saving ? "Saving…" : "Save round"}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link to={`/dashboard/negotiated-rates/${rate.id}`}>Cancel</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default NegotiatedRateNegotiatePage
