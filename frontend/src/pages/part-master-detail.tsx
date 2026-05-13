import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SectionHint } from "@/components/ui/section-hint"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApiError, getJson, patchJson } from "@/lib/api"
import { hasPermission, isSuperuser } from "@/lib/permissions"
import { RateVersionHistoryButton } from "@/components/contractors/RateVersionHistoryDrawer"
import { PartAnalyticsDashboard } from "@/components/parts/analytics/PartAnalyticsDashboard"
import type { PartMasterPublic } from "@/pages/part-master"

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
  weight_per_piece: "Weight per unit",
  labour_headcount: "Labour count",
  standard_man_hours: "Standard man-hours",
  base_rate: "Base rate",
  rate_unit_type: "Rate unit",
  org_unit_id: "Plant / org unit",
  effective_from: "Effective from",
  effective_to: "Effective to",
  is_active: "Active flag",
  status: "Record status",
  notes: "Notes",
}

function humanizeAuditField(key: string): string {
  return AUDIT_FIELD_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
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

function auditAccentBorder(action: string): string {
  const u = action.toUpperCase()
  if (u === "DEACTIVATED" || u === "SUPERSEDED") return "border-l-rose-500"
  return "border-l-emerald-500"
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

export function PartMasterDetailPage() {
  const { partMasterId } = useParams()
  const id = Number(partMasterId)
  const [mainTab, setMainTab] = React.useState("intelligence")
  const [row, setRow] = React.useState<PartMasterPublic | null>(null)
  const [audits, setAudits] = React.useState<PartMasterAuditEntry[]>([])
  const [baseRate, setBaseRate] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [labourHeadcount, setLabourHeadcount] = React.useState("")
  const [standardManHours, setStandardManHours] = React.useState("")

  const canView = hasPermission("part_master.view") || isSuperuser()
  const canUpdate = hasPermission("part_master.update") || isSuperuser()

  const loadPart = React.useCallback(async () => {
    if (!canView || !Number.isFinite(id)) return
    try {
      const r = await getJson<PartMasterPublic>(`/part-master/${id}`)
      setRow(r)
      setBaseRate(String(r.base_rate))
      setDescription(r.description ?? "")
      setLabourHeadcount(r.labour_headcount != null ? String(r.labour_headcount) : "")
      setStandardManHours(r.standard_man_hours != null ? String(r.standard_man_hours) : "")
    } catch {
      setRow(null)
    }
  }, [canView, id])

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

  async function save() {
    if (!row || !canUpdate) return
    const br = Number(baseRate)
    if (!Number.isFinite(br) || br <= 0) {
      toast.error("Enter a valid base rate")
      return
    }
    const lh = labourHeadcount.trim()
    const smh = standardManHours.trim()
    let labourParsed: number | null = null
    if (lh) {
      const n = Number.parseInt(lh, 10)
      if (!Number.isFinite(n) || n < 0) {
        toast.error("Labour count must be a non-negative whole number")
        return
      }
      labourParsed = n
    }
    let smhParsed: number | null = null
    if (smh) {
      const n = Number(smh)
      if (!Number.isFinite(n) || n < 0) {
        toast.error("Man-hours must be a non-negative number")
        return
      }
      smhParsed = n
    }
    try {
      const updated = await patchJson<PartMasterPublic>(`/part-master/${row.id}`, {
        base_rate: br,
        description: description.trim() || null,
        labour_headcount: labourParsed,
        standard_man_hours: smhParsed,
      })
      setRow(updated)
      toast.success("Saved")
      await loadAudits()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Save failed")
    }
  }

  if (!canView) {
    return (
      <Card className="rounded-2xl border-border/50 shadow-sm">
        <CardHeader>
          <CardTitle>Part master</CardTitle>
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

  const weightBased = row.pricing_method === "weight_based"
  const rateLabel = weightBased ? "Rate per kg (base)" : "Base rate"
  const plantLabel = row.org_unit_name ?? `Plant #${row.org_unit_id}`
  const metadataHint = `${plantLabel}. Pricing: ${row.pricing_method.replace(/_/g, " ")}. Rate unit: ${row.rate_unit_type.replace(/_/g, " ")}. Billing UOM: ${row.unit_type}. Effective ${row.effective_from}${row.effective_to ? ` → ${row.effective_to}` : ""}. Record status: ${row.status}. Active flag: ${row.is_active ? "on" : "off"}.`

  return (
    <div className="w-full min-w-0 space-y-6 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-6">
        <div className="min-w-0 space-y-1">
          <div className="text-xs text-muted-foreground">
            <Link to="/dashboard/part-master" className="underline-offset-2 hover:underline">
              Part master
            </Link>
            <span className="mx-1">/</span>
            <span>Detail</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{row.part_name}</h1>
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
            Intelligence
          </TabsTrigger>
          <TabsTrigger value="master" className="rounded-lg">
            Master data & audit
          </TabsTrigger>
        </TabsList>

        <TabsContent value="intelligence" className="mt-6 min-w-0 outline-none">
          <PartAnalyticsDashboard partMasterId={row.id} />
        </TabsContent>

        <TabsContent value="master" className="mt-6 min-w-0 space-y-8 pb-28 outline-none">
          <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-4 sm:px-5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Part number</p>
            <p className="mt-1 break-all font-mono text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {row.part_code}
            </p>
          </div>

          <div className="grid w-full min-w-0 gap-6 xl:grid-cols-12 xl:items-start">
            <Card className="min-w-0 rounded-2xl border-border/50 shadow-sm xl:col-span-4">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-base">Description</CardTitle>
                <SectionHint text="Shown on lookups and rate cards where there is room." />
              </CardHeader>
              <CardContent>
                <Textarea
                  rows={5}
                  className="min-h-[120px] resize-y rounded-xl border-border/60 bg-background/80"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={!canUpdate}
                />
              </CardContent>
            </Card>

            <Card className="min-w-0 rounded-2xl border-border/50 shadow-sm xl:col-span-5">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-base">Commercial</CardTitle>
                <SectionHint text="Plant baseline used for negotiations and work order pricing. Edit the rate here; use version history for past snapshots." />
              </CardHeader>
              <CardContent className="grid gap-4">
                {weightBased ? (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Weight (kg)</span>
                    <p className="mt-0.5 font-medium tabular-nums">
                      {row.weight_per_piece != null ? String(row.weight_per_piece) : "—"}
                    </p>
                  </div>
                ) : (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Weight per piece (kg, optional)</span>
                    <p className="mt-0.5 font-medium tabular-nums">
                      {row.weight_per_piece != null ? String(row.weight_per_piece) : "—"}
                    </p>
                  </div>
                )}
                <div className="grid max-w-full gap-1.5 sm:max-w-sm">
                  <Label htmlFor="br">{rateLabel}</Label>
                  <Input
                    id="br"
                    className="rounded-xl border-border/60 font-medium tabular-nums"
                    value={baseRate}
                    onChange={(e) => setBaseRate(e.target.value)}
                    disabled={!canUpdate}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0 rounded-2xl border-border/50 shadow-sm xl:col-span-3">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-base">Labour norms</CardTitle>
                <SectionHint text="Typical crew size and standard hours for planning. Not used in billing math." />
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <div className="grid min-w-0 gap-1.5 sm:col-span-2 xl:col-span-1">
                  <Label htmlFor="lc">Labour count</Label>
                  <Input
                    id="lc"
                    type="number"
                    min={0}
                    step={1}
                    className="rounded-xl border-border/60"
                    value={labourHeadcount}
                    onChange={(e) => setLabourHeadcount(e.target.value)}
                    disabled={!canUpdate}
                  />
                </div>
                <div className="grid min-w-0 gap-1.5 sm:col-span-2 xl:col-span-1">
                  <Label htmlFor="mh">Standard man-hours</Label>
                  <Input
                    id="mh"
                    type="number"
                    step="any"
                    min={0}
                    className="rounded-xl border-border/60"
                    value={standardManHours}
                    onChange={(e) => setStandardManHours(e.target.value)}
                    disabled={!canUpdate}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <section className="min-w-0 border-t border-border/70 pt-8" aria-labelledby="part-audit-heading">
            <h2 id="part-audit-heading" className="mb-1 text-base font-semibold tracking-tight">
              Audit trail
            </h2>
            <p className="mb-5 text-xs text-muted-foreground">
              Who changed what and when. Full snapshots: <span className="font-medium text-foreground/80">View history</span>.
            </p>

            {activityEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No audit entries yet.</p>
            ) : (
              <ul className="space-y-5">
                {activityEntries.map((a) => {
                  const changes = auditChangeRows(a)
                  const { date, time } = formatAuditDateTime(a.created_at)
                  const actor = a.changed_by_name ?? (a.changed_by != null ? `User #${a.changed_by}` : "—")
                  return (
                    <li key={a.id} className={`flex gap-4 border-l-2 pl-4 ${auditAccentBorder(a.action)}`}>
                      <div className="w-28 shrink-0 text-right text-[11px] tabular-nums leading-snug text-muted-foreground sm:w-32">
                        <time dateTime={a.created_at}>
                          <div>{date}</div>
                          {time ? <div>{time}</div> : null}
                        </time>
                      </div>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="text-sm text-muted-foreground">
                          <span className="text-foreground">{auditActionLabel(a.action)}</span>
                          {" by "}
                          <span className="font-semibold text-foreground">{actor}</span>
                        </p>
                        {changes.length > 0 ? (
                          <ul className="space-y-0.5">
                            {changes.map((c) => (
                              <li key={`${a.id}-${c.key}`} className="text-sm leading-relaxed text-muted-foreground">
                                <span>{c.field}</span>
                                <span> : </span>
                                <span>{c.before}</span>
                                <span> → </span>
                                <span className="font-semibold text-foreground">{c.after}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted-foreground">No field changes recorded for this event.</p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {canUpdate ? (
            <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-border/70 bg-gray-50/95 px-4 py-4 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
              <Button className="rounded-xl" onClick={() => void save()}>
                Save changes
              </Button>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default PartMasterDetailPage
