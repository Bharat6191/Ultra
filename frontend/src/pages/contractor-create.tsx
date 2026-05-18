import * as React from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  ContractorForm,
  contractorFormToCreatePayload,
  emptyContractorForm,
  isContractorFormValid,
  type ContractorFormValues,
} from "@/components/contractors/ContractorForm"
import { postJson } from "@/lib/api"

type ContractorPublic = {
  id: number
  name: string
  is_active: boolean
}

export function ContractorCreatePage() {
  const navigate = useNavigate()
  const [saving, setSaving] = React.useState(false)
  const [active, setActive] = React.useState(true)
  const [form, setForm] = React.useState<ContractorFormValues>(() => emptyContractorForm())

  async function submit() {
    setSaving(true)
    toast.loading("Creating contractor…", { id: "contractor-create" })
    try {
      const payload = contractorFormToCreatePayload(form)
      const created = await postJson<ContractorPublic>("/contractors", payload as unknown as Record<string, unknown>)
      if (!active && created.is_active) {
        // Best-effort: detail page supports deactivate if workflow created as active.
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
            disabled={saving || !isContractorFormValid(form)}
            onClick={() => void submit()}
          >
            {saving ? "Creating…" : "Create"}
          </Button>
        </div>
      </div>

      <ContractorForm form={form} onChange={setForm} active={active} onActiveChange={setActive} />

      <div className="text-xs text-muted-foreground">
        If approval workflow is configured for{" "}
        <code className="rounded bg-muted px-1 py-0.5">contractor.create</code>, contractors may start as inactive until
        approved.
      </div>
    </div>
  )
}
