import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SectionHint } from "@/components/ui/section-hint"
import { ApiError, getJson, patchJson } from "@/lib/api"
import { hasPermission, isSuperuser } from "@/lib/permissions"
import { RateVersionHistoryButton } from "@/components/contractors/RateVersionHistoryDrawer"
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

function formatAuditWhen(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d)
  } catch {
    return iso
  }
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

/** Hide internal snapshot rows; same moment as CREATED/UPDATED and covered by View history. */
const ACTIVITY_HIDDEN = new Set(["VERSION_CREATED"])

export function PartMasterDetailPage() {
  const { partMasterId } = useParams()
  const id = Number(partMasterId)
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
    () => audits.filter((a) => !ACTIVITY_HIDDEN.has(a.action)),
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
    <div className="w-full min-w-0 space-y-6 pb-28">
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
        <h2 id="part-audit-heading" className="mb-3 text-base font-semibold tracking-tight">
          Activity
        </h2>
        <p className="mb-3 max-w-xl text-xs text-muted-foreground">
          Logged changes to this part. Version snapshots are available from{" "}
          <span className="font-medium text-foreground/80">View history</span> above.
        </p>

        {activityEntries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 bg-muted/10 px-3 py-8 text-center text-sm text-muted-foreground">
            No activity yet.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-border/50 divide-y divide-border/50">
            {activityEntries.map((a) => (
              <li
                key={a.id}
                className="flex flex-col gap-0.5 px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-8 sm:px-4"
              >
                <time className="shrink-0 text-xs tabular-nums text-muted-foreground" dateTime={a.created_at}>
                  {formatAuditWhen(a.created_at)}
                </time>
                <span className="min-w-[8rem] shrink-0 text-sm font-medium text-foreground">{auditActionLabel(a.action)}</span>
                <span className="min-w-0 truncate text-xs text-muted-foreground sm:text-sm">
                  {a.changed_by_name ?? (a.changed_by != null ? `#${a.changed_by}` : "—")}
                </span>
              </li>
            ))}
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
    </div>
  )
}

export default PartMasterDetailPage
