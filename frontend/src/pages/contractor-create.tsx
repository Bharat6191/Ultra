import * as React from "react"
import { useNavigate } from "react-router-dom"
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
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  combineAddressLines,
  contactNumberError,
  contractorFormToCreatePayload,
  emptyContractorForm,
  isContractorFormValid,
  normalizePhoneInput,
  splitAddressLines,
  type ContractorFormValues,
} from "@/components/contractors/ContractorForm"
import { postJson } from "@/lib/api"
import { cn } from "@/lib/utils"

type ContractorPublic = {
  id: number
  name: string
  is_active: boolean
}

type CreateStep = {
  key: "basic" | "contact" | "compliance" | "additional" | "review"
  label: string
  description: string
  icon: React.ElementType
}

const CREATE_STEPS: CreateStep[] = [
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
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Card className="rounded-3xl border-zinc-200 bg-white shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-2xl">{title}</CardTitle>
        {description ? <CardDescription className="text-sm">{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
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

export function ContractorCreatePage() {
  const navigate = useNavigate()
  const [saving, setSaving] = React.useState(false)
  const [stepIndex, setStepIndex] = React.useState(0)
  const [form, setForm] = React.useState<ContractorFormValues>(() => emptyContractorForm())

  const currentStep = CREATE_STEPS[stepIndex]
  const isFinalStep = stepIndex === CREATE_STEPS.length - 1
  const phoneError = contactNumberError(form.phone)
  const alternatePhoneError = contactNumberError(form.alternate_phone)
  const [addressLine1, addressLine2] = splitAddressLines(form.address)
  const canGoNext =
    stepIndex === 0 ? isContractorFormValid(form) : stepIndex === 1 ? !phoneError && !alternatePhoneError : true

  async function submit() {
    setSaving(true)
    toast.loading("Creating contractor…", { id: "contractor-create" })
    try {
      const payload = contractorFormToCreatePayload(form)
      const created = await postJson<ContractorPublic>("/contractors", payload as unknown as Record<string, unknown>)
      toast.success("Contractor created", { id: "contractor-create" })
      navigate(`/dashboard/contractors/${created.id}`, { replace: true })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed", { id: "contractor-create" })
    } finally {
      setSaving(false)
    }
  }

  function nextStep() {
    if (!canGoNext || isFinalStep) return
    setStepIndex((current) => Math.min(current + 1, CREATE_STEPS.length - 1))
  }

  function previousStep() {
    setStepIndex((current) => Math.max(current - 1, 0))
  }

  function renderCurrentStep() {
    switch (currentStep.key) {
      case "basic":
        return (
          <StepCard title="Basic Information">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Contractor Code" required>
                <Input
                  value={form.contractor_code}
                  onChange={(e) => setForm((prev) => ({ ...prev, contractor_code: e.target.value }))}
                  placeholder="CTR-001"
                />
              </Field>
              <Field label="Contractor Type">
                <select
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  value={form.contractor_type}
                  onChange={(e) => setForm((prev) => ({ ...prev, contractor_type: e.target.value }))}
                >
                  <option value="">Select type</option>
                  <option value="vendor">Vendor</option>
                  <option value="labour">Labour</option>
                  <option value="service">Service</option>
                  <option value="epc">EPC</option>
                </select>
              </Field>
              <Field label="Display Name" required>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="ABC Contractors Pvt. Ltd."
                />
              </Field>
              <Field label="Trade Name">
                <Input
                  value={form.trade_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, trade_name: e.target.value }))}
                  placeholder="ABC Contractors"
                />
              </Field>
              <Field label="Legal Name" required={false}>
                <Input
                  value={form.legal_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, legal_name: e.target.value }))}
                  placeholder="ABC Contractors Private Limited"
                />
              </Field>
            </div>
          </StepCard>
        )

      case "contact":
        return (
          <StepCard title="Contact Information">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Contact Person">
                <Input
                  value={form.contact_person}
                  onChange={(e) => setForm((prev) => ({ ...prev, contact_person: e.target.value }))}
                  placeholder="Jane Doe"
                />
              </Field>
              <Field label="Contact Title">
                <Input
                  value={form.contact_person_title}
                  onChange={(e) => setForm((prev) => ({ ...prev, contact_person_title: e.target.value }))}
                  placeholder="Operations Manager"
                />
              </Field>
              <Field label="Contact no.">
                <div className="space-y-1.5">
                  <Input
                    value={form.phone}
                    onChange={(e) => setForm((prev) => ({ ...prev, phone: normalizePhoneInput(e.target.value) }))}
                    placeholder="9876543210"
                    inputMode="numeric"
                    maxLength={10}
                    aria-invalid={Boolean(phoneError)}
                  />
                  {phoneError ? <p className="text-sm text-destructive">{phoneError}</p> : null}
                </div>
              </Field>
              <Field label="Alternate contact no.">
                <div className="space-y-1.5">
                  <Input
                    value={form.alternate_phone}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, alternate_phone: normalizePhoneInput(e.target.value) }))
                    }
                    placeholder="9876543210"
                    inputMode="numeric"
                    maxLength={10}
                    aria-invalid={Boolean(alternatePhoneError)}
                  />
                  {alternatePhoneError ? <p className="text-sm text-destructive">{alternatePhoneError}</p> : null}
                </div>
              </Field>
              <Field label="Email">
                <Input
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="contractor@example.com"
                />
              </Field>
              <Field label="Alternate Email">
                <Input
                  value={form.alternate_email}
                  onChange={(e) => setForm((prev) => ({ ...prev, alternate_email: e.target.value }))}
                  placeholder="accounts@example.com"
                />
              </Field>
            </div>
          </StepCard>
        )

      case "compliance":
        return (
          <StepCard title="Compliance & Registration">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="PAN">
                <Input
                  value={form.pan}
                  onChange={(e) => setForm((prev) => ({ ...prev, pan: e.target.value }))}
                  placeholder="ABCDE1234F"
                />
              </Field>
              <Field label="GSTIN">
                <Input
                  value={form.gstin}
                  onChange={(e) => setForm((prev) => ({ ...prev, gstin: e.target.value }))}
                  placeholder="22AAAAA0000A1Z5"
                />
              </Field>
              <Field label="CIN">
                <Input
                  value={form.cin}
                  onChange={(e) => setForm((prev) => ({ ...prev, cin: e.target.value }))}
                  placeholder="U12345MH2024PTC000001"
                />
              </Field>
              <Field label="Registration Number">
                <Input
                  value={form.registration_number}
                  onChange={(e) => setForm((prev) => ({ ...prev, registration_number: e.target.value }))}
                  placeholder="REG-2026-001"
                />
              </Field>
            </div>
          </StepCard>
        )

      case "additional":
        return (
          <StepCard title="Additional Information">
            <div className="space-y-4">
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="grid content-start gap-6">
                  <Field label="Address line 1" required>
                    <Input
                      value={addressLine1}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          address: combineAddressLines(e.target.value, addressLine2),
                        }))
                      }
                      placeholder="Street, area, landmark"
                    />
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
                    />
                  </Field>
                </div>
                <div className="grid content-start gap-6">
                  <Field label="City" required>
                    <Input
                      value={form.city}
                      onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))}
                      placeholder="Mumbai"
                    />
                  </Field>
                  <Field label="State" required>
                    <Input
                      value={form.state}
                      onChange={(e) => setForm((prev) => ({ ...prev, state: e.target.value }))}
                      placeholder="Maharashtra"
                    />
                  </Field>
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <Field label="Country" required>
                  <select
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    value={form.country}
                    onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value }))}
                  >
                    <option value="India">India</option>
                    <option value="United Arab Emirates">United Arab Emirates</option>
                    <option value="Saudi Arabia">Saudi Arabia</option>
                    <option value="Qatar">Qatar</option>
                    <option value="Oman">Oman</option>
                    <option value="Kuwait">Kuwait</option>
                  </select>
                </Field>
                <Field label="Postal Code" required>
                  <Input
                    value={form.postal_code}
                    onChange={(e) => setForm((prev) => ({ ...prev, postal_code: e.target.value }))}
                    placeholder="400001"
                  />
                </Field>
              </div>

              <Field label="Website">
                <Input
                  value={form.website}
                  onChange={(e) => setForm((prev) => ({ ...prev, website: e.target.value }))}
                  placeholder="https://example.com"
                />
              </Field>
            </div>
          </StepCard>
        )

      case "review":
        return (
          <StepCard title="Review & Notes">
            <div className="space-y-5">
              <Field label="Internal Notes">
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Anything your team should know before proceeding with compliance, documents, or onboarding."
                  className="min-h-32"
                />
              </Field>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <ReviewItem label="Contractor Code" value={display(form.contractor_code)} />
                <ReviewItem label="Display Name" value={display(form.name)} />
                <ReviewItem label="Type" value={display(form.contractor_type)} />
                <ReviewItem label="Contact Person" value={display(form.contact_person)} />
                <ReviewItem label="Email" value={display(form.email)} />
                <ReviewItem label="Contact no." value={display(form.phone)} />
                <ReviewItem label="PAN" value={display(form.pan)} />
                <ReviewItem label="GSTIN" value={display(form.gstin)} />
                <ReviewItem label="Registration Number" value={display(form.registration_number)} />
                <ReviewItem label="City" value={display(form.city)} />
                <ReviewItem label="State" value={display(form.state)} />
                <ReviewItem label="Website" value={display(form.website)} />
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900">
                Documents, plant mapping, and compliance tracking can be managed on the contractor detail screen after
                this profile is created.
              </div>
            </div>
          </StepCard>
        )
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Create Contractor</h1>
          <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
            Step {stepIndex + 1} of {CREATE_STEPS.length}
          </Badge>
        </div>
      </div>

      <Card className="rounded-3xl border-zinc-200 bg-white shadow-sm">
        <CardContent className="space-y-5 p-6">
          <div className="grid gap-3 md:grid-cols-5">
            {CREATE_STEPS.map((step, index) => {
              const done = index < stepIndex
              const active = index === stepIndex
              const Icon = step.icon
              return (
                <div key={step.key} className="relative min-w-0">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-full border text-sm font-semibold transition",
                        done
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : active
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                            : "border-zinc-200 bg-white text-zinc-500",
                      )}
                    >
                      {done ? <Check className="size-5" /> : index + 1}
                    </div>
                    {index < CREATE_STEPS.length - 1 ? <div className="hidden h-px flex-1 bg-zinc-200 md:block" /> : null}
                  </div>
                  <div className="mt-3 space-y-1">
                    <div className={cn("text-sm font-semibold", active || done ? "text-zinc-950" : "text-zinc-500")}>
                      {step.label}
                    </div>
                    <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Icon className="mt-0.5 size-3.5 shrink-0" />
                      <span>{step.description}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all"
              style={{ width: `${((stepIndex + 1) / CREATE_STEPS.length) * 100}%` }}
            />
          </div>
        </CardContent>
      </Card>

      <div>{renderCurrentStep()}</div>

      <Card className="rounded-3xl border-emerald-200 bg-emerald-50/40 shadow-sm">
        <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="text-sm text-emerald-900">
            Required fields are validated as you move forward. You can still go back and update any step before
            creating the contractor.
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {stepIndex > 0 ? (
              <Button type="button" variant="outline" onClick={previousStep}>
                <ArrowLeft className="mr-2 size-4" />
                Back
              </Button>
            ) : null}
            {isFinalStep ? (
              <Button
                type="button"
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={saving || !isContractorFormValid(form)}
                onClick={() => void submit()}
              >
                {saving ? "Creating…" : "Create Contractor"}
              </Button>
            ) : (
              <Button type="button" className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={!canGoNext} onClick={nextStep}>
                Next
                <ArrowRight className="ml-2 size-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
