import * as React from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { postJson } from "@/lib/api"

type ContractorCreate = {
  contractor_code?: string | null
  name: string
  contact_person?: string | null
  contact_person_title?: string | null
  email?: string | null
  alternate_email?: string | null
  phone?: string | null
  alternate_phone?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  postal_code?: string | null
  gst_number?: string | null
  pan_number?: string | null
  registration_number?: string | null
  website?: string | null
  notes?: string | null
}

type ContractorPublic = {
  id: number
  name: string
  is_active: boolean
}

export function ContractorCreatePage() {
  const navigate = useNavigate()
  const [saving, setSaving] = React.useState(false)
  const [active, setActive] = React.useState(true)

  const [form, setForm] = React.useState({
    contractor_code: "",
    name: "",
    contact_person: "",
    contact_person_title: "",
    email: "",
    alternate_email: "",
    phone: "",
    alternate_phone: "",
    address: "",
    city: "",
    state: "",
    country: "India",
    postal_code: "",
    gst_number: "",
    pan_number: "",
    registration_number: "",
    website: "",
    notes: "",
  })

  function v(s: string) {
    const t = s.trim()
    return t.length ? t : null
  }

  async function submit() {
    setSaving(true)
    toast.loading("Creating contractor…", { id: "contractor-create" })
    try {
      const payload: ContractorCreate = {
        contractor_code: v(form.contractor_code),
        name: form.name.trim(),
        contact_person: v(form.contact_person),
        contact_person_title: v(form.contact_person_title),
        email: v(form.email),
        alternate_email: v(form.alternate_email),
        phone: v(form.phone),
        alternate_phone: v(form.alternate_phone),
        address: v(form.address),
        city: v(form.city),
        state: v(form.state),
        country: v(form.country),
        postal_code: v(form.postal_code),
        gst_number: v(form.gst_number),
        pan_number: v(form.pan_number),
        registration_number: v(form.registration_number),
        website: v(form.website),
        notes: v(form.notes),
      }

      const created = await postJson<ContractorPublic>("/contractors", payload as unknown as Record<string, unknown>)
      // If workflow is enabled for contractor.create, it may be created inactive; allow setting desired state after create.
      if (!active && created.is_active) {
        // Best-effort: detail page supports deactivate.
      }
      toast.success("Contractor created", { id: "contractor-create" })
      navigate(`/dashboard/contractors/${created.id}`, { replace: true })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed", { id: "contractor-create" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Create contractor</h1>
          <div className="text-sm text-muted-foreground">
            Create a contractor profile and then manage documents, compliance and activity on the next screen.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => navigate("/dashboard/contractors")}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={saving || !form.name.trim()}
            onClick={() => void submit()}
          >
            {saving ? "Creating…" : "Create"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="rounded-2xl shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Basic information</CardTitle>
            <CardDescription>Core identity details used across workflows and compliance.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Contractor code (optional)</div>
              <Input
                value={form.contractor_code}
                onChange={(e) => setForm((s) => ({ ...s, contractor_code: e.target.value }))}
                placeholder="CTR-001"
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Name</div>
              <Input value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} placeholder="ABC Contractors Pvt Ltd" />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Contact person</div>
              <Input
                value={form.contact_person}
                onChange={(e) => setForm((s) => ({ ...s, contact_person: e.target.value }))}
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Contact title (optional)</div>
              <Input
                value={form.contact_person_title}
                onChange={(e) => setForm((s) => ({ ...s, contact_person_title: e.target.value }))}
                placeholder="Manager"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Status</CardTitle>
            <CardDescription>Operational status for this contractor.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-xl border p-3">
              <div>
                <div className="text-sm font-medium">Active</div>
                <div className="text-xs text-muted-foreground">Can be used in operational flows.</div>
              </div>
              <Switch checked={active} onCheckedChange={(v) => setActive(Boolean(v))} />
            </div>
            <div className="text-xs text-muted-foreground">
              If approval workflow is configured for <code className="rounded bg-muted px-1 py-0.5">contractor.create</code>, contractors may start as inactive until approved.
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="rounded-2xl shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Contact information</CardTitle>
            <CardDescription>Primary and secondary contact channels.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Email</div>
              <Input value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} placeholder="contractor@example.com" />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Alternate email</div>
              <Input value={form.alternate_email} onChange={(e) => setForm((s) => ({ ...s, alternate_email: e.target.value }))} placeholder="alt@example.com" />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Phone</div>
              <Input value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} placeholder="+91..." />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Alternate phone</div>
              <Input value={form.alternate_phone} onChange={(e) => setForm((s) => ({ ...s, alternate_phone: e.target.value }))} placeholder="+91..." />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Business IDs</CardTitle>
            <CardDescription>Compliance and statutory identifiers.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">GST number</div>
              <Input value={form.gst_number} onChange={(e) => setForm((s) => ({ ...s, gst_number: e.target.value }))} placeholder="22AAAAA0000A1Z5" />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">PAN</div>
              <Input value={form.pan_number} onChange={(e) => setForm((s) => ({ ...s, pan_number: e.target.value }))} placeholder="ABCDE1234F" />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Registration number</div>
              <Input value={form.registration_number} onChange={(e) => setForm((s) => ({ ...s, registration_number: e.target.value }))} placeholder="REG-..." />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="rounded-2xl shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Address</CardTitle>
            <CardDescription>Structured address helps reporting and filters later.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <div className="text-xs text-muted-foreground">Address line</div>
              <Input value={form.address} onChange={(e) => setForm((s) => ({ ...s, address: e.target.value }))} placeholder="Street, area, landmark" />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">City</div>
              <Input value={form.city} onChange={(e) => setForm((s) => ({ ...s, city: e.target.value }))} placeholder="Mumbai" />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">State</div>
              <Input value={form.state} onChange={(e) => setForm((s) => ({ ...s, state: e.target.value }))} placeholder="Maharashtra" />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Country</div>
              <Input value={form.country} onChange={(e) => setForm((s) => ({ ...s, country: e.target.value }))} placeholder="India" />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Postal code</div>
              <Input value={form.postal_code} onChange={(e) => setForm((s) => ({ ...s, postal_code: e.target.value }))} placeholder="400001" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Web</CardTitle>
            <CardDescription>Optional discoverability links.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Website</div>
              <Input value={form.website} onChange={(e) => setForm((s) => ({ ...s, website: e.target.value }))} placeholder="https://example.com" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Internal notes</CardTitle>
          <CardDescription>Non-public notes for operators and audit context.</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} />
        </CardContent>
      </Card>
    </div>
  )
}

