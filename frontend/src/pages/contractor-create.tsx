import * as React from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { ContractorFormWizard } from "@/components/contractors/ContractorFormWizard"
import {
  contractorFormToCreatePayload,
  emptyContractorForm,
  type ContractorFormValues,
} from "@/components/contractors/ContractorForm"
import { postJson } from "@/lib/api"

type ContractorPublic = {
  id: number
}

type ContractorCreateDraft = {
  form: ContractorFormValues
  stepIndex: number
}

const CONTRACTOR_CREATE_DRAFT_KEY = "contractor.create.draft.v1"

function sanitizeDraftForm(raw: unknown): ContractorFormValues {
  const empty = emptyContractorForm()
  if (!raw || typeof raw !== "object") return empty
  const source = raw as Record<string, unknown>
  return {
    contractor_code: typeof source.contractor_code === "string" ? source.contractor_code : empty.contractor_code,
    name: typeof source.name === "string" ? source.name : empty.name,
    legal_name: typeof source.legal_name === "string" ? source.legal_name : empty.legal_name,
    trade_name: typeof source.trade_name === "string" ? source.trade_name : empty.trade_name,
    contractor_type: typeof source.contractor_type === "string" ? source.contractor_type : empty.contractor_type,
    pan: typeof source.pan === "string" ? source.pan : empty.pan,
    gstin: typeof source.gstin === "string" ? source.gstin : empty.gstin,
    cin: typeof source.cin === "string" ? source.cin : empty.cin,
    contact_person: typeof source.contact_person === "string" ? source.contact_person : empty.contact_person,
    contact_person_title:
      typeof source.contact_person_title === "string" ? source.contact_person_title : empty.contact_person_title,
    email: typeof source.email === "string" ? source.email : empty.email,
    alternate_email: typeof source.alternate_email === "string" ? source.alternate_email : empty.alternate_email,
    phone: typeof source.phone === "string" ? source.phone : empty.phone,
    alternate_phone: typeof source.alternate_phone === "string" ? source.alternate_phone : empty.alternate_phone,
    address: typeof source.address === "string" ? source.address : empty.address,
    city: typeof source.city === "string" ? source.city : empty.city,
    state: typeof source.state === "string" ? source.state : empty.state,
    country: typeof source.country === "string" && source.country.trim() ? source.country : empty.country,
    postal_code: typeof source.postal_code === "string" ? source.postal_code : empty.postal_code,
    registration_number:
      typeof source.registration_number === "string" ? source.registration_number : empty.registration_number,
    website: typeof source.website === "string" ? source.website : empty.website,
    notes: typeof source.notes === "string" ? source.notes : empty.notes,
  }
}

function isPristineDraft(form: ContractorFormValues, stepIndex: number): boolean {
  const empty = emptyContractorForm()
  return stepIndex === 0 && Object.keys(empty).every((key) => form[key as keyof ContractorFormValues] === empty[key as keyof ContractorFormValues])
}

function readContractorCreateDraft(): ContractorCreateDraft | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(CONTRACTOR_CREATE_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return null
    const source = parsed as Record<string, unknown>
    const stepIndexValue = Number(source.stepIndex)
    return {
      form: sanitizeDraftForm(source.form),
      stepIndex: Number.isFinite(stepIndexValue) && stepIndexValue >= 0 ? Math.floor(stepIndexValue) : 0,
    }
  } catch {
    return null
  }
}

function clearContractorCreateDraft() {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(CONTRACTOR_CREATE_DRAFT_KEY)
  } catch {
    // ignore
  }
}

function writeContractorCreateDraft(form: ContractorFormValues, stepIndex: number) {
  if (typeof window === "undefined") return
  try {
    if (isPristineDraft(form, stepIndex)) {
      window.localStorage.removeItem(CONTRACTOR_CREATE_DRAFT_KEY)
      return
    }
    window.localStorage.setItem(
      CONTRACTOR_CREATE_DRAFT_KEY,
      JSON.stringify({
        form,
        stepIndex,
      } satisfies ContractorCreateDraft),
    )
  } catch {
    // ignore
  }
}

export function ContractorCreatePage() {
  const navigate = useNavigate()
  const [saving, setSaving] = React.useState(false)
  const restoredDraftRef = React.useRef<ContractorCreateDraft | null>(readContractorCreateDraft())
  const [form, setForm] = React.useState<ContractorFormValues>(
    () => restoredDraftRef.current?.form ?? emptyContractorForm(),
  )
  const [stepIndex, setStepIndex] = React.useState<number>(() => restoredDraftRef.current?.stepIndex ?? 0)

  React.useEffect(() => {
    if (!restoredDraftRef.current) return
    toast.info("Restored saved contractor draft.", { id: "contractor-create-draft" })
    restoredDraftRef.current = null
  }, [])

  React.useEffect(() => {
    writeContractorCreateDraft(form, stepIndex)
  }, [form, stepIndex])

  async function submit() {
    setSaving(true)
    toast.loading("Creating contractor…", { id: "contractor-create" })
    try {
      const payload = contractorFormToCreatePayload(form)
      const created = await postJson<ContractorPublic>("/contractors", payload as unknown as Record<string, unknown>)
      clearContractorCreateDraft()
      toast.success("Contractor created", { id: "contractor-create" })
      navigate(`/dashboard/contractors/${created.id}`, { replace: true })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed", { id: "contractor-create" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <ContractorFormWizard
      title="Create Contractor"
      subtitle="Add the contractor details in a guided flow, then review everything before saving."
      form={form}
      onChange={setForm}
      onSubmit={submit}
      saving={saving}
      submitLabel="Create Contractor"
      submittingLabel="Creating…"
      helperText="Required fields are validated as you move forward. You can still go back and update any step before creating the contractor."
      reviewMessage="Documents, plant mapping, and compliance tracking can be managed on the contractor detail screen after this profile is created."
      stepIndex={stepIndex}
      onStepIndexChange={setStepIndex}
      onCancel={() => {
        clearContractorCreateDraft()
        navigate("/dashboard/contractors")
      }}
    />
  )
}
