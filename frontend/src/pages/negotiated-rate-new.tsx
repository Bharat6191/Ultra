import * as React from "react"
import { CalendarDays, Eye, File, FileImage, FileText, IndianRupee, Search, UploadCloud } from "lucide-react"
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
import { cn } from "@/lib/utils"
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
const NEGOTIATION_REMARKS_MAX_LENGTH = 500

function mergeAttachments(existing: File[], incoming: File[]) {
  const merged = [...existing, ...incoming]
  const seen = new Set<string>()
  return merged.filter((f) => {
    const key = `${f.name}:${f.size}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

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
  const partSearchRef = React.useRef<HTMLDivElement>(null)
  const [isPartSearchOpen, setIsPartSearchOpen] = React.useState(false)
  const [isAttachmentDragActive, setIsAttachmentDragActive] = React.useState(false)
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
  const selectedContractorName = React.useMemo(() => {
    if (effectiveContractorId == null) return null
    return (
      contractorChoices.find((choice) => choice.id === effectiveContractorId)?.name ??
      `Contractor #${effectiveContractorId}`
    )
  }, [contractorChoices, effectiveContractorId])

  React.useEffect(() => {
    if (!isPartSearchOpen) return
    function handlePointerDown(event: MouseEvent) {
      if (!partSearchRef.current?.contains(event.target as Node)) {
        setIsPartSearchOpen(false)
      }
    }
    document.addEventListener("mousedown", handlePointerDown)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
    }
  }, [isPartSearchOpen])

  React.useEffect(() => {
    if (effectiveContractorId != null) return
    setIsPartSearchOpen(false)
  }, [effectiveContractorId])

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
  const showPartResults = effectiveContractorId !== null && isPartSearchOpen
  const remarksCount = form.remarks.length

  function handleFilesAdded(files: File[]) {
    if (files.length === 0) return
    setAttachments((prev) => mergeAttachments(prev, files))
  }

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
          <CardTitle>New Negotiation</CardTitle>
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
            Negotiation
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

      <Card className="min-w-0 overflow-visible rounded-[28px] border-border/50 shadow-sm">
        <CardContent className="p-0">
          <div className="grid min-w-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
            <section className="border-b border-border/50 px-6 py-6 lg:border-b-0 lg:border-r">
              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight">
                    Contractor & Part Selection
                  </h2>
                </div>

                
                  <div className="grid gap-2">
                    <Label showRequired>Contractor</Label>
                    {needContractorPick ? (
                      <select
                        className={cn(SELECT_ROW_CLASS, "h-11 rounded-xl")}
                        value={pickedContractorId === "" ? "" : String(pickedContractorId)}
                        onChange={(e) => {
                          const value = e.target.value
                          setPickedContractorId(value === "" ? "" : Number(value))
                        }}
                      >
                        <option value="">Select contractor...</option>
                        {contractorChoices.map((choice) => (
                          <option key={choice.id} value={String(choice.id)}>
                            {choice.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="flex min-h-11 items-center rounded-xl border border-border/70 bg-background px-3 text-sm font-medium text-foreground">
                        {selectedContractorName ?? "No active contractor available"}
                      </div>
                    )}
                    {fixedContractorId ? (
                      <p className="text-xs text-muted-foreground">
                        Creating for a pre-selected contractor.{" "}
                        <Link
                          to="/dashboard/negotiated-rates/new"
                          className="font-medium text-foreground underline underline-offset-2"
                        >
                          Change
                        </Link>
                      </p>
                    ) : null}
                  </div>

                  <div ref={partSearchRef} className="relative grid gap-2">
                    <Label htmlFor="neg-search-parts">Search Parts</Label>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                      <Input
                        id="neg-search-parts"
                        className="h-11 rounded-xl pl-9"
                        value={search}
                        onFocus={() => {
                          if (effectiveContractorId != null) setIsPartSearchOpen(true)
                        }}
                        onChange={(e) => {
                          setSearch(e.target.value)
                          if (effectiveContractorId != null) setIsPartSearchOpen(true)
                        }}
                        placeholder="Search by code, name or plant..."
                        disabled={effectiveContractorId == null}
                      />
                    </div>

                    {showPartResults ? (
                      <div className="absolute top-full z-30 mt-2 w-full overflow-hidden rounded-2xl border border-border/70 bg-background shadow-xl">
                        <div className="max-h-[24rem] overflow-y-auto p-2">
                          {selectableParts.length === 0 && blockedParts.length === 0 ? (
                            <div className="rounded-xl px-3 py-8 text-center text-sm text-muted-foreground">
                              No matching parts found.
                            </div>
                          ) : null}

                          {selectableParts.map((pm) => (
                            <button
                              key={pm.id}
                              type="button"
                              className="mb-1.5 w-full rounded-xl border border-transparent bg-background px-3 py-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50/50"
                              onClick={() => {
                                setForm((prev) => ({ ...prev, part_master_id: pm.id }))
                                setSearch("")
                                setIsPartSearchOpen(false)
                              }}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                      {pm.part_code}
                                    </span>
                                    <span className="text-sm font-semibold text-foreground">
                                      {pm.part_name}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {pm.org_unit_name ?? "No plant"} ·{" "}
                                    {pm.pricing_method.replace(/_/g, " ")} ·{" "}
                                    {pm.rate_unit_type.replace(/_/g, " ")}
                                  </p>
                                </div>
                                <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                                  {formatMoney(pm.base_rate)}
                                </span>
                              </div>
                            </button>
                          ))}

                          {blockedParts.length > 0 ? (
                            <div className="mt-2 border-t border-border/50 pt-2">
                              <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                Already under negotiation
                              </div>
                              <div className="space-y-1.5">
                                {blockedParts.map((pm) => {
                                  const thread = threadsByPartMasterId[pm.id]
                                  return (
                                    <div
                                      key={pm.id}
                                      className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-3"
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-mono text-xs font-semibold uppercase tracking-wide text-amber-900/70">
                                              {pm.part_code}
                                            </span>
                                            <span className="text-sm font-semibold text-foreground">
                                              {pm.part_name}
                                            </span>
                                          </div>
                                          <p className="mt-1 text-xs text-amber-900/75">
                                            {thread ? `${rateStatusLabel(thread.status)} · ` : null}
                                            {pm.org_unit_name ?? "No plant"}
                                          </p>
                                        </div>
                                        {thread ? (
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-8 shrink-0 rounded-lg border-amber-300 bg-white px-3 text-xs"
                                            asChild
                                          >
                                            <Link to={`/dashboard/negotiated-rates/${thread.id}`}>
                                              View existing
                                            </Link>
                                          </Button>
                                        ) : null}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                

                <div className="grid gap-2">
                  <Label>Part Baseline</Label>
                  <div
                    className={cn(
                      "flex min-h-[140px] items-center justify-center rounded-2xl border px-5 py-5 text-center",
                      selected
                        ? "border-emerald-100 bg-emerald-50/35"
                        : "border-border/70 bg-background",
                    )}
                  >
                    {selected ? (
                      <div className="w-full space-y-3 text-left">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-base font-semibold text-foreground">
                              {selected.part_name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              <span className="font-mono">{selected.part_code}</span> ·{" "}
                              {selected.org_unit_name ?? "No plant"}
                            </p>
                          </div>
                          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                            {formatMoney(selected.base_rate)}
                          </span>
                        </div>
                        <div className="grid gap-1 text-xs text-muted-foreground">
                          <p>
                            {selected.pricing_method.replace(/_/g, " ")} ·{" "}
                            {selected.rate_unit_type.replace(/_/g, " ")} · unit {selected.unit_type}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 rounded-lg px-2 text-xs text-emerald-700 hover:text-emerald-800"
                          onClick={() => {
                            setForm((prev) => ({ ...prev, part_master_id: null }))
                            setSearch("")
                            setIsPartSearchOpen(true)
                          }}
                        >
                          Change part
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
                          <FileText className="size-5" aria-hidden />
                        </div>
                        <div className="space-y-1">
                          <p className="text-base font-semibold text-foreground">
                            No part selected yet
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Select contractor and search part to view baseline rate.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="border-b border-border/50 px-6 py-6 lg:border-b-0">
              <div className="space-y-5">
                <div className="space-y-5">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-semibold tracking-tight">Rate Details</h2>
                    <SectionHint text="Work order lines use their work date: it must fall on or after effective from. Approved rates stay open-ended until superseded or expired by policy." />
                  </div>

                  <div className="grid gap-4 xl:grid-cols-3">
                    <div className="grid gap-2">
                      <Label htmlFor="neg-initial" showRequired>
                        Initial Ask
                      </Label>
                      <div className="relative">
                        <IndianRupee className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                        <Input
                          id="neg-initial"
                          type="number"
                          inputMode="decimal"
                          className="h-11 rounded-xl pl-9"
                          placeholder="Enter initial ask"
                          value={form.initial_rate}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, initial_rate: e.target.value }))
                          }
                        />
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="neg-agreed" showRequired>
                        Agreed Rate
                      </Label>
                      <div className="relative">
                        <IndianRupee className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                        <Input
                          id="neg-agreed"
                          type="number"
                          inputMode="decimal"
                          className="h-11 rounded-xl pl-9"
                          placeholder="0.00"
                          value={form.negotiated_rate}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, negotiated_rate: e.target.value }))
                          }
                        />
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label
                        htmlFor="neg-effective-from"
                        showRequired
                        title="First day this rate can apply to work orders (by line work date)."
                      >
                        Effective From
                      </Label>
                      <div className="relative">
                        <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                        <Input
                          id="neg-effective-from"
                          type="date"
                          className="h-11 rounded-xl pl-9"
                          value={form.effective_from}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, effective_from: e.target.value }))
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="neg-remarks" showRequired>
                        Remarks
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        {remarksCount} / {NEGOTIATION_REMARKS_MAX_LENGTH}
                      </span>
                    </div>
                    <Textarea
                      id="neg-remarks"
                      rows={2}
                      required
                      maxLength={NEGOTIATION_REMARKS_MAX_LENGTH}
                      className="min-h-[76px] rounded-2xl"
                      placeholder="Context for approvers — timeline, rationale, links..."
                      value={form.remarks}
                      onChange={(e) => setForm((prev) => ({ ...prev, remarks: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5">
                        <Label htmlFor="neg-file-btn" showRequired>
                          Attachments
                        </Label>
                        <SectionHint text="PDFs, images, and text-based support files attach to round 1 as opening evidence when the draft is created." />
                      </div>
                      {attachments.length > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 rounded-lg px-2 text-xs text-muted-foreground"
                          onClick={() => setAttachments([])}
                        >
                          Clear
                        </Button>
                      ) : null}
                    </div>

                    <input
                      ref={fileInputRef}
                      id="neg-file-btn"
                      type="file"
                      multiple
                      accept={ATTACHMENT_ACCEPT}
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden
                      onChange={(e) => {
                        handleFilesAdded(Array.from(e.target.files ?? []))
                        e.target.value = ""
                      }}
                    />

                    <div
                      className={cn(
                        "rounded-2xl border px-4 py-4 text-center transition",
                        isAttachmentDragActive
                          ? "border-emerald-400 bg-emerald-50/60"
                          : "border-border/70 bg-background",
                      )}
                      onDragEnter={(e) => {
                        e.preventDefault()
                        setIsAttachmentDragActive(true)
                      }}
                      onDragOver={(e) => {
                        e.preventDefault()
                        setIsAttachmentDragActive(true)
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                          setIsAttachmentDragActive(false)
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        setIsAttachmentDragActive(false)
                        handleFilesAdded(Array.from(e.dataTransfer.files ?? []))
                      }}
                    >
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 w-full rounded-xl"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <UploadCloud className="size-4" aria-hidden />
                        Browse Files
                      </Button>
                      <p className="mt-3 text-xs leading-5 text-muted-foreground">
                        PDF, JPG, PNG, TXT (Max 10MB)
                      </p>
                    </div>

                    {attachments.length > 0 ? (
                      <ul className="space-y-2 rounded-2xl border border-border/70 bg-muted/15 p-3">
                        {attachments.map((file, index) => (
                          <li
                            key={`${file.name}-${file.size}-${index}`}
                            className="space-y-2 rounded-xl bg-background px-3 py-2"
                          >
                            <div className="flex items-start gap-2">
                              <AttachmentRowIcon file={file} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium" title={file.name}>
                                  {file.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {(file.size / 1024).toFixed(file.size < 10240 ? 1 : 0)} KB
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {canPreviewStagedFile(file) ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 rounded-lg px-3 text-xs"
                                  onClick={() => openAttachmentPreview(file)}
                                >
                                  <Eye className="size-3.5" aria-hidden />
                                  View
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 rounded-lg px-2 text-xs"
                                onClick={() =>
                                  setAttachments((prev) => prev.filter((_, fileIndex) => fileIndex !== index))
                                }
                              >
                                Remove
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  {previewVsBase ? (
                    <VsBaseToleranceBadge
                      negotiated={negRate}
                      baseRate={baseRate}
                      tolerance={previewVsBase}
                    />
                  ) : null}

                  {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
                </div>

                <div className="flex flex-wrap justify-end gap-3 border-t border-border/50 pt-3">
                  <Button type="button" variant="outline" className="h-10 rounded-xl px-5" asChild>
                    <Link to="/dashboard/negotiated-rates">Cancel</Link>
                  </Button>
                  <Button
                    type="button"
                    className="h-10 rounded-xl px-5"
                    disabled={!canSave || saving}
                    onClick={() => void submit()}
                  >
                    <FileText className="size-4" aria-hidden />
                    {saving ? "Creating..." : "Save as Draft"}
                  </Button>
                </div>
              </div>
            </section>
          </div>
        </CardContent>
      </Card>

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
