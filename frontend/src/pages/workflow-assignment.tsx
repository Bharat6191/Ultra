import * as React from "react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApiError, deleteJson, getJson, patchJson, postJson } from "@/lib/api"

type PermissionActionOption = {
  code: string
  feature_key: string
  feature_name: string
}

type RoleListItem = { id: number; name: string }

type StepRow = {
  id: number
  workflow_id: number
  step_order: number
  approver_role_id: number
  required_approvals: number
}

type WorkflowDetail = {
  id: number
  name: string
  entity_type: string
  is_active: boolean
  created_by: number | null
  created_at: string
  steps: StepRow[]
}

type MappingRow = {
  id: number
  action_code: string
  workflow_id: number
  workflow_name: string | null
  is_active: boolean
  created_at: string
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function roleName(roles: RoleListItem[], roleId: number): string {
  const r = roles.find((x) => x.id === roleId)
  return r?.name ?? `Role #${roleId}`
}

export function WorkflowAssignmentPage() {
  const [tab, setTab] = React.useState("design")
  const [actions, setActions] = React.useState<PermissionActionOption[] | null>(null)
  const [workflows, setWorkflows] = React.useState<WorkflowDetail[] | null>(null)
  const [roles, setRoles] = React.useState<RoleListItem[] | null>(null)
  const [mappings, setMappings] = React.useState<MappingRow[] | null>(null)

  const [actionCode, setActionCode] = React.useState("")
  const [workflowId, setWorkflowId] = React.useState("")
  const [builderWorkflowId, setBuilderWorkflowId] = React.useState("")
  const [manageWorkflowId, setManageWorkflowId] = React.useState("")
  const [newWorkflowName, setNewWorkflowName] = React.useState("User creation approval")
  const [newEntityType, setNewEntityType] = React.useState("user_creation")
  const [newRoleId, setNewRoleId] = React.useState("")
  const [newRequired, setNewRequired] = React.useState("1")
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [creatingWf, setCreatingWf] = React.useState(false)
  const [addingStep, setAddingStep] = React.useState(false)
  const [activating, setActivating] = React.useState(false)
  const [removingStepId, setRemovingStepId] = React.useState<number | null>(null)
  const [deactivatingWorkflowId, setDeactivatingWorkflowId] = React.useState<number | null>(null)
  const [unassigningMappingId, setUnassigningMappingId] = React.useState<number | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [a, w, m, r] = await Promise.all([
        getJson<PermissionActionOption[]>("/admin/workflow-mappings/action-codes"),
        getJson<WorkflowDetail[]>("/admin/approval-workflows"),
        getJson<MappingRow[]>("/admin/workflow-mappings"),
        getJson<RoleListItem[]>("/admin/roles?skip=0&limit=200"),
      ])
      setActions(a)
      setWorkflows(w)
      setMappings(m)
      setRoles(r)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Failed to load workflow assignment data."
      toast.error(msg)
      setActions([])
      setWorkflows([])
      setMappings([])
      setRoles([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const activeWorkflows = React.useMemo(
    () => (workflows ?? []).filter((w) => w.is_active),
    [workflows],
  )

  const selectedBuilderWf = React.useMemo(() => {
    const id = Number(builderWorkflowId)
    if (!Number.isFinite(id) || id < 1) return null
    return (workflows ?? []).find((w) => w.id === id) ?? null
  }, [workflows, builderWorkflowId])

  const nextStepOrder = React.useMemo(() => {
    const steps = selectedBuilderWf?.steps ?? []
    if (steps.length === 0) return 1
    return Math.max(...steps.map((s) => s.step_order)) + 1
  }, [selectedBuilderWf])

  const selectedManageWf = React.useMemo(() => {
    const id = Number(manageWorkflowId)
    if (!Number.isFinite(id) || id < 1) return null
    return (workflows ?? []).find((w) => w.id === id) ?? null
  }, [workflows, manageWorkflowId])

  async function onCreateWorkflow() {
    const name = newWorkflowName.trim()
    const et = newEntityType.trim()
    if (!name) {
      toast.error("Enter a workflow name.")
      return
    }
    if (!et) {
      toast.error("Enter an entity type (use user_creation for the user-approval engine).")
      return
    }
    setCreatingWf(true)
    try {
      const created = await postJson<WorkflowDetail>("/admin/approval-workflows", {
        name,
        entity_type: et,
        is_active: false,
      })
      toast.success("Draft workflow created. Add approval levels, then Activate.")
      setBuilderWorkflowId(String(created.id))
      await load()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not create workflow."
      toast.error(msg)
    } finally {
      setCreatingWf(false)
    }
  }

  async function onAddStep() {
    const wid = Number(builderWorkflowId)
    const rid = Number(newRoleId)
    const req = Number(newRequired)
    if (!Number.isFinite(wid) || wid < 1) {
      toast.error("Select a workflow to edit.")
      return
    }
    if (!Number.isFinite(rid) || rid < 1) {
      toast.error("Select an approver role.")
      return
    }
    if (!Number.isFinite(req) || req < 1) {
      toast.error("Required approvals must be at least 1.")
      return
    }
    setAddingStep(true)
    try {
      await postJson<{ id: number }>(`/admin/approval-workflows/${wid}/steps`, {
        step_order: nextStepOrder,
        approver_role_id: rid,
        required_approvals: req,
      })
      toast.success(`Level ${nextStepOrder} added.`)
      setNewRoleId("")
      setNewRequired("1")
      await load()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not add step."
      toast.error(msg)
    } finally {
      setAddingStep(false)
    }
  }

  async function onActivateWorkflow() {
    const wid = Number(builderWorkflowId)
    if (!Number.isFinite(wid) || wid < 1) {
      toast.error("Select a workflow to activate.")
      return
    }
    const wf = (workflows ?? []).find((w) => w.id === wid)
    if (!wf?.steps?.length) {
      toast.error("Add at least one approval level before activating.")
      return
    }
    setActivating(true)
    try {
      await patchJson<WorkflowDetail>(`/admin/approval-workflows/${wid}/activate`, {})
      toast.success("Workflow activated.")
      await load()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not activate workflow."
      toast.error(msg)
    } finally {
      setActivating(false)
    }
  }

  async function onAssign() {
    const wid = Number(workflowId)
    if (!actionCode.trim()) {
      toast.error("Select an action.")
      return
    }
    if (!Number.isFinite(wid) || wid < 1) {
      toast.error("Select a workflow.")
      return
    }
    setSaving(true)
    try {
      await postJson<MappingRow>("/admin/workflow-mappings", {
        action_code: actionCode.trim(),
        workflow_id: wid,
      })
      toast.success("Workflow assigned.")
      setWorkflowId("")
      await load()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not save mapping."
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  async function onRemoveStep(step: StepRow) {
    const wid = Number(manageWorkflowId)
    if (!Number.isFinite(wid) || wid < 1) {
      toast.error("Select a workflow to manage.")
      return
    }
    if (!window.confirm(`Remove level ${step.step_order} from this workflow?`)) return
    setRemovingStepId(step.id)
    try {
      await deleteJson<WorkflowDetail>(`/admin/approval-workflows/${wid}/steps/${step.id}`)
      toast.success(`Level ${step.step_order} removed.`)
      await load()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not remove level."
      toast.error(msg)
    } finally {
      setRemovingStepId(null)
    }
  }

  async function onDeactivateWorkflow(workflow: WorkflowDetail) {
    if (!window.confirm(`Deactivate "${workflow.name}"? This also unassigns any active action mappings using it.`)) {
      return
    }
    setDeactivatingWorkflowId(workflow.id)
    try {
      await patchJson<WorkflowDetail>(`/admin/approval-workflows/${workflow.id}/deactivate`, {})
      toast.success("Workflow deactivated.")
      await load()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not deactivate workflow."
      toast.error(msg)
    } finally {
      setDeactivatingWorkflowId(null)
    }
  }

  async function onUnassignMapping(mapping: MappingRow) {
    if (!window.confirm(`Turn off approval for action "${mapping.action_code}"?`)) return
    setUnassigningMappingId(mapping.id)
    try {
      await patchJson<MappingRow>(`/admin/workflow-mappings/${mapping.id}/deactivate`, {})
      toast.success("Workflow unassigned from action.")
      await load()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not unassign workflow."
      toast.error(msg)
    } finally {
      setUnassigningMappingId(null)
    }
  }

  return (
    <div className="w-full space-y-6">
      {activeWorkflows.length === 0 ? (
        <Alert>
          <AlertTitle>No active approval workflow</AlertTitle>
          <AlertDescription>
            Map actions only to <strong>active</strong> workflows. Create a <strong>draft</strong> below, add one or
            more <strong>approval levels</strong> (each level = which role approves and how many approvals are required
            at that level), then click <strong>Activate</strong>.
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 p-1 sm:w-auto">
          <TabsTrigger value="design">Design Workflow</TabsTrigger>
          <TabsTrigger value="manage">Manage Workflow</TabsTrigger>
        </TabsList>

        <TabsContent value="design" className="mt-4 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Design approval workflow</CardTitle>
              <CardDescription>
                Each <strong>level</strong> runs in order. For a level, every user who has the selected <strong>approver
                role</strong> gets a task; <strong>Required approvals</strong> is how many approvals must complete that
                level before the next level starts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <div className="text-sm font-medium">1. Create a draft</div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="wf-name" showRequired>
                      Workflow name
                    </Label>
                    <Input
                      id="wf-name"
                      value={newWorkflowName}
                      onChange={(e) => setNewWorkflowName(e.target.value)}
                      disabled={loading || creatingWf}
                      placeholder="e.g. User creation — 2 levels"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="wf-entity" showRequired>
                      Entity type
                    </Label>
                    <Input
                      id="wf-entity"
                      value={newEntityType}
                      onChange={(e) => setNewEntityType(e.target.value)}
                      disabled={loading || creatingWf}
                      placeholder="user_creation"
                    />
                    <p className="text-xs text-muted-foreground">
                      Use <code className="rounded bg-muted px-1">user_creation</code> for the user signup approval path
                      (legacy finalizer).
                    </p>
                  </div>
                </div>
                <Button type="button" variant="secondary" onClick={() => void onCreateWorkflow()} disabled={loading || creatingWf}>
                  {creatingWf ? "Creating…" : "Create draft workflow"}
                </Button>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="text-sm font-medium">2. Add approval levels</div>
                <div className="space-y-2">
                  <Label htmlFor="builder-wf" showRequired>
                    Workflow to edit
                  </Label>
                  <select
                    id="builder-wf"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm"
                    value={builderWorkflowId}
                    onChange={(e) => setBuilderWorkflowId(e.target.value)}
                    disabled={loading}
                  >
                    <option value="">Select a draft or inactive workflow…</option>
                    {(workflows ?? []).map((w) => (
                      <option key={w.id} value={String(w.id)}>
                        {w.name} · {w.entity_type} · {w.is_active ? "active" : "inactive"} · {w.steps?.length ?? 0} level(s)
                      </option>
                    ))}
                  </select>
                </div>

                {selectedBuilderWf ? (
                  <div className="space-y-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Level</TableHead>
                          <TableHead>Approver role</TableHead>
                          <TableHead>Required approvals</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(selectedBuilderWf.steps ?? []).length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="text-muted-foreground text-sm">
                              No levels yet. Add the first level below.
                            </TableCell>
                          </TableRow>
                        ) : (
                          [...(selectedBuilderWf.steps ?? [])]
                            .sort((a, b) => a.step_order - b.step_order)
                            .map((s) => (
                              <TableRow key={s.id}>
                                <TableCell className="font-medium">{s.step_order}</TableCell>
                                <TableCell>{roleName(roles ?? [], s.approver_role_id)}</TableCell>
                                <TableCell>{s.required_approvals}</TableCell>
                              </TableRow>
                            ))
                        )}
                      </TableBody>
                    </Table>

                    <div className="rounded-md border bg-muted/30 p-4 space-y-3">
                      <div className="text-sm font-medium">Add next level ({nextStepOrder})</div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="step-role" showRequired>
                            Approver role
                          </Label>
                          <select
                            id="step-role"
                            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm"
                            value={newRoleId}
                            onChange={(e) => setNewRoleId(e.target.value)}
                            disabled={loading}
                          >
                            <option value="">Select role…</option>
                            {(roles ?? []).map((r) => (
                              <option key={r.id} value={String(r.id)}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="step-req" showRequired>
                            Required approvals at this level
                          </Label>
                          <Input
                            id="step-req"
                            type="number"
                            min={1}
                            value={newRequired}
                            onChange={(e) => setNewRequired(e.target.value)}
                            disabled={loading}
                          />
                          <p className="text-xs text-muted-foreground">
                            Use 2+ when multiple approvers in that role must all approve (or quorum-style counts).
                          </p>
                        </div>
                      </div>
                      <Button type="button" onClick={() => void onAddStep()} disabled={loading || addingStep}>
                        {addingStep ? "Adding…" : `Add level ${nextStepOrder}`}
                      </Button>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="default"
                        onClick={() => void onActivateWorkflow()}
                        disabled={loading || activating || selectedBuilderWf.is_active}
                      >
                        {activating ? "Activating…" : selectedBuilderWf.is_active ? "Already active" : "Activate workflow"}
                      </Button>
                      {selectedBuilderWf.is_active ? (
                        <Badge variant="secondary">Active</Badge>
                      ) : (
                        <Badge variant="outline">Inactive draft</Badge>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Select a workflow to view levels and add more.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Assign workflow to an action</CardTitle>
              <CardDescription>
                Only <strong>active</strong> workflows appear here. Use the section above to build and activate one first.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="action-select" showRequired>
                    Action (permission code)
                  </Label>
                  <select
                    id="action-select"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm"
                    value={actionCode}
                    onChange={(e) => setActionCode(e.target.value)}
                    disabled={loading}
                  >
                    <option value="">Select…</option>
                    {(actions ?? []).map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code}
                        {a.feature_name ? ` — ${a.feature_name}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workflow-select" showRequired>
                    Workflow (active only)
                  </Label>
                  <select
                    id="workflow-select"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm"
                    value={workflowId}
                    onChange={(e) => setWorkflowId(e.target.value)}
                    disabled={loading}
                  >
                    <option value="">
                      {activeWorkflows.length ? "Select…" : "No active workflows — create one above"}
                    </option>
                    {activeWorkflows.map((w) => (
                      <option key={w.id} value={String(w.id)}>
                        {w.name} ({w.entity_type}) — {w.steps?.length ?? 0} level(s)
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Button
                type="button"
                onClick={() => void onAssign()}
                disabled={loading || saving || activeWorkflows.length === 0}
              >
                {saving ? "Saving…" : "Assign workflow"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manage" className="mt-4 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Manage workflow</CardTitle>
              <CardDescription>
                Remove unused approval levels, deactivate a workflow, or turn approval off for an action from this tab.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="manage-wf" showRequired>
                  Workflow to manage
                </Label>
                <select
                  id="manage-wf"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm"
                  value={manageWorkflowId}
                  onChange={(e) => setManageWorkflowId(e.target.value)}
                  disabled={loading}
                >
                  <option value="">Select workflow…</option>
                  {(workflows ?? []).map((w) => (
                    <option key={w.id} value={String(w.id)}>
                      {w.name} · {w.entity_type} · {w.is_active ? "active" : "inactive"} · {w.steps?.length ?? 0} level(s)
                    </option>
                  ))}
                </select>
              </div>

              {selectedManageWf ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    {selectedManageWf.is_active ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}
                    <Badge variant="outline">{selectedManageWf.entity_type}</Badge>
                    {selectedManageWf.is_active ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void onDeactivateWorkflow(selectedManageWf)}
                        disabled={deactivatingWorkflowId === selectedManageWf.id}
                      >
                        {deactivatingWorkflowId === selectedManageWf.id ? "Deactivating…" : "Deactivate Workflow"}
                      </Button>
                    ) : null}
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Level</TableHead>
                        <TableHead>Approver role</TableHead>
                        <TableHead>Required approvals</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(selectedManageWf.steps ?? []).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-muted-foreground text-sm">
                            No approval levels configured.
                          </TableCell>
                        </TableRow>
                      ) : (
                        [...(selectedManageWf.steps ?? [])]
                          .sort((a, b) => a.step_order - b.step_order)
                          .map((s) => (
                            <TableRow key={s.id}>
                              <TableCell className="font-medium">{s.step_order}</TableCell>
                              <TableCell>{roleName(roles ?? [], s.approver_role_id)}</TableCell>
                              <TableCell>{s.required_approvals}</TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void onRemoveStep(s)}
                                  disabled={selectedManageWf.is_active || removingStepId === s.id}
                                >
                                  {removingStepId === s.id ? "Removing…" : "Remove Level"}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                      )}
                    </TableBody>
                  </Table>

                  <p className="text-xs text-muted-foreground">
                    Levels can be removed only from inactive workflows that have never been used in an approval request.
                    To stop approvals completely, deactivate the workflow or unassign the action below.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Select a workflow to remove levels or deactivate it.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Current mappings</CardTitle>
              <CardDescription>
                Unassigning an active mapping turns approval off for that action. Historical inactive rows remain for audit.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Workflow</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(mappings ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">
                        {loading ? "Loading…" : "No mappings yet."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    (mappings ?? []).map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono text-xs">{m.action_code}</TableCell>
                        <TableCell>{m.workflow_name ?? `Workflow #${m.workflow_id}`}</TableCell>
                        <TableCell>{m.is_active ? "Yes" : "No"}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{formatDateTime(m.created_at)}</TableCell>
                        <TableCell className="text-right">
                          {m.is_active ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void onUnassignMapping(m)}
                              disabled={unassigningMappingId === m.id}
                            >
                              {unassigningMappingId === m.id ? "Unassigning…" : "Unassign"}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Inactive</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
