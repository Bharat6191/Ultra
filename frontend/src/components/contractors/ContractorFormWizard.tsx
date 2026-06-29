import * as React from "react"
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  FileBadge2,
  MapPin,
  NotebookPen,
  Phone,
} from "lucide-react"

import { CountrySelect } from "@/components/contractors/CountrySelect"
import {
  combineAddressLines,
  type ContractorFormErrorKey,
  getContractorFormErrors,
  getContractorStepErrors,
  isContractorFormValid,
  isContractorStepValid,
  normalizeCinInput,
  normalizeContractorCodeInput,
  normalizeGstinInput,
  normalizePanInput,
  normalizePhoneInput,
  splitAddressLines,
  type ContractorFormValues,
} from "@/components/contractors/ContractorForm"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type WizardStep = {
  key: "basic" | "contact" | "compliance" | "additional" | "review"
  label: string
  description: string
  icon: React.ElementType
}

const WIZARD_STEPS: WizardStep[] = [
  {
    key: "basic",
    label: "Basic Information",
    description: "Identity and public contractor details.",
    icon: Building2,
  },
  {
    key: "contact",
    label: "Contact Information",
    description: "Primary communication channels.",
    icon: Phone,
  },
  {
    key: "compliance",
    label: "Compliance & Registration",
    description: "Tax and statutory identifiers.",
    icon: FileBadge2,
  },
  {
    key: "additional",
    label: "Additional Information",
    description: "Address and web presence.",
    icon: MapPin,
  },
  {
    key: "review",
    label: "Review & Notes",
    description: "Internal notes and final checks.",
    icon: NotebookPen,
  },
]

function Field({
  label,
  required = false,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-semibold text-zinc-950">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </div>
      {children}
    </div>
  )
}

function StepCard({
  title,
  description,
  children,
  compact = false,
}: {
  title: string
  description?: string
  children: React.ReactNode
  compact?: boolean
}) {
  return (
    <div className={cn("space-y-5", compact ? "space-y-4" : "space-y-6")}>
      <div className={cn("space-y-1.5", compact ? "" : "space-y-2")}>
        <div className={cn("font-semibold text-zinc-950", compact ? "text-lg" : "text-[2.15rem] tracking-tight")}>
          {title}
        </div>
        {description ? (
          <div className={cn("text-muted-foreground", compact ? "text-sm" : "text-lg leading-7")}>{description}</div>
        ) : null}
      </div>
      <div>{children}</div>
    </div>
  )
}

function ReviewItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50/60 px-4 py-3">
      <div className="text-xs font-bold uppercase tracking-wide text-zinc-950">{label}</div>
      <div className="mt-1 text-sm font-normal text-zinc-950">{value}</div>
    </div>
  )
}

function display(value: string): string {
  const next = value.trim()
  return next.length ? next : "—"
}

export type ContractorFormWizardProps = {
  title: string
  subtitle?: string
  form: ContractorFormValues
  onChange: (next: ContractorFormValues) => void
  onSubmit: () => void | Promise<void>
  saving?: boolean
  submitLabel: string
  submittingLabel: string
  helperText?: string
  reviewMessage: string
  onCancel?: () => void
  cancelLabel?: string
  showStatus?: boolean
  active?: boolean
  onActiveChange?: (active: boolean) => void
  allowStepJump?: boolean
  submitFromAnyStep?: boolean
  compactLayout?: boolean
  navigationMode?: "step" | "tab"
  showReviewStep?: boolean
  stepIndex?: number
  onStepIndexChange?: (stepIndex: number) => void
}

export function ContractorFormWizard({
  title,
  subtitle,
  form,
  onChange,
  onSubmit,
  saving = false,
  submitLabel,
  submittingLabel,
  helperText = "",
  reviewMessage,
  onCancel,
  cancelLabel = "Cancel",
  showStatus = false,
  active = true,
  onActiveChange,
  allowStepJump = false,
  submitFromAnyStep = false,
  compactLayout = false,
  navigationMode = "step",
  showReviewStep = true,
  stepIndex: stepIndexProp,
  onStepIndexChange,
}: ContractorFormWizardProps) {
  const steps = React.useMemo(
    () => (showReviewStep ? WIZARD_STEPS : WIZARD_STEPS.filter((step) => step.key !== "review")),
    [showReviewStep],
  )
  const [internalStepIndex, setInternalStepIndex] = React.useState(0)
  const maxStepIndex = Math.max(steps.length - 1, 0)
  const rawStepIndex = stepIndexProp ?? internalStepIndex
  const stepIndex = Math.max(0, Math.min(rawStepIndex, maxStepIndex))
  const currentStep = steps[stepIndex] ?? steps[0]
  const isFinalStep = stepIndex === steps.length - 1
  const isTabMode = navigationMode === "tab"
  const [touchedFields, setTouchedFields] = React.useState<Partial<Record<ContractorFormErrorKey, boolean>>>({})
  const [attemptedSteps, setAttemptedSteps] = React.useState<Partial<Record<WizardStep["key"], boolean>>>({})
  const [submitAttempted, setSubmitAttempted] = React.useState(false)
  const validationErrors = React.useMemo(() => getContractorFormErrors(form), [form])
  const stepErrors = React.useMemo(() => getContractorStepErrors(form, currentStep.key), [form, currentStep.key])
  const currentStepAttempted = submitAttempted || Boolean(attemptedSteps[currentStep.key])
  const stepValidationErrorKeys = React.useMemo(
    () => Object.keys(stepErrors) as ContractorFormErrorKey[],
    [stepErrors],
  )
  const allValidationErrorKeys = React.useMemo(
    () => Object.keys(validationErrors) as ContractorFormErrorKey[],
    [validationErrors],
  )
  const visibleStepErrors = React.useMemo(() => {
    const next: Partial<Record<ContractorFormErrorKey, string>> = {}
    for (const key of stepValidationErrorKeys) {
      if (currentStepAttempted || touchedFields[key]) {
        const message = stepErrors[key]
        if (message) next[key] = message
      }
    }
    return next
  }, [currentStepAttempted, stepErrors, stepValidationErrorKeys, touchedFields])
  const [addressLine1, addressLine2] = splitAddressLines(form.address)
  const canGoNext = isContractorStepValid(form, currentStep.key)
  const progressPercent = Math.round(((stepIndex + 1) / steps.length) * 100)
  const hasHelperText = helperText.trim().length > 0
  const inputClassName = compactLayout ? undefined : "h-14 rounded-2xl border-zinc-200 px-4 text-[15px] shadow-sm"
  const selectClassName = compactLayout
    ? "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
    : "h-14 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-[15px] shadow-sm outline-none transition focus-visible:border-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/15"
  const textareaClassName = compactLayout ? "min-h-32" : "min-h-36 rounded-2xl border-zinc-200 px-4 py-3 text-[15px] shadow-sm"
  const sectionGridClassName = compactLayout ? "grid gap-4 md:grid-cols-2" : "grid gap-6 xl:grid-cols-2"
  const splitGridClassName = compactLayout ? "grid gap-6 lg:grid-cols-2" : "grid gap-7 xl:grid-cols-2"
  const formSectionSpacingClassName = compactLayout ? "space-y-4" : "space-y-6"

  React.useEffect(() => {
    if (rawStepIndex === stepIndex) return
    if (stepIndexProp === undefined) setInternalStepIndex(stepIndex)
    onStepIndexChange?.(stepIndex)
  }, [onStepIndexChange, rawStepIndex, stepIndex, stepIndexProp])

  function setStepIndex(next: number | ((current: number) => number)) {
    const resolved = typeof next === "function" ? next(stepIndex) : next
    const clamped = Math.max(0, Math.min(resolved, maxStepIndex))
    if (stepIndexProp === undefined) setInternalStepIndex(clamped)
    onStepIndexChange?.(clamped)
  }

  function setForm(updater: (current: ContractorFormValues) => ContractorFormValues) {
    onChange(updater(form))
  }

  function touchField(field: ContractorFormErrorKey) {
    setTouchedFields((prev) => (prev[field] ? prev : { ...prev, [field]: true }))
  }

  function touchFields(fields: ContractorFormErrorKey[]) {
    if (fields.length === 0) return
    setTouchedFields((prev) => {
      let changed = false
      const next = { ...prev }
      for (const field of fields) {
        if (!next[field]) {
          next[field] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }

  function nextStep() {
    if (isFinalStep) return
    if (!canGoNext) {
      setAttemptedSteps((prev) => (prev[currentStep.key] ? prev : { ...prev, [currentStep.key]: true }))
      touchFields(stepValidationErrorKeys)
      return
    }
    setStepIndex((current) => Math.min(current + 1, steps.length - 1))
  }

  function previousStep() {
    setStepIndex((current) => Math.max(current - 1, 0))
  }

  function jumpToStep(index: number) {
    if (!allowStepJump) return
    setStepIndex(index)
  }

  async function submitForm() {
    if (!isContractorFormValid(form)) {
      setSubmitAttempted(true)
      touchFields(allValidationErrorKeys)
      const firstInvalidStepIndex = steps.findIndex((step) => Object.keys(getContractorStepErrors(form, step.key)).length > 0)
      if (firstInvalidStepIndex >= 0) {
        const firstInvalidStep = steps[firstInvalidStepIndex]
        setAttemptedSteps((prev) => (prev[firstInvalidStep.key] ? prev : { ...prev, [firstInvalidStep.key]: true }))
        setStepIndex(firstInvalidStepIndex)
      }
      return
    }
    await onSubmit()
  }

  function renderCurrentStep() {
    switch (currentStep.key) {
      case "basic":
        return (
          <StepCard
            title="Basic Information"
            description="Capture the contractor identity and public-facing profile details."
            compact={compactLayout}
          >
            <div className={sectionGridClassName}>
              <Field label="Contractor Code" required>
                <div className="space-y-1.5">
                  <Input
                    value={form.contractor_code}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, contractor_code: normalizeContractorCodeInput(e.target.value) }))
                    }
                    onBlur={() => touchField("contractor_code")}
                    placeholder="CTR-001"
                    aria-invalid={Boolean(visibleStepErrors.contractor_code)}
                    className={inputClassName}
                  />
                  {visibleStepErrors.contractor_code ? <p className="text-sm text-destructive">{visibleStepErrors.contractor_code}</p> : null}
                </div>
              </Field>
              <Field label="Contractor Type" required>
                <div className="space-y-1.5">
                  <select
                    className={selectClassName}
                    value={form.contractor_type}
                    onChange={(e) => setForm((prev) => ({ ...prev, contractor_type: e.target.value }))}
                    onBlur={() => touchField("contractor_type")}
                    aria-invalid={Boolean(visibleStepErrors.contractor_type)}
                  >
                    <option value="">Select type</option>
                    <option value="vendor">Vendor</option>
                    <option value="labour">Labour</option>
                    <option value="service">Service</option>
                    <option value="epc">EPC</option>
                  </select>
                  {visibleStepErrors.contractor_type ? <p className="text-sm text-destructive">{visibleStepErrors.contractor_type}</p> : null}
                </div>
              </Field>
              <Field label="Display Name" required>
                <div className="space-y-1.5">
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    onBlur={() => touchField("name")}
                    placeholder="ABC Contractors Pvt. Ltd."
                    aria-invalid={Boolean(visibleStepErrors.name)}
                    className={inputClassName}
                  />
                  {visibleStepErrors.name ? <p className="text-sm text-destructive">{visibleStepErrors.name}</p> : null}
                </div>
              </Field>
              <Field label="Trade Name">
                <Input
                  value={form.trade_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, trade_name: e.target.value }))}
                  placeholder="ABC Contractors"
                  className={inputClassName}
                />
              </Field>
              <Field label="Legal Name">
                <Input
                  value={form.legal_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, legal_name: e.target.value }))}
                  placeholder="ABC Contractors Private Limited"
                  className={inputClassName}
                />
              </Field>
              {showStatus && onActiveChange ? (
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-zinc-50/70 px-4 py-4">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-zinc-950">Active status</div>
                      {/* <div className="text-sm text-muted-foreground">
                        Toggle whether this contractor can be used in operational flows.
                      </div> */}
                    </div>
                    <Switch checked={active} onCheckedChange={(value) => onActiveChange(Boolean(value))} />
                  </div>
                </div>
              ) : null}
            </div>
          </StepCard>
        )

      case "contact":
        return (
          <StepCard
            title="Contact Information"
            description="Add the primary communication details used for onboarding and operations."
            compact={compactLayout}
          >
            <div className={sectionGridClassName}>
              <Field label="Contact Person" required>
                <div className="space-y-1.5">
                  <Input
                    value={form.contact_person}
                    onChange={(e) => setForm((prev) => ({ ...prev, contact_person: e.target.value }))}
                    onBlur={() => touchField("contact_person")}
                    placeholder="Jane Doe"
                    aria-invalid={Boolean(visibleStepErrors.contact_person)}
                    className={inputClassName}
                  />
                  {visibleStepErrors.contact_person ? <p className="text-sm text-destructive">{visibleStepErrors.contact_person}</p> : null}
                </div>
              </Field>
              <Field label="Contact Title">
                <Input
                  value={form.contact_person_title}
                  onChange={(e) => setForm((prev) => ({ ...prev, contact_person_title: e.target.value }))}
                  placeholder="Operations Manager"
                  className={inputClassName}
                />
              </Field>
              <Field label="Contact no." required>
                <div className="space-y-1.5">
                  <Input
                    value={form.phone}
                    onChange={(e) => setForm((prev) => ({ ...prev, phone: normalizePhoneInput(e.target.value) }))}
                    onBlur={() => touchField("phone")}
                    placeholder="9876543210"
                    inputMode="numeric"
                    maxLength={10}
                    aria-invalid={Boolean(visibleStepErrors.phone)}
                    className={inputClassName}
                  />
                  {visibleStepErrors.phone ? <p className="text-sm text-destructive">{visibleStepErrors.phone}</p> : null}
                </div>
              </Field>
              <Field label="Alternate contact no.">
                <div className="space-y-1.5">
                  <Input
                    value={form.alternate_phone}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, alternate_phone: normalizePhoneInput(e.target.value) }))
                    }
                    onBlur={() => touchField("alternate_phone")}
                    placeholder="9876543210"
                    inputMode="numeric"
                    maxLength={10}
                    aria-invalid={Boolean(visibleStepErrors.alternate_phone)}
                    className={inputClassName}
                  />
                  {visibleStepErrors.alternate_phone ? <p className="text-sm text-destructive">{visibleStepErrors.alternate_phone}</p> : null}
                </div>
              </Field>
              <Field label="Email" required>
                <div className="space-y-1.5">
                  <Input
                    value={form.email}
                    onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                    onBlur={() => touchField("email")}
                    placeholder="contractor@example.com"
                    aria-invalid={Boolean(visibleStepErrors.email)}
                    className={inputClassName}
                  />
                  {visibleStepErrors.email ? <p className="text-sm text-destructive">{visibleStepErrors.email}</p> : null}
                </div>
              </Field>
              <Field label="Alternate Email">
                <div className="space-y-1.5">
                  <Input
                    value={form.alternate_email}
                    onChange={(e) => setForm((prev) => ({ ...prev, alternate_email: e.target.value }))}
                    onBlur={() => touchField("alternate_email")}
                    placeholder="accounts@example.com"
                    aria-invalid={Boolean(visibleStepErrors.alternate_email)}
                    className={inputClassName}
                  />
                  {visibleStepErrors.alternate_email ? <p className="text-sm text-destructive">{visibleStepErrors.alternate_email}</p> : null}
                </div>
              </Field>
            </div>
          </StepCard>
        )

      case "compliance":
        return (
          <StepCard
            title="Compliance & Registration"
            description="Provide tax, statutory, and registration identifiers for this contractor."
            compact={compactLayout}
          >
            <div className={sectionGridClassName}>
              <Field label="PAN Number" required>
                <div className="space-y-1.5">
                  <Input
                    value={form.pan}
                    onChange={(e) => setForm((prev) => ({ ...prev, pan: normalizePanInput(e.target.value) }))}
                    onBlur={() => touchField("pan")}
                    placeholder="ABCDE1234F"
                    aria-invalid={Boolean(visibleStepErrors.pan)}
                    className={inputClassName}
                  />
                  {visibleStepErrors.pan ? <p className="text-sm text-destructive">{visibleStepErrors.pan}</p> : null}
                </div>
              </Field>
              <Field label="GSTIN Number" required>
                <div className="space-y-1.5">
                  <Input
                    value={form.gstin}
                    onChange={(e) => setForm((prev) => ({ ...prev, gstin: normalizeGstinInput(e.target.value) }))}
                    onBlur={() => touchField("gstin")}
                    placeholder="22AAAAA0000A1Z5"
                    aria-invalid={Boolean(visibleStepErrors.gstin)}
                    className={inputClassName}
                  />
                  {visibleStepErrors.gstin ? <p className="text-sm text-destructive">{visibleStepErrors.gstin}</p> : null}
                </div>
              </Field>
              <Field label="CIN Number">
                <div className="space-y-1.5">
                  <Input
                    value={form.cin}
                    onChange={(e) => setForm((prev) => ({ ...prev, cin: normalizeCinInput(e.target.value) }))}
                    onBlur={() => touchField("cin")}
                    placeholder="U12345MH2024PTC000001"
                    aria-invalid={Boolean(visibleStepErrors.cin)}
                    className={inputClassName}
                  />
                  {visibleStepErrors.cin ? <p className="text-sm text-destructive">{visibleStepErrors.cin}</p> : null}
                </div>
              </Field>
              <Field label="Registration Number">
                <Input
                  value={form.registration_number}
                  onChange={(e) => setForm((prev) => ({ ...prev, registration_number: e.target.value }))}
                  placeholder="REG-2026-001"
                  className={inputClassName}
                />
              </Field>
            </div>
          </StepCard>
        )

      case "additional":
        return (
          <StepCard
            title="Additional Information"
            description="Provide address details and website information."
            compact={compactLayout}
          >
            <div className={formSectionSpacingClassName}>
              <div className={splitGridClassName}>
                <div className="grid content-start gap-6">
                  <Field label="Address line 1" required>
                    <div className="space-y-1.5">
                      <Input
                        value={addressLine1}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            address: combineAddressLines(e.target.value, addressLine2),
                          }))
                        }
                        onBlur={() => touchField("address")}
                        placeholder="Street, area, landmark"
                        aria-invalid={Boolean(visibleStepErrors.address)}
                        className={inputClassName}
                      />
                      {visibleStepErrors.address ? <p className="text-sm text-destructive">{visibleStepErrors.address}</p> : null}
                    </div>
                  </Field>
                  <Field label="Address line 2">
                    <Input
                      value={addressLine2}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          address: combineAddressLines(addressLine1, e.target.value),
                        }))
                      }
                      placeholder="Building, suite, floor"
                      className={inputClassName}
                    />
                  </Field>
                </div>
                <div className="grid content-start gap-6">
                  <Field label="City" required>
                    <div className="space-y-1.5">
                      <Input
                        value={form.city}
                        onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))}
                        onBlur={() => touchField("city")}
                        placeholder="Mumbai"
                        aria-invalid={Boolean(visibleStepErrors.city)}
                        className={inputClassName}
                      />
                      {visibleStepErrors.city ? <p className="text-sm text-destructive">{visibleStepErrors.city}</p> : null}
                    </div>
                  </Field>
                  <Field label="State" required>
                    <div className="space-y-1.5">
                      <Input
                        value={form.state}
                        onChange={(e) => setForm((prev) => ({ ...prev, state: e.target.value }))}
                        onBlur={() => touchField("state")}
                        placeholder="Maharashtra"
                        aria-invalid={Boolean(visibleStepErrors.state)}
                        className={inputClassName}
                      />
                      {visibleStepErrors.state ? <p className="text-sm text-destructive">{visibleStepErrors.state}</p> : null}
                    </div>
                  </Field>
                </div>
              </div>

              <div className={sectionGridClassName}>
                <Field label="Country" required>
                  <div className="space-y-1.5">
                    <CountrySelect
                      value={form.country}
                      onChange={(value) => setForm((prev) => ({ ...prev, country: value }))}
                      onBlur={() => touchField("country")}
                      ariaInvalid={Boolean(visibleStepErrors.country)}
                      size={compactLayout ? "md" : "lg"}
                    />
                    {visibleStepErrors.country ? <p className="text-sm text-destructive">{visibleStepErrors.country}</p> : null}
                  </div>
                </Field>
                <Field label="Postal Code" required>
                  <div className="space-y-1.5">
                    <Input
                      value={form.postal_code}
                      onChange={(e) => setForm((prev) => ({ ...prev, postal_code: e.target.value }))}
                      onBlur={() => touchField("postal_code")}
                      placeholder="400001"
                      aria-invalid={Boolean(visibleStepErrors.postal_code)}
                      className={inputClassName}
                    />
                    {visibleStepErrors.postal_code ? <p className="text-sm text-destructive">{visibleStepErrors.postal_code}</p> : null}
                  </div>
                </Field>
              </div>

              <Field label="Website">
                <div className="space-y-1.5">
                  <Input
                    value={form.website}
                    onChange={(e) => setForm((prev) => ({ ...prev, website: e.target.value }))}
                    onBlur={() => touchField("website")}
                    placeholder="https://example.com"
                    aria-invalid={Boolean(visibleStepErrors.website)}
                    className={inputClassName}
                  />
                  {visibleStepErrors.website ? <p className="text-sm text-destructive">{visibleStepErrors.website}</p> : null}
                </div>
              </Field>
            </div>
          </StepCard>
        )

      case "review":
        return (
          <StepCard
            title="Review & Notes"
            description="Add internal notes and verify the captured details before saving."
            compact={compactLayout}
          >
            <div className="space-y-5">
              <Field label="Internal Notes">
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Anything your team should know before proceeding with compliance, documents, or onboarding."
                  className={textareaClassName}
                />
              </Field>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <ReviewItem label="Contractor Code" value={display(form.contractor_code)} />
                <ReviewItem label="Display Name" value={display(form.name)} />
                <ReviewItem label="Type" value={display(form.contractor_type)} />
                <ReviewItem label="Contact Person" value={display(form.contact_person)} />
                <ReviewItem label="Email" value={display(form.email)} />
                <ReviewItem label="Contact no." value={display(form.phone)} />
                <ReviewItem label="PAN Number" value={display(form.pan)} />
                <ReviewItem label="GSTIN Number" value={display(form.gstin)} />
                <ReviewItem label="Registration Number" value={display(form.registration_number)} />
                <ReviewItem label="City" value={display(form.city)} />
                <ReviewItem label="State" value={display(form.state)} />
                <ReviewItem label="Website" value={display(form.website)} />
                {showStatus ? <ReviewItem label="Status" value={active ? "Active" : "Inactive"} /> : null}
              </div>

              {Object.keys(validationErrors).length > 0 ? (
                <div className="rounded-2xl border border-red-200 bg-red-50/70 px-4 py-3 text-sm text-red-900">
                  <div className="font-semibold">Complete the required details before saving:</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {Array.from(new Set(Object.values(validationErrors))).map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900">
                {reviewMessage}
              </div>
            </div>
          </StepCard>
        )
    }
  }

  return (
    <div className="w-full space-y-6">
      {compactLayout ? (
        <Card className="rounded-3xl border-zinc-200 bg-white shadow-sm">
          <CardContent className="space-y-5 p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{title}</h1>
                  {!isTabMode ? (
                    <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
                      Step {stepIndex + 1} of {steps.length}
                    </Badge>
                  ) : null}
                </div>
                {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {onCancel ? (
                  <Button type="button" variant="outline" onClick={onCancel}>
                    {cancelLabel}
                  </Button>
                ) : null}
                {submitFromAnyStep ? (
                  <Button
                    type="button"
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                    disabled={saving}
                    onClick={() => void submitForm()}
                  >
                    {saving ? submittingLabel : submitLabel}
                  </Button>
                ) : null}
              </div>
            </div>

            {isTabMode ? (
              <Tabs
                value={currentStep.key}
                onValueChange={(value) => {
                  const nextIndex = steps.findIndex((step) => step.key === value)
                  if (nextIndex >= 0) setStepIndex(nextIndex)
                }}
                className="w-full gap-3"
              >
                <TabsList className="h-auto w-full flex-wrap justify-start gap-2 rounded-2xl bg-zinc-50 p-1">
                  {steps.map((step) => (
                    <TabsTrigger
                      key={step.key}
                      value={step.key}
                      className="rounded-xl border border-transparent px-4 py-2 data-active:border-emerald-200 data-active:bg-white data-active:text-zinc-950"
                    >
                      {step.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-3">
                    {allowStepJump ? (
                      <span className="text-xs text-muted-foreground">Open the section you want to edit.</span>
                    ) : null}
                  </div>

                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 lg:max-w-xs">
                    <div
                      className="h-full rounded-full bg-emerald-600 transition-all"
                      style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="grid gap-2 md:grid-cols-5">
                  {steps.map((step, index) => {
                    const done = index < stepIndex
                    const activeStep = index === stepIndex
                    const Icon = step.icon
                    const isClickable = allowStepJump
                    return (
                      <button
                        key={step.key}
                        type="button"
                        onClick={() => jumpToStep(index)}
                        disabled={!isClickable}
                        className={cn(
                          "flex min-w-0 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition",
                          isClickable ? "hover:border-emerald-300 hover:bg-emerald-50/40" : "cursor-default",
                          done
                            ? "border-emerald-200 bg-emerald-50/60"
                            : activeStep
                              ? "border-emerald-300 bg-emerald-50"
                              : "border-zinc-200 bg-white",
                        )}
                      >
                        <div
                          className={cn(
                            "grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold transition",
                            done
                              ? "border-emerald-600 bg-emerald-600 text-white"
                              : activeStep
                                ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                                : "border-zinc-200 bg-white text-zinc-500",
                          )}
                        >
                          {done ? <Check className="size-4" /> : index + 1}
                        </div>
                        <div className="min-w-0">
                          <div
                            className={cn(
                              "truncate text-sm font-semibold",
                              activeStep || done ? "text-zinc-950" : "text-zinc-600",
                            )}
                          >
                            {step.label}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Icon className="size-3.5 shrink-0" />
                            <span className="truncate">{step.description}</span>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/50 p-5">{renderCurrentStep()}</div>

            <div className="flex flex-col gap-4 border-t border-zinc-200 pt-4 lg:flex-row lg:items-center lg:justify-between">
              <div>{hasHelperText ? <div className="text-sm text-emerald-900">{helperText}</div> : null}</div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {!isTabMode && stepIndex > 0 ? (
                  <Button type="button" variant="outline" onClick={previousStep}>
                    <ArrowLeft className="mr-2 size-4" />
                    Back
                  </Button>
                ) : null}
                {!isTabMode && !isFinalStep ? (
                  <Button
                    type="button"
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={nextStep}
                  >
                    Next
                    <ArrowRight className="ml-2 size-4" />
                  </Button>
                ) : !isTabMode && !submitFromAnyStep ? (
                  <Button
                    type="button"
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                    disabled={saving}
                    onClick={() => void submitForm()}
                  >
                    {saving ? submittingLabel : submitLabel}
                  </Button>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="rounded-[30px] border-zinc-200 bg-white shadow-[0_22px_70px_-46px_rgba(15,23,42,0.42)]">
            <CardContent className="space-y-6 p-6 lg:p-7">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <Badge variant="outline" className="rounded-full px-4 py-2 text-sm font-semibold text-zinc-700">
                  Step {stepIndex + 1} of {steps.length}
                </Badge>

                <div className="flex items-center gap-4 xl:min-w-[26rem] xl:max-w-[32rem] xl:flex-1 xl:justify-end">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className="h-full rounded-full bg-emerald-600 transition-all"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <span className="text-base font-semibold text-zinc-700">{progressPercent}%</span>
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-5">
                {steps.map((step, index) => {
                  const done = index < stepIndex
                  const activeStep = index === stepIndex
                  const isClickable = allowStepJump
                  return (
                    <button
                      key={step.key}
                      type="button"
                      onClick={() => jumpToStep(index)}
                      disabled={!isClickable}
                      className={cn(
                        "flex min-w-0 items-center gap-4 rounded-[20px] border px-4 py-4 text-left transition-all",
                        isClickable ? "hover:border-emerald-300 hover:bg-emerald-50/40" : "cursor-default",
                        done
                          ? "border-zinc-200 bg-white"
                          : activeStep
                            ? "border-emerald-300 bg-emerald-50/70 shadow-[0_12px_30px_-24px_rgba(5,150,105,0.75)]"
                            : "border-zinc-200 bg-white",
                      )}
                    >
                      <div
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-full border text-sm font-semibold transition",
                          done || activeStep
                            ? "border-emerald-600 bg-emerald-600 text-white"
                            : "border-zinc-300 bg-white text-zinc-600",
                        )}
                      >
                        {done ? <Check className="size-4" /> : index + 1}
                      </div>
                      <div className="min-w-0">
                        <div
                          className={cn(
                            "truncate text-sm font-semibold",
                            activeStep || done ? "text-zinc-950" : "text-zinc-600",
                          )}
                        >
                          {step.label}
                        </div>
                        <div className="mt-0.5 truncate text-sm text-zinc-500">{step.description}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-visible rounded-[30px] border-zinc-200 bg-white shadow-[0_22px_70px_-46px_rgba(15,23,42,0.42)]">
            <CardContent className="space-y-8 overflow-visible p-6 lg:p-7">
              {renderCurrentStep()}
              {hasHelperText ? (
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
                  {helperText}
                </div>
              ) : null}
            </CardContent>
            <div className="flex flex-col gap-4 border-t border-zinc-200 px-6 py-5 sm:flex-row sm:items-center sm:justify-between lg:px-7">
              <div>
                {onCancel ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onCancel}
                    className="h-14 rounded-2xl px-8 text-base"
                  >
                    {cancelLabel}
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                {stepIndex > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={previousStep}
                    className="h-14 rounded-2xl px-8 text-base"
                  >
                    <ArrowLeft className="mr-2 size-4" />
                    Back
                  </Button>
                ) : null}
                {submitFromAnyStep ? (
                  <Button
                    type="button"
                    className="h-14 rounded-2xl bg-emerald-600 px-8 text-base text-white hover:bg-emerald-700"
                    disabled={saving}
                    onClick={() => void submitForm()}
                  >
                    {saving ? submittingLabel : submitLabel}
                  </Button>
                ) : isFinalStep ? (
                  <Button
                    type="button"
                    className="h-14 rounded-2xl bg-emerald-600 px-8 text-base text-white hover:bg-emerald-700"
                    disabled={saving}
                    onClick={() => void submitForm()}
                  >
                    {saving ? submittingLabel : submitLabel}
                  </Button>
                ) : null}
                {!isFinalStep ? (
                  <Button
                    type="button"
                    className="h-14 rounded-2xl bg-emerald-600 px-8 text-base text-white hover:bg-emerald-700"
                    onClick={nextStep}
                  >
                    Next
                    <ArrowRight className="ml-2 size-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
