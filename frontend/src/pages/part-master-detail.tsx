import * as React from "react"
import { ChevronRight, Sparkles } from "lucide-react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"

import { PageBackLink } from "@/components/layout/page-back-link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { SectionHint } from "@/components/ui/section-hint"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApiError, getJson, patchJson } from "@/lib/api"
import { humanizeFieldKey } from "@/lib/field-labels"
import { canListOrgUnitsForAssignments, hasPermission, isSuperuser } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { RateVersionHistoryButton } from "@/components/contractors/RateVersionHistoryDrawer"
import { PartAnalyticsDashboard } from "@/components/parts/analytics/PartAnalyticsDashboard"
import type { PartMasterPublic } from "@/pages/part-master"

type OrgUnitLite = { id: number; name: string; type: string }

type PartMasterAuditEntry = {
  id: number
  part_master_id: number
  action: string
  changed_by: number | null
  changed_by_name: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  metadata_json: Record<string, unknown> | null
  created_at: string
}

function auditActionLabel(action: string): string {
  const a = action.toUpperCase()
  if (a === "CREATED") return "Created"
  if (a === "VERSION_CREATED") return "Version recorded"
  if (a === "UPDATED") return "Updated"
  if (a === "VALIDITY_CHANGED") return "Validity changed"
  if (a === "ACTIVATED") return "Activated"
  if (a === "DEACTIVATED") return "Deactivated"
  if (a === "SUPERSEDED") return "Superseded"
  if (a === "RATE_REPLACED") return "Rate replaced"
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

const AUDIT_FIELD_LABELS: Record<string, string> = {
  part_code: "Part number",
  part_name: "Part name",
  description: "Description",
  unit_type: "Billing unit (UOM)",
  pricing_method: "Pricing method",
  billing_basis: "Billing basis",
  allow_manual_amount_override: "Allow manual amount override",
  weight_per_piece: "Weight per unit",
  labour_cost: "Labour cost",
  man_days: "Man days",
  labour_headcount: "Labour count",
  standard_man_hours: "Standard man-hours",
  base_rate: "Should cost",
  rate_unit_type: "Rate unit",
  org_unit_id: "Plant / org unit",
  effective_from: "Effective from",
  effective_to: "Effective to",
  is_active: "Active flag",
  status: "Record status",
  notes: "Notes",
}

const PART_MASTER_DESCRIPTION_MAX_LENGTH = 200
const PART_MASTER_NOTES_MAX_LENGTH = 200

function humanizeAuditField(key: string): string {
  return humanizeFieldKey(key, AUDIT_FIELD_LABELS)
}

function formatAuditCell(v: unknown): string {
  if (v === null || v === undefined) return "—"
  if (typeof v === "boolean") return v ? "Yes" : "No"
  if (typeof v === "number") return String(v)
  if (typeof v === "string") return v.length > 200 ? `${v.slice(0, 200)}…` : v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

/** Snapshot-only keys: version line belongs in View history, not the simple audit list. */
const AUDIT_SKIP_KEYS = new Set(["version_number"])

/** Pairs of field label + before/after for display in the audit trail. */
function auditChangeRows(a: PartMasterAuditEntry): { key: string; field: string; before: string; after: string }[] {
  const oldVal = a.old_value
  const newVal = a.new_value
  if (!oldVal && !newVal) return []

  const keys = new Set([...Object.keys(oldVal ?? {}), ...Object.keys(newVal ?? {})])
  const rows: { key: string; field: string; before: string; after: string }[] = []
  for (const k of Array.from(keys).sort()) {
    if (AUDIT_SKIP_KEYS.has(k)) continue
    const ov = oldVal?.[k]
    const nv = newVal?.[k]
    const same = JSON.stringify(ov) === JSON.stringify(nv)
    if (same) continue
    rows.push({
      key: k,
      field: humanizeAuditField(k),
      before: formatAuditCell(ov),
      after: formatAuditCell(nv),
    })
  }
  return rows
}

function formatAuditDateTime(iso: string): { date: string; time: string } {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return { date: iso, time: "" }
    return {
      date: new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(d),
      time: new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(d),
    }
  } catch {
    return { date: iso, time: "" }
  }
}

function initialsFromName(name: string): string {
  const tokens = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (tokens.length === 0 || name === "—") return "—"
  return tokens
    .slice(0, 2)
    .map((token) => token.charAt(0).toUpperCase())
    .join("")
}

function emptyEditForm(): {
  org_unit_id: string
  part_code: string
  part_name: string
  description: string
  unit_type: string
  pricing_method: string
  weight_per_piece: string
  labour_cost: string
  man_days: string
  base_rate: string
  rate_unit_type: string
  effective_from: string
  effective_to: string
  notes: string
  status: string
  is_active: boolean
} {
  return {
    org_unit_id: "",
    part_code: "",
    part_name: "",
    description: "",
    unit_type: "pcs",
    pricing_method: "piece_based",
    weight_per_piece: "",
    labour_cost: "",
    man_days: "",
    base_rate: "",
    rate_unit_type: "per_piece",
    effective_from: "",
    effective_to: "",
    notes: "",
    status: "active",
    is_active: true,
  }
}

function hydrateFormFromRow(r: PartMasterPublic) {
  return {
    org_unit_id: String(r.org_unit_id),
    part_code: r.part_code,
    part_name: r.part_name,
    description: r.description ?? "",
    unit_type: r.unit_type,
    pricing_method: r.pricing_method,
    weight_per_piece: sanitizeDecimalString(r.weight_per_piece != null ? String(r.weight_per_piece) : ""),
    labour_cost: sanitizeDecimalString(r.labour_cost != null ? String(r.labour_cost) : ""),
    man_days: sanitizeDecimalString(r.man_days != null ? String(r.man_days) : ""),
    base_rate: sanitizeDecimalString(String(r.base_rate)),
    rate_unit_type: r.rate_unit_type,
    effective_from: r.effective_from?.slice(0, 10) ?? "",
    effective_to: r.effective_to ? r.effective_to.slice(0, 10) : "",
    notes: r.notes ?? "",
    status: r.status,
    is_active: r.is_active,
  }
}

/** Keep only digits and at most one decimal point (avoids pasted garbage like "("). */
function sanitizeDecimalString(raw: string): string {
  let t = raw.replace(/[^\d.]/g, "")
  const dot = t.indexOf(".")
  if (dot === -1) return t
  return t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, "")
}

function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100
}

function computeRatePerKg(weightKg: string, labourCost: string, manDays: string): number | null {
  const wn = Number(sanitizeDecimalString(weightKg.trim()))
  const lc = Number(sanitizeDecimalString(labourCost.trim()))
  const md = Number(sanitizeDecimalString(manDays.trim()))
  if (!Number.isFinite(wn) || wn <= 0) return null
  if (!Number.isFinite(lc) || lc <= 0) return null
  if (!Number.isFinite(md) || md <= 0) return null
  return roundMoney2((md * lc) / wn)
}

export function PartMasterDetailPage() {
  const { partMasterId } = useParams()
  const id = Number(partMasterId)
  const auditPreviewCount = 4
  const [mainTab, setMainTab] = React.useState("intelligence")
  const [row, setRow] = React.useState<PartMasterPublic | null>(null)
  const [audits, setAudits] = React.useState<PartMasterAuditEntry[]>([])
  const [plants, setPlants] = React.useState<OrgUnitLite[]>([])
  const [form, setForm] = React.useState(() => emptyEditForm())
  const [saving, setSaving] = React.useState(false)
  const [showAllAuditEntries, setShowAllAuditEntries] = React.useState(false)
  const [expandedAuditIds, setExpandedAuditIds] = React.useState<number[]>([])

  const canView = hasPermission("part_master.view") || isSuperuser()
  const canUpdate = hasPermission("part_master.update") || isSuperuser()

  const loadPart = React.useCallback(async () => {
    if (!canView || !Number.isFinite(id)) return
    try {
      const r = await getJson<PartMasterPublic>(`/part-master/${id}`)
      setRow(r)
      setForm(hydrateFormFromRow(r))
    } catch {
      setRow(null)
    }
  }, [canView, id])

  React.useEffect(() => {
    if (!canUpdate || !canListOrgUnitsForAssignments()) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await getJson<OrgUnitLite[]>("/admin/org-units?type=PLANT")
        if (!cancelled) setPlants(Array.isArray(data) ? data : [])
      } catch {
        if (!cancelled) setPlants([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canUpdate])

  const loadAudits = React.useCallback(async () => {
    if (!canView || !Number.isFinite(id)) return
    try {
      const list = await getJson<PartMasterAuditEntry[]>(`/part-master/${id}/audit-logs`)
      setAudits(Array.isArray(list) ? list : [])
    } catch {
      setAudits([])
    }
  }, [canView, id])

  React.useEffect(() => {
    void loadPart()
  }, [loadPart])

  React.useEffect(() => {
    void loadAudits()
  }, [loadAudits])

  const activityEntries = React.useMemo(
    () =>
      [...audits]
        .filter((a) => a.action.toUpperCase() !== "VERSION_CREATED")
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [audits],
  )

  React.useEffect(() => {
    setShowAllAuditEntries(false)
    setExpandedAuditIds([])
  }, [activityEntries.length])

  const visibleAuditEntries = showAllAuditEntries ? activityEntries : activityEntries.slice(0, auditPreviewCount)

  const weightBased = form.pricing_method === "weight_based"
  const derivedRatePerKg = React.useMemo(
    () => (weightBased ? computeRatePerKg(form.weight_per_piece, form.labour_cost, form.man_days) : null),
    [weightBased, form.weight_per_piece, form.labour_cost, form.man_days],
  )

  async function save() {
    if (!row || !canUpdate) return
    if (!form.part_code.trim() || !form.part_name.trim()) {
      toast.error("Part code and name are required")
      return
    }
    if (!form.org_unit_id) {
      toast.error("Select a plant")
      return
    }
    const w = sanitizeDecimalString(form.weight_per_piece.trim())
    const labourCostStr = sanitizeDecimalString(form.labour_cost.trim())
    const manDaysStr = sanitizeDecimalString(form.man_days.trim())
    let br: number
    if (form.pricing_method === "weight_based") {
      const wn = Number(w)
      if (!w || !Number.isFinite(wn) || wn <= 0) {
        toast.error("Weight (kg) is required for weight-based parts")
        return
      }
      const lcN = Number(labourCostStr)
      const mdN = Number(manDaysStr)
      if (!labourCostStr || !manDaysStr || !Number.isFinite(lcN) || !Number.isFinite(mdN) || lcN <= 0 || mdN <= 0) {
        toast.error("Labour cost and man days are required for weight-based parts")
        return
      }
      const derived = computeRatePerKg(w, labourCostStr, manDaysStr)
      if (derived == null || derived <= 0) {
        toast.error("Could not derive rate per kg from weight, labour cost, and man days")
        return
      }
      br = derived
    } else {
      const n = Number(sanitizeDecimalString(form.base_rate.trim()))
      if (!Number.isFinite(n) || n <= 0) {
        toast.error("Enter a valid should cost greater than zero")
        return
      }
      br = n
    }
    if (!form.effective_from.trim()) {
      toast.error("Effective from date is required")
      return
    }
    if (form.description.length > PART_MASTER_DESCRIPTION_MAX_LENGTH) {
      toast.error(`Description cannot exceed ${PART_MASTER_DESCRIPTION_MAX_LENGTH} characters`)
      return
    }
    if (form.notes.trim().length > PART_MASTER_NOTES_MAX_LENGTH) {
      toast.error(`Notes cannot exceed ${PART_MASTER_NOTES_MAX_LENGTH} characters`)
      return
    }
    const wb = form.pricing_method === "weight_based"
    setSaving(true)
    try {
      const updated = await patchJson<PartMasterPublic>(`/part-master/${row.id}`, {
        org_unit_id: Number(form.org_unit_id),
        part_code: form.part_code.trim(),
        part_name: form.part_name.trim(),
        description: form.description.trim() || null,
        unit_type: form.unit_type.trim(),
        pricing_method: form.pricing_method,
        weight_per_piece: w ? Number(w) : null,
        labour_cost: wb ? Number(labourCostStr) : null,
        man_days: wb ? Number(manDaysStr) : null,
        base_rate: br,
        rate_unit_type: form.rate_unit_type,
        effective_from: form.effective_from.trim(),
        effective_to: form.effective_to.trim() || null,
        notes: form.notes.trim() || null,
        status: form.status,
        is_active: form.is_active,
      })
      setRow(updated)
      setForm(hydrateFormFromRow(updated))
      toast.success("Saved")
      await loadAudits()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  function toggleAuditEntry(entryId: number) {
    setExpandedAuditIds((current) =>
      current.includes(entryId) ? current.filter((id) => id !== entryId) : [...current, entryId],
    )
  }

  if (!canView) {
    return (
      <Card className="rounded-2xl border-border/50 shadow-sm">
        <CardHeader>
          <CardTitle>Part Master</CardTitle>
          <CardDescription>
            You need <span className="font-mono">part_master.view</span>.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!Number.isFinite(id)) {
    return (
      <Card className="rounded-2xl border-border/50 shadow-sm">
        <CardHeader>
          <CardTitle>Not found</CardTitle>
          <CardDescription>
            <Button variant="link" asChild>
              <Link to="/dashboard/part-master">Back to list</Link>
            </Button>
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!row) {
    return (
      <Card className="rounded-2xl border-border/50 shadow-sm">
        <CardHeader>
          <CardTitle>Not found</CardTitle>
          <CardDescription>
            <Button variant="link" asChild>
              <Link to="/dashboard/part-master">Back to list</Link>
            </Button>
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const plantLabel = row.org_unit_name ?? `Plant #${row.org_unit_id}`
  const metadataHint = `${plantLabel}. Saved record: ${row.part_code}. Use Master data tab to edit all fields like on create.`

  return (
    <div className="w-full min-w-0 space-y-6 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-6">
        <div className="min-w-0 space-y-1">
          <PageBackLink
            to="/dashboard/part-master"
            label={row.part_code || "Part Master"}
            className={row.part_code ? "font-mono" : undefined}
          />
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{form.part_name || row.part_name}</h1>
            <SectionHint text={metadataHint} />
          </div>
        </div>
        <RateVersionHistoryButton
          resource="part-master"
          parentId={row.id}
          title={`${row.part_code} — ${row.part_name}`}
          subtitle={row.org_unit_name ?? undefined}
        />
      </header>

      <Tabs value={mainTab} onValueChange={setMainTab} className="w-full min-w-0">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-xl bg-muted/40 p-1">
          <TabsTrigger value="intelligence" className="rounded-lg">
            Part Details
          </TabsTrigger>
          <TabsTrigger value="master" className="rounded-lg">
            Master data & audit
          </TabsTrigger>
        </TabsList>

        <TabsContent value="intelligence" className="mt-6 min-w-0 outline-none">
          <PartAnalyticsDashboard partMasterId={row.id} />
        </TabsContent>

        <TabsContent value="master" className="mt-6 min-w-0 space-y-6 pb-8 outline-none">
          <div className="grid w-full min-w-0 grid-cols-1 gap-6 lg:grid-cols-3 lg:items-stretch">
            <Card className="flex min-h-0 min-w-0 flex-col rounded-2xl border-border/50 shadow-sm">
              <CardHeader className="shrink-0 space-y-0 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-tight">Identity & plant</CardTitle>
                  <SectionHint text="Part code is normalized to uppercase on save." />
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <div className="grid gap-1.5">
                  <Label showRequired>Plant</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none disabled:opacity-60"
                    value={form.org_unit_id}
                    onChange={(e) => setForm((f) => ({ ...f, org_unit_id: e.target.value }))}
                    disabled={!canUpdate}
                  >
                    <option value="">Select…</option>
                    {plants.length > 0
                      ? plants.map((p) => (
                          <option key={p.id} value={String(p.id)}>
                            {p.name}
                          </option>
                        ))
                      : (
                          <option value={String(row.org_unit_id)}>
                            {row.org_unit_name ?? `Plant #${row.org_unit_id}`}
                          </option>
                        )}
                  </select>
                </div>
                <div className="grid min-w-0 gap-1.5">
                  <Label htmlFor="pm-code" showRequired>
                    Part Code
                  </Label>
                  <Input
                    id="pm-code"
                    className="rounded-xl border-border/60 font-mono"
                    value={form.part_code}
                    onChange={(e) => setForm((f) => ({ ...f, part_code: e.target.value }))}
                    disabled={!canUpdate}
                    autoComplete="off"
                  />
                </div>
                <div className="grid min-w-0 gap-1.5">
                  <Label htmlFor="pm-name" showRequired>
                    Part Name
                  </Label>
                  <Input
                    id="pm-name"
                    className="rounded-xl border-border/60"
                    value={form.part_name}
                    onChange={(e) => setForm((f) => ({ ...f, part_name: e.target.value }))}
                    disabled={!canUpdate}
                  />
                </div>
                <div className="grid min-h-0 min-w-0 flex-1 gap-1.5">
                  <Label htmlFor="pm-desc">Description</Label>
                  <Textarea
                    id="pm-desc"
                    rows={4}
                    className="min-h-[96px] flex-1 resize-y rounded-xl border-border/60 bg-background/80"
                    value={form.description}
                    maxLength={PART_MASTER_DESCRIPTION_MAX_LENGTH}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        description: e.target.value.slice(0, PART_MASTER_DESCRIPTION_MAX_LENGTH),
                      }))
                    }
                    disabled={!canUpdate}
                  />
                  <div className="flex justify-end text-[11px] text-muted-foreground">
                    {form.description.length}/{PART_MASTER_DESCRIPTION_MAX_LENGTH}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="flex min-h-0 min-w-0 flex-col rounded-2xl border-border/50 shadow-sm">
              <CardHeader className="shrink-0 space-y-0 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-tight">Commercial</CardTitle>
                  <SectionHint text="Weight-based: labour cost × man days ÷ weight (kg) = rate per kg. Piece-based: billing UOM + rate unit." />
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="grid min-w-0 gap-1.5">
                    <Label showRequired>Pricing Method</Label>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none disabled:opacity-60"
                      value={form.pricing_method}
                      onChange={(e) => {
                        const pm = e.target.value
                        setForm((f) => {
                          if (pm === "weight_based") {
                            return {
                              ...f,
                              pricing_method: pm,
                              rate_unit_type: "per_kg",
                              unit_type: f.unit_type.toLowerCase() === "pcs" ? "kg" : f.unit_type,
                            }
                          }
                          const ru = f.rate_unit_type === "per_kg" ? "per_piece" : f.rate_unit_type
                          return {
                            ...f,
                            pricing_method: pm,
                            rate_unit_type: ru,
                            labour_cost: "",
                            man_days: "",
                          }
                        })
                      }}
                      disabled={!canUpdate}
                    >
                      <option value="piece_based">Piece / Time / Other Unit</option>
                      <option value="weight_based">Weight (kg)</option>
                    </select>
                  </div>
                  <div className="grid min-w-0 gap-1.5">
                    <Label showRequired>Unit Type (UOM)</Label>
                    <Input
                      value={form.unit_type}
                      onChange={(e) => setForm((f) => ({ ...f, unit_type: e.target.value }))}
                      placeholder="PCS, kg, m…"
                      disabled={!canUpdate}
                      className="rounded-xl border-border/60"
                    />
                  </div>
                </div>
                {weightBased ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="grid min-w-0 gap-1.5">
                      <Label htmlFor="pm-labour-cost" showRequired>
                        Labour Cost
                      </Label>
                      <Input
                        id="pm-labour-cost"
                        inputMode="decimal"
                        value={form.labour_cost}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, labour_cost: sanitizeDecimalString(e.target.value) }))
                        }
                        placeholder="e.g. 5000"
                        disabled={!canUpdate}
                        className="rounded-xl border-border/60 tabular-nums"
                      />
                    </div>
                    <div className="grid min-w-0 gap-1.5">
                      <Label htmlFor="pm-man-days" showRequired>
                        Man Days
                      </Label>
                      <Input
                        id="pm-man-days"
                        inputMode="decimal"
                        value={form.man_days}
                        onChange={(e) => setForm((f) => ({ ...f, man_days: sanitizeDecimalString(e.target.value) }))}
                        placeholder="e.g. 2.5"
                        disabled={!canUpdate}
                        className="rounded-xl border-border/60 tabular-nums"
                      />
                    </div>
                    <div className="grid min-w-0 gap-1.5">
                      <Label htmlFor="pm-wt" showRequired>
                        Weight (kg)
                      </Label>
                      <Input
                        id="pm-wt"
                        inputMode="decimal"
                        value={form.weight_per_piece}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, weight_per_piece: sanitizeDecimalString(e.target.value) }))
                        }
                        placeholder="e.g. 42.35"
                        disabled={!canUpdate}
                        className="rounded-xl border-border/60 tabular-nums"
                      />
                    </div>
                    <div className="grid min-w-0 gap-1.5">
                      <Label htmlFor="pm-rate-kg">Rate/kg</Label>
                      <Input
                        id="pm-rate-kg"
                        readOnly
                        value={derivedRatePerKg != null ? String(derivedRatePerKg) : ""}
                        placeholder="man days × labour cost ÷ weight"
                        disabled
                        className="rounded-xl border-border/60 bg-muted/40 font-medium tabular-nums"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="grid min-w-0 gap-1.5">
                        <Label htmlFor="pm-wt-opt">Weight/Piece(kg,optional)</Label>
                        <Input
                          id="pm-wt-opt"
                          inputMode="decimal"
                          value={form.weight_per_piece}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, weight_per_piece: sanitizeDecimalString(e.target.value) }))
                          }
                          placeholder="Reference only"
                          disabled={!canUpdate}
                          className="rounded-xl border-border/60 tabular-nums"
                        />
                      </div>
                      <div className="grid min-w-0 gap-1.5">
                        <Label showRequired>Rate Unit</Label>
                        <select
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none disabled:opacity-60"
                          value={form.rate_unit_type}
                          onChange={(e) => setForm((f) => ({ ...f, rate_unit_type: e.target.value }))}
                          disabled={!canUpdate}
                        >
                          <option value="per_piece">Per Piece</option>
                          <option value="per_unit">Per Unit</option>
                          <option value="per_box">Per Box</option>
                          <option value="per_nos">Per Nos</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid min-w-0 gap-1.5 sm:max-w-sm">
                      <Label htmlFor="pm-base" showRequired>
                        Should Cost
                      </Label>
                      <Input
                        id="pm-base"
                        inputMode="decimal"
                        value={form.base_rate}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, base_rate: sanitizeDecimalString(e.target.value) }))
                        }
                        disabled={!canUpdate}
                        className="rounded-xl border-border/60 font-medium tabular-nums"
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="flex min-h-0 min-w-0 flex-col rounded-2xl border-border/50 shadow-sm">
              <CardHeader className="shrink-0 space-y-0 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-tight">Validity & Record</CardTitle>
                  <SectionHint text="Plant/code changes check overlap with other active rows." />
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="grid min-w-0 gap-1.5">
                    <Label htmlFor="pm-ef" showRequired>
                      Effective From
                    </Label>
                    <Input
                      id="pm-ef"
                      type="date"
                      value={form.effective_from}
                      onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))}
                      disabled={!canUpdate}
                      className="rounded-xl border-border/60"
                    />
                  </div>
                  <div className="grid min-w-0 gap-1.5">
                    <Label htmlFor="pm-et" showRequired>
                      Effective To (optional)
                    </Label>
                    <Input
                      id="pm-et"
                      type="date"
                      value={form.effective_to}
                      onChange={(e) => setForm((f) => ({ ...f, effective_to: e.target.value }))}
                      disabled={!canUpdate}
                      className="rounded-xl border-border/60"
                    />
                  </div>
                </div>
                <div className="grid min-w-0 gap-1.5 sm:max-w-xs">
                  <Label showRequired>Record Status</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none disabled:opacity-60"
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                    disabled={!canUpdate}
                  >
                    <option value="draft">draft</option>
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                    <option value="superseded">superseded</option>
                  </select>
                </div>
                <div className="grid min-h-0 min-w-0 flex-1 gap-1.5">
                  <Label htmlFor="pm-notes">Notes</Label>
                  <Textarea
                    id="pm-notes"
                    rows={2}
                    className="min-h-[72px] resize-y rounded-xl border-border/60 bg-background/80"
                    value={form.notes}
                    maxLength={PART_MASTER_NOTES_MAX_LENGTH}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        notes: e.target.value.slice(0, PART_MASTER_NOTES_MAX_LENGTH),
                      }))
                    }
                    disabled={!canUpdate}
                  />
                  <div className="flex justify-end text-[11px] text-muted-foreground">
                    {form.notes.length}/{PART_MASTER_NOTES_MAX_LENGTH}
                  </div>
                </div>
                <div className="mt-auto flex shrink-0 items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Active</p>
                    {/* <p className="text-xs text-muted-foreground">Hidden from default lookups when off.</p> */}
                  </div>
                  <Switch
                    checked={form.is_active}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
                    disabled={!canUpdate}
                  />
                </div>
              </CardContent>
            </Card>
            
          </div>
          {canUpdate ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-muted/15 px-4 py-4 shadow-sm">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Save your updates</p>
                {/* <p className="text-xs text-muted-foreground">
                  Changes to master data are recorded in the audit log after save.
                </p> */}
              </div>
              <Button className="min-w-32 rounded-xl" onClick={() => void save()} disabled={saving}>
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          ) : null}

          <Card className="min-w-0 overflow-hidden rounded-2xl border-border/50 shadow-sm" aria-labelledby="part-audit-heading">
            <CardHeader className="border-b border-border/60 bg-muted/15 pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle id="part-audit-heading" className="text-base">
                    Audit Log
                  </CardTitle>
                  {/* <CardDescription>
                    Summary cards show the audit event, who performed it, when it happened, and expandable field changes.
                  </CardDescription> */}
                </div>
                <Badge variant="outline" className="rounded-full px-2.5 py-1">
                  {activityEntries.length} {activityEntries.length === 1 ? "entry" : "entries"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-5">
              {activityEntries.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/70 bg-muted/10 px-4 py-10 text-center text-sm text-muted-foreground">
                  No audit entries yet.
                </div>
              ) : (
                <>
                  <div className="space-y-5">
                    {visibleAuditEntries.map((entry) => {
                      const actor = entry.changed_by_name ?? (entry.changed_by != null ? `User #${entry.changed_by}` : "—")
                      const { date, time } = formatAuditDateTime(entry.created_at)
                      const changes = auditChangeRows(entry)
                      const expanded = expandedAuditIds.includes(entry.id)
                      return (
                        <div key={entry.id} className="flex gap-4">
                          <div className="shrink-0 pt-3">
                            <div className="flex size-12 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm sm:size-14">
                              <Sparkles className="size-5 sm:size-6" aria-hidden />
                            </div>
                          </div>

                          <div className="min-w-0 flex-1 rounded-[28px] border border-border/70 bg-background px-5 py-5 shadow-sm">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0 flex-1 space-y-4">
                                <div className="flex flex-wrap items-center gap-3">
                                  <h3 className="text-xl font-semibold tracking-tight text-foreground">
                                    {auditActionLabel(entry.action)}
                                  </h3>
                                  <Badge variant="secondary" className="rounded-full px-3 py-1 text-[11px] font-semibold tracking-wide">
                                    AUDIT
                                  </Badge>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2 xl:max-w-2xl">
                                  <div className="rounded-3xl border border-border/70 bg-muted/10 px-5 py-4">
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                      Performed By
                                    </div>
                                    <div className="mt-2 flex items-center gap-3">
                                      <div className="flex size-9 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                                        {initialsFromName(actor)}
                                      </div>
                                      <div className="min-w-0 text-base font-semibold text-foreground">{actor}</div>
                                    </div>
                                  </div>

                                  <div className="rounded-3xl border border-border/70 bg-muted/10 px-5 py-4">
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                      Time
                                    </div>
                                    <time dateTime={entry.created_at} className="mt-2 block text-base font-semibold text-foreground">
                                      {date}
                                      {time ? `, ${time}` : ""}
                                    </time>
                                  </div>
                                </div>
                              </div>

                              <div className="flex shrink-0 items-start justify-end">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="h-auto rounded-full px-3 py-2 text-base font-semibold text-foreground hover:bg-transparent hover:text-foreground"
                                  onClick={() => toggleAuditEntry(entry.id)}
                                >
                                  <ChevronRight
                                    className={cn("mr-2 size-5 transition-transform duration-200", expanded && "rotate-90")}
                                    aria-hidden
                                  />
                                  {expanded ? "Hide Changes" : "View Changes"}
                                </Button>
                              </div>
                            </div>
                            

                            {expanded ? (
                              <div className="mt-5 border-t border-border/60 pt-5">
                                {changes.length > 0 ? (
                                  <div className="overflow-hidden rounded-2xl border border-border/60">
                                    <div className="hidden grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b border-border/60 bg-muted/20 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
                                      <div>Updated Field</div>
                                      <div>Before</div>
                                      <div>After</div>
                                    </div>
                                    <div className="divide-y divide-border/60">
                                      {changes.map((change) => (
                                        <div
                                          key={`${entry.id}-${change.key}`}
                                          className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]"
                                        >
                                          <div className="min-w-0">
                                            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:hidden">
                                              Updated Field
                                            </div>
                                            <div className="text-sm font-medium text-foreground">{change.field}</div>
                                          </div>
                                          <div className="min-w-0">
                                            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:hidden">
                                              Before
                                            </div>
                                            <div className="break-words text-sm text-muted-foreground">{change.before}</div>
                                          </div>
                                          <div className="min-w-0">
                                            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:hidden">
                                              After
                                            </div>
                                            <div className="break-words text-sm font-semibold text-foreground">{change.after}</div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="rounded-2xl border border-dashed border-border/70 bg-muted/10 px-4 py-4 text-sm text-muted-foreground">
                                    No field changes recorded for this audit event.
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {activityEntries.length > auditPreviewCount ? (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">
                        Showing {visibleAuditEntries.length} of {activityEntries.length} audit entries.
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto rounded-full px-0 text-sm font-semibold text-emerald-700 hover:bg-transparent hover:text-emerald-800"
                        onClick={() => setShowAllAuditEntries((current) => !current)}
                      >
                        {showAllAuditEntries ? "Hide Older Audit Entries" : `View ${activityEntries.length - auditPreviewCount} More`}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default PartMasterDetailPage
