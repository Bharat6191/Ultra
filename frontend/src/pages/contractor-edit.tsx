import * as React from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { ArrowLeft } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ContractorForm,
  contractorFormFromSource,
  contractorFormToUpdatePayload,
  isContractorFormValid,
  type ContractorFormValues,
} from "@/components/contractors/ContractorForm"
import { getJson, patchJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"

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
}

export function ContractorEditPage() {
  const { id: idParam } = useParams()
  const id = Number(idParam)
  const navigate = useNavigate()

  const canEdit = hasPermission("contractor.update")
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [contractor, setContractor] = React.useState<ContractorPublic | null>(null)
  const [form, setForm] = React.useState<ContractorFormValues | null>(null)
  const [active, setActive] = React.useState(true)

  React.useEffect(() => {
    if (!Number.isFinite(id) || id <= 0) {
      setError("Invalid contractor id")
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void getJson<ContractorPublic>(`/contractors/${id}`)
      .then((c) => {
        if (cancelled) return
        setContractor(c)
        setForm(contractorFormFromSource(c))
        setActive(c.is_active)
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load contractor")
          setContractor(null)
          setForm(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  async function submit() {
    if (!contractor || !form) return
    setSaving(true)
    toast.loading("Saving contractor…", { id: "contractor-edit" })
    try {
      const updated = await patchJson<ContractorPublic>(
        `/contractors/${contractor.id}`,
        contractorFormToUpdatePayload(form, active) as unknown as Record<string, unknown>,
      )
      toast.success("Contractor updated", { id: "contractor-edit" })
      navigate(`/dashboard/contractors/${updated.id}`, { replace: true })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update", { id: "contractor-edit" })
    } finally {
      setSaving(false)
    }
  }

  if (!canEdit) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Permission required</AlertTitle>
        <AlertDescription>You need contractor.update to edit contractors.</AlertDescription>
      </Alert>
    )
  }

  if (loading) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Loading…</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Fetching contractor details.</CardContent>
      </Card>
    )
  }

  if (error || !contractor || !form) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Unable to load contractor</AlertTitle>
        <AlertDescription>{error ?? "Contractor not found"}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Button asChild variant="ghost" size="icon-sm" className="mt-0.5 rounded-lg" aria-label="Back to contractor">
            <Link to={`/dashboard/contractors/${contractor.id}`}>
              <ArrowLeft className="size-4 opacity-70" aria-hidden />
            </Link>
          </Button>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Edit contractor</h1>
            <p className="text-sm text-muted-foreground">
              Update profile details for {contractor.name}. Sensitive statutory changes may trigger approval workflows.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(`/dashboard/contractors/${contractor.id}`)}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={saving || !isContractorFormValid(form)}
            onClick={() => void submit()}
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      <ContractorForm form={form} onChange={setForm} active={active} onActiveChange={setActive} />
    </div>
  )
}
