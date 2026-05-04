import * as React from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ContractorRatesPanel } from "@/components/contractors/ContractorRatesPanel"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ContractorDocuments, type ContractorDocument } from "@/components/contractors/ContractorDocuments"
import { ContractorHeader } from "@/components/contractors/ContractorHeader"
import { ContractorStats } from "@/components/contractors/ContractorStats"
import { ContractorOverview } from "@/components/contractors/ContractorOverview"
import { ContractorPlants } from "@/components/contractors/ContractorPlants"
import { ContractorTimeline } from "@/components/contractors/ContractorTimeline"
import { getJson, patchJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"

type Compliance = {
  state: "compliant" | "warning" | "non_compliant" | "no_data"
  expired_documents: number
  expiring_soon: number
  pending_verification: number
  missing_critical_types: string[]
  next_expiry: string | null
}

type ContractorPublic = {
  id: number
  contractor_code: string | null
  name: string
  legal_name: string | null
  trade_name: string | null
  pan: string | null
  gstin: string | null
  cin: string | null
  contractor_type: string | null
  status: string
  contact_person: string | null
  contact_person_title: string | null
  email: string | null
  alternate_email: string | null
  phone: string | null
  alternate_phone: string | null
  address: string | null
  city: string | null
  state: string | null
  country: string | null
  postal_code: string | null
  gst_number: string | null
  pan_number: string | null
  registration_number: string | null
  website: string | null
  notes: string | null
  is_active: boolean
  plant_count: number
  compliance: Compliance | null
  created_by: number | null
  updated_by: number | null
  created_at: string
  updated_at: string
}

export function ContractorDetailPage() {
  const params = useParams()
  const id = Number(params.id)
  const [searchParams, setSearchParams] = useSearchParams()

  const [contractor, setContractor] = React.useState<ContractorPublic | null>(null)
  const [docs, setDocs] = React.useState<ContractorDocument[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [editOpen, setEditOpen] = React.useState(searchParams.get("edit") === "1")
  const [saving, setSaving] = React.useState(false)
  const warnDays = 7

  const canEdit = hasPermission("contractor.update")
  const canActivate = hasPermission("contractor.activate") || hasPermission("contractor.update")
  const canViewRates = hasPermission("contractor_rates.view")

  const rawTab = (searchParams.get("tab") ?? "overview").toLowerCase()
  const focusParam = searchParams.get("focus")
  const focusRateId = focusParam ? Number(focusParam) : null

  // Tabs available on the contractor master profile. The "rates" tab is a
  // read-only view of negotiation history — actions (create / submit / cancel /
  // add round) live on the dedicated `/dashboard/negotiated-rates/:id` page.
  const allowedTabs = canViewRates
    ? (["overview", "documents", "plants", "rates", "timeline"] as const)
    : (["overview", "documents", "plants", "timeline"] as const)
  const tabValue: string = (allowedTabs as readonly string[]).includes(rawTab)
    ? rawTab
    : "overview"

  async function loadContractor() {
    setError(null)
    try {
      const c = await getJson<ContractorPublic>(`/contractors/${id}`)
      setContractor(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contractor")
      setContractor(null)
    }
  }

  async function loadDocs() {
    try {
      const d = await getJson<ContractorDocument[]>(`/contractors/${id}/documents`)
      setDocs(d)
    } catch {
      setDocs([])
    }
  }

  React.useEffect(() => {
    if (!Number.isFinite(id) || id <= 0) {
      setError("Invalid contractor id")
      return
    }
    void loadContractor()
    void loadDocs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function changeStatus(status: string, reason?: string) {
    if (!contractor) return
    try {
      const updated = await patchJson<ContractorPublic>(`/contractors/${contractor.id}/status`, {
        status,
        reason: reason || null,
      })
      setContractor(updated)
      toast.success(`Status updated to ${updated.status}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to change status")
    }
  }

  async function saveEdit(form: ContractorEditForm) {
    if (!contractor) return
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: form.name?.trim() || contractor.name,
        legal_name: form.legal_name?.trim() || null,
        trade_name: form.trade_name?.trim() || null,
        pan: form.pan?.trim().toUpperCase() || null,
        gstin: form.gstin?.trim().toUpperCase() || null,
        cin: form.cin?.trim().toUpperCase() || null,
        contractor_type: form.contractor_type || null,
        contact_person: form.contact_person?.trim() || null,
        email: form.email?.trim() || null,
        phone: form.phone?.trim() || null,
        address: form.address || null,
        city: form.city?.trim() || null,
        state: form.state?.trim() || null,
        country: form.country?.trim() || null,
        postal_code: form.postal_code?.trim() || null,
        notes: form.notes || null,
      }
      const updated = await patchJson<ContractorPublic>(`/contractors/${contractor.id}`, payload)
      setContractor(updated)
      setEditOpen(false)
      const next = new URLSearchParams(searchParams)
      next.delete("edit")
      setSearchParams(next, { replace: true })
      toast.success("Contractor updated")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update")
    } finally {
      setSaving(false)
    }
  }

  if (!contractor && error) {
    return (
      <Card className="border-destructive/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Unable to load contractor</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-destructive">{error}</CardContent>
      </Card>
    )
  }

  if (!contractor) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Loading…</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Fetching contractor details.</CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-6">
      <ContractorHeader
        name={contractor.name}
        legalName={contractor.legal_name}
        contractorCode={contractor.contractor_code}
        contractorType={contractor.contractor_type}
        status={contractor.status}
        complianceState={contractor.compliance?.state ?? null}
        isActive={contractor.is_active}
        canEdit={canEdit}
        canActivate={canActivate}
        onEdit={() => setEditOpen(true)}
        onActivate={() => void changeStatus("active")}
        onSuspend={() => void changeStatus("suspended", "Suspended via Detail page")}
        onBlacklist={() =>
          void changeStatus("blacklisted", "Blacklisted via Detail page")
        }
      />

      <ContractorStats
        documents={docs ?? []}
        warnDays={warnDays}
        contractorUpdatedAt={contractor.updated_at}
      />

      {error ? <div className="text-sm text-destructive">{error}</div> : null}

      <Tabs
        value={tabValue}
        onValueChange={(v) => {
          const next = new URLSearchParams(searchParams)
          if (v === "overview") next.delete("tab")
          else next.set("tab", v)
          // The deep-link `focus` param is only meaningful while the rates tab
          // is selected; drop it when the user navigates elsewhere.
          if (v !== "rates") next.delete("focus")
          setSearchParams(next, { replace: true })
        }}
        className="gap-4"
      >
        <TabsList variant="line" className="rounded-2xl bg-white p-2 shadow-sm">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="plants">Plants</TabsTrigger>
          {canViewRates ? (
            <TabsTrigger value="rates">Negotiated rates</TabsTrigger>
          ) : null}
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <ContractorOverview contractor={contractor} />
        </TabsContent>

        <TabsContent value="documents">
          <ContractorDocuments
            contractorId={contractor.id}
            warnDays={warnDays}
            documents={docs}
            onRefresh={async () => {
              await loadDocs()
              await loadContractor()
            }}
          />
        </TabsContent>

        <TabsContent value="plants">
          <ContractorPlants contractorId={contractor.id} />
        </TabsContent>

        {canViewRates ? (
          <TabsContent value="rates">
            <ContractorRatesPanel
              contractorId={contractor.id}
              focusRateId={focusRateId}
              onFocusHandled={() => {
                if (focusParam) {
                  const next = new URLSearchParams(searchParams)
                  next.delete("focus")
                  setSearchParams(next, { replace: true })
                }
              }}
              readOnly
            />
          </TabsContent>
        ) : null}

        <TabsContent value="timeline">
          <ContractorTimeline contractorId={contractor.id} />
        </TabsContent>
      </Tabs>

      <ContractorEditDialog
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o)
          if (!o) {
            const next = new URLSearchParams(searchParams)
            next.delete("edit")
            setSearchParams(next, { replace: true })
          }
        }}
        contractor={contractor}
        saving={saving}
        onSave={saveEdit}
      />
    </div>
  )
}

type ContractorEditForm = {
  name: string
  legal_name: string
  trade_name: string
  pan: string
  gstin: string
  cin: string
  contractor_type: string
  contact_person: string
  email: string
  phone: string
  address: string
  city: string
  state: string
  country: string
  postal_code: string
  notes: string
}

function ContractorEditDialog({
  open,
  onOpenChange,
  contractor,
  saving,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contractor: ContractorPublic
  saving: boolean
  onSave: (form: ContractorEditForm) => Promise<void>
}) {
  const [form, setForm] = React.useState<ContractorEditForm>(() => buildInitial(contractor))

  React.useEffect(() => {
    setForm(buildInitial(contractor))
  }, [contractor])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit contractor</DialogTitle>
          <DialogDescription>
            Sensitive changes (legal name, PAN, GSTIN, CIN, type) may trigger an approval workflow.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name">
            <Input value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
          </Field>
          <Field label="Legal name">
            <Input
              value={form.legal_name}
              onChange={(e) => setForm((s) => ({ ...s, legal_name: e.target.value }))}
            />
          </Field>
          <Field label="Trade name">
            <Input
              value={form.trade_name}
              onChange={(e) => setForm((s) => ({ ...s, trade_name: e.target.value }))}
            />
          </Field>
          <Field label="Type">
            <select
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
              value={form.contractor_type}
              onChange={(e) => setForm((s) => ({ ...s, contractor_type: e.target.value }))}
            >
              <option value="">—</option>
              <option value="vendor">Vendor</option>
              <option value="labour">Labour</option>
              <option value="service">Service</option>
              <option value="epc">EPC</option>
            </select>
          </Field>
          <Field label="PAN">
            <Input
              value={form.pan}
              onChange={(e) => setForm((s) => ({ ...s, pan: e.target.value }))}
              placeholder="ABCDE1234F"
            />
          </Field>
          <Field label="GSTIN">
            <Input
              value={form.gstin}
              onChange={(e) => setForm((s) => ({ ...s, gstin: e.target.value }))}
              placeholder="22AAAAA0000A1Z5"
            />
          </Field>
          <Field label="CIN">
            <Input value={form.cin} onChange={(e) => setForm((s) => ({ ...s, cin: e.target.value }))} />
          </Field>
          <Field label="Contact person">
            <Input
              value={form.contact_person}
              onChange={(e) => setForm((s) => ({ ...s, contact_person: e.target.value }))}
            />
          </Field>
          <Field label="Email">
            <Input value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} />
          </Field>
          <Field label="City">
            <Input value={form.city} onChange={(e) => setForm((s) => ({ ...s, city: e.target.value }))} />
          </Field>
          <Field label="State">
            <Input value={form.state} onChange={(e) => setForm((s) => ({ ...s, state: e.target.value }))} />
          </Field>
          <Field label="Country">
            <Input
              value={form.country}
              onChange={(e) => setForm((s) => ({ ...s, country: e.target.value }))}
            />
          </Field>
          <Field label="Postal code">
            <Input
              value={form.postal_code}
              onChange={(e) => setForm((s) => ({ ...s, postal_code: e.target.value }))}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address">
              <Input
                value={form.address}
                onChange={(e) => setForm((s) => ({ ...s, address: e.target.value }))}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <Textarea
                value={form.notes}
                onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
                rows={3}
              />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void onSave(form)} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

function buildInitial(c: ContractorPublic): ContractorEditForm {
  return {
    name: c.name ?? "",
    legal_name: c.legal_name ?? "",
    trade_name: c.trade_name ?? "",
    pan: c.pan ?? "",
    gstin: c.gstin ?? "",
    cin: c.cin ?? "",
    contractor_type: c.contractor_type ?? "",
    contact_person: c.contact_person ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    address: c.address ?? "",
    city: c.city ?? "",
    state: c.state ?? "",
    country: c.country ?? "",
    postal_code: c.postal_code ?? "",
    notes: c.notes ?? "",
  }
}
