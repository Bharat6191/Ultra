import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export type ContractorOverviewData = {
  id?: number
  contractor_code?: string | null
  name: string
  legal_name?: string | null
  trade_name?: string | null
  pan?: string | null
  gstin?: string | null
  cin?: string | null
  contractor_type?: string | null
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
  registration_number?: string | null
  website?: string | null
  notes?: string | null
}

function FieldRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid gap-1">
      <div className="text-xs font-bold uppercase tracking-wide text-zinc-950">{label}</div>
      <div className={`text-sm font-normal text-zinc-950 ${mono ? "font-mono" : ""}`}>{value || "—"}</div>
    </div>
  )
}

export function ContractorOverview({ contractor }: { contractor: ContractorOverviewData }) {
  const location = [contractor.city, contractor.state, contractor.country, contractor.postal_code]
    .filter(Boolean)
    .join(", ")

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Identity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <FieldRow label="Contractor code" value={contractor.contractor_code} mono />
          <FieldRow label="Display name" value={contractor.name} />
          <FieldRow label="Legal name" value={contractor.legal_name} />
          <FieldRow label="Trade name" value={contractor.trade_name} />
          <FieldRow label="Type" value={contractor.contractor_type} />
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Statutory IDs</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <FieldRow label="PAN Number" value={contractor.pan} mono />
          <FieldRow label="GSTIN Number" value={contractor.gstin} mono />
          <FieldRow label="CIN Number" value={contractor.cin} mono />
          <FieldRow label="Registration Number" value={contractor.registration_number} mono />
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Contractor Information</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <FieldRow label="Contact Person" value={contractor.contact_person} />
          <FieldRow label="Contact Title" value={contractor.contact_person_title} />
          <FieldRow label="Email" value={contractor.email} />
          <FieldRow label="Alternate email" value={contractor.alternate_email} />
          <FieldRow label="Contact no." value={contractor.phone} />
          <FieldRow label="Alternate contact no." value={contractor.alternate_phone} />
        </CardContent>
      </Card>

      <Card className="rounded-2xl lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Address</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Address" value={contractor.address ? <div className="whitespace-pre-wrap">{contractor.address}</div> : null} />
          <FieldRow label="Location" value={location} />
          <FieldRow label="Website" value={contractor.website} />
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="whitespace-pre-wrap text-sm text-zinc-700">
            {contractor.notes || <span className="text-muted-foreground">No internal notes.</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
