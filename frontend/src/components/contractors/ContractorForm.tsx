import { CountrySelect } from "@/components/contractors/CountrySelect"
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

export type ContractorFormErrorKey = keyof ContractorFormValues
export type ContractorFormErrors = Partial<Record<ContractorFormErrorKey, string>>
export type ContractorFormWizardStepKey = "basic" | "contact" | "compliance" | "additional" | "review"

const CONTRACTOR_CODE_REGEX = /^[A-Z0-9][A-Z0-9/_-]{0,63}$/
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_REGEX = /^[6-9]\d{9}$/
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const GSTIN_REGEX = /^\d{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const CIN_REGEX = /^[A-Z][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/
const INDIA_POSTAL_CODE_REGEX = /^\d{6}$/
const INTERNATIONAL_POSTAL_CODE_REGEX = /^[A-Z0-9 -]{3,12}$/i

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
    contractor_code: normalizeContractorCodeInput(c.contractor_code ?? ""),
    name: c.name ?? "",
    legal_name: c.legal_name ?? "",
    trade_name: c.trade_name ?? "",
    contractor_type: c.contractor_type ?? "",
    pan: normalizePanInput(c.pan ?? c.pan_number ?? ""),
    gstin: normalizeGstinInput(c.gstin ?? c.gst_number ?? ""),
    cin: normalizeCinInput(c.cin ?? ""),
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

function trimOrEmpty(s: string): string {
  return s.trim()
}

function requiredFieldError(value: string, label: string): string | null {
  return trimOrEmpty(value) ? null : `${label} is required`
}

function optionalEmailError(value: string, label: string): string | null {
  const trimmed = trimOrEmpty(value)
  if (!trimmed) return null
  return EMAIL_REGEX.test(trimmed) ? null : `${label} must be a valid email address`
}

function optionalWebsiteError(value: string): string | null {
  const trimmed = trimOrEmpty(value)
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? null
      : "Website must start with http:// or https://"
  } catch {
    return "Website must be a valid URL"
  }
}

export function normalizePhoneInput(s: string): string {
  return s.replace(/\D/g, "").slice(0, 10)
}

export function normalizeContractorCodeInput(s: string): string {
  return s.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9/_-]/g, "").slice(0, 64)
}

export function normalizePanInput(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)
}

export function normalizeGstinInput(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15)
}

export function normalizeCinInput(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 21)
}

function normalizeAddressLine(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim()
}

export function splitAddressLines(address: string): [string, string] {
  const [line1 = "", ...rest] = address.split(/\r?\n+/)
  return [line1, rest.join(" ").trim()]
}

export function combineAddressLines(line1: string, line2: string): string {
  const first = normalizeAddressLine(line1)
  const second = normalizeAddressLine(line2)
  return [first, second].filter(Boolean).join("\n")
}

export function contactNumberError(s: string): string | null {
  const t = s.trim()
  if (!t) return null
  return PHONE_REGEX.test(t) ? null : "Contact no. must start with 6, 7, 8, or 9 and be exactly 10 digits"
}

export function contractorCodeError(s: string): string | null {
  const t = s.trim()
  if (!t) return null
  return CONTRACTOR_CODE_REGEX.test(t)
    ? null
    : "Contractor code can use only letters, numbers, /, _, and -"
}

export function panError(s: string): string | null {
  const t = s.trim()
  if (!t) return null
  return PAN_REGEX.test(t) ? null : "PAN must be in format ABCDE1234F"
}

export function gstinError(s: string): string | null {
  const t = s.trim()
  if (!t) return null
  return GSTIN_REGEX.test(t) ? null : "GSTIN must be a valid 15-character GSTIN"
}

export function cinError(s: string): string | null {
  const t = s.trim()
  if (!t) return null
  return CIN_REGEX.test(t) ? null : "CIN must be a valid 21-character company identification number"
}

export function postalCodeError(postalCode: string, country: string): string | null {
  const value = postalCode.trim()
  if (!value) return null
  const countryValue = country.trim().toLowerCase()
  if (countryValue === "india") {
    return INDIA_POSTAL_CODE_REGEX.test(value) ? null : "Postal code must be exactly 6 digits"
  }
  return INTERNATIONAL_POSTAL_CODE_REGEX.test(value)
    ? null
    : "Postal code must be 3-12 letters, numbers, spaces, or hyphens"
}

export function isValidOptionalContactNumber(s: string): boolean {
  return contactNumberError(s) === null
}

export function getContractorFormErrors(form: ContractorFormValues): ContractorFormErrors {
  const errors: ContractorFormErrors = {}
  const [addressLine1] = splitAddressLines(form.address)

  const contractorCodeRequired = requiredFieldError(form.contractor_code, "Contractor code")
  if (contractorCodeRequired) errors.contractor_code = contractorCodeRequired
  else {
    const contractorCodeFormatError = contractorCodeError(form.contractor_code)
    if (contractorCodeFormatError) errors.contractor_code = contractorCodeFormatError
  }

  const nameRequired = requiredFieldError(form.name, "Display name")
  if (nameRequired) errors.name = nameRequired

  const typeRequired = requiredFieldError(form.contractor_type, "Contractor type")
  if (typeRequired) errors.contractor_type = typeRequired

  const contactPersonRequired = requiredFieldError(form.contact_person, "Contact person")
  if (contactPersonRequired) errors.contact_person = contactPersonRequired

  const emailRequired = requiredFieldError(form.email, "Email")
  if (emailRequired) errors.email = emailRequired
  else {
    const emailFormatError = optionalEmailError(form.email, "Email")
    if (emailFormatError) errors.email = emailFormatError
  }

  const alternateEmailFormatError = optionalEmailError(form.alternate_email, "Alternate email")
  if (alternateEmailFormatError) errors.alternate_email = alternateEmailFormatError
  if (
    trimOrEmpty(form.email) &&
    trimOrEmpty(form.alternate_email) &&
    trimOrEmpty(form.email).toLowerCase() === trimOrEmpty(form.alternate_email).toLowerCase()
  ) {
    errors.alternate_email = "Alternate email must be different from email"
  }

  const phoneRequired = requiredFieldError(form.phone, "Contact no.")
  if (phoneRequired) errors.phone = phoneRequired
  else {
    const phoneFormatError = contactNumberError(form.phone)
    if (phoneFormatError) errors.phone = phoneFormatError
  }

  const alternatePhoneFormatError = contactNumberError(form.alternate_phone)
  if (alternatePhoneFormatError) errors.alternate_phone = alternatePhoneFormatError
  if (
    trimOrEmpty(form.phone) &&
    trimOrEmpty(form.alternate_phone) &&
    trimOrEmpty(form.phone) === trimOrEmpty(form.alternate_phone)
  ) {
    errors.alternate_phone = "Alternate contact no. must be different from contact no."
  }

  const panRequired = requiredFieldError(form.pan, "PAN")
  if (panRequired) errors.pan = panRequired
  else {
    const panFormatError = panError(form.pan)
    if (panFormatError) errors.pan = panFormatError
  }

  const gstinRequired = requiredFieldError(form.gstin, "GSTIN")
  if (gstinRequired) errors.gstin = gstinRequired
  else {
    const gstinFormatError = gstinError(form.gstin)
    if (gstinFormatError) errors.gstin = gstinFormatError
  }

  const cinFormatError = cinError(form.cin)
  if (cinFormatError) errors.cin = cinFormatError

  if (trimOrEmpty(form.pan) && trimOrEmpty(form.gstin) && trimOrEmpty(form.gstin).slice(2, 12) !== trimOrEmpty(form.pan)) {
    errors.gstin = "GSTIN must contain the same PAN as the PAN field"
  }

  const addressRequired = requiredFieldError(addressLine1, "Address line 1")
  if (addressRequired) errors.address = addressRequired

  const cityRequired = requiredFieldError(form.city, "City")
  if (cityRequired) errors.city = cityRequired

  const stateRequired = requiredFieldError(form.state, "State")
  if (stateRequired) errors.state = stateRequired

  const countryRequired = requiredFieldError(form.country, "Country")
  if (countryRequired) errors.country = countryRequired

  const postalRequired = requiredFieldError(form.postal_code, "Postal code")
  if (postalRequired) errors.postal_code = postalRequired
  else {
    const postalFormatError = postalCodeError(form.postal_code, form.country)
    if (postalFormatError) errors.postal_code = postalFormatError
  }

  const websiteFormatError = optionalWebsiteError(form.website)
  if (websiteFormatError) errors.website = websiteFormatError

  return errors
}

const STEP_ERROR_KEYS: Record<ContractorFormWizardStepKey, ContractorFormErrorKey[]> = {
  basic: ["contractor_code", "name", "contractor_type"],
  contact: ["contact_person", "email", "alternate_email", "phone", "alternate_phone"],
  compliance: ["pan", "gstin", "cin"],
  additional: ["address", "city", "state", "country", "postal_code", "website"],
  review: [
    "contractor_code",
    "name",
    "contractor_type",
    "contact_person",
    "email",
    "alternate_email",
    "phone",
    "alternate_phone",
    "pan",
    "gstin",
    "cin",
    "address",
    "city",
    "state",
    "country",
    "postal_code",
    "website",
  ],
}

export function getContractorStepErrors(
  form: ContractorFormValues,
  step: ContractorFormWizardStepKey,
): ContractorFormErrors {
  const allErrors = getContractorFormErrors(form)
  const selected: ContractorFormErrors = {}
  for (const key of STEP_ERROR_KEYS[step]) {
    if (allErrors[key]) selected[key] = allErrors[key]
  }
  return selected
}

export function isContractorStepValid(form: ContractorFormValues, step: ContractorFormWizardStepKey): boolean {
  return Object.keys(getContractorStepErrors(form, step)).length === 0
}

export function contractorFormToCreatePayload(form: ContractorFormValues) {
  const pan = trimOrNull(normalizePanInput(form.pan))
  const gstin = trimOrNull(normalizeGstinInput(form.gstin))
  return {
    contractor_code: normalizeContractorCodeInput(form.contractor_code),
    name: form.name.trim(),
    legal_name: trimOrNull(form.legal_name),
    trade_name: trimOrNull(form.trade_name),
    contractor_type: trimOrNull(form.contractor_type),
    pan,
    gstin,
    cin: trimOrNull(normalizeCinInput(form.cin)),
    pan_number: pan,
    gst_number: gstin,
    contact_person: trimOrNull(form.contact_person),
    contact_person_title: trimOrNull(form.contact_person_title),
    email: trimOrNull(form.email)?.toLowerCase() ?? null,
    alternate_email: trimOrNull(form.alternate_email)?.toLowerCase() ?? null,
    phone: trimOrNull(normalizePhoneInput(form.phone)),
    alternate_phone: trimOrNull(normalizePhoneInput(form.alternate_phone)),
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
  const pan = trimOrNull(normalizePanInput(form.pan))
  const gstin = trimOrNull(normalizeGstinInput(form.gstin))
  return {
    contractor_code: normalizeContractorCodeInput(form.contractor_code),
    name: form.name.trim(),
    legal_name: trimOrNull(form.legal_name),
    trade_name: trimOrNull(form.trade_name),
    contractor_type: trimOrNull(form.contractor_type) || null,
    pan,
    gstin,
    cin: trimOrNull(normalizeCinInput(form.cin)),
    pan_number: pan,
    gst_number: gstin,
    contact_person: trimOrNull(form.contact_person),
    contact_person_title: trimOrNull(form.contact_person_title),
    email: trimOrNull(form.email)?.toLowerCase() ?? null,
    alternate_email: trimOrNull(form.alternate_email)?.toLowerCase() ?? null,
    phone: trimOrNull(normalizePhoneInput(form.phone)),
    alternate_phone: trimOrNull(normalizePhoneInput(form.alternate_phone)),
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
  return Object.keys(getContractorFormErrors(form)).length === 0
}

export type ContractorFormSectionKey = "basic" | "status" | "contact" | "businessIds" | "address" | "web" | "notes"

type Props = {
  form: ContractorFormValues
  onChange: (next: ContractorFormValues) => void
  active: boolean
  onActiveChange: (active: boolean) => void
  showStatus?: boolean
  sectionIds?: Partial<Record<ContractorFormSectionKey, string>>
}

export function ContractorForm({
  form,
  onChange,
  active,
  onActiveChange,
  showStatus = true,
  sectionIds,
}: Props) {
  function set<K extends keyof ContractorFormValues>(key: K, value: ContractorFormValues[K]) {
    onChange({ ...form, [key]: value })
  }

  const phoneError = contactNumberError(form.phone)
  const alternatePhoneError = contactNumberError(form.alternate_phone)
  const [addressLine1, addressLine2] = splitAddressLines(form.address)

  return (
    <div className="space-y-6 overflow-visible">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card id={sectionIds?.basic} className="rounded-2xl shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text">Basic information</CardTitle>
            <CardDescription>Core identity details used across workflows and compliance.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Contractor code</div>
              <Input
                value={form.contractor_code}
                onChange={(e) => set("contractor_code", normalizeContractorCodeInput(e.target.value))}
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
          <Card id={sectionIds?.status} className="rounded-2xl shadow-sm">
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
        <Card id={sectionIds?.contact} className="rounded-2xl shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text">Contact information</CardTitle>
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
              <div className="text-xs text-muted-foreground">Contact no.</div>
              <Input
                value={form.phone}
                onChange={(e) => set("phone", normalizePhoneInput(e.target.value))}
                placeholder="9876543210"
                inputMode="numeric"
                maxLength={10}
                aria-invalid={Boolean(phoneError)}
              />
              {phoneError ? <div className="text-xs text-destructive">{phoneError}</div> : null}
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Alternate contact no.</div>
              <Input
                value={form.alternate_phone}
                onChange={(e) => set("alternate_phone", normalizePhoneInput(e.target.value))}
                placeholder="9876543210"
                inputMode="numeric"
                maxLength={10}
                aria-invalid={Boolean(alternatePhoneError)}
              />
              {alternatePhoneError ? <div className="text-xs text-destructive">{alternatePhoneError}</div> : null}
            </div>
          </CardContent>
        </Card>

        <Card id={sectionIds?.businessIds} className="rounded-2xl shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Business IDs</CardTitle>
            <CardDescription>Compliance and statutory identifiers.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">PAN</div>
              <Input
                value={form.pan}
                onChange={(e) => set("pan", normalizePanInput(e.target.value))}
                placeholder="ABCDE1234F"
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">GSTIN</div>
              <Input
                value={form.gstin}
                onChange={(e) => set("gstin", normalizeGstinInput(e.target.value))}
                placeholder="22AAAAA0000A1Z5"
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">CIN</div>
              <Input value={form.cin} onChange={(e) => set("cin", normalizeCinInput(e.target.value))} placeholder="U12345..." />
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
        <Card id={sectionIds?.address} className="overflow-visible rounded-2xl shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Address</CardTitle>
            <CardDescription>Structured address helps reporting and filters later.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 overflow-visible sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <div className="text-xs text-muted-foreground">Address line 1</div>
              <Input
                value={addressLine1}
                onChange={(e) => set("address", combineAddressLines(e.target.value, addressLine2))}
                placeholder="Street, area, landmark"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <div className="text-xs text-muted-foreground">Address line 2</div>
              <Input
                value={addressLine2}
                onChange={(e) => set("address", combineAddressLines(addressLine1, e.target.value))}
                placeholder="Building, suite, floor"
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
              <CountrySelect
                value={form.country}
                onChange={(value) => set("country", value)}
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Postal code</div>
              <Input value={form.postal_code} onChange={(e) => set("postal_code", e.target.value)} placeholder="400001" />
            </div>
          </CardContent>
        </Card>

        <Card id={sectionIds?.web} className="rounded-2xl shadow-sm">
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

      <Card id={sectionIds?.notes} className="rounded-2xl shadow-sm">
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
