import * as React from "react"
import {
  BadgeIndianRupee,
  ClipboardList,
  Info,
  Package,
  Plus,
  Scale,
  Trash2,
  Users,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SectionHint } from "@/components/ui/section-hint"
import { getJson } from "@/lib/api"
import { cn } from "@/lib/utils"

const workOrderShellCardClass =
  "overflow-hidden rounded-[1.5rem] border border-zinc-200/80 bg-white/95 shadow-[0_20px_48px_-36px_rgba(15,23,42,0.32)]"

const workOrderFieldClass =
  "h-12 w-full rounded-xl border border-zinc-200 bg-white px-3.5 text-sm text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] outline-none transition focus-visible:border-emerald-400 focus-visible:ring-4 focus-visible:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-zinc-50/80 disabled:text-zinc-500"

const workOrderSelectClass = `${workOrderFieldClass} appearance-none`
const executionWeightHeaderHint = "Weight / Piece. Used only for weight-based per kg pricing."
const executionRateHeaderHint =
  "Resolved unit rate. Uses the approved negotiated rate for the pricing date; otherwise the Part Master list rate."
const executionTaxableHeaderHint =
  "Taxable formula: Qty × Rate. For weight-based pricing: Qty × Weight / Piece × Rate / Kg."
const executionRequiredStarClass =
  "ml-0.5 inline font-semibold text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.45)]"

export function formatWorkOrderDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))
  } catch {
    return iso
  }
}

/** Rate preview for a work order not yet saved (uses today). */
export function pricingDateForNewWorkOrder(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Negotiated-rate lookup date from work order creation timestamp. */
export function pricingDateFromCreatedAt(createdAt: string | null | undefined): string {
  if (!createdAt) return pricingDateForNewWorkOrder()
  return createdAt.slice(0, 10)
}

/** View-mode contractor callout under the execution sheet title. */
export function ExecutionSheetContractorBanner({ name }: { name: string | null | undefined }) {
  return (
    <div
      className="flex min-w-[18rem] items-center gap-3 rounded-[1.2rem] border border-emerald-100/90 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(240,253,250,0.92))] px-4 py-3 shadow-[0_14px_34px_-28px_rgba(5,150,105,0.55)] sm:min-w-[22rem] sm:px-5"
      role="group"
      aria-label="Contractor"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
        <Users className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Contractor</p>
        <p className="truncate text-[1.02rem] font-semibold leading-snug tracking-tight text-zinc-950 sm:text-[1.08rem]">
          {name?.trim() || "—"}
        </p>
      </div>
    </div>
  )
}

export type OrgUnitLite = { id: number; name: string }
export type ContractorLite = { id: number; name: string }

export type PartMasterLite = {
  id: number
  part_code: string
  part_name: string
  unit_type: string
  pricing_method: string
  rate_unit_type: string
  weight_per_piece: number | string | null
  base_rate: number | string
  org_unit_id: number
}

export type ExecutionDraftLine = {
  key: string
  part_master_id: string
  progress_type: "quantity" | "percentage"
  qty: string
  /** Line override for weight-based per-kg; falls back to Part Master when blank */
  weight_per_piece: string
  remarks: string
}

export type ExecutionDetailRow = {
  sr: number
  contractor_label: string
  job_label: string
  qty_display: string
  /** Line / per-piece weight when applicable; "—" if not shown. */
  weight_display: string
  /** Part unit of measure (e.g. kg, box). */
  unit_display: string
  rate_display: React.ReactNode
  invoice_display: React.ReactNode
  /** Optional inline completion editor/rendering for active work orders */
  completionCell?: React.ReactNode
}

export type WorkOrderLikeForLines = {
  contractor_id?: number
  items?: {
    id: number
    part_master_id: number
    progress_type: string
    planned_quantity: string | number | null
    planned_percentage: string | number | null
    weight_per_piece_snapshot?: string | number | null
    taxable_value?: string | number | null
    notes?: string | null
  }[]
}

export function flattenWorkOrderToDraftLines(row: WorkOrderLikeForLines): ExecutionDraftLine[] {
  const items = row.items
  if (!items?.length) return [newDraftLine()]
  return items.map((it) => {
    const pct = it.progress_type === "percentage"
    return {
      key: `i-${it.id}`,
      part_master_id: String(it.part_master_id),
      progress_type: pct ? "percentage" : "quantity",
      qty: pct
        ? it.planned_percentage != null && String(it.planned_percentage) !== ""
          ? String(it.planned_percentage)
          : ""
        : it.planned_quantity != null && String(it.planned_quantity) !== ""
          ? String(it.planned_quantity)
          : "",
      weight_per_piece:
        it.weight_per_piece_snapshot != null && String(it.weight_per_piece_snapshot) !== ""
          ? formatEditableWeightValue(it.weight_per_piece_snapshot)
          : "",
      remarks: it.notes?.trim() ? it.notes.trim() : "",
    }
  })
}

export function newDraftLine(): ExecutionDraftLine {
  return {
    key: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()),
    part_master_id: "",
    progress_type: "quantity",
    qty: "",
    weight_per_piece: "",
    remarks: "",
  }
}

export function partLabel(pm: PartMasterLite): string {
  return `${pm.part_code} — ${pm.part_name} (${pm.pricing_method}/${pm.rate_unit_type})`
}

export function filteredPartMasters(pms: PartMasterLite[], orgUnitId: string): PartMasterLite[] {
  if (!orgUnitId) return pms
  return pms.filter((pm) => String(pm.org_unit_id) === String(orgUnitId))
}

export function pickPartMaster(pms: PartMasterLite[], id: string | number | undefined): PartMasterLite | undefined {
  if (id === "" || id === undefined) return undefined
  return pms.find((r) => String(r.id) === String(id))
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function parseDecimal(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return NaN
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""))
  return n
}

function formatEditableWeightValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  const raw = String(value).trim()
  if (!raw) return ""
  const n = Number(raw.replace(/,/g, ""))
  if (!Number.isFinite(n)) return raw
  return n.toLocaleString(undefined, {
    useGrouping: false,
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })
}

function formatExecutionSummaryWeight(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0.000 kg"
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`
}

function formatExecutionSummaryQty(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0"
  const rounded = Math.round(value * 1000) / 1000
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded))
  return rounded.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })
}

function ExecutionMetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Package
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-4 rounded-[1.6rem] border border-emerald-100/70 bg-[linear-gradient(135deg,rgba(240,253,244,0.92),rgba(255,255,255,0.96))] px-5 py-5">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-zinc-500">{label}</p>
        <p className="mt-1 text-[1.65rem] font-semibold tracking-tight text-zinc-950">{value}</p>
      </div>
    </div>
  )
}

/** Compact qty / % (e.g. 1.000 → 1). */
export function formatExecutionQtyDisplay(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "—"
  const raw = String(v).trim()
  if (raw === "") return "—"
  const n = typeof v === "number" ? v : Number(raw.replace(/,/g, ""))
  if (!Number.isFinite(n)) return raw
  if (raw.includes("%")) return raw
  const t = Math.round(n * 10000) / 10000
  if (Math.abs(t - Math.round(t)) < 1e-9) return String(Math.round(t))
  return String(t).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
}

export function formatExecutionWeightKg(weightStr: string): string {
  const n = Number(String(weightStr).replace(/,/g, ""))
  if (!Number.isFinite(n)) return `${weightStr} kg`
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3, minimumFractionDigits: 0 })} kg`
}

/** Numeric weight only (no unit); pair with ``unit_display`` in the execution sheet. */
export function formatExecutionWeightAmount(weightStr: string): string {
  const raw = String(weightStr).trim()
  if (!raw) return "—"
  const n = Number(raw.replace(/,/g, ""))
  if (!Number.isFinite(n)) return raw
  return n.toLocaleString(undefined, { maximumFractionDigits: 3, minimumFractionDigits: 0 })
}

/** Human-readable rate / taxable basis (e.g. wt/kg). */
export function executionPricingBasisLabel(pricingMethod?: string | null, rateUnitType?: string | null): string {
  const pm = String(pricingMethod ?? "").trim().toLowerCase()
  const ru = String(rateUnitType ?? "").trim().toLowerCase()
  if (pm === "weight_based" && ru === "per_kg") return "wt/kg"
  if (pm === "piece_based" && ru === "per_box") return "pc/box"
  if (pm || ru) return [pm.replace(/_/g, " "), ru.replace(/_/g, " ")].filter(Boolean).join(" · ")
  return ""
}

export function executionRateSourceLabel(raw: string): string {
  const s = String(raw ?? "").trim().toLowerCase()
  if (s === "master" || s === "part_master") return "list"
  if (s === "negotiated" || s === "contractor") return "negotiated"
  return String(raw ?? "").trim() || "—"
}

export function ExecutionTableHeaderLabel({
  label,
  hint,
  align = "left",
  icon: Icon,
  showRequired = false,
}: {
  label: string
  hint?: string | null
  align?: "left" | "right" | "center"
  icon?: React.ComponentType<{ className?: string }>
  showRequired?: boolean
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5",
        align === "right" && "justify-end",
        align === "center" && "justify-center",
      )}
    >
      {Icon ? <Icon className="size-[0.95rem] shrink-0 text-zinc-500" /> : null}
      <span>
        {label}
        {showRequired ? (
          <span className={executionRequiredStarClass} aria-hidden>
            *
          </span>
        ) : null}
      </span>
      {hint ? <SectionHint text={hint} /> : null}
    </span>
  )
}

/** Value-only rate cell; details live in the header hint. */
export function executionDetailRateCell(args: {
  rateMoney: string
  rateSource: string
  pricingMethod?: string | null
  rateUnitType?: string | null
}): React.ReactNode {
  return (
    <div className="ml-auto block w-full max-w-full text-right align-middle leading-tight">
      <div className="tabular-nums text-[1.05rem] font-semibold tracking-tight text-zinc-950">{args.rateMoney}</div>
    </div>
  )
}

/** Value-only taxable cell; details live in the header hint. */
export function executionDetailTaxableCell(args: {
  money: string
  rateSource: string
  pricingMethod?: string | null
  rateUnitType?: string | null
  calculationBreakdown?: Record<string, unknown> | null
}): React.ReactNode {
  return (
    <div className="ml-auto block w-full max-w-full text-right align-middle leading-tight">
      <div className="tabular-nums text-[1.05rem] font-semibold tracking-tight text-zinc-950">{args.money}</div>
    </div>
  )
}

export function WorkOrderExecutionHeader(props: {
  loading: boolean
  editable: boolean
  title: string
  reference: string
  org_unit_id: string
  plants: OrgUnitLite[]
  onTitle: (v: string) => void
  onReference: (v: string) => void
  onOrgUnit: (v: string) => void
  /** Detail-only: overrides plant dropdown */
  plantLabel?: string
}) {
  const {
    loading,
    editable,
    title,
    reference,
    org_unit_id,
    plants,
    onTitle,
    onReference,
    onOrgUnit,
    plantLabel,
  } = props

  return (
    <Card className={workOrderShellCardClass}>
      <CardContent className="grid gap-4 px-5 py-5 md:grid-cols-2 xl:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="wo-title" showRequired={editable} className="text-sm font-semibold text-zinc-900">
            Title
          </Label>
          <Input
            id="wo-title"
            className={workOrderFieldClass}
            placeholder="Enter work order title"
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            disabled={loading || !editable}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="wo-reference" className="text-sm font-semibold text-zinc-900">
            Reference (optional)
          </Label>
          <Input
            id="wo-reference"
            className={workOrderFieldClass}
            placeholder="Internal ref / PO"
            value={reference}
            onChange={(e) => onReference(e.target.value)}
            disabled={loading || !editable}
          />
        </div>
        <div className="grid gap-2">
          <Label
            htmlFor="wo-plant"
            showRequired={editable && plantLabel === undefined}
            className="text-sm font-semibold text-zinc-900"
          >
            Plant
          </Label>
          {plantLabel !== undefined ? (
            <div className={cn(workOrderFieldClass, "flex items-center text-zinc-600")}>{plantLabel || "—"}</div>
          ) : (
            <select
              id="wo-plant"
              className={workOrderSelectClass}
              value={org_unit_id}
              onChange={(e) => onOrgUnit(e.target.value)}
              disabled={loading || !editable}
            >
              <option value="">Select plant…</option>
              {plants.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}ƒ
                </option>
              ))}
            </select>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function needsWeightPerPiece(pm: PartMasterLite | undefined): boolean {
  if (!pm) return false
  return String(pm.pricing_method ?? "").toLowerCase() === "weight_based" && String(pm.rate_unit_type ?? "").toLowerCase() === "per_kg"
}

function estimateLineAmount(
  line: ExecutionDraftLine,
  pm: PartMasterLite | undefined,
  resolvedRate?: number,
): number {
  if (!pm || line.progress_type !== "quantity") return NaN
  const qtyN = parseDecimal(line.qty)
  const rateN =
    resolvedRate != null && Number.isFinite(resolvedRate) ? resolvedRate : parseDecimal(pm.base_rate)
  if (!Number.isFinite(qtyN) || !Number.isFinite(rateN)) return NaN
  if (needsWeightPerPiece(pm)) {
    const wstr =
      line.weight_per_piece.trim() ||
      (pm.weight_per_piece != null && String(pm.weight_per_piece).trim() !== "" ? String(pm.weight_per_piece) : "")
    const wN = parseDecimal(wstr)
    if (!Number.isFinite(wN)) return NaN
    return qtyN * wN * rateN
  }
  return qtyN * rateN
}

export function WorkOrderExecutionTable(props: {
  mode: "edit" | "view"
  loading: boolean
  org_unit_id: string
  contractors: ContractorLite[]
  partMasters: PartMasterLite[]
  contractorId: string
  onContractorId: (v: string) => void
  lines: ExecutionDraftLine[]
  onLinesChange: (lines: ExecutionDraftLine[]) => void
  detailRows?: ExecutionDetailRow[]
  contractorSummaryLabel?: string
  /** ISO YYYY-MM-DD; in edit mode, Rate / Taxable preview uses the same resolution as save (negotiated window vs Part Master). */
  pricingWorkDate?: string
}) {
  const {
    mode,
    loading,
    org_unit_id,
    contractors,
    partMasters,
    contractorId,
    onContractorId,
    lines,
    onLinesChange,
    detailRows,
    contractorSummaryLabel,
    pricingWorkDate,
  } = props
  const pms = filteredPartMasters(partMasters, org_unit_id)
  const isEdit = mode === "edit"
  const [ratePreviewByPartId, setRatePreviewByPartId] = React.useState<
    Record<string, { resolved_rate: number; rate_source: string }>
  >({})

  const sortedPartIdsKey = React.useMemo(
    () =>
      [...new Set(lines.map((l) => l.part_master_id).filter(Boolean))]
        .sort()
        .join("\u001e"),
    [lines],
  )

  React.useEffect(() => {
    const valid =
      isEdit && Boolean(contractorId) && Boolean(pricingWorkDate?.trim()) && Boolean(sortedPartIdsKey)
    if (valid) return
    let cancelled = false
    const tid = window.setTimeout(() => {
      if (!cancelled) setRatePreviewByPartId({})
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(tid)
    }
  }, [isEdit, contractorId, pricingWorkDate, sortedPartIdsKey])

  React.useEffect(() => {
    if (!isEdit || !contractorId || !pricingWorkDate?.trim()) return
    const ids = sortedPartIdsKey.split("\u001e").filter(Boolean)
    if (ids.length === 0) return
    let cancelled = false
    const tid = window.setTimeout(() => {
      void (async () => {
        const next: Record<string, { resolved_rate: number; rate_source: string }> = {}
        await Promise.all(
          ids.map(async (pid) => {
            try {
              const qs = new URLSearchParams({
                contractor_id: contractorId,
                part_master_id: pid,
                pricing_date: pricingWorkDate.trim(),
              })
              const r = await getJson<{ resolved_rate: string | number; rate_source: string }>(
                `/work-orders/rate-preview?${qs.toString()}`,
              )
              const rateN = parseDecimal(r.resolved_rate)
              if (Number.isFinite(rateN)) {
                next[pid] = { resolved_rate: rateN, rate_source: r.rate_source }
              }
            } catch {
              // Missing key → fall back to Part Master base_rate in the row renderer.
            }
          }),
        )
        if (!cancelled) setRatePreviewByPartId(next)
      })()
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(tid)
    }
  }, [isEdit, contractorId, pricingWorkDate, sortedPartIdsKey])

  function updateLine(key: string, patch: Partial<ExecutionDraftLine>) {
    onLinesChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function removeLine(key: string) {
    onLinesChange(lines.filter((l) => l.key !== key))
  }

  const editSummary = React.useMemo(() => {
    let totalQty = 0
    let totalWeight = 0
    let totalTaxable = 0

    for (const line of lines) {
      const pm = pickPartMaster(pms, line.part_master_id)
      const qtyN = parseDecimal(line.qty)
      if (Number.isFinite(qtyN) && qtyN > 0) totalQty += qtyN

      if (needsWeightPerPiece(pm)) {
        const weightValue =
          line.weight_per_piece.trim() ||
          (pm?.weight_per_piece != null && String(pm.weight_per_piece).trim() !== ""
            ? String(pm.weight_per_piece).trim()
            : "")
        const weightN = parseDecimal(weightValue)
        if (Number.isFinite(weightN) && weightN > 0) totalWeight += weightN
      }

      const resolvedForLine = line.part_master_id ? ratePreviewByPartId[line.part_master_id]?.resolved_rate : undefined
      const taxable = estimateLineAmount(line, pm, resolvedForLine)
      if (Number.isFinite(taxable) && taxable > 0) totalTaxable += taxable
    }

    return { totalQty, totalWeight, totalTaxable }
  }, [lines, pms, ratePreviewByPartId])

  if (isEdit) {
    return (
      <Card
        className={cn(
          workOrderShellCardClass,
          "bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.08),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(249,250,251,0.94))]",
        )}
      >
        <CardHeader className="px-5 pt-5 pb-0">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
                <ClipboardList className="size-6" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-[1.55rem] font-bold tracking-tight text-zinc-950">Execution Sheet</CardTitle>
                {/* <CardDescription className="mt-1.5 max-w-3xl text-sm leading-6 text-zinc-500">
                  One contractor per work order. Lines are Part Master parts; unit rate and taxable value resolve from
                  negotiated rates or Part Master base. Weight is required only for weight-based per-kg pricing.
                </CardDescription> */}
              </div>
            </div>

            <div className="grid max-w-xl gap-2">
              <Label showRequired className="text-sm font-semibold text-zinc-900">
                Contractor
              </Label>
              <select
                className={workOrderSelectClass}
                value={contractorId}
                onChange={(e) => onContractorId(e.target.value)}
                disabled={loading || !org_unit_id}
              >
                <option value="">Select contractor…</option>
                {contractors.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-5 pb-5 pt-5">
          <div className="h-px bg-gradient-to-r from-zinc-200 via-zinc-200 to-transparent" />

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-[1.3rem] font-bold tracking-tight text-zinc-950">Part Lines</h3>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-xl border-emerald-200 bg-white px-4 text-sm text-emerald-700 shadow-sm hover:bg-emerald-50"
              disabled={loading}
              onClick={() => onLinesChange([...lines, newDraftLine()])}
            >
              <Plus className="size-4" />
              Add Part Line
            </Button>
          </div>

          <div className="mt-4 overflow-hidden rounded-[1.2rem] border border-zinc-200 bg-white shadow-[0_12px_24px_-20px_rgba(15,23,42,0.35)]">
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="bg-zinc-50/85">
                    <th className="border-b border-zinc-200 px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                      SR
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                      Part Code
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                      Part Name
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3 text-center text-sm font-semibold text-zinc-700">
                      <ExecutionTableHeaderLabel label="Qty" align="center" showRequired />
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3 text-center text-sm font-semibold text-zinc-700">
                      <ExecutionTableHeaderLabel label="Weight" hint={executionWeightHeaderHint} align="center" />
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3 text-center text-sm font-semibold text-zinc-700">
                      UOM
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                      <ExecutionTableHeaderLabel label="Rate" hint={executionRateHeaderHint} align="right" />
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                      <ExecutionTableHeaderLabel
                        label="Taxable Value"
                        hint={executionTaxableHeaderHint}
                        align="right"
                      />
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3 text-center text-sm font-semibold text-zinc-700">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => {
                    const pm = pickPartMaster(pms, line.part_master_id)
                    const showWt = needsWeightPerPiece(pm)
                    const preview = line.part_master_id ? ratePreviewByPartId[line.part_master_id] : undefined
                    const resolvedForLine = preview?.resolved_rate
                    const invN = estimateLineAmount(line, pm, resolvedForLine)
                    const invShown = Number.isFinite(invN) ? fmtMoney(invN) : "0.00"
                    const unitShown = pm?.unit_type ?? "—"
                    const baseN = pm ? parseDecimal(pm.base_rate) : NaN
                    const rateN =
                      resolvedForLine != null && Number.isFinite(resolvedForLine) ? resolvedForLine : baseN
                    const rateShown = pm && Number.isFinite(rateN) ? fmtMoney(rateN) : "—"

                    return (
                      <tr key={line.key} className="transition-colors hover:bg-emerald-50/35">
                        <td className="border-b border-zinc-100 px-4 py-3 align-middle text-sm font-medium text-zinc-600">
                          {idx + 1}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-3 align-middle text-sm font-medium text-zinc-800">
                          {pm?.part_code ?? "—"}
                        </td>
                        <td className="min-w-[18rem] border-b border-zinc-100 px-4 py-3 align-middle">
                          <select
                            className={cn(workOrderSelectClass, "h-10 rounded-lg px-3")}
                            value={line.part_master_id}
                            onChange={(e) => {
                              const v = e.target.value
                              const nextPm = pickPartMaster(pms, v)
                              const nextNeedsWt = needsWeightPerPiece(nextPm)
                              const wFromPm =
                                nextPm &&
                                nextPm.weight_per_piece != null &&
                                String(nextPm.weight_per_piece).trim() !== ""
                                  ? String(nextPm.weight_per_piece).trim()
                                  : ""
                              updateLine(line.key, {
                                part_master_id: v,
                                weight_per_piece: nextNeedsWt ? formatEditableWeightValue(wFromPm) : "",
                              })
                            }}
                            disabled={loading || !org_unit_id}
                          >
                            <option value="">Select part…</option>
                            {pms.map((r) => (
                              <option key={r.id} value={String(r.id)}>
                                {r.part_name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-3 align-middle">
                          <Input
                            className="h-10 rounded-lg border-zinc-200 text-center text-sm tabular-nums"
                            inputMode="decimal"
                            placeholder={line.progress_type === "percentage" ? "%" : "0"}
                            value={line.qty}
                            onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                            disabled={loading}
                          />
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-3 align-middle">
                          {showWt ? (
                            <Input
                              className="h-10 rounded-lg border-zinc-200 text-center text-sm tabular-nums"
                              inputMode="decimal"
                              placeholder={pm?.weight_per_piece != null ? formatEditableWeightValue(pm.weight_per_piece) : "0.000"}
                              value={line.weight_per_piece}
                              onChange={(e) => updateLine(line.key, { weight_per_piece: e.target.value })}
                              onBlur={() =>
                                updateLine(line.key, {
                                  weight_per_piece: formatEditableWeightValue(line.weight_per_piece),
                                })
                              }
                              disabled={loading}
                            />
                          ) : (
                            <div className="flex h-10 items-center justify-center rounded-lg border border-zinc-100 bg-zinc-50/60 text-sm text-zinc-400">
                              —
                            </div>
                          )}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-3 text-center align-middle text-sm text-zinc-700">
                          {unitShown}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-3 text-right align-middle text-sm font-medium tabular-nums text-zinc-800">
                          {rateShown}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-3 text-right align-middle text-sm font-medium tabular-nums text-zinc-900">
                          {invShown}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-3 text-center align-middle">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            className="rounded-xl border-zinc-200 text-red-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                            onClick={() => removeLine(line.key)}
                            disabled={loading || lines.length <= 1}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            <ExecutionMetricCard
              icon={Package}
              label="Total Quantity"
              value={formatExecutionSummaryQty(editSummary.totalQty)}
            />
            <ExecutionMetricCard
              icon={Scale}
              label="Total Weight"
              value={formatExecutionSummaryWeight(editSummary.totalWeight)}
            />
            <ExecutionMetricCard
              icon={BadgeIndianRupee}
              label="Total Taxable Value"
              value={fmtMoney(editSummary.totalTaxable)}
            />
          </div>
        </CardContent>
      </Card>
    )
  }

  const hasCompletion = (detailRows ?? []).some((r) => Boolean(r.completionCell))
  const hideContractorColumn = contractorSummaryLabel !== undefined
  const viewColCount = (hideContractorColumn ? 0 : 1) + 7 + (hasCompletion ? 1 : 0)
  const th =
    "whitespace-nowrap border-b border-emerald-100/80 px-3.5 py-3.5 text-left align-middle text-[0.9rem] font-semibold tracking-tight text-zinc-950"
  const viewMinWidth = hasCompletion ? "min-w-[60rem]" : "min-w-[50rem]"

  return (
    <Card className={workOrderShellCardClass}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0 px-5 pb-0 pt-5 sm:px-6 sm:pt-6">
        <div className="min-w-0 flex-1">
          <CardTitle className="text-[1.25rem] font-bold tracking-tight text-zinc-950 sm:text-[1.35rem]">
            Execution Sheet
          </CardTitle>
          {contractorSummaryLabel === undefined ? (
            <CardDescription className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
              One contractor per work order. Lines are Part Master parts; unit rate and taxable value resolve from
              negotiated rates (or Part Master base). Weight is required only for weight-based per-kg pricing.
            </CardDescription>
          ) : null}
        </div>
        {contractorSummaryLabel !== undefined ? (
          <ExecutionSheetContractorBanner name={contractorSummaryLabel} />
        ) : null}
      </CardHeader>
      <CardContent className="overflow-x-auto px-5 pb-5 pt-5 sm:px-6 sm:pb-6 [&_[data-slot=exec-scroll]]:px-0">
        <div
          data-slot="exec-scroll"
          className="relative w-full max-h-[min(72vh,880px)] overflow-x-auto overflow-y-auto rounded-[1.55rem] border border-emerald-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(250,250,250,0.97))] shadow-[0_20px_44px_-34px_rgba(15,23,42,0.28)]"
        >
          <table className={cn("w-full table-fixed border-separate border-spacing-0 text-sm align-middle", viewMinWidth)}>
            <thead className="sticky top-0 z-20 bg-[linear-gradient(135deg,rgba(240,253,250,0.98),rgba(255,255,255,0.97),rgba(236,253,245,0.96))] backdrop-blur-sm supports-[backdrop-filter]:bg-emerald-50/90">
              <tr>
                <th className={cn(th, "w-16 text-center")}>
                  <ExecutionTableHeaderLabel label="SR" align="center" />
                </th>
                {hideContractorColumn ? null : (
                  <th className={cn(th, "w-52 truncate")}>Contractor</th>
                )}
                <th className={cn(th, "w-[10rem]")}>
                  <ExecutionTableHeaderLabel label="Part" />
                </th>
                <th className={cn(th, "w-20 text-center tabular-nums")}>
                  <ExecutionTableHeaderLabel label="Qty" align="center" />
                </th>
                <th className={cn(th, "w-28 text-center tabular-nums")}>
                  <ExecutionTableHeaderLabel label="Weight (kg)" hint={executionWeightHeaderHint} align="center" />
                </th>
                <th className={cn(th, "w-20 text-center")}>
                  <ExecutionTableHeaderLabel label="Unit" align="center" />
                </th>
                <th className={cn(th, "w-28 text-right tabular-nums")}>
                  <ExecutionTableHeaderLabel label="Rate (₹)" hint={executionRateHeaderHint} align="right" />
                </th>
                <th className={cn(th, "w-32 text-right tabular-nums")}>
                  <ExecutionTableHeaderLabel label="Taxable (₹)" hint={executionTaxableHeaderHint} align="right" />
                </th>
                {hasCompletion ? (
                  <th className={cn(th, "w-[14.5rem] text-center")}>
                    Completion
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="[&_tr:last-child_td]:border-b-0">
              {(detailRows?.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={viewColCount} className="px-6 py-12 text-center text-sm text-zinc-500">
                    No execution lines on this work order.
                  </td>
                </tr>
              ) : null}
              {(detailRows ?? []).map((dr) => (
                <React.Fragment key={dr.sr}>
                  <tr
                    className={cn(
                      "bg-white transition-colors hover:bg-emerald-50/35",
                      "has-[[data-completion-dirty='true']]:bg-amber-500/[0.06] has-[[data-completion-dirty='true']]:ring-1 has-[[data-completion-dirty='true']]:ring-inset has-[[data-completion-dirty='true']]:ring-amber-400/35",
                    )}
                  >
                    <td className="border-b border-zinc-200/80 px-3.5 py-4 text-center align-middle tabular-nums text-[0.98rem] font-medium text-zinc-700">
                      {dr.sr}
                    </td>
                    {hideContractorColumn ? null : (
                      <td
                        className="min-w-0 truncate border-b border-zinc-200/80 px-3.5 py-4 align-middle text-[0.98rem] font-medium text-zinc-800"
                        title={dr.contractor_label}
                      >
                        {dr.contractor_label}
                      </td>
                    )}
                    <td
                      className="min-w-0 max-w-full truncate border-b border-zinc-200/80 px-3.5 py-4 align-middle text-[1rem] font-semibold tracking-tight text-zinc-950"
                      title={dr.job_label}
                    >
                      {dr.job_label}
                    </td>
                    <td className="border-b border-zinc-200/80 px-3.5 py-4 text-center align-middle text-[1rem] tabular-nums font-semibold text-zinc-950">
                      {dr.qty_display}
                    </td>
                    <td className="border-b border-zinc-200/80 px-3.5 py-4 text-center align-middle text-[1rem] tabular-nums text-zinc-700">
                      {dr.weight_display}
                    </td>
                    <td className="border-b border-zinc-200/80 px-3.5 py-4 text-center align-middle text-[1rem] font-medium text-zinc-800">
                      {dr.unit_display}
                    </td>
                    <td className="border-b border-zinc-200/80 px-3.5 py-4 align-middle text-right text-xs">
                      {dr.rate_display}
                    </td>
                    <td className="border-b border-zinc-200/80 px-3.5 py-4 align-middle text-right text-xs tabular-nums">
                      {dr.invoice_display}
                    </td>
                    {hasCompletion ? (
                      <td className="min-w-0 border-b border-zinc-200/80 px-3 py-4 align-middle">
                        <div className="flex justify-end">{dr.completionCell ?? null}</div>
                      </td>
                    ) : null}
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

export function WorkOrderExecutionFooter(props: {
  busy: boolean
  showSave?: boolean
  showSubmit: boolean
  submitLabel?: string
  saveLabel?: string
  tip?: string | null
  onCancel?: () => void
  onSave?: () => void
  onSubmitApproval?: () => void
}) {
  const {
    busy,
    showSave = true,
    showSubmit,
    submitLabel = "Activate",
    saveLabel = "Save",
    tip = "Tip: Choose the contractor once, then add part lines. Taxable value uses negotiated rate when approved, else Part Master base.",
    onCancel,
    onSave,
    onSubmitApproval,
  } = props

  return (
    <Card className={workOrderShellCardClass}>
      <CardContent className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
        {tip ? (
          <div className="flex max-w-3xl items-start gap-3">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
              <Info className="size-4" />
            </div>
            <p className="text-sm leading-6 text-zinc-500">{tip}</p>
          </div>
        ) : (
          <div />
        )}
        <div className="flex flex-wrap items-center gap-3">
          {onCancel ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 min-w-[9rem] rounded-xl border-zinc-200 bg-white px-5"
              disabled={busy}
              onClick={() => onCancel()}
            >
              Cancel
            </Button>
          ) : null}
          {showSave ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 min-w-[10rem] rounded-xl border-emerald-200 bg-emerald-50/70 px-5 text-emerald-700 hover:bg-emerald-100"
              disabled={busy}
              onClick={() => onSave?.()}
            >
              {busy ? "Saving…" : saveLabel}
            </Button>
          ) : null}
          {showSubmit ? (
            <Button
              type="button"
              className="h-11 min-w-[12rem] rounded-xl bg-emerald-600 px-6 shadow-[0_20px_40px_-20px_rgba(5,150,105,0.7)] hover:bg-emerald-700"
              disabled={busy}
              onClick={() => onSubmitApproval?.()}
            >
              {busy ? "Working…" : submitLabel}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

export type WorkOrderItemApiPayload = {
  part_master_id: number
  progress_type: "quantity" | "percentage"
  planned_quantity: string | null
  planned_percentage: string | null
  weight_per_piece?: string
  notes: string | null
}

export function buildWorkOrderLinesForApi(
  contractorId: string,
  lines: ExecutionDraftLine[],
  partMasters: PartMasterLite[],
): { ok: true; contractor_id: number; items: WorkOrderItemApiPayload[] } | { ok: false; error: string } {
  if (!contractorId.trim()) return { ok: false, error: "Contractor is required." }
  const cid = Number(contractorId)
  if (!Number.isFinite(cid) || cid <= 0) return { ok: false, error: "Select a valid contractor." }

  const usable = lines.filter((l) => l.part_master_id.trim())
  if (usable.length === 0) return { ok: false, error: "Add at least one line with a part selected." }

  const items: WorkOrderItemApiPayload[] = []
  for (const x of usable) {
    const pt = x.progress_type === "percentage" ? "percentage" : "quantity"
    const pm = pickPartMaster(partMasters, x.part_master_id)
    const qtyValue = x.qty.trim()
    if (!qtyValue) {
      return {
        ok: false,
        error: pt === "percentage" ? "Percentage is required for each selected line." : "Quantity is required for each selected line.",
      }
    }
    const row: WorkOrderItemApiPayload = {
      part_master_id: Number(x.part_master_id),
      progress_type: pt,
      planned_quantity: pt === "quantity" ? qtyValue : null,
      planned_percentage: pt === "percentage" ? qtyValue : null,
      notes: x.remarks.trim() || null,
    }
    if (needsWeightPerPiece(pm)) {
      const w =
        x.weight_per_piece.trim() ||
        (pm?.weight_per_piece != null && String(pm.weight_per_piece).trim() !== "" ? String(pm.weight_per_piece).trim() : "")
      if (!w) return { ok: false, error: "Weight per piece is required for weight-based (per kg) parts." }
      row.weight_per_piece = w
    }
    items.push(row)
  }
  return { ok: true, contractor_id: cid, items }
}
