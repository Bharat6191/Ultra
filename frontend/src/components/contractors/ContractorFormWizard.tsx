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

import {
  combineAddressLines,
  contactNumberError,
  isContractorFormValid,
  normalizePhoneInput,
  splitAddressLines,
  type ContractorFormValues,
} from "@/components/contractors/ContractorForm"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  if (compact) {
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <div className="text-lg font-semibold text-zinc-950">{title}</div>
          {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
        </div>
        <div>{children}</div>
      </div>
    )
  }

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

export type ContractorFormWizardProps = {
  title: string
  subtitle?: string
  form: ContractorFormValues
  onChange: (next: ContractorFormValues) => void
  onSubmit: () => void | Promise<void>
  saving?: boolean
  submitLabel: string
  submittingLabel: string
  helperText: string
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
  helperText,
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
  const phoneError = contactNumberError(form.phone)
  const alternatePhoneError = contactNumberError(form.alternate_phone)
  const [addressLine1, addressLine2] = splitAddressLines(form.address)
  const canGoNext =
    stepIndex === 0 ? isContractorFormValid(form) : stepIndex === 1 ? !phoneError && !alternatePhoneError : true

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

  function nextStep() {
    if (!canGoNext || isFinalStep) return
    setStepIndex((current) => Math.min(current + 1, steps.length - 1))
  }

  function previousStep() {
    setStepIndex((current) => Math.max(current - 1, 0))
  }

  function jumpToStep(index: number) {
    if (!allowStepJump) return
    setStepIndex(index)
  }

  function renderCurrentStep() {
    switch (currentStep.key) {
      case "basic":
        return (
          <StepCard title="Basic Information" compact={compactLayout}>
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
              <Field label="Legal Name">
                <Input
                  value={form.legal_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, legal_name: e.target.value }))}
                  placeholder="ABC Contractors Private Limited"
                />
              </Field>
              {showStatus && onActiveChange ? (
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-zinc-50/70 px-4 py-3">
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
          <StepCard title="Contact Information" compact={compactLayout}>
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
          <StepCard title="Compliance & Registration" compact={compactLayout}>
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
          <StepCard title="Additional Information" compact={compactLayout}>
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
          <StepCard title="Review & Notes" compact={compactLayout}>
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
                {showStatus ? <ReviewItem label="Status" value={active ? "Active" : "Inactive"} /> : null}
              </div>

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
                    disabled={saving || !isContractorFormValid(form)}
                    onClick={() => void onSubmit()}
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
              <div className="text-sm text-emerald-900">{helperText}</div>
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
                    disabled={!canGoNext}
                    onClick={nextStep}
                  >
                    Next
                    <ArrowRight className="ml-2 size-4" />
                  </Button>
                ) : !isTabMode && !submitFromAnyStep ? (
                  <Button
                    type="button"
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                    disabled={saving || !isContractorFormValid(form)}
                    onClick={() => void onSubmit()}
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
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{title}</h1>
              <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
                      Step {stepIndex + 1} of {steps.length}
              </Badge>
            </div>
            {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>

          <Card className="rounded-3xl border-zinc-200 bg-white shadow-sm">
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
                    Step {stepIndex + 1} of {WIZARD_STEPS.length}
                  </Badge>
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
            </CardContent>
          </Card>

          <div>{renderCurrentStep()}</div>

          <Card className="rounded-3xl border-emerald-200 bg-emerald-50/40 shadow-sm">
            <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="text-sm text-emerald-900">{helperText}</div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {onCancel ? (
                  <Button type="button" variant="outline" onClick={onCancel}>
                    {cancelLabel}
                  </Button>
                ) : null}
                {stepIndex > 0 ? (
                  <Button type="button" variant="outline" onClick={previousStep}>
                    <ArrowLeft className="mr-2 size-4" />
                    Back
                  </Button>
                ) : null}
                {submitFromAnyStep ? (
                  <Button
                    type="button"
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                    disabled={saving || !isContractorFormValid(form)}
                    onClick={() => void onSubmit()}
                  >
                    {saving ? submittingLabel : submitLabel}
                  </Button>
                ) : isFinalStep ? (
                  <Button
                    type="button"
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                    disabled={saving || !isContractorFormValid(form)}
                    onClick={() => void onSubmit()}
                  >
                    {saving ? submittingLabel : submitLabel}
                  </Button>
                ) : null}
                {!isFinalStep ? (
                  <Button
                    type="button"
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                    disabled={!canGoNext}
                    onClick={nextStep}
                  >
                    Next
                    <ArrowRight className="ml-2 size-4" />
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
