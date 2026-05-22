import * as React from "react"
import { File, FileImage, FileText } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SectionHint } from "@/components/ui/section-hint"
import { computeVsBaseTolerance, formatMoney } from "@/components/contractors/rateStatus"
import { VsBaseToleranceBadge } from "@/components/contractors/VsBaseToleranceBadge"
import { ApiError, getJson, postForm, postJson } from "@/lib/api"
import { hasPermission, isSuperuser } from "@/lib/permissions"
import type { ContractorRatePublic } from "@/components/contractors/ContractorRatesPanel"

type NegotiationRoundResponse = {
  id: number
  contractor_rate_id: number
  round_number: number
}

const ATTACHMENT_ACCEPT = "image/*,.pdf,application/pdf"

function attachmentKind(f: File): "image" | "pdf" | "other" {
  if (f.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name)) return "image"
  if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) return "pdf"
  return "other"
}

function AttachmentRowIcon({ file }: { file: File }) {
  const k = attachmentKind(file)
  if (k === "image") return <FileImage className="size-4 shrink-0 text-muted-foreground" aria-hidden />
  if (k === "pdf") return <FileText className="size-4 shrink-0 text-red-700/80" aria-hidden />
  return <File className="size-4 shrink-0 text-muted-foreground" aria-hidden />
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
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [imagePreviews, setImagePreviews] = React.useState<{ url: string; name: string }[]>([])
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)

  React.useEffect(() => {
    const next = attachments
      .filter((f) => attachmentKind(f) === "image")
      .map((f) => ({ url: URL.createObjectURL(f), name: f.name }))
    setImagePreviews(next)
    return () => {
      for (const p of next) URL.revokeObjectURL(p.url)
    }
  }, [attachments])

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
    (rate.status === "draft" || rate.status === "approved" || rate.status === "rejected")

  async function submit() {
    if (!rate || !canRound) return
    const n = Number(agreedRate)
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter a valid agreed rate")
      return
    }
    if (!remarks.trim()) {
      toast.error("Remarks are required")
      return
    }
    if (attachments.length < 1) {
      toast.error("Add at least one attachment")
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const round = await postJson<NegotiationRoundResponse>(`/contractor-rates/${rate.id}/negotiate`, {
        proposed_rate: null,
        counter_rate: agreedRate,
        remarks: remarks.trim(),
        apply_to_negotiated_rate: true,
      })
      const targetRateId = round.contractor_rate_id
      for (const f of attachments) {
        const fd = new FormData()
        fd.append("file", f, f.name)
        await postForm(`/contractor-rates/${targetRateId}/negotiation-logs/${round.id}/attachments`, fd)
      }
      const draftUpdate = rate.status === "draft"
      const successorDraft = rate.status === "approved" && targetRateId !== rate.id
      toast.success(
        attachments.length
          ? draftUpdate
            ? `Round 1 updated (${attachments.length} attachment${attachments.length === 1 ? "" : "s"})`
            : successorDraft
              ? `Round ${round.round_number} started (${attachments.length} attachment${attachments.length === 1 ? "" : "s"})`
            : `Round saved (${attachments.length} file${attachments.length === 1 ? "" : "s"})`
          : successorDraft
            ? `Round ${round.round_number} started`
          : draftUpdate
            ? "Round 1 updated"
            : "Negotiation round saved",
      )
      navigate(`/dashboard/negotiated-rates/${targetRateId}`)
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

  const agreedN = Number(agreedRate)
  const previewVsBase = rate
    ? computeVsBaseTolerance(agreedN, rate.base_rate)
    : null
  const inPlaceRound = rate.status === "draft"
  const contextRoundLabel = inPlaceRound ? "1 (in place)" : `${rate.current_round + 1} (next)`
  const canSave =
    Number.isFinite(agreedN) &&
    agreedN > 0 &&
    !!remarks.trim() &&
    attachments.length >= 1

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
            Rounds can only be added while this rate is draft, approved, or rejected. Current
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
          <SectionHint text="Draft rates can still update round 1. Approved rates start the next round in a new draft, while pending approval stays locked." />
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
              <span className="text-muted-foreground">Should cost</span>
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
              <span>{contextRoundLabel}</span>
            </div>
            <div className="flex justify-between gap-2 border-t pt-2">
              <span className="text-muted-foreground">Effective from</span>
              <span className="font-medium tabular-nums">{rate.effective_from}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Effective to</span>
              <span className="font-medium tabular-nums">{rate.effective_to ?? "Open end"}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Work order lines use their work date within this window to resolve the negotiated rate. Change
              dates on the rate detail page if needed.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50 shadow-sm lg:col-span-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Agreed rate & evidence</CardTitle>
            <CardDescription>
              {rate.status === "draft"
                ? "Updates round 1 in place while this negotiation is still a draft. Remarks and at least one attachment are required. A new round starts only after rejection from approval."
                : "Records the next negotiation round after rejection. Remarks and attachments are required."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
            <div className="grid gap-1">
              <Label showRequired>Agreed rate</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={agreedRate}
                onChange={(e) => setAgreedRate(e.target.value)}
              />
            </div>
            {previewVsBase ? (
              <VsBaseToleranceBadge
                negotiated={agreedN}
                baseRate={rate.base_rate}
                tolerance={previewVsBase}
              />
            ) : null}
            <div className="grid gap-1">
              <Label htmlFor="neg-negotiate-remarks" showRequired>
                Remarks
              </Label>
              <Textarea
                id="neg-negotiate-remarks"
                rows={4}
                placeholder="Notes for the timeline and approvers…"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="neg-negotiate-file-btn" showRequired>
                    Attachments
                  </Label>
                  <SectionHint text="Add at least one PDF or image for this round. Files are stored on the negotiation log and shown on the timeline." />
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
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ATTACHMENT_ACCEPT}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
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
                />
                <Button
                  id="neg-negotiate-file-btn"
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Add files…
                </Button>
                <span className="text-xs text-muted-foreground">Images and PDFs · multi-select</span>
              </div>
              {attachments.length > 0 ? (
                <ul className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border bg-muted/30 p-2 text-sm">
                  {attachments.map((f, i) => (
                    <li
                      key={`${f.name}-${f.size}-${i}`}
                      className="flex items-center justify-between gap-2 rounded-md bg-background px-2 py-1.5"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <AttachmentRowIcon file={f} />
                        <span className="min-w-0 truncate font-medium" title={f.name}>
                          {f.name}
                        </span>
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                          {attachmentKind(f)}
                        </span>
                      </div>
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
              {imagePreviews.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {imagePreviews.map((p) => (
                    <div key={p.url} className="overflow-hidden rounded-md border bg-muted/40">
                      <img src={p.url} alt="" className="h-28 w-full object-cover" title={p.name} />
                      <p className="truncate px-1.5 py-1 text-[10px] text-muted-foreground" title={p.name}>
                        {p.name}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={!canSave || saving} onClick={() => void submit()}>
                {saving ? "Saving…" : rate.status === "draft" ? "Update round 1" : "Save round"}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link to={`/dashboard/negotiated-rates/${rate.id}`}>Cancel</Link>
              </Button>
            </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default NegotiatedRateNegotiatePage
