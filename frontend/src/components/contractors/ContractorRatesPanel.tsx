import * as React from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import {
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Download,
  Eye,
  File,
  FileImage,
  FileText,
  Hourglass,
  MessagesSquare,
  Paperclip,
  Plus,
  Send,
  TrendingUp,
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ApiError, authFetch, getJson, postForm, postJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"
import {
  formatMoney,
  formatPercent,
  rateStatusLabel,
  rateStatusVariant,
  rateStepperIndex,
  RATE_STEPPER_STEPS,
} from "@/components/contractors/rateStatus"
import { VsBaseToleranceBadge } from "@/components/contractors/VsBaseToleranceBadge"
import { ContractorRateTimeline } from "@/components/contractors/ContractorRateTimeline"
import { SectionHint } from "@/components/ui/section-hint"

export type NegotiationAttachmentItem = {
  id: number
  file_path: string
  file_name: string | null
  content_type: string | null
  uploaded_by: number | null
  uploaded_at: string
}

export type NegotiationRoundPublic = {
  id: number
  round_number: number
  proposed_rate: number | string | null
  counter_rate: number | string | null
  remarks: string | null
  round_summary?: string | null
  created_by_name: string | null
  created_at: string
  attachments?: NegotiationAttachmentItem[]
}

export type ContractorRatePublic = {
  id: number
  contractor_id: number
  contractor_name: string | null
  part_master_id: number
  part_code: string | null
  part_name: string | null
  unit_type: string | null
  pricing_method: string | null
  rate_unit_type: string | null
  org_unit_id: number | null
  org_unit_name: string | null
  base_rate: number | string | null
  negotiated_rate: number | string
  initial_rate: number | string | null
  previous_rate: number | string | null
  savings_amount: number | string | null
  savings_percentage: number | string | null
  vs_base_amount: number | string | null
  vs_base_percentage: number | string | null
  effective_from: string
  effective_to: string | null
  status: string
  current_round: number
  remarks: string | null
  approval_request_id: number | null
  approved_by: number | null
  approved_at: string | null
  rejected_by: number | null
  rejected_at: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
  rounds: NegotiationRoundPublic[]
}

export type RatesSummary = {
  total_negotiations: number
  pending_approvals: number
  approved: number
  rejected: number
  /** Negotiation savings — anchored on the contractor's initial ask, always >= 0. */
  total_savings: number | string
  avg_savings_percentage: number | string
  /** Vs-base KPIs — surface so the dashboard can flag when contractors land
   *  ABOVE the procurement baseline without poisoning the savings figure. */
  total_premium_above_base?: number | string
  total_below_base_savings?: number | string
  approved_above_base?: number
  approved_below_base?: number
  approved_at_base?: number
}

const OPENING_EVIDENCE_ACCEPT = "image/*,.pdf,application/pdf"

/** Matches server rules for ``POST …/opening-evidence`` (draft only; 0 rounds or single round-1 opening evidence). */
export function canAppendOpeningEvidence(rate: ContractorRatePublic): boolean {
  if (rate.status !== "draft") return false
  const rounds = rate.rounds ?? []
  if (rounds.length === 0) return true
  if (rounds.length !== 1) return false
  const r = rounds[0]
  if (Number(r.round_number) !== 1) return false
  return (r.round_summary ?? "").trim() === "Opening evidence"
}

function attachmentKind(f: File): "image" | "pdf" | "other" {
  if (f.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name)) return "image"
  if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) return "pdf"
  return "other"
}

function DraftOpeningEvidenceRowIcon({ file }: { file: File }) {
  const k = attachmentKind(file)
  if (k === "image") return <FileImage className="size-4 shrink-0 text-muted-foreground" aria-hidden />
  if (k === "pdf") return <FileText className="size-4 shrink-0 text-red-700/80" aria-hidden />
  return <File className="size-4 shrink-0 text-muted-foreground" aria-hidden />
}

function DraftOpeningEvidenceUploader({
  rateId,
  disabled,
  onUploaded,
}: {
  rateId: number
  disabled?: boolean
  onUploaded: () => void
}) {
  const [staged, setStaged] = React.useState<File[]>([])
  const [uploading, setUploading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  async function uploadStaged() {
    if (!staged.length) return
    setUploading(true)
    try {
      for (const f of staged) {
        const fd = new FormData()
        fd.append("file", f, f.name)
        await postForm(`/contractor-rates/${rateId}/opening-evidence`, fd)
      }
      toast.success(
        staged.length === 1 ? "File attached to draft" : `${staged.length} files attached to draft`,
      )
      setStaged([])
      onUploaded()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Upload failed"
      toast.error(msg)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-emerald-200/80 bg-emerald-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h4 className="text-sm font-medium text-emerald-950">Evidence before approval</h4>
          <SectionHint text="Add PDFs or images to round 1 while this negotiation is still a draft. After further negotiation rounds, use Negotiate to attach files to those rounds." />
        </div>
        {staged.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-xs text-muted-foreground"
            disabled={uploading}
            onClick={() => setStaged([])}
          >
            Clear list
          </Button>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={OPENING_EVIDENCE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          disabled={disabled || uploading}
          onChange={(e) => {
            const next = Array.from(e.target.files ?? [])
            if (next.length) {
              setStaged((prev) => {
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
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          disabled={disabled || uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          Add files…
        </Button>
        <Button type="button" size="sm" disabled={disabled || uploading || staged.length === 0} onClick={() => void uploadStaged()}>
          {uploading ? "Uploading…" : staged.length ? `Upload ${staged.length} file${staged.length === 1 ? "" : "s"}` : "Upload"}
        </Button>
      </div>
      {staged.length > 0 ? (
        <ul className="mt-3 max-h-36 space-y-1.5 overflow-y-auto rounded-lg border bg-background/80 p-2 text-sm">
          {staged.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${i}`}
              className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <DraftOpeningEvidenceRowIcon file={f} />
                <span className="min-w-0 truncate" title={f.name}>
                  {f.name}
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
                disabled={uploading}
                onClick={() => setStaged((prev) => prev.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}


/**
 * Self-contained rates UI for a single contractor: loads its own data, owns its
 * dialogs, and exposes a `focusRateId` so other pages can deep-link to a specific
 * rate (e.g. opening from a My Tasks approval).
 *
 * Pass ``readOnly`` to suppress every mutating affordance (New negotiation link,
 * Submit / Cancel actions, negotiate link). The panel still loads, lists, and
 * shows the timeline so the contractor profile tab can display the negotiation
 * history without offering edit controls.
 */
export function ContractorRatesPanel({
  contractorId,
  focusRateId,
  onFocusHandled,
  readOnly = false,
}: {
  contractorId: number
  focusRateId?: number | null
  onFocusHandled?: () => void
  readOnly?: boolean
}) {
  const [rates, setRates] = React.useState<ContractorRatePublic[] | null>(null)
  const [summary, setSummary] = React.useState<RatesSummary | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const [selectedRateId, setSelectedRateId] = React.useState<number | null>(null)

  const canView = hasPermission("contractor_rates.view")
  // ``readOnly`` strips every mutating affordance regardless of RBAC, used by
  // the contractor master tab to show negotiation history without edit access.
  const canCreate = !readOnly && hasPermission("contractor_rates.create")
  const canUpdate = !readOnly && hasPermission("contractor_rates.update")

  const detailRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!contractorId || !canView) return
    void load()
  }, [contractorId, canView])

  // Honour deep-links from the my-tasks page (focusRateId=<id>): once data has
  // loaded, jump to that row and scroll the detail panel into view.
  React.useEffect(() => {
    if (focusRateId && rates && rates.some((r) => r.id === focusRateId)) {
      setSelectedRateId(focusRateId)
      onFocusHandled?.()
      // Defer to next paint so the panel is rendered.
      requestAnimationFrame(() => {
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRateId, rates])

  async function load() {
    setError(null)
    try {
      const [list, sum] = await Promise.all([
        getJson<ContractorRatePublic[]>(
          `/contractor-rates?contractor_id=${contractorId}`,
        ),
        getJson<RatesSummary>(`/contractor-rates/summary?contractor_id=${contractorId}`),
      ])
      setRates(list)
      setSummary(sum)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contractor rates")
    }
  }

  const selectedRate = React.useMemo(
    () => rates?.find((r) => r.id === selectedRateId) ?? null,
    [rates, selectedRateId],
  )

  const activeRates = React.useMemo(
    () => (rates ?? []).filter((r) => r.status === "approved"),
    [rates],
  )

  async function submitForApproval(rate: ContractorRatePublic) {
    try {
      await postJson(`/contractor-rates/${rate.id}/submit`, {})
      toast.success("Submitted for approval")
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submit failed")
    }
  }

  async function cancelRate(rate: ContractorRatePublic) {
    if (!confirm(`Cancel draft #${rate.id}? This cannot be undone.`)) return
    try {
      await postJson(`/contractor-rates/${rate.id}/cancel`, {})
      toast.success("Negotiation cancelled")
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed")
    }
  }

  if (!canView) {
    return (
      <Card className="border-destructive/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Negotiated rates</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You don't have permission to view negotiated rates.
        </CardContent>
      </Card>
    )
  }

  if (!rates || !summary) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Loading rates…</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {error ?? "Fetching rates and savings."}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-6">
      {/* Action header (no page chrome — composed by the parent). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Negotiated rates</h2>
          <p className="text-xs text-muted-foreground">
            Negotiate against Part Master baselines per plant, route to procurement approval, and track savings.
          </p>
        </div>
        {canCreate ? (
          <Button asChild>
            <Link to={`/dashboard/negotiated-rates/new?contractorId=${contractorId}`}>
              <Plus className="size-4" /> New negotiation
            </Link>
          </Button>
        ) : null}
      </div>

      {/* Summary KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total negotiations"
          value={summary.total_negotiations}
          icon={<MessagesSquare className="size-4" />}
        />
        <KpiCard
          title="Pending approvals"
          value={summary.pending_approvals}
          icon={<Hourglass className="size-4" />}
          tone="warning"
        />
        <KpiCard
          title="Total savings"
          value={formatMoney(summary.total_savings)}
          icon={<CircleDollarSign className="size-4" />}
          tone="success"
        />
        <KpiCard
          title="Avg savings %"
          value={formatPercent(summary.avg_savings_percentage)}
          icon={<TrendingUp className="size-4" />}
          tone="success"
        />
      </div>

      {error ? <div className="text-sm text-destructive">{error}</div> : null}

      {/* Active rate cards */}
      {activeRates.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Currently active rates</CardTitle>
            <p className="text-xs text-muted-foreground">
              Approved rates that are in force right now.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {activeRates.map((r) => (
                <ActiveRateCard key={r.id} rate={r} onSelect={() => setSelectedRateId(r.id)} />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* All rates table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">All negotiations</CardTitle>
          <p className="text-xs text-muted-foreground">
            Drafts, submitted requests, approved/expired rates, and rejections.
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Part</TableHead>
                <TableHead>Plant</TableHead>
                <TableHead className="text-right">Should cost</TableHead>
                <TableHead className="text-right">Negotiated</TableHead>
                <TableHead className="text-right">Savings</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    No negotiations yet — start one above.
                  </TableCell>
                </TableRow>
              ) : (
                rates.map((r) => (
                  <TableRow
                    key={r.id}
                    className={`cursor-pointer ${selectedRateId === r.id ? "bg-emerald-50/30" : ""}`}
                    onClick={() => setSelectedRateId(r.id)}
                  >
                    <TableCell>
                      <div className="font-mono text-xs font-medium text-foreground">{r.part_code ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.part_name ?? "—"}</div>
                      <div className="text-[11px] capitalize text-muted-foreground">
                        {(r.pricing_method ?? "").replace(/_/g, " ") || "—"} · {r.unit_type ?? "—"}
                      </div>
                    </TableCell>
                    <TableCell>{r.org_unit_name ?? "—"}</TableCell>
                    <TableCell className="text-right">{formatMoney(r.base_rate)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatMoney(r.negotiated_rate)}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.savings_amount !== null ? (
                        <div>
                          <div className="font-medium">
                            {formatMoney(r.savings_amount)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatPercent(r.savings_percentage)}
                          </div>
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>{r.effective_from}</div>
                      <div className="text-muted-foreground">
                        {r.effective_to ? `→ ${r.effective_to}` : "→ open"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={rateStatusVariant(r.status)}>
                        {rateStatusLabel(r.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div
                        className="flex items-center justify-end gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canCreate && (r.status === "draft" || r.status === "rejected") ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void submitForApproval(r)}
                          >
                            <Send className="size-3.5" /> Submit
                          </Button>
                        ) : null}
                        {canUpdate && (r.status === "draft" || r.status === "pending_approval") ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => void cancelRate(r)}
                          >
                            Cancel
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedRateId(r.id)}
                        >
                          Open <ChevronRight className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail panel for the selected rate */}
      {selectedRate ? (
        <div ref={detailRef}>
          <RateDetailPanel
            rate={selectedRate}
            canUpdate={canUpdate}
            canCreate={canCreate}
            onAfterMutation={() => void load()}
          />
        </div>
      ) : null}

    </div>
  )
}


function KpiCard({
  title,
  value,
  icon,
  tone,
}: {
  title: string
  value: React.ReactNode
  icon?: React.ReactNode
  tone?: "success" | "warning" | "info" | "neutral"
}) {
  const toneClasses: Record<string, string> = {
    success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    warning: "bg-amber-50 text-amber-700 ring-amber-200",
    info: "bg-sky-50 text-sky-700 ring-sky-200",
    neutral: "bg-gray-50 text-gray-600 ring-gray-200",
  }
  const cls = toneClasses[tone ?? "neutral"]
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
        </div>
        {icon ? (
          <span className={`grid size-9 place-items-center rounded-xl ring-2 ${cls}`}>{icon}</span>
        ) : null}
      </CardContent>
    </Card>
  )
}


function ActiveRateCard({
  rate,
  onSelect,
}: {
  rate: ContractorRatePublic
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex flex-col items-stretch rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-xs font-medium text-foreground">{rate.part_code ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{rate.part_name ?? "—"}</div>
          <div className="text-[11px] capitalize text-muted-foreground">
            {(rate.pricing_method ?? "").replace(/_/g, " ") || "—"} · {rate.unit_type ?? "—"}
          </div>
        </div>
        <Badge variant="success">Active</Badge>
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="text-xs text-muted-foreground">Negotiated</div>
          <div className="text-2xl font-semibold tracking-tight">
            {formatMoney(rate.negotiated_rate)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Should cost</div>
          <div className="text-sm">{formatMoney(rate.base_rate)}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <span>{rate.org_unit_name ?? "—"}</span>
        <span className="text-right">
          {rate.savings_amount !== null
            ? `Save ${formatMoney(rate.savings_amount)} (${formatPercent(
                rate.savings_percentage,
              )})`
            : "—"}
        </span>
      </div>
    </button>
  )
}


function NegotiationRoundAttachments({
  rateId,
  logId,
  items,
}: {
  rateId: number
  logId: number
  items: NegotiationAttachmentItem[]
}) {
  if (!items.length) return null

  const [open, setOpen] = React.useState(false)
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null)
  const [viewerMime, setViewerMime] = React.useState<string>("")
  const [viewerName, setViewerName] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [loadErr, setLoadErr] = React.useState<string | null>(null)

  React.useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  async function pullAndShow(att: NegotiationAttachmentItem, mode: "view" | "download") {
    setLoadErr(null)
    setLoading(true)
    try {
      const path = `/contractor-rates/${rateId}/negotiation-logs/${logId}/attachments/${att.id}/content`
      const res = await authFetch(path)
      if (!res.ok) {
        let msg = res.statusText
        try {
          const j = (await res.json()) as { detail?: unknown }
          if (typeof j.detail === "string") msg = j.detail
        } catch {
          try {
            const t = await res.text()
            if (t) msg = t.slice(0, 200)
          } catch {
            // ignore
          }
        }
        throw new Error(msg)
      }
      const blob = await res.blob()
      const mime = (att.content_type || blob.type || "").toLowerCase()
      const name = att.file_name || `attachment-${att.id}`
      if (mode === "download") {
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = name
        a.rel = "noopener"
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        return
      }
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      const url = URL.createObjectURL(blob)
      setBlobUrl(url)
      setViewerMime(mime)
      setViewerName(name)
      setOpen(true)
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Could not open file")
    } finally {
      setLoading(false)
    }
  }

  const canPreviewImage = viewerMime.startsWith("image/")
  const canPreviewPdf = viewerMime === "application/pdf" || viewerMime.endsWith("/pdf")

  return (
    <div className="mt-2 rounded-lg border border-dashed bg-muted/20 p-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Paperclip className="size-3" />
        Attachments
      </div>
      <ul className="space-y-1">
        {items.map((att) => (
          <li
            key={att.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background px-2 py-1.5 text-xs"
          >
            <span className="min-w-0 truncate font-medium text-foreground" title={att.file_name ?? undefined}>
              {att.file_name ?? `File #${att.id}`}
            </span>
            <span className="flex shrink-0 gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={loading}
                onClick={() => void pullAndShow(att, "view")}
              >
                <Eye className="size-3.5" />
                View
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={loading}
                onClick={() => void pullAndShow(att, "download")}
              >
                <Download className="size-3.5" />
                Save
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {loadErr ? <p className="mt-1 text-xs text-destructive">{loadErr}</p> : null}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next && blobUrl) {
            URL.revokeObjectURL(blobUrl)
            setBlobUrl(null)
          }
        }}
      >
        <DialogContent className="max-h-[min(94vh,1000px)] w-full max-w-[calc(100vw-1rem)] overflow-hidden p-5 sm:max-w-[min(88rem,calc(100vw-1rem))]">
          <DialogHeader>
            <DialogTitle className="truncate pr-8 text-base">{viewerName}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[calc(94vh-7rem)] min-h-[min(60vh,520px)] overflow-auto">
            {blobUrl && canPreviewImage ? (
              <img
                src={blobUrl}
                alt={viewerName}
                className="mx-auto max-h-[min(82vh,900px)] w-auto max-w-full object-contain"
              />
            ) : null}
            {blobUrl && canPreviewPdf ? (
              <iframe
                title={viewerName}
                src={blobUrl}
                className="h-[min(82vh,900px)] min-h-[480px] w-full rounded-md border bg-muted/30"
              />
            ) : null}
            {blobUrl && !canPreviewImage && !canPreviewPdf ? (
              <p className="text-sm text-muted-foreground">
                No in-browser preview for this type. Close and use <strong>Save</strong> to download and open it
                locally.
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}


export function RateDetailPanel({
  rate,
  canUpdate,
  canCreate = false,
  onAfterMutation,
}: {
  rate: ContractorRatePublic
  canUpdate: boolean
  canCreate?: boolean
  onAfterMutation?: () => void
}) {
  const stepIdx = rateStepperIndex(rate.status)
  const isTerminal = rate.status === "rejected" || rate.status === "cancelled"
  const canUploadOpeningDraft = canAppendOpeningEvidence(rate) && (canCreate || canUpdate)
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                <span className="font-mono text-sm">{rate.part_code ?? "—"}</span>
                <span className="text-muted-foreground"> · </span>
                {rate.part_name ?? "—"}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {rate.org_unit_name ?? "—"} · {(rate.pricing_method ?? "").replace(/_/g, " ")} ·{" "}
                {rate.unit_type ?? "—"}
              </p>
            </div>
            <Badge variant={rateStatusVariant(rate.status)}>{rateStatusLabel(rate.status)}</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* Stepper */}
          <ol className="flex items-center gap-1">
            {RATE_STEPPER_STEPS.map((step, i) => {
              const reached = !isTerminal && stepIdx >= i
              const current = !isTerminal && stepIdx === i
              const draftActive = current && step.key === "draft"
              return (
                <React.Fragment key={step.key}>
                  <li className="flex items-center gap-2">
                    <span
                      className={`grid size-6 place-items-center rounded-full text-xs font-semibold ring-2 ${
                        draftActive
                          ? "bg-sky-50 text-sky-700 ring-sky-200"
                          : reached
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                            : "bg-gray-50 text-gray-500 ring-gray-200"
                      }`}
                    >
                      {reached ? <CheckCircle2 className="size-3.5" /> : i + 1}
                    </span>
                    <span
                      className={`text-xs ${
                        draftActive
                          ? "font-semibold text-sky-800"
                          : current
                            ? "font-semibold text-foreground"
                            : "text-muted-foreground"
                      }`}
                    >
                      {step.label}
                    </span>
                  </li>
                  {i < RATE_STEPPER_STEPS.length - 1 ? (
                    <li
                      className={`mx-1 h-px flex-1 ${
                        reached ? "bg-emerald-200" : "bg-gray-200"
                      }`}
                    />
                  ) : null}
                </React.Fragment>
              )
            })}
            {isTerminal ? (
              <li className="ml-3 inline-flex">
                <Badge variant="error">{rate.status === "rejected" ? "Rejected" : "Cancelled"}</Badge>
              </li>
            ) : null}
          </ol>

          {/* Rate facts */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Fact label="Should cost" value={formatMoney(rate.base_rate)} />
            <Fact label="Initial ask" value={formatMoney(rate.initial_rate)} />
            <Fact label="Agreed rate" value={formatMoney(rate.negotiated_rate)} strong />
            <Fact
              label="Negotiated down by"
              value={
                rate.savings_amount !== null && Number(rate.savings_amount) > 0
                  ? `${formatMoney(rate.savings_amount)} (${formatPercent(rate.savings_percentage)})`
                  : "—"
              }
              strong
            />
            <Fact label="Effective from" value={rate.effective_from} />
            <Fact label="Effective to" value={rate.effective_to ?? "Open"} />
          </div>
          {/* <p className="text-xs text-muted-foreground">
            Work orders use each line&apos;s <strong>work date</strong>: an <strong>approved</strong> negotiated
            rate applies when that date falls between effective from and to (inclusive). Outside that window,
            Part Master pricing applies (or another non-overlapping approved rate that covers the date).
          </p> */}

          {/* Negotiation savings highlight (initial ask -> agreed). */}
          {/* {rate.savings_amount !== null && Number(rate.savings_amount) > 0 ? (
            <div className="rounded-lg border bg-emerald-50/60 p-3 text-sm text-emerald-800">
              Negotiated down by <strong>{formatMoney(rate.savings_amount)}</strong> (
              {formatPercent(rate.savings_percentage)}) from the contractor's opening ask of{" "}
              <strong>{formatMoney(rate.initial_rate)}</strong>.
            </div>
          ) : null} */}

          {rate.vs_base_percentage != null && rate.vs_base_percentage !== "" ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Tolerance</p>
              <VsBaseToleranceBadge
                negotiated={rate.negotiated_rate}
                baseRate={rate.base_rate}
                className="w-fit"
              />
            </div>
          ) : null}

          {canUploadOpeningDraft ? (
            <DraftOpeningEvidenceUploader rateId={rate.id} onUploaded={() => onAfterMutation?.()} />
          ) : null}

          {/* Negotiation rounds */}
          <div>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Negotiation rounds</h4>
              {canUpdate &&
              (rate.status === "draft" || rate.status === "approved" || rate.status === "rejected") ? (
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/dashboard/negotiated-rates/${rate.id}/negotiate`}>
                    <Plus className="size-3.5" /> Negotiate
                  </Link>
                </Button>
              ) : null}
            </div>
            {rate.rounds.length === 0 ? (
              <p className="mt-2 rounded-md border border-dashed bg-gray-50 p-3 text-xs text-muted-foreground">
                {rate.status === "draft"
                  ? "No rounds yet. Add opening evidence above (before submit), or use Negotiate to record a proposal or counter-offer."
                  : "No rounds yet. Add a counter-offer or proposal to start the discussion."}
              </p>
            ) : (
              <ol className="mt-2 space-y-2">
                {rate.rounds.map((rnd) => (
                  <li
                    key={rnd.id}
                    className="rounded-xl border bg-white p-3 text-sm shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
                          Round {rnd.round_number}
                        </span>
                        {rnd.proposed_rate !== null ? (
                          <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                            Proposed {formatMoney(rnd.proposed_rate)}
                          </span>
                        ) : null}
                        {rnd.counter_rate !== null ? (
                          <span className="rounded-md bg-sky-50 px-2 py-0.5 text-xs text-sky-700">
                            Counter {formatMoney(rnd.counter_rate)}
                          </span>
                        ) : null}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(rnd.created_at).toLocaleString()}
                      </span>
                    </div>
                    {rnd.remarks ? (
                      <p className="mt-1 text-muted-foreground">{rnd.remarks}</p>
                    ) : null}
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      by {rnd.created_by_name ?? "System"}
                    </div>
                    <NegotiationRoundAttachments
                      rateId={rate.id}
                      logId={rnd.id}
                      items={rnd.attachments ?? []}
                    />
                  </li>
                ))}
              </ol>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="self-start lg:sticky lg:top-4">
        <ContractorRateTimeline rateId={rate.id} refreshKey={rate.updated_at} />
      </div>
    </div>
  )
}


function Fact({
  label,
  value,
  strong,
}: {
  label: string
  value: React.ReactNode
  strong?: boolean
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 ${strong ? "text-base font-semibold text-foreground" : "text-sm"}`}>
        {value}
      </div>
    </div>
  )
}
