import * as React from "react"
import { Eye, File, FileImage, FileText } from "lucide-react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SectionHint } from "@/components/ui/section-hint"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ApiError, getJson, postForm, postJson } from "@/lib/api"
import {
  computeVsBaseTolerance,
  formatMoney,
  rateStatusLabel,
} from "@/components/contractors/rateStatus"
import { VsBaseToleranceBadge } from "@/components/contractors/VsBaseToleranceBadge"
import { hasPermission, isSuperuser } from "@/lib/permissions"
import {
  EMPTY_RATE_FORM,
  type NewRateForm,
  type PartMasterPick,
} from "@/components/contractors/ContractorRateDialog"

const SELECT_ROW_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"

const ATTACHMENT_ACCEPT =
  "image/*,.pdf,.txt,.csv,.md,.log,.json,.xml,text/plain,text/csv,text/markdown,application/pdf"

const TEXT_PREVIEW_MAX_BYTES = 512 * 1024

function attachmentKind(f: File): "image" | "pdf" | "text" | "other" {
  if (f.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name)) return "image"
  if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) return "pdf"
  if (
    f.type.startsWith("text/") ||
    /\.(txt|csv|md|log|json|xml|tsv)$/i.test(f.name)
  ) {
    return "text"
  }
  return "other"
}

function canPreviewStagedFile(f: File): boolean {
  return attachmentKind(f) !== "other"
}

type ContractorRateListRow = {
  id: number
  part_master_id: number
  status: string
  effective_to: string | null
}

function isActiveNegotiationThreadRow(r: ContractorRateListRow, todayIso: string): boolean {
  const st = r.status.toLowerCase()
  if (st === "cancelled" || st === "expired") return false
  if (st === "draft" || st === "pending_approval" || st === "rejected") return true
  if (st === "approved") {
    if (!r.effective_to) return true
    return r.effective_to >= todayIso
  }
  return false
}

function buildThreadsByPartMasterId(
  rates: ContractorRateListRow[],
  todayIso: string,
): Record<number, { id: number; status: string }> {
  const out: Record<number, { id: number; status: string }> = {}
  for (const r of rates) {
    if (!isActiveNegotiationThreadRow(r, todayIso)) continue
    const cur = out[r.part_master_id]
    if (!cur || r.id > cur.id) out[r.part_master_id] = { id: r.id, status: r.status }
  }
  return out
}

function AttachmentRowIcon({ file }: { file: File }) {
  const k = attachmentKind(file)
  if (k === "image") return <FileImage className="size-4 shrink-0 text-muted-foreground" aria-hidden />
  if (k === "pdf") return <FileText className="size-4 shrink-0 text-red-700/80" aria-hidden />
  if (k === "text") return <FileText className="size-4 shrink-0 text-sky-800/80" aria-hidden />
  return <File className="size-4 shrink-0 text-muted-foreground" aria-hidden />
}

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
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [threadsByPartMasterId, setThreadsByPartMasterId] = React.useState<
    Record<number, { id: number; status: string }>
  >({})

  const canViewRates = hasPermission("contractor_rates.view") || isSuperuser()

  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [previewFile, setPreviewFile] = React.useState<File | null>(null)
  const [previewBlobUrl, setPreviewBlobUrl] = React.useState<string | null>(null)
  const [previewText, setPreviewText] = React.useState<string | null>(null)
  const [previewTextTruncated, setPreviewTextTruncated] = React.useState(false)
  const [previewLoading, setPreviewLoading] = React.useState(false)

  React.useEffect(() => {
    if (!previewOpen || !previewFile) {
      setPreviewBlobUrl((u) => {
        if (u) URL.revokeObjectURL(u)
        return null
      })
      setPreviewText(null)
      setPreviewTextTruncated(false)
      setPreviewLoading(false)
      return
    }

    const k = attachmentKind(previewFile)
    if (k === "image" || k === "pdf") {
      const u = URL.createObjectURL(previewFile)
      setPreviewBlobUrl(u)
      setPreviewText(null)
      setPreviewTextTruncated(false)
      setPreviewLoading(false)
      return () => {
        URL.revokeObjectURL(u)
      }
    }

    if (k === "text") {
      setPreviewBlobUrl((u) => {
        if (u) URL.revokeObjectURL(u)
        return null
      })
      setPreviewText(null)
      setPreviewLoading(true)
      let cancelled = false
      const slice =
        previewFile.size > TEXT_PREVIEW_MAX_BYTES
          ? previewFile.slice(0, TEXT_PREVIEW_MAX_BYTES)
          : previewFile
      void slice
        .text()
        .then((t) => {
          if (!cancelled) {
            setPreviewText(t)
            setPreviewTextTruncated(previewFile.size > TEXT_PREVIEW_MAX_BYTES)
          }
        })
        .catch(() => {
          if (!cancelled) setPreviewText("Could not read this file as text.")
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false)
        })
      return () => {
        cancelled = true
      }
    }

    setPreviewLoading(false)
    return undefined
  }, [previewOpen, previewFile])

  function openAttachmentPreview(f: File) {
    if (!canPreviewStagedFile(f)) {
      toast.message("Preview is not available for this file type.")
      return
    }
    setPreviewFile(f)
    setPreviewOpen(true)
  }

  function closeAttachmentPreview() {
    setPreviewOpen(false)
    setPreviewFile(null)
  }

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

  React.useEffect(() => {
    if (!canCreate || effectiveContractorId == null || !canViewRates) {
      setThreadsByPartMasterId({})
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const rates = await getJson<ContractorRateListRow[]>(
          `/contractor-rates?contractor_id=${effectiveContractorId}`,
        )
        if (cancelled) return
        const todayIso = new Date().toISOString().slice(0, 10)
        setThreadsByPartMasterId(buildThreadsByPartMasterId(Array.isArray(rates) ? rates : [], todayIso))
      } catch {
        if (!cancelled) setThreadsByPartMasterId({})
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canCreate, canViewRates, effectiveContractorId])

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

  const { selectableParts, blockedParts } = React.useMemo(() => {
    const sel: PartMasterPick[] = []
    const blk: PartMasterPick[] = []
    for (const pm of filtered) {
      if (threadsByPartMasterId[pm.id]) blk.push(pm)
      else sel.push(pm)
    }
    return { selectableParts: sel, blockedParts: blk }
  }, [filtered, threadsByPartMasterId])

  React.useEffect(() => {
    if (form.part_master_id == null) return
    if (!threadsByPartMasterId[form.part_master_id]) return
    setForm((f) => ({ ...f, part_master_id: null }))
  }, [threadsByPartMasterId, form.part_master_id])

  const baseRate = selected ? Number(selected.base_rate) : NaN
  const negRate = Number(form.negotiated_rate)
  const initialAskStr = form.initial_rate.trim()
  const initialAskN = Number(initialAskStr)
  const effectiveInitial =
    initialAskStr !== "" && Number.isFinite(initialAskN) && initialAskN > 0 ? initialAskN : NaN

  const previewNegotiationSavings =
    Number.isFinite(effectiveInitial) && Number.isFinite(negRate) && effectiveInitial > 0
      ? {
          amount: Math.max(0, effectiveInitial - negRate),
          pct: effectiveInitial > 0 ? (Math.max(0, effectiveInitial - negRate) / effectiveInitial) * 100 : 0,
        }
      : null

  const previewVsBase = computeVsBaseTolerance(negRate, baseRate)

  const canSave =
    effectiveContractorId !== null &&
    form.part_master_id !== null &&
    initialAskStr !== "" &&
    Number.isFinite(initialAskN) &&
    initialAskN > 0 &&
    !!form.negotiated_rate.trim() &&
    Number.isFinite(negRate) &&
    negRate > 0 &&
    !!form.effective_from.trim() &&
    !!form.remarks.trim() &&
    attachments.length >= 1

  async function submit() {
    if (!effectiveContractorId || form.part_master_id === null) return
    setSaving(true)
    setSaveError(null)
    let createdId: number | null = null
    try {
      const created = await postJson<{ id: number }>("/contractor-rates", {
        contractor_id: effectiveContractorId,
        part_master_id: form.part_master_id,
        negotiated_rate: form.negotiated_rate,
        initial_rate: form.initial_rate.trim(),
        effective_from: form.effective_from,
        effective_to: null,
        remarks: form.remarks.trim(),
      })
      createdId = created.id
      if (attachments.length > 0) {
        // One POST per file: first seeds round 1 + file; later calls append to the same
        // opening-evidence round (avoids multipart/proxy quirks and supports retry after partial failure).
        for (const f of attachments) {
          const fd = new FormData()
          fd.append("file", f, f.name)
          await postForm<{ negotiation_log_id: number; attachments: unknown[] }>(
            `/contractor-rates/${created.id}/opening-evidence`,
            fd,
          )
        }
      }
      toast.success(
        attachments.length
          ? `Draft created with ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}`
          : "Draft negotiation created",
      )
      navigate(`/dashboard/negotiated-rates/${created.id}`)
    } catch (e) {
      const base =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to create draft"
      const msg =
        createdId !== null && attachments.length > 0
          ? `${base} (draft #${createdId} was saved — open it from Negotiated rates to add files or retry.)`
          : base
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
    <div className="relative w-[calc(100%+2rem)] max-w-none -mx-4 min-w-0 space-y-5 px-4 sm:w-[calc(100%+3rem)] sm:-mx-6 sm:px-6 lg:w-[calc(100%+4rem)] lg:-mx-8 lg:px-8">
      <header className="space-y-1 border-b border-border/70 pb-4">
        <div className="text-xs text-muted-foreground">
          <Link to="/dashboard/negotiated-rates" className="underline-offset-2 hover:underline">
            Negotiated rates
          </Link>
          <span className="mx-1">/</span>
          <span>New</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Start a negotiation</h1>
          <SectionHint text="One open negotiation per contractor and part. Use the existing rate to add rounds, or start a new record after the prior thread ends." />
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

      <div className="grid w-full min-w-0 grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <Card className="min-w-0 rounded-2xl border-border/50 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Contractor & part</CardTitle>
              <SectionHint text="Baseline comes from Part Master for the selected plant. One active thread per contractor and part — open the existing rate to add rounds." />
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            {needContractorPick ? (
              <div className="grid gap-1">
                <Label showRequired>Contractor</Label>
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
              <Label showRequired>Part baseline</Label>
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
              ) : effectiveContractorId == null ? (
                <p className="rounded-md border border-dashed bg-muted/30 px-2 py-5 text-center text-xs text-muted-foreground">
                  Select a contractor first.
                </p>
              ) : (
                <ul className="max-h-[min(28rem,55vh)] space-y-1 overflow-y-auto rounded-lg border p-1">
                  {selectableParts.length === 0 && blockedParts.length === 0 ? (
                    <li className="px-2 py-6 text-center text-xs text-muted-foreground">No matches.</li>
                  ) : null}
                  {selectableParts.map((pm) => (
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
                  ))}
                  {blockedParts.length > 0 ? (
                    <li className="px-2 pt-2">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Already under negotiation
                      </div>
                      <ul className="space-y-1">
                        {blockedParts.map((pm) => {
                          const t = threadsByPartMasterId[pm.id]
                          return (
                            <li
                              key={pm.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200/80 bg-amber-50/50 px-2 py-2 text-sm"
                            >
                              <div className="min-w-0 flex-1">
                                <span className="font-mono text-xs">{pm.part_code}</span>{" "}
                                <span className="text-muted-foreground">·</span>{" "}
                                <span className="text-muted-foreground">{pm.part_name}</span>
                                <div className="text-[11px] text-muted-foreground">
                                  {t ? `${rateStatusLabel(t.status)} · ` : null}
                                  {pm.org_unit_name ?? "—"}
                                </div>
                              </div>
                              {t ? (
                                <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 text-xs" asChild>
                                  <Link to={`/dashboard/negotiated-rates/${t.id}`}>View existing</Link>
                                </Button>
                              ) : null}
                            </li>
                          )
                        })}
                      </ul>
                    </li>
                  ) : null}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 rounded-2xl border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Rates & notes</CardTitle>
              <SectionHint text="Work order lines use their work date: it must fall on or after effective from. Approved rates stay open-ended until superseded or expired by policy." />
            </div>
          </CardHeader>
          <CardContent>
            {/* Use a div instead of <form> so implicit submit / file-control quirks cannot full-page reload the app. */}
            <div className="grid gap-4">
            <div className="grid gap-1">
              <Label htmlFor="neg-initial" showRequired>
                Initial ask
              </Label>
              <Input
                id="neg-initial"
                type="number"
                inputMode="decimal"
                placeholder="Contractor opening price"
                value={form.initial_rate}
                onChange={(e) => setForm((f) => ({ ...f, initial_rate: e.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="neg-agreed" showRequired>
                Agreed rate
              </Label>
              <Input
                id="neg-agreed"
                type="number"
                inputMode="decimal"
                placeholder="0.00"
                value={form.negotiated_rate}
                onChange={(e) => setForm((f) => ({ ...f, negotiated_rate: e.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <Label
                htmlFor="neg-effective-from"
                showRequired
                title="First day this rate can apply to work orders (by line work date)."
              >
                Effective from
              </Label>
              <Input
                id="neg-effective-from"
                type="date"
                value={form.effective_from}
                onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="neg-remarks" showRequired>
                Remarks
              </Label>
              <Textarea
                id="neg-remarks"
                rows={3}
                required
                placeholder="Context for approvers — timeline, rationale, links…"
                value={form.remarks}
                onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
              />
            </div>

            <div className="grid gap-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="neg-file-btn" showRequired>
                    Attachments
                  </Label>
                  <SectionHint text="PDFs or images attach to round 1 as opening evidence when the draft is created. Use Negotiate for files on later rounds." />
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
                  id="neg-file-btn"
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Add files…
                </Button>
                <span className="text-xs text-muted-foreground">Multi-select · images, PDF, text</span>
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
                      {canPreviewStagedFile(f) ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 shrink-0 px-2 text-xs"
                          onClick={() => openAttachmentPreview(f)}
                        >
                          <Eye className="size-3.5" aria-hidden />
                          View
                        </Button>
                      ) : null}
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

            {/* {previewNegotiationSavings && previewNegotiationSavings.amount > 0 ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-900">
                Negotiation savings vs opening ask:{" "}
                <strong>{formatMoney(previewNegotiationSavings.amount)}</strong> (
                {previewNegotiationSavings.pct.toFixed(1)}%)
              </div>
            ) : null} */}
            {previewVsBase ? (
              <VsBaseToleranceBadge
                negotiated={negRate}
                baseRate={baseRate}
                tolerance={previewVsBase}
              />
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
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={previewOpen}
        onOpenChange={(open) => {
          if (!open) closeAttachmentPreview()
        }}
      >
        <DialogContent className="max-h-[min(94vh,1000px)] w-full max-w-[calc(100vw-1rem)] overflow-hidden p-5 sm:max-w-[min(88rem,calc(100vw-1rem))]">
          <DialogHeader>
            <DialogTitle className="truncate pr-8 text-base">
              {previewFile?.name ?? "Attachment"}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[calc(94vh-7rem)] min-h-[min(60vh,520px)] overflow-auto">
            {previewLoading ? (
              <p className="text-sm text-muted-foreground">Loading preview…</p>
            ) : null}
            {!previewLoading && previewFile && attachmentKind(previewFile) === "image" && previewBlobUrl ? (
              <img
                src={previewBlobUrl}
                alt=""
                className="mx-auto max-h-[min(82vh,900px)] w-auto max-w-full object-contain"
              />
            ) : null}
            {!previewLoading && previewFile && attachmentKind(previewFile) === "pdf" && previewBlobUrl ? (
              <iframe
                title={previewFile.name}
                src={previewBlobUrl}
                className="h-[min(82vh,900px)] min-h-[480px] w-full rounded-md border bg-muted/30"
              />
            ) : null}
            {!previewLoading && previewFile && attachmentKind(previewFile) === "text" ? (
              <div className="space-y-2">
                {previewTextTruncated ? (
                  <p className="text-xs text-amber-800">
                    Showing the first {(TEXT_PREVIEW_MAX_BYTES / 1024).toFixed(0)} KB only. Full file will still be
                    uploaded when you create the draft.
                  </p>
                ) : null}
                <pre className="max-h-[min(82vh,900px)] min-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/20 p-3 font-mono text-xs">
                  {previewText ?? ""}
                </pre>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default NegotiatedRateNewPage
