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
  contractor_id: string
  part_master_id: string
  progress_type: "quantity" | "percentage"
  qty: string
  remarks: string
}

export type ExecutionDetailRow = {
  sr: number
  contractor_label: string
  job_label: string
  qty_display: string
  unit_display: string
  rate_display: string
  invoice_display: string
  remarks_display: string
  /** Optional inline completion editor/rendering for active work orders */
  completionCell?: React.ReactNode
}

export type WorkOrderLikeForLines = {
  contractors?: {
    contractor_id: number
    items?: {
      id: number
      part_master_id: number
      progress_type: string
      planned_quantity: string | number | null
      planned_percentage: string | number | null
      notes?: string | null
    }[]
  }[]
}

export function flattenWorkOrderToDraftLines(row: WorkOrderLikeForLines): ExecutionDraftLine[] {
  const out: ExecutionDraftLine[] = []
  for (const c of row.contractors ?? []) {
    for (const it of c.items ?? []) {
      const pct = it.progress_type === "percentage"
      out.push({
        key: `i-${it.id}`,
        contractor_id: String(c.contractor_id),
        part_master_id: String(it.part_master_id),
        progress_type: pct ? "percentage" : "quantity",
        qty: pct
          ? it.planned_percentage != null && String(it.planned_percentage) !== ""
            ? String(it.planned_percentage)
            : ""
          : it.planned_quantity != null && String(it.planned_quantity) !== ""
            ? String(it.planned_quantity)
            : "",
        remarks: it.notes?.trim() ? it.notes.trim() : "",
      })
    }
  }
  return out.length > 0 ? out : [newDraftLine()]
}

export function newDraftLine(): ExecutionDraftLine {
  return {
    key: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()),
    contractor_id: "",
    part_master_id: "",
    progress_type: "quantity",
    qty: "",
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

  const selectCls =
    "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"

  return (
    <div className="grid gap-4 md:grid-cols-3">
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
    </div>
  )
}

export function WorkOrderExecutionTable(props: {
  mode: "edit" | "view"
  loading: boolean
  org_unit_id: string
  contractors: ContractorLite[]
  partMasters: PartMasterLite[]
  lines: ExecutionDraftLine[]
  onLinesChange: (lines: ExecutionDraftLine[]) => void
  detailRows?: ExecutionDetailRow[]
}) {
  const { mode, loading, org_unit_id, contractors, partMasters, lines, onLinesChange, detailRows } = props
  const pms = filteredPartMasters(partMasters, org_unit_id)
  const isEdit = mode === "edit"
  const hasCompletion = !isEdit && (detailRows ?? []).some((r) => Boolean(r.completionCell))

  function updateLine(key: string, patch: Partial<ExecutionDraftLine>) {
    onLinesChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function removeLine(key: string) {
    onLinesChange(lines.filter((l) => l.key !== key))
  }

  const th = "whitespace-normal px-2 py-2 text-left align-bottom text-[11px] font-medium uppercase tracking-wide text-muted-foreground"

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-4">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold tracking-tight">Execution sheet</CardTitle>
          <CardDescription>Contractor + part + qty. Unit and governed rates auto-resolve from approved setup.</CardDescription>
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
      <CardContent className="overflow-x-auto p-0 px-px pb-4 sm:p-6 sm:pt-0">
        <table className="w-full min-w-[840px] border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th className={th}>SR</th>
              <th className={th}>Contractor</th>
              <th className={th}>Part</th>
              <th className={cn(th, "w-20")}>Qty</th>
              <th className={cn(th, "w-24")}>Unit</th>
              <th className={cn(th, "w-28 text-right tabular-nums")}>Unit rate</th>
              <th className={cn(th, "w-32 text-right tabular-nums")}>Invoice value</th>
              {hasCompletion ? <th className={cn(th, "min-w-[360px]")}>Completion</th> : null}
              <th className={th}>Remarks</th>
              {isEdit ? <th className={cn(th, "w-20 text-right")} /> : null}
            </tr>
          </thead>
          <tbody>
            {!isEdit && (detailRows?.length ?? 0) === 0 ? (
              <tr className="border-b border-border/60">
                <td colSpan={hasCompletion ? 9 : 8} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No execution lines on this work order.
                </td>
              </tr>
            ) : null}
            {isEdit
              ? lines.map((line, idx) => {
                  const pm = pickPartMaster(pms, line.part_master_id)
                  const qtyN = parseDecimal(line.qty)
                  const rateN = pm ? parseDecimal(pm.base_rate) : NaN
                  const invoice =
                    line.progress_type === "quantity" && Number.isFinite(qtyN) && Number.isFinite(rateN)
                      ? qtyN * rateN
                      : NaN
                  const unitShown = pm?.unit_type ?? "—"
                  const rateShown = pm ? fmtMoney(rateN) : "—"
                  const invShown = Number.isFinite(invoice) ? fmtMoney(invoice) : "—"

                  return (
                    <tr key={line.key} className="border-b border-border/60">
                      <td className="px-2 py-2 align-middle tabular-nums text-muted-foreground">{idx + 1}</td>
                      <td className="min-w-[140px] px-2 py-2 align-middle">
                        <select
                          className="h-9 w-full max-w-[200px] rounded-md border border-input bg-background px-2 text-xs outline-none"
                          value={line.contractor_id}
                          onChange={(e) => updateLine(line.key, { contractor_id: e.target.value })}
                          disabled={loading || !org_unit_id}
                        >
                          <option value="">Select…</option>
                          {contractors.map((c) => (
                            <option key={c.id} value={String(c.id)}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="min-w-[180px] px-2 py-2 align-middle">
                        <select
                          className="h-9 w-full max-w-[260px] rounded-md border border-input bg-background px-2 text-xs outline-none"
                          value={line.part_master_id}
                          onChange={(e) => updateLine(line.key, { part_master_id: e.target.value })}
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
                      <td className="px-2 py-2 align-middle">
                        <Input
                          className="h-9 tabular-nums"
                          inputMode="decimal"
                          placeholder={line.progress_type === "percentage" ? "%" : "0"}
                          value={line.qty}
                          onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                          disabled={loading}
                        />
                      </td>
                      <td className="px-2 py-2 align-middle tabular-nums text-muted-foreground">{unitShown}</td>
                      <td className="px-2 py-2 align-middle text-right tabular-nums text-muted-foreground">{rateShown}</td>
                      <td className="px-2 py-2 align-middle text-right tabular-nums text-muted-foreground">{invShown}</td>
                      <td className="min-w-[120px] px-2 py-2 align-middle">
                        <Input
                          className="h-9"
                          placeholder="Optional"
                          value={line.remarks}
                          onChange={(e) => updateLine(line.key, { remarks: e.target.value })}
                          disabled={loading}
                        />
                      </td>
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
                    <tr className="border-b border-border/60">
                      <td className="px-2 py-2 align-middle tabular-nums text-muted-foreground">{dr.sr}</td>
                      <td className="px-2 py-2 align-middle">{dr.contractor_label}</td>
                      <td className="px-2 py-2 align-middle">{dr.job_label}</td>
                      <td className="px-2 py-2 align-middle tabular-nums">{dr.qty_display}</td>
                      <td className="px-2 py-2 align-middle tabular-nums text-muted-foreground">{dr.unit_display}</td>
                      <td className="px-2 py-2 align-middle text-right tabular-nums text-muted-foreground">{dr.rate_display}</td>
                      <td className="px-2 py-2 align-middle text-right tabular-nums text-muted-foreground">{dr.invoice_display}</td>
                      {hasCompletion ? <td className="px-2 py-2 align-middle">{dr.completionCell ?? null}</td> : null}
                      <td className="px-2 py-2 align-middle text-sm text-muted-foreground">{dr.remarks_display || "—"}</td>
                    </tr>
                  </React.Fragment>
                ))}
          </tbody>
        </table>
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
    tip = "Tip: pick contractor + item/job first — unit and governed rate will auto-load.",
    onCancel,
    onSave,
    onSubmitApproval,
  } = props

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        {tip ? <p className="max-w-xl text-sm text-muted-foreground">{tip}</p> : <div />}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onCancel?.()}>
            Cancel
          </Button>
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

export function draftLinesToContractors(
  lines: ExecutionDraftLine[],
): {
  contractor_id: number
  scope_notes: null
  items: {
    part_master_id: number
    progress_type: "quantity" | "percentage"
    planned_quantity: string | null
    planned_percentage: string | null
    notes: string | null
  }[]
}[] {
  const byContractor = new Map<number, typeof lines>()
  for (const line of lines) {
    if (!line.contractor_id.trim() || !line.part_master_id.trim()) continue
    const cid = Number(line.contractor_id)
    if (!Number.isFinite(cid)) continue
    const bucket = byContractor.get(cid) ?? []
    bucket.push(line)
    byContractor.set(cid, bucket)
  }
  return [...byContractor.entries()].map(([contractor_id, ls]) => ({
    contractor_id,
    scope_notes: null,
    items: ls.map((x) => {
      const pt = x.progress_type === "percentage" ? "percentage" : "quantity"
      return {
        part_master_id: Number(x.part_master_id),
        progress_type: pt as "quantity" | "percentage",
        planned_quantity: pt === "quantity" ? (x.qty.trim() ? x.qty : null) : null,
        planned_percentage: pt === "percentage" ? (x.qty.trim() ? x.qty : null) : null,
        notes: x.remarks.trim() || null,
      }
    }),
  }))
}
