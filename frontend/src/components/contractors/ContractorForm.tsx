import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

export type ContractorFormValues = {
  contractor_code: string
  name: string
  legal_name: string
  trade_name: string
  contractor_type: string
  pan: string
  gstin: string
  cin: string
  contact_person: string
  contact_person_title: string
  email: string
  alternate_email: string
  phone: string
  alternate_phone: string
  address: string
  city: string
  state: string
  country: string
  postal_code: string
  registration_number: string
  website: string
  notes: string
}

export type ContractorFormSource = {
  contractor_code?: string | null
  name?: string | null
  legal_name?: string | null
  trade_name?: string | null
  contractor_type?: string | null
  pan?: string | null
  gstin?: string | null
  cin?: string | null
  pan_number?: string | null
  gst_number?: string | null
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

export function emptyContractorForm(): ContractorFormValues {
  return {
    contractor_code: "",
    name: "",
    legal_name: "",
    trade_name: "",
    contractor_type: "",
    pan: "",
    gstin: "",
    cin: "",
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
    registration_number: "",
    website: "",
    notes: "",
  }
}

export function contractorFormFromSource(c: ContractorFormSource): ContractorFormValues {
  return {
    contractor_code: c.contractor_code ?? "",
    name: c.name ?? "",
    legal_name: c.legal_name ?? "",
    trade_name: c.trade_name ?? "",
    contractor_type: c.contractor_type ?? "",
    pan: c.pan ?? c.pan_number ?? "",
    gstin: c.gstin ?? c.gst_number ?? "",
    cin: c.cin ?? "",
    contact_person: c.contact_person ?? "",
    contact_person_title: c.contact_person_title ?? "",
    email: c.email ?? "",
    alternate_email: c.alternate_email ?? "",
    phone: c.phone ?? "",
    alternate_phone: c.alternate_phone ?? "",
    address: c.address ?? "",
    city: c.city ?? "",
    state: c.state ?? "",
    country: c.country ?? "India",
    postal_code: c.postal_code ?? "",
    registration_number: c.registration_number ?? "",
    website: c.website ?? "",
    notes: c.notes ?? "",
  }
}

function trimOrNull(s: string): string | null {
  const t = s.trim()
  return t.length ? t : null
}

export function contractorFormToCreatePayload(form: ContractorFormValues) {
  const pan = trimOrNull(form.pan)
  const gstin = trimOrNull(form.gstin)
  return {
    contractor_code: form.contractor_code.trim(),
    name: form.name.trim(),
    legal_name: trimOrNull(form.legal_name),
    trade_name: trimOrNull(form.trade_name),
    contractor_type: trimOrNull(form.contractor_type),
    pan,
    gstin,
    cin: trimOrNull(form.cin),
    pan_number: pan,
    gst_number: gstin,
    contact_person: trimOrNull(form.contact_person),
    contact_person_title: trimOrNull(form.contact_person_title),
    email: trimOrNull(form.email),
    alternate_email: trimOrNull(form.alternate_email),
    phone: trimOrNull(form.phone),
    alternate_phone: trimOrNull(form.alternate_phone),
    address: trimOrNull(form.address),
    city: trimOrNull(form.city),
    state: trimOrNull(form.state),
    country: trimOrNull(form.country),
    postal_code: trimOrNull(form.postal_code),
    registration_number: trimOrNull(form.registration_number),
    website: trimOrNull(form.website),
    notes: trimOrNull(form.notes),
  }
}

export function contractorFormToUpdatePayload(form: ContractorFormValues, isActive: boolean) {
  const pan = trimOrNull(form.pan)
  const gstin = trimOrNull(form.gstin)
  return {
    contractor_code: form.contractor_code.trim(),
    name: form.name.trim(),
    legal_name: trimOrNull(form.legal_name),
    trade_name: trimOrNull(form.trade_name),
    contractor_type: trimOrNull(form.contractor_type) || null,
    pan,
    gstin,
    cin: trimOrNull(form.cin),
    pan_number: pan,
    gst_number: gstin,
    contact_person: trimOrNull(form.contact_person),
    contact_person_title: trimOrNull(form.contact_person_title),
    email: trimOrNull(form.email),
    alternate_email: trimOrNull(form.alternate_email),
    phone: trimOrNull(form.phone),
    alternate_phone: trimOrNull(form.alternate_phone),
    address: trimOrNull(form.address),
    city: trimOrNull(form.city),
    state: trimOrNull(form.state),
    country: trimOrNull(form.country),
    postal_code: trimOrNull(form.postal_code),
    registration_number: trimOrNull(form.registration_number),
    website: trimOrNull(form.website),
    notes: trimOrNull(form.notes),
    is_active: isActive,
  }
}

export function isContractorFormValid(form: ContractorFormValues): boolean {
  return Boolean(form.contractor_code.trim() && form.name.trim())
}

type Props = {
  form: ContractorFormValues
  onChange: (next: ContractorFormValues) => void
  active: boolean
  onActiveChange: (active: boolean) => void
  showStatus?: boolean
}

export function ContractorForm({ form, onChange, active, onActiveChange, showStatus = true }: Props) {
  function set<K extends keyof ContractorFormValues>(key: K, value: ContractorFormValues[K]) {
    onChange({ ...form, [key]: value })
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="rounded-2xl shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Basic information</CardTitle>
            <CardDescription>Core identity details used across workflows and compliance.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Contractor code</div>
              <Input
                value={form.contractor_code}
                onChange={(e) => set("contractor_code", e.target.value)}
                placeholder="CTR-001"
                required
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Display name</div>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="ABC Contractors Pvt Ltd"
                required
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Legal name</div>
              <Input
                value={form.legal_name}
                onChange={(e) => set("legal_name", e.target.value)}
                placeholder="ABC Contractors Private Limited"
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Trade name</div>
              <Input
                value={form.trade_name}
                onChange={(e) => set("trade_name", e.target.value)}
                placeholder="ABC Contractors"
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Type</div>
              <select
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                value={form.contractor_type}
                onChange={(e) => set("contractor_type", e.target.value)}
              >
                <option value="">—</option>
                <option value="vendor">Vendor</option>
                <option value="labour">Labour</option>
                <option value="service">Service</option>
                <option value="epc">EPC</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Contact person</div>
              <Input
                value={form.contact_person}
                onChange={(e) => set("contact_person", e.target.value)}
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <div className="text-xs text-muted-foreground">Contact title (optional)</div>
              <Input
                value={form.contact_person_title}
                onChange={(e) => set("contact_person_title", e.target.value)}
                placeholder="Manager"
              />
            </div>
          </CardContent>
        </Card>

        {showStatus ? (
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
                <Switch checked={active} onCheckedChange={(v) => onActiveChange(Boolean(v))} />
              </div>
            </CardContent>
          </Card>
        ) : null}
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
              <Input value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="contractor@example.com" />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Alternate email</div>
              <Input
                value={form.alternate_email}
                onChange={(e) => set("alternate_email", e.target.value)}
                placeholder="alt@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Phone</div>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91..." />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Alternate phone</div>
              <Input
                value={form.alternate_phone}
                onChange={(e) => set("alternate_phone", e.target.value)}
                placeholder="+91..."
              />
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
              <div className="text-xs text-muted-foreground">PAN</div>
              <Input
                value={form.pan}
                onChange={(e) => set("pan", e.target.value)}
                placeholder="ABCDE1234F"
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">GSTIN</div>
              <Input
                value={form.gstin}
                onChange={(e) => set("gstin", e.target.value)}
                placeholder="22AAAAA0000A1Z5"
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">CIN</div>
              <Input value={form.cin} onChange={(e) => set("cin", e.target.value)} placeholder="U12345..." />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Registration number</div>
              <Input
                value={form.registration_number}
                onChange={(e) => set("registration_number", e.target.value)}
                placeholder="REG-..."
              />
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
              <Input
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                placeholder="Street, area, landmark"
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">City</div>
              <Input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Mumbai" />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">State</div>
              <Input value={form.state} onChange={(e) => set("state", e.target.value)} placeholder="Maharashtra" />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Country</div>
              <Input value={form.country} onChange={(e) => set("country", e.target.value)} placeholder="India" />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Postal code</div>
              <Input value={form.postal_code} onChange={(e) => set("postal_code", e.target.value)} placeholder="400001" />
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
              <Input
                value={form.website}
                onChange={(e) => set("website", e.target.value)}
                placeholder="https://example.com"
              />
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
          <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </CardContent>
      </Card>
    </div>
  )
}
