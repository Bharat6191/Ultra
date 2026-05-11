import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import type { ContractorLite, ExecutionDraftLine, OrgUnitLite, RateMasterLite } from "@/components/work-orders/work-order-execution-ui"
import {
  draftLinesToContractors,
  newDraftLine,
  WorkOrderExecutionFooter,
  WorkOrderExecutionHeader,
  WorkOrderExecutionTable,
} from "@/components/work-orders/work-order-execution-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ApiError, getJson, postJson } from "@/lib/api"
import { canListOrgUnitsForAssignments, hasPermission } from "@/lib/permissions"

export function WorkOrderCreatePage() {
  const navigate = useNavigate()
  const canCreate = hasPermission("work_orders.create")

  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const [contractors, setContractors] = React.useState<ContractorLite[]>([])
  const [rateMasters, setRateMasters] = React.useState<RateMasterLite[]>([])
  const [plants, setPlants] = React.useState<OrgUnitLite[]>([])

  const [busy, setBusy] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [reference, setReference] = React.useState("")
  const [org_unit_id, setOrgUnitId] = React.useState("")
  const [workDate] = React.useState(() => new Date().toISOString().slice(0, 10))
  const [lines, setLines] = React.useState<ExecutionDraftLine[]>(() => [newDraftLine()])

  React.useEffect(() => {
    if (!canCreate) return
    void (async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const [clist, rms, plist] = await Promise.all([
          getJson<ContractorLite[]>("/contractors/lookup?limit=200&status=active").catch(() => []),
          getJson<RateMasterLite[]>("/rate-master?active=true").catch(() => []),
          canListOrgUnitsForAssignments()
            ? getJson<OrgUnitLite[]>("/admin/org-units?type=PLANT").catch(() => [])
            : Promise.resolve([]),
        ])
        setContractors(clist)
        setRateMasters(Array.isArray(rms) ? rms : [])
        setPlants(plist)
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load dropdowns")
        setContractors([])
        setRateMasters([])
        setPlants([])
      } finally {
        setLoading(false)
      }
    })()
  }, [canCreate])

  function validatePayload() {
    if (!org_unit_id) return { error: "Plant is required." as const }
    if (!title.trim()) return { error: "Title is required." as const }
    const contractorsPayload = draftLinesToContractors(lines)
    const itemCount = contractorsPayload.reduce((n, c) => n + c.items.length, 0)
    if (itemCount === 0) return { error: "Add at least one line with contractor and item/job." as const }
    return {
      contractorsPayload,
      body: {
        org_unit_id: Number(org_unit_id),
        title: title.trim(),
        description: reference.trim() || null,
        work_date: workDate,
        contractors: contractorsPayload,
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
      await postJson(`/work-orders/${wo.id}/submit`, {})
      toast.success("Submitted for approval")
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium">Create work order</h2>
          <p className="text-sm text-muted-foreground">Execution sheet • rates resolve negotiated → master (preview shows master).</p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/dashboard/work-orders">Back</Link>
        </Button>
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
        rateMasters={rateMasters}
        lines={lines}
        onLinesChange={setLines}
      />

      <WorkOrderExecutionFooter
        busy={busy}
        showSubmit
        onCancel={() => navigate("/dashboard/work-orders")}
        onSave={() => void saveDraft()}
        onSubmitApproval={() => void saveAndSubmit()}
      />
    </div>
  )
}

export default WorkOrderCreatePage
