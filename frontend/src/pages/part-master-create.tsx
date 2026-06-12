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
    labour_cost: "",
    man_days: "",
    base_rate: "",
    rate_unit_type: "per_piece",
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

  const weightBased = form.pricing_method === "weight_based"
  const derivedRatePerKg = React.useMemo(
    () => (weightBased ? computeRatePerKg(form.weight_per_piece, form.labour_cost, form.man_days) : null),
    [weightBased, form.weight_per_piece, form.labour_cost, form.man_days],
  )

  async function submit() {
    if (!form.part_code.trim() || !form.part_name.trim()) {
      toast.error("Part code and name are required")
      return
    }
    if (!form.org_unit_id) {
      toast.error("Select a plant")
      return
    }
    if (!form.unit_type.trim()) {
      toast.error("Unit type (billing UOM) is required")
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

    const wb = form.pricing_method === "weight_based"
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
        labour_cost: wb ? Number(labourCostStr) : null,
        man_days: wb ? Number(manDaysStr) : null,
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
          <CardTitle>Create Part</CardTitle>
          <CardDescription>
            You need <span className="font-mono">part_master.create</span>.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <header className="space-y-1 border-b border-border/70 pb-6">
        <div className="text-xs text-muted-foreground">
          <Link to="/dashboard/part-master" className="underline-offset-2 hover:underline">
            Part Master
          </Link>
          <span className="mx-1">/</span>
          <span>New</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight"> Create Part </h1>
          <SectionHint text="Weight-based: man days × labour cost ÷ weight (kg) sets rate per kg. New parts start active from today; adjust validity on the part detail screen if needed." />
        </div>
      </header>

      <div className="grid w-full min-w-0 gap-6 xl:grid-cols-12 xl:items-start">
        <Card className="min-w-0 rounded-2xl border-border/50 shadow-sm xl:col-span-5">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Identity & plant</CardTitle>
            <SectionHint text="Part code is normalized to uppercase when saved." />
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <div className="grid gap-1 sm:col-span-2 xl:col-span-1">
              <Label showRequired>Plant</Label>
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
              <Label showRequired>Part code</Label>
              <Input value={form.part_code} onChange={(e) => setForm((f) => ({ ...f, part_code: e.target.value }))} />
            </div>
            <div className="grid min-w-0 gap-1 sm:col-span-2 xl:col-span-1">
              <Label showRequired>Part name</Label>
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

        <Card className="min-w-0 rounded-2xl border-border/50 shadow-sm xl:col-span-7">
          <CardHeader className="flex flex-row items-center justify-between space-y-5 pb-3">
            <CardTitle className="text-base">Commercial</CardTitle>
            <SectionHint text="Weight-based parts derive rate per kg from labour inputs. Piece-based parts use billing UOM + rate unit + should cost." />
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 space-y-5">
            <div className="grid gap-1">
              <Label showRequired>Pricing method</Label>
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
                    return {
                      ...f,
                      pricing_method: pm,
                      rate_unit_type: ru,
                      labour_cost: "",
                      man_days: "",
                    }
                  })
                }}
              >
                <option value="piece_based">Piece / time / other unit</option>
                <option value="weight_based">Weight (kg)</option>
              </select>
            </div>
            <div className="grid gap-1">
              <Label showRequired>Unit type (billing UOM)</Label>
              <Input
                value={form.unit_type}
                onChange={(e) => setForm((f) => ({ ...f, unit_type: e.target.value }))}
                placeholder="PCS, KG, HR…"
              />
            </div>
            {weightBased ? (
              <>
                <div className="grid gap-1">
                  <Label showRequired>Labour cost</Label>
                  <Input
                    inputMode="decimal"
                    value={form.labour_cost}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, labour_cost: sanitizeDecimalString(e.target.value) }))
                    }
                    placeholder="e.g. 5000"
                    className="tabular-nums"
                  />
                </div>
                <div className="grid gap-1">
                  <Label showRequired>Man days</Label>
                  <Input
                    inputMode="decimal"
                    value={form.man_days}
                    onChange={(e) => setForm((f) => ({ ...f, man_days: sanitizeDecimalString(e.target.value) }))}
                    placeholder="e.g. 2.5"
                    className="tabular-nums"
                  />
                </div>
                <div className="grid gap-1">
                  <Label showRequired>Weight (kg)</Label>
                  <Input
                    inputMode="decimal"
                    value={form.weight_per_piece}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, weight_per_piece: sanitizeDecimalString(e.target.value) }))
                    }
                    placeholder="e.g. 100"
                    className="tabular-nums"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="pm-create-rate-kg">Rate per kg (calculated)</Label>
                  <Input
                    id="pm-create-rate-kg"
                    readOnly
                    value={derivedRatePerKg != null ? String(derivedRatePerKg) : ""}
                    placeholder="man days × labour cost ÷ weight"
                    disabled
                    className="bg-muted/40 font-medium tabular-nums"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-1">
                  <Label>Weight per piece (kg, optional)</Label>
                  <Input
                    inputMode="decimal"
                    value={form.weight_per_piece}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, weight_per_piece: sanitizeDecimalString(e.target.value) }))
                    }
                    placeholder="Reference only"
                    className="tabular-nums"
                  />
                </div>
                <div className="grid gap-1">
                  <Label showRequired>Rate unit</Label>
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
                <div className="grid gap-1 sm:col-span-2">
                  <Label showRequired>Should cost</Label>
                  <Input
                    inputMode="decimal"
                    value={form.base_rate}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, base_rate: sanitizeDecimalString(e.target.value) }))
                    }
                    className="font-medium tabular-nums"
                  />
                </div>
              </>
            )} 
  <div className="flex flex-wrap items-center gap-2">
    <Button variant="outline" asChild>
      <Link to="/dashboard/part-master">Cancel</Link>
    </Button>

    <Button disabled={saving} onClick={() => void submit()}>
      {saving ? "Saving…" : "Create"}
    </Button>
  </div>
          </CardContent>
         
        </Card>
      </div>

      {/* <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-border/70 bg-gray-50/95 px-4 py-4 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <Button variant="outline" asChild>
          <Link to="/dashboard/part-master">Cancel</Link>
        </Button>
        <Button disabled={saving} onClick={() => void submit()}>
          {saving ? "Saving…" : "Create"}
        </Button>
      </div> */}
    </div>
  )
}

export default PartMasterCreatePage
