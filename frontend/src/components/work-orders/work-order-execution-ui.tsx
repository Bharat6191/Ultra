import * as React from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

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
  /** Weight + unit of measure in one column (e.g. "4,245 kg" or "box"). */
  unit_profile_display: string
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
          ? String(it.weight_per_piece_snapshot)
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

function breakdownFormulaHint(breakdown: Record<string, unknown> | null | undefined): string | null {
  if (!breakdown) return null
  const f = breakdown.formula
  if (typeof f !== "string" || !f.trim()) return null
  return f.trim().replace(/\s+/g, " ")
}

/** Stacked rate: bold amount + muted basis line (enterprise table style). */
export function executionDetailRateCell(args: {
  rateMoney: string
  rateSource: string
  pricingMethod?: string | null
  rateUnitType?: string | null
}): React.ReactNode {
  const pricing = executionPricingBasisLabel(args.pricingMethod, args.rateUnitType)
  const src = executionRateSourceLabel(args.rateSource)
  const sub = [pricing || null, src].filter(Boolean).join(" · ")
  const full = sub || args.rateSource
  return (
    <div className="ml-auto block w-full max-w-full text-right align-middle leading-tight">
      <div className="tabular-nums text-sm font-semibold text-foreground">{args.rateMoney}</div>
      {sub ? (
        <div className="truncate text-[10px] leading-snug text-muted-foreground" title={full}>
          {sub}
        </div>
      ) : null}
    </div>
  )
}

/** Stacked taxable: bold amount + muted calculation / source line. */
export function executionDetailTaxableCell(args: {
  money: string
  rateSource: string
  pricingMethod?: string | null
  rateUnitType?: string | null
  calculationBreakdown?: Record<string, unknown> | null
}): React.ReactNode {
  const formula = breakdownFormulaHint(args.calculationBreakdown ?? null)
  const basis = formula ?? executionPricingBasisLabel(args.pricingMethod, args.rateUnitType)
  const src = executionRateSourceLabel(args.rateSource)
  const sub = [basis || null, src].filter(Boolean).join(" · ")
  const full = sub || src
  return (
    <div className="ml-auto block w-full max-w-full text-right align-middle leading-tight">
      <div className="tabular-nums text-sm font-semibold text-foreground">{args.money}</div>
      {sub ? (
        <div className="line-clamp-2 text-[10px] leading-snug text-muted-foreground" title={full}>
          {sub}
        </div>
      ) : null}
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
  /** ISO date (yyyy-mm-dd). When set, the field is shown; editable only with ``onWorkDate``. */
  work_date?: string
  onWorkDate?: (v: string) => void
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
    work_date,
    onWorkDate,
    plantLabel,
  } = props

  const selectCls =
    "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"

  const showWorkDate = work_date !== undefined
  const workDateEditable = Boolean(editable && onWorkDate)

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <div className="grid gap-1.5">
        <Label htmlFor="wo-title">Title</Label>
        <Input
          id="wo-title"
          placeholder="e.g. Site welding package Q2"
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          disabled={loading || !editable}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="wo-reference">Reference (optional)</Label>
        <Input
          id="wo-reference"
          placeholder="Internal ref / PO"
          value={reference}
          onChange={(e) => onReference(e.target.value)}
          disabled={loading || !editable}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="wo-plant">Plant</Label>
        {plantLabel !== undefined ? (
          <div className={cn(selectCls, "flex h-10 items-center text-muted-foreground")}>{plantLabel || "—"}</div>
        ) : (
          <select id="wo-plant" className={selectCls} value={org_unit_id} onChange={(e) => onOrgUnit(e.target.value)} disabled={loading || !editable}>
            <option value="">Select plant…</option>
            {plants.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {showWorkDate ? (
        <div className="grid gap-1.5">
          <Label htmlFor="wo-work-date">Work date (rate pricing)</Label>
          {workDateEditable ? (
            <Input
              id="wo-work-date"
              type="date"
              value={work_date}
              onChange={(e) => onWorkDate?.(e.target.value)}
              disabled={loading}
              className={selectCls}
            />
          ) : (
            <div className={cn(selectCls, "flex h-10 items-center text-muted-foreground tabular-nums")}>
              {work_date || "—"}
            </div>
          )}
          {workDateEditable ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              Line rates use the <strong>approved</strong> negotiated rate whose effective window contains this date;
              otherwise Part Master applies.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function needsWeightPerPiece(pm: PartMasterLite | undefined): boolean {
  if (!pm) return false
  return String(pm.pricing_method ?? "").toLowerCase() === "weight_based" && String(pm.rate_unit_type ?? "").toLowerCase() === "per_kg"
}

function estimateLineAmount(line: ExecutionDraftLine, pm: PartMasterLite | undefined): number {
  if (!pm || line.progress_type !== "quantity") return NaN
  const qtyN = parseDecimal(line.qty)
  const rateN = parseDecimal(pm.base_rate)
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
  } = props
  const pms = filteredPartMasters(partMasters, org_unit_id)
  const isEdit = mode === "edit"
  const hasCompletion = !isEdit && (detailRows ?? []).some((r) => Boolean(r.completionCell))
  const hideContractorColumn = !isEdit && contractorSummaryLabel !== undefined
  const viewTableFixed = !isEdit && hasCompletion
  /** View: SR, [Contractor], Part, Qty, Unit (merged), Rate, Taxable, [Completion] */
  const viewColCount = (hideContractorColumn ? 0 : !isEdit ? 1 : 0) + 6 + (hasCompletion ? 1 : 0)

  function updateLine(key: string, patch: Partial<ExecutionDraftLine>) {
    onLinesChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function removeLine(key: string) {
    onLinesChange(lines.filter((l) => l.key !== key))
  }

  const th = "whitespace-nowrap px-2 py-2 text-left align-middle text-[11px] font-medium uppercase tracking-wide text-muted-foreground"

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-4">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold tracking-tight">Execution sheet</CardTitle>
          <CardDescription>
            {isEdit ? (
              <>
                One contractor per work order. Lines are Part Master parts; unit rate and taxable value resolve from
                negotiated rates (or Part Master base). Weight is required only for weight-based per-kg pricing.
              </>
            ) : contractorSummaryLabel !== undefined ? (
              <>
                <span className="font-medium text-foreground">{contractorSummaryLabel || "—"}</span>
                {/* <span className="text-muted-foreground"> · </span> */}
                {/* <span>Negotiated or list rates and taxable values follow the saved snapshot.</span> */}
              </>
            ) : (
              <>
                One contractor per work order. Lines are Part Master parts; unit rate and taxable value resolve from
                negotiated rates (or Part Master base). Weight is required only for weight-based per-kg pricing.
              </>
            )}
          </CardDescription>
        </div>
        {isEdit ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => onLinesChange([...lines, newDraftLine()])}
          >
            + Add line
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="overflow-x-auto p-0 px-px pb-4 sm:p-6 sm:pt-0 [&_[data-slot=exec-scroll]]:px-4 sm:[&_[data-slot=exec-scroll]]:px-0">
        {isEdit ? (
          <div className="grid max-w-md gap-1.5 border-b px-4 py-4 sm:px-6">
            <Label>Contractor</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
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
        ) : null}
        <div
          data-slot="exec-scroll"
          className="relative w-full max-h-[min(72vh,880px)] overflow-x-auto overflow-y-auto rounded-lg border border-border/50 bg-card"
        >
          <table
            className={cn(
              "w-full border-collapse text-sm align-middle",
              isEdit || viewTableFixed ? "table-fixed" : "table-auto",
            )}
          >
            <thead className="sticky top-0 z-20 border-b border-border/60 bg-muted/95 shadow-[0_1px_0_0_hsl(var(--border)/0.6)] backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80">
              <tr>
                <th
                  className={cn(
                    th,
                    isEdit ? "w-8 tabular-nums" : viewTableFixed ? (hideContractorColumn ? "w-[4%] tabular-nums" : "w-[3%] tabular-nums") : "tabular-nums",
                  )}
                >
                  SR
                </th>
                {isEdit || hideContractorColumn ? null : (
                  <th className={cn(th, viewTableFixed ? "w-[11%] truncate" : "max-w-[8rem] truncate")}>Contractor</th>
                )}
                <th
                  className={cn(
                    th,
                    isEdit
                      ? "min-w-0 w-[52%]"
                      : viewTableFixed
                        ? hideContractorColumn
                          ? "w-[16%] min-w-0 truncate"
                          : "w-[12%] min-w-0 truncate"
                        : "min-w-[8rem] max-w-[14rem] truncate",
                  )}
                >
                  Part
                </th>
                <th
                  className={cn(
                    th,
                    isEdit
                      ? "w-12 text-right tabular-nums"
                      : viewTableFixed
                        ? hideContractorColumn
                          ? "w-[6%] text-right tabular-nums"
                          : "w-[5%] text-right tabular-nums"
                        : "text-right tabular-nums",
                  )}
                >
                  Qty
                </th>
                {isEdit ? (
                  <>
                    <th className={cn(th, "w-16")}>Wt / pc</th>
                    <th className={cn(th, "w-12")}>Unit</th>
                  </>
                ) : (
                  <th
                    className={cn(
                      th,
                      viewTableFixed
                        ? hideContractorColumn
                          ? "w-[8%] text-right tabular-nums"
                          : "w-[7%] text-right tabular-nums"
                        : "text-right tabular-nums",
                    )}
                  >
                    Wt / unit
                  </th>
                )}
                <th
                  className={cn(
                    th,
                    isEdit
                      ? "w-20 text-right tabular-nums"
                      : viewTableFixed
                        ? hideContractorColumn
                          ? "w-[11%] text-right tabular-nums"
                          : "w-[10%] text-right tabular-nums"
                        : "text-right tabular-nums",
                  )}
                >
                  Rate
                </th>
                <th
                  className={cn(
                    th,
                    isEdit
                      ? "w-24 text-right tabular-nums"
                      : viewTableFixed
                        ? hideContractorColumn
                          ? "w-[21%] text-right tabular-nums"
                          : "w-[18%] text-right tabular-nums"
                        : "text-right tabular-nums",
                  )}
                >
                  Taxable
                </th>
                {hasCompletion ? (
                  <th
                    className={cn(
                      th,
                      isEdit
                        ? "w-[36%] text-right"
                        : viewTableFixed
                          ? hideContractorColumn
                            ? "w-[34%] text-right"
                            : "w-[34%] text-right"
                          : "text-right",
                    )}
                  >
                    Completion
                  </th>
                ) : null}
                {isEdit ? <th className={cn(th, "w-16 text-right")} /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
            {!isEdit && (detailRows?.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={viewColCount} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No execution lines on this work order.
                </td>
              </tr>
            ) : null}
            {isEdit
              ? lines.map((line, idx) => {
                  const pm = pickPartMaster(pms, line.part_master_id)
                  const showWt = needsWeightPerPiece(pm)
                  const invN = estimateLineAmount(line, pm)
                  const invShown = Number.isFinite(invN) ? fmtMoney(invN) : "—"
                  const unitShown = pm?.unit_type ?? "—"
                  const rateN = pm ? parseDecimal(pm.base_rate) : NaN
                  const rateShown = pm ? fmtMoney(rateN) : "—"

                  return (
                    <tr
                      key={line.key}
                      className="transition-colors odd:bg-background even:bg-muted/[0.14] hover:bg-muted/30"
                    >
                      <td className="px-2 py-2 align-middle tabular-nums text-muted-foreground">{idx + 1}</td>
                      <td className="min-w-0 px-2 py-2 align-middle">
                        <select
                          className="h-9 w-full max-w-[280px] rounded-md border border-input bg-background px-2 text-xs outline-none"
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
                              weight_per_piece: nextNeedsWt ? wFromPm : "",
                            })
                          }}
                          disabled={loading || !org_unit_id}
                        >
                          <option value="">Select…</option>
                          {pms.map((r) => (
                            <option key={r.id} value={String(r.id)}>
                              {partLabel(r)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2 align-middle text-right tabular-nums text-muted-foreground">
                        <Input
                          className="h-9 tabular-nums"
                          inputMode="decimal"
                          placeholder={line.progress_type === "percentage" ? "%" : "0"}
                          value={line.qty}
                          onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                          disabled={loading}
                        />
                      </td>
                      <td className="px-2 py-2 align-middle">
                        {showWt ? (
                          <Input
                            className="h-9 tabular-nums"
                            inputMode="decimal"
                            placeholder={pm?.weight_per_piece != null ? String(pm.weight_per_piece) : "kg/pc"}
                            value={line.weight_per_piece}
                            onChange={(e) => updateLine(line.key, { weight_per_piece: e.target.value })}
                            disabled={loading}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 align-middle tabular-nums text-muted-foreground">{unitShown}</td>
                      <td className="px-2 py-2 align-middle text-right tabular-nums text-muted-foreground">{rateShown}</td>
                      <td className="px-2 py-2 align-middle text-right tabular-nums text-muted-foreground">{invShown}</td>
                      <td className="px-2 py-2 align-middle text-right">
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-40"
                          onClick={() => removeLine(line.key)}
                          disabled={loading || lines.length <= 1}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  )
                })
              : (detailRows ?? []).map((dr) => (
                  <React.Fragment key={dr.sr}>
                    <tr
                      className={cn(
                        "transition-colors odd:bg-background even:bg-muted/[0.12] hover:bg-muted/25",
                        "has-[[data-completion-dirty='true']]:bg-amber-500/[0.06] has-[[data-completion-dirty='true']]:ring-1 has-[[data-completion-dirty='true']]:ring-inset has-[[data-completion-dirty='true']]:ring-amber-400/35",
                      )}
                    >
                      <td className="px-2 py-2 align-middle tabular-nums text-xs text-muted-foreground">{dr.sr}</td>
                      {hideContractorColumn ? null : (
                        <td className="min-w-0 truncate px-2 py-2 align-middle text-xs" title={dr.contractor_label}>
                          {dr.contractor_label}
                        </td>
                      )}
                      <td
                        className="min-w-0 max-w-full truncate px-2 py-2 align-middle font-mono text-xs font-semibold text-foreground"
                        title={dr.job_label}
                      >
                        {dr.job_label}
                      </td>
                      <td className="px-2 py-2 align-middle text-right text-xs tabular-nums font-medium text-foreground">{dr.qty_display}</td>
                      <td className="px-2 py-2 align-middle text-right text-xs tabular-nums text-muted-foreground">{dr.unit_profile_display}</td>
                      <td className="px-2 py-2 align-middle text-right text-xs">{dr.rate_display}</td>
                      <td className="px-2 py-2 align-middle text-right text-xs tabular-nums">{dr.invoice_display}</td>
                      {hasCompletion ? (
                        <td className="min-w-0 px-2 py-2 align-middle">{dr.completionCell ?? null}</td>
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
    submitLabel = "Submit for approval",
    saveLabel = "Save",
    tip = "Tip: choose the contractor once, then add part lines. Taxable value uses negotiated rate when approved, else Part Master base.",
    onCancel,
    onSave,
    onSubmitApproval,
  } = props

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        {tip ? <p className="max-w-xl text-sm text-muted-foreground">{tip}</p> : <div />}
        <div className="flex flex-wrap items-center gap-2">
          {onCancel ? (
            <Button type="button" variant="outline" disabled={busy} onClick={() => onCancel()}>
              Cancel
            </Button>
          ) : null}
          {showSave ? (
            <Button type="button" disabled={busy} onClick={() => onSave?.()}>
              {busy ? "Saving…" : saveLabel}
            </Button>
          ) : null}
          {showSubmit ? (
            <Button type="button" disabled={busy} className="min-w-[160px]" onClick={() => onSubmitApproval?.()}>
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
    const row: WorkOrderItemApiPayload = {
      part_master_id: Number(x.part_master_id),
      progress_type: pt,
      planned_quantity: pt === "quantity" ? (x.qty.trim() ? x.qty : null) : null,
      planned_percentage: pt === "percentage" ? (x.qty.trim() ? x.qty : null) : null,
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
