import * as React from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { PageBackLink } from "@/components/layout/page-back-link"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  buildWorkOrderLinesForApi,
  newDraftLine,
  pricingDateForNewWorkOrder,
  WorkOrderExecutionFooter,
  WorkOrderExecutionHeader,
  WorkOrderExecutionTable,
} from "@/components/work-orders/work-order-execution-ui"
import type { ContractorLite, OrgUnitLite, PartMasterLite } from "@/components/work-orders/work-order-execution-ui"
import { ApiError, getJson, postJson } from "@/lib/api"
import { canListOrgUnitsForAssignments, hasPermission } from "@/lib/permissions"

function submitSuccessMessage(status: string | null | undefined): string {
  return String(status ?? "").trim().toLowerCase() === "active"
    ? "Work order activated"
    : "Submitted for approval"
}

export function WorkOrderCreatePage() {
  const navigate = useNavigate()
  const canCreate = hasPermission("work_orders.create")

  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const [contractors, setContractors] = React.useState<ContractorLite[]>([])
  const [partMasters, setPartMasters] = React.useState<PartMasterLite[]>([])
  const [plants, setPlants] = React.useState<OrgUnitLite[]>([])

  const [busy, setBusy] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [reference, setReference] = React.useState("")
  const [org_unit_id, setOrgUnitId] = React.useState("")
  const [contractorId, setContractorId] = React.useState("")
  const [lines, setLines] = React.useState(() => [newDraftLine()])

  const pricingWorkDate = React.useMemo(() => pricingDateForNewWorkOrder(), [])

  React.useEffect(() => {
    if (!canCreate) return
    void (async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const [clist, rms, plist] = await Promise.all([
          getJson<ContractorLite[]>("/contractors/lookup?limit=200&status=active").catch(() => []),
          getJson<PartMasterLite[]>("/part-master?active=true").catch(() => []),
          canListOrgUnitsForAssignments()
            ? getJson<OrgUnitLite[]>("/admin/org-units?type=PLANT").catch(() => [])
            : Promise.resolve([]),
        ])
        setContractors(clist)
        setPartMasters(Array.isArray(rms) ? rms : [])
        setPlants(plist)
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load dropdowns")
        setContractors([])
        setPartMasters([])
        setPlants([])
      } finally {
        setLoading(false)
      }
    })()
  }, [canCreate])

  function validatePayload() {
    if (!org_unit_id) return { error: "Plant is required." as const }
    if (!title.trim()) return { error: "Title is required." as const }
    const built = buildWorkOrderLinesForApi(contractorId, lines, partMasters)
    if (!built.ok) return { error: built.error }
    return {
      body: {
        org_unit_id: Number(org_unit_id),
        contractor_id: built.contractor_id,
        title: title.trim(),
        description: reference.trim() || null,
        items: built.items,
      },
    }
  }

  async function saveDraft() {
    const v = validatePayload()
    if ("error" in v) return toast.error(v.error)
    setBusy(true)
    try {
      const wo = await postJson<{ id: number }>("/work-orders", v.body)
      toast.success("Work order saved (draft)")
      navigate(`/dashboard/work-orders/${wo.id}`, { replace: true })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Save failed")
    } finally {
      setBusy(false)
    }
  }

  async function saveAndSubmit() {
    const v = validatePayload()
    if ("error" in v) return toast.error(v.error)
    setBusy(true)
    try {
      const wo = await postJson<{ id: number }>("/work-orders", v.body)
      const submitted = await postJson<{ status?: string | null }>(`/work-orders/${wo.id}/submit`, {})
      toast.success(submitSuccessMessage(submitted.status))
      navigate(`/dashboard/work-orders/${wo.id}`, { replace: true })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Submit failed")
    } finally {
      setBusy(false)
    }
  }

  if (!canCreate) {
    return (
      <Alert variant="destructive">
        <AlertTitle>No access</AlertTitle>
        <AlertDescription>Needs the permission `work_orders.create`.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div className="min-w-0 space-y-3">
        <PageBackLink to="/dashboard/work-orders" label="Work Orders" />
        <div className="space-y-1.5">
          <h3 className="text-xl font-bold tracking-tight text-zinc-950">Create Work Order</h3>
        </div>
      </div>

      {loadError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load form options</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      <WorkOrderExecutionHeader
        loading={loading}
        editable
        title={title}
        reference={reference}
        org_unit_id={org_unit_id}
        plants={plants}
        onTitle={setTitle}
        onReference={setReference}
        onOrgUnit={setOrgUnitId}
      />

      <WorkOrderExecutionTable
        mode="edit"
        loading={loading}
        org_unit_id={org_unit_id}
        contractors={contractors}
        partMasters={partMasters}
        contractorId={contractorId}
        onContractorId={setContractorId}
        lines={lines}
        onLinesChange={setLines}
        pricingWorkDate={pricingWorkDate}
      />

      <WorkOrderExecutionFooter
        busy={busy}
        showSubmit
        saveLabel="Save Draft"
        submitLabel="Activate"
        onCancel={() => navigate("/dashboard/work-orders")}
        onSave={() => void saveDraft()}
        onSubmitApproval={() => void saveAndSubmit()}
      />
    </div>
  )
}
