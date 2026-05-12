import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, getJson, postJson } from "@/lib/api"
import { canListOrgUnitsForAssignments, hasPermission, isSuperuser } from "@/lib/permissions"
import { SectionHint } from "@/components/ui/section-hint"
import type { PartMasterPublic } from "@/pages/part-master"

type OrgUnitLite = { id: number; name: string; type: string }

export function PartMasterCreatePage() {
  const navigate = useNavigate()
  const canCreate = hasPermission("part_master.create") || isSuperuser()

  const [plants, setPlants] = React.useState<OrgUnitLite[]>([])
  const [saving, setSaving] = React.useState(false)

  const [form, setForm] = React.useState({
    org_unit_id: "",
    part_code: "",
    part_name: "",
    description: "",
    unit_type: "PCS",
    pricing_method: "piece_based",
    weight_per_piece: "",
    base_rate: "",
    rate_unit_type: "per_piece",
    labour_headcount: "",
    standard_man_hours: "",
  })

  React.useEffect(() => {
    if (!canListOrgUnitsForAssignments()) return
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
  }, [])

  async function submit() {
    if (!form.part_code.trim() || !form.part_name.trim()) {
      toast.error("Part code and name are required")
      return
    }
    if (!form.org_unit_id) {
      toast.error("Select a plant")
      return
    }
    const br = Number(form.base_rate)
    if (!Number.isFinite(br) || br <= 0) {
      toast.error("Enter a valid base rate greater than zero")
      return
    }

    const w = form.weight_per_piece.trim()
    const lh = form.labour_headcount.trim()
    const smh = form.standard_man_hours.trim()
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

    setSaving(true)
    toast.loading("Creating part…", { id: "part-master-create" })
    try {
      const created = await postJson<PartMasterPublic>("/part-master", {
        part_code: form.part_code.trim(),
        part_name: form.part_name.trim(),
        description: form.description.trim() || null,
        unit_type: form.unit_type.trim(),
        pricing_method: form.pricing_method,
        weight_per_piece: w ? Number(w) : null,
        labour_headcount: labourParsed,
        standard_man_hours: smhParsed,
        base_rate: br,
        rate_unit_type: form.rate_unit_type,
        org_unit_id: Number(form.org_unit_id),
        effective_from: new Date().toISOString().slice(0, 10),
        effective_to: null,
        is_active: true,
        status: "active",
        notes: null,
      })
      toast.success("Part created", { id: "part-master-create" })
      navigate(`/dashboard/part-master/${created.id}`)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Create failed", { id: "part-master-create" })
    } finally {
      setSaving(false)
    }
  }

  if (!canCreate) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Create part</CardTitle>
          <CardDescription>
            You need <span className="font-mono">part_master.create</span>.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const weightBased = form.pricing_method === "weight_based"

  return (
    <div className="w-full min-w-0 space-y-6">
      <header className="space-y-1 border-b border-border/70 pb-6">
        <div className="text-xs text-muted-foreground">
          <Link to="/dashboard/part-master" className="underline-offset-2 hover:underline">
            Part master
          </Link>
          <span className="mx-1">/</span>
          <span>New</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Create part</h1>
          <SectionHint text="Define commercial terms, units, optional labour norms. New parts start active from today with open-ended validity unless you edit them later on the part detail screen." />
        </div>
      </header>

      <div className="grid w-full min-w-0 gap-6 xl:grid-cols-12 xl:items-start">
        <Card className="min-w-0 rounded-2xl border-border/50 shadow-sm xl:col-span-4">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Identity & plant</CardTitle>
            <SectionHint text="Part code is normalized to uppercase when saved." />
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <div className="grid gap-1 sm:col-span-2 xl:col-span-1">
              <Label>Plant</Label>
              <select
                className="h-9 w-full rounded-md border bg-white px-2 text-sm"
                value={form.org_unit_id}
                onChange={(e) => setForm((f) => ({ ...f, org_unit_id: e.target.value }))}
              >
                <option value="">Select…</option>
                {plants.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid min-w-0 gap-1 sm:col-span-2 xl:col-span-1">
              <Label>Part code</Label>
              <Input value={form.part_code} onChange={(e) => setForm((f) => ({ ...f, part_code: e.target.value }))} />
            </div>
            <div className="grid min-w-0 gap-1 sm:col-span-2 xl:col-span-1">
              <Label>Part name</Label>
              <Input value={form.part_name} onChange={(e) => setForm((f) => ({ ...f, part_name: e.target.value }))} />
            </div>
            <div className="grid min-w-0 gap-1 sm:col-span-2 xl:col-span-1">
              <Label>Description</Label>
              <Textarea
                rows={5}
                className="min-h-[120px] resize-y rounded-xl border-border/60 bg-background/80"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 rounded-2xl border-border/50 shadow-sm xl:col-span-5">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Commercial</CardTitle>
            <SectionHint text="Weight-based parts bill in kg and use rate per kg. Piece- or time-based parts use your billing unit (PCS, HR, etc.) with a matching rate unit." />
          </CardHeader>
          <CardContent
            className={
              weightBased
                ? "grid gap-4 sm:grid-cols-2 2xl:grid-cols-4"
                : "grid gap-4 sm:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3"
            }
          >
          <div className="grid gap-1">
            <Label>Pricing method</Label>
            <select
              className="h-9 w-full rounded-md border bg-white px-2 text-sm"
              value={form.pricing_method}
              onChange={(e) => {
                const pm = e.target.value
                setForm((f) => {
                  if (pm === "weight_based") {
                    return {
                      ...f,
                      pricing_method: pm,
                      rate_unit_type: "per_kg",
                      unit_type: f.unit_type === "PCS" ? "KG" : f.unit_type,
                    }
                  }
                  const ru = f.rate_unit_type === "per_kg" ? "per_piece" : f.rate_unit_type
                  return { ...f, pricing_method: pm, rate_unit_type: ru }
                })
              }}
            >
              <option value="piece_based">Piece / time / other unit</option>
              <option value="weight_based">Weight (kg)</option>
            </select>
          </div>
          <div className="grid gap-1">
            <Label>Unit type (billing UOM)</Label>
            <Input
              value={form.unit_type}
              onChange={(e) => setForm((f) => ({ ...f, unit_type: e.target.value }))}
              placeholder="PCS, KG, HR…"
            />
          </div>
          {weightBased ? (
            <>
              <div className="grid gap-1">
                <Label>Weight (kg)</Label>
                <Input
                  type="number"
                  step="any"
                  min={0}
                  value={form.weight_per_piece}
                  onChange={(e) => setForm((f) => ({ ...f, weight_per_piece: e.target.value }))}
                  placeholder="Kg per billed quantity"
                />
              </div>
              <div className="grid gap-1">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="pm-rate-kg">Rate per kg</Label>
                  <SectionHint text="Stored as the part base rate with rate unit per kg." />
                </div>
                <Input
                  id="pm-rate-kg"
                  type="number"
                  step="any"
                  min={0}
                  value={form.base_rate}
                  onChange={(e) => setForm((f) => ({ ...f, base_rate: e.target.value }))}
                />
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-1">
                <Label>Weight per piece (kg, optional)</Label>
                <Input
                  type="number"
                  step="any"
                  min={0}
                  value={form.weight_per_piece}
                  onChange={(e) => setForm((f) => ({ ...f, weight_per_piece: e.target.value }))}
                  placeholder="Conversion / reference only"
                />
              </div>
              <div className="grid gap-1">
                <Label>Rate unit</Label>
                <select
                  className="h-9 w-full rounded-md border bg-white px-2 text-sm"
                  value={form.rate_unit_type}
                  onChange={(e) => setForm((f) => ({ ...f, rate_unit_type: e.target.value }))}
                >
                  <option value="per_piece">Per piece</option>
                  <option value="per_unit">Per unit</option>
                  <option value="per_box">Per box</option>
                  <option value="per_nos">Per nos</option>
                </select>
              </div>
              <div className="grid gap-1 sm:col-span-2 2xl:col-span-3">
                <Label>Base rate</Label>
                <Input
                  type="number"
                  step="any"
                  min={0}
                  value={form.base_rate}
                  onChange={(e) => setForm((f) => ({ ...f, base_rate: e.target.value }))}
                />
              </div>
            </>
          )}
          </CardContent>
        </Card>

        <Card className="min-w-0 rounded-2xl border-border/50 shadow-sm xl:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Labour norms (optional)</CardTitle>
            <SectionHint text="Typical crew size and standard hours for planning. These values are not used in billing calculations." />
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <div className="grid min-w-0 gap-1 sm:col-span-2 xl:col-span-1">
              <Label>Labour count</Label>
              <Input
                type="number"
                min={0}
                step={1}
                value={form.labour_headcount}
                onChange={(e) => setForm((f) => ({ ...f, labour_headcount: e.target.value }))}
                placeholder="Headcount"
              />
            </div>
            <div className="grid min-w-0 gap-1 sm:col-span-2 xl:col-span-1">
              <Label>Standard man-hours</Label>
              <Input
                type="number"
                step="any"
                min={0}
                value={form.standard_man_hours}
                onChange={(e) => setForm((f) => ({ ...f, standard_man_hours: e.target.value }))}
                placeholder="Hours"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-border/70 bg-gray-50/95 px-4 py-4 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <Button variant="outline" asChild>
          <Link to="/dashboard/part-master">Cancel</Link>
        </Button>
        <Button disabled={saving} onClick={() => void submit()}>
          {saving ? "Saving…" : "Create part"}
        </Button>
      </div>
    </div>
  )
}

export default PartMasterCreatePage
