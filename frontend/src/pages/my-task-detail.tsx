import * as React from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { ApprovalWorkflowTimeline, type TaskApprovalStepLine } from "@/components/approval-workflow-timeline"
import { formatMoney, formatPercent, rateStatusLabel } from "@/components/contractors/rateStatus"
import {
  WorkOrderApprovalReview,
  WorkOrderRateOverrideApprovalReview,
} from "@/components/tasks/work-order-task-review"
import { InvoiceExceptionApprovalReview } from "@/components/tasks/invoice-task-review"
import { ApiError, getJson, postJson } from "@/lib/api"
import {
  canReadNegotiatedRates,
  hasPermission,
  isSuperuser,
  persistAuthFromMe,
} from "@/lib/permissions"
import { cn } from "@/lib/utils"

type TaskComment = {
  id: number
  user_id: number
  user_display_name?: string | null
  comment: string
  created_at: string | null
}

type TaskAuditLog = {
  id: number
  action: string
  actor_user_id: number | null
  actor_display_name?: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  created_at: string | null
}

type TaskApprovalContext = {
  request_id: number
  entity_type: string
  entity_id: number
  status: string
  current_step: number
  created_by: number | null
  created_by_display_name?: string | null
  payload: Record<string, unknown>
  step_order: number | null
  approver_role_id: number | null
  approver_role_name: string | null
  required_approvals: number | null
  workflow_steps?: TaskApprovalStepLine[]
}

type UnifiedTaskDetail = {
  id: number
  task_type: "approval" | "manual" | "rework"
  title: string | null
  description: string | null
  status: string
  due_date: string | null
  created_by: number | null
  assigned_to_user_id: number | null

  entity_type: string | null
  entity_id: number | null
  form_schema: Record<string, unknown> | null
  form_data: Record<string, unknown> | null

  request_id: number | null
  step_id: number | null

  approval?: TaskApprovalContext | null

  comments: TaskComment[]
  audit_logs: TaskAuditLog[]
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

type FormField =
  | { key: string; type: "text" | "textarea" | "number" | "date"; label?: string; required?: boolean }
  | { key: string; type: "select"; label?: string; required?: boolean; options?: string[] }
  | { key: string; type: "checkbox"; label?: string; required?: boolean }

function readFormSchema(schema: Record<string, unknown> | null): { sections: { title?: string; fields: FormField[] }[] } | null {
  if (!schema) return null
  const sections = (schema as any).sections
  if (!Array.isArray(sections)) return null
  return {
    sections: sections
      .map((s: any) => ({
        title: typeof s?.title === "string" ? s.title : undefined,
        fields: Array.isArray(s?.fields) ? (s.fields as any[]).filter((f) => f && typeof f.key === "string" && typeof f.type === "string") : [],
      }))
      .filter((s) => s.fields.length > 0),
  }
}

function formatPayloadValue(v: unknown): string {
  if (v === null || v === undefined) return "—"
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return "—"
  }
}

function taskStatusBadgeVariant(status: string): React.ComponentProps<typeof Badge>["variant"] {
  switch (status) {
    case "pending":
    case "pending_approval":
      return "warning"
    case "approved":
    case "completed":
      return "success"
    case "closed":
      return "secondary"
    case "rejected":
      return "destructive"
    case "open":
    case "in_progress":
    default:
      return "outline"
  }
}

function entityLabel(task: UnifiedTaskDetail): string {
  const a = task.approval
  const et = a?.entity_type ?? task.entity_type
  const eid = a?.entity_id ?? task.entity_id
  if (!et) return "—"
  // Pretty labels for the entity types we know about. Falls back to the raw key.
  const pretty: Record<string, string> = {
    contractor_creation: "Contractor approval",
    contractor_activation: "Contractor activation",
    contractor_update: "Contractor update",
    contractor_rate_approval: "Negotiated rate",
    work_order_approval: "Work order submission",
    work_order_rate_override: "Work order rate override",
    invoice_exception_approval: "Invoice exception",
    user_creation: "New user account",
  }
  return `${pretty[et] ?? et} #${eid ?? "—"}`
}

/**
 * Resolve a deep-link to the source record for a task so an approver can review
 * the actual entity (contractor profile, negotiated rate detail, …) without
 * leaving the inbox.  Returns null if we don't have enough context to link.
 */
function entityLink(task: UnifiedTaskDetail): { href: string; label: string } | null {
  const a = task.approval
  const et = a?.entity_type ?? task.entity_type
  const eid = a?.entity_id ?? task.entity_id
  if (!et || !eid) return null
  if (et === "contractor_rate_approval") {
    return {
      href: `/dashboard/negotiated-rates/${eid}`,
      label: "Open Rate",
    }
  }
  if (
    et === "contractor_creation" ||
    et === "contractor_activation" ||
    et === "contractor_update"
  ) {
    return { href: `/dashboard/contractors/${eid}`, label: "Open contractor" }
  }
  if (et === "work_order_approval") {
    return { href: `/dashboard/work-orders/${eid}`, label: "Open work order" }
  }
  if (et === "work_order_rate_override") {
    const pl = a?.payload as { work_order_id?: unknown }
    const wid = pl?.work_order_id != null ? Number(pl.work_order_id) : NaN
    if (Number.isFinite(wid) && wid > 0) {
      return { href: `/dashboard/work-orders/${wid}`, label: "Open work order" }
    }
  }
  if (et === "user_creation") {
    return { href: `/dashboard/users/${eid}`, label: "Open user" }
  }
  if (et === "invoice_exception_approval") {
    return { href: `/dashboard/invoices/${eid}`, label: "Open invoice" }
  }
  return null
}

/** Single deep-link to the related business record, only when the viewer can access that module. */
function openRecordAction(task: UnifiedTaskDetail): { href: string; label: string } | null {
  const base = entityLink(task)
  if (!base) return null
  const a = task.approval
  const et = a?.entity_type ?? task.entity_type
  if (!et) return null
  if (isSuperuser()) return base

  const woAccess =
    hasPermission("work_orders.view") ||
    hasPermission("work_orders.approve") ||
    hasPermission("work_orders.create")
  if (et === "work_order_approval" || et === "work_order_rate_override") return woAccess ? base : null

  if (et === "contractor_rate_approval") return canReadNegotiatedRates() ? base : null

  if (
    et === "contractor_creation" ||
    et === "contractor_activation" ||
    et === "contractor_update"
  ) {
    return hasPermission("contractor.view") ? base : null
  }

  if (et === "user_creation") {
    return hasPermission("users.view") || hasPermission("users.update") ? base : null
  }

  if (et === "invoice_exception_approval") {
    return hasPermission("invoices.view") ||
      hasPermission("invoices.validate") ||
      hasPermission("invoices.update") ||
      hasPermission("invoices.create")
      ? base
      : null
  }

  return null
}

function payloadPrimitive(payload: Record<string, unknown>, key: string): string | number | boolean | null {
  const value = payload[key]
  if (typeof value === "string") return value.trim() !== "" ? value : null
  if (typeof value === "number" || typeof value === "boolean") return value
  return null
}

function approvalPayloadEntries(payload: Record<string, unknown>, entityType: string): { key: string; label: string; value: string }[] {
  const p = payload ?? {}
  if (entityType === "user_creation") {
    const rows: { key: string; label: string; value: string }[] = []
    if (p.full_name != null && String(p.full_name).trim() !== "")
      rows.push({ key: "full_name", label: "Full name", value: String(p.full_name) })
    if (p.email != null && String(p.email).trim() !== "")
      rows.push({ key: "email", label: "Email", value: String(p.email) })
    if (p.phone != null && String(p.phone).trim() !== "")
      rows.push({ key: "phone", label: "Phone", value: String(p.phone) })
    const roleVal =
      p.role_name != null && String(p.role_name).trim() !== ""
        ? String(p.role_name)
        : p.role_id != null
          ? formatPayloadValue(p.role_id)
          : null
    if (roleVal && roleVal !== "—") rows.push({ key: "role", label: "Role", value: roleVal })
    const orgVal =
      p.org_unit_name != null && String(p.org_unit_name).trim() !== ""
        ? String(p.org_unit_name)
        : p.org_unit_id != null
          ? formatPayloadValue(p.org_unit_id)
          : null
    if (orgVal && orgVal !== "—") rows.push({ key: "org", label: "Plant / org unit", value: orgVal })
    return rows
  }
  return Object.keys(p)
    .filter((k) => p[k] != null && String(p[k]).trim() !== "")
    .sort((a, b) => a.localeCompare(b))
    .map((k) => ({ key: k, label: k.replace(/_/g, " "), value: formatPayloadValue(p[k]) }))
}

function ContractorRateApprovalReviewCard({ task }: { task: UnifiedTaskDetail }) {
  const approval = task.approval
  if (!approval || approval.entity_type !== "contractor_rate_approval") return null

  const payload = approval.payload ?? {}
  const taskStatusText = String(task.status ?? "—")
  const approvalStatusText = rateStatusLabel(approval.status)
  const showApprovalStatusBadge =
    approvalStatusText.trim().toLowerCase() !== taskStatusText.trim().toLowerCase()
  const submittedBy =
    approval.created_by_display_name ?? (approval.created_by != null ? `User #${approval.created_by}` : "—")
  const detailRows: Array<{ label: string; value: string }> = [
    { label: "Action code", value: String(payloadPrimitive(payload, "action_code") ?? "—") },
    { label: "Contractor ID", value: String(payloadPrimitive(payload, "contractor_id") ?? "—") },
    { label: "Part master ID", value: String(payloadPrimitive(payload, "part_master_id") ?? "—") },
    { label: "Rate record", value: `#${approval.entity_id}` },
    { label: "Effective from", value: String(payloadPrimitive(payload, "effective_from") ?? "—") },
    {
      label: "Effective to",
      value:
        payloadPrimitive(payload, "effective_to") != null
          ? String(payloadPrimitive(payload, "effective_to"))
          : "Open",
    },
  ]

  const originRows: Array<{ label: string; value: string }> = [
    { label: "Request #", value: `#${approval.request_id}` },
    { label: "Submitted by", value: submittedBy },
    { label: "Entity", value: entityLabel(task) },
    { label: "Task status", value: task.status ?? "—" },
  ]

  return (
    <Card className="min-w-0 overflow-hidden border-border/80 shadow-sm">
      <CardHeader className="space-y-3 border-b border-border/60 bg-gradient-to-br from-emerald-50/90 via-white to-white py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
              What you're approving
            </div>
            <CardTitle className="text-xl leading-tight text-zinc-950">
              {task.title?.trim() || "Negotiated rate approval"}
            </CardTitle>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={taskStatusBadgeVariant(task.status)}>{taskStatusText}</Badge>
            {showApprovalStatusBadge ? <Badge variant="outline">{approvalStatusText}</Badge> : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 pt-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Negotiated Rate</div>
            <div className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">
              {formatMoney(payloadPrimitive(payload, "negotiated_rate") as number | string | null)}
            </div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-white px-4 py-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-950">Savings</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">
              {formatMoney(payloadPrimitive(payload, "savings_amount") as number | string | null)}
            </div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-white px-4 py-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-950">Savings %</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950"> 
              {formatPercent(payloadPrimitive(payload, "savings_percentage") as number | string | null)}
            </div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-white px-4 py-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-950">Effective From</div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-zinc-950">
              {String(payloadPrimitive(payload, "effective_from") ?? "—")}
              {payloadPrimitive(payload, "effective_from") != null
                ? payloadPrimitive(payload, "effective_to") != null
                  ? ` → ${String(payloadPrimitive(payload, "effective_to"))}`
                  : " → Open"
                : ""}
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
          <div className="rounded-2xl border border-border/70 bg-white">
            <div className="border-b border-border/60 px-4 py-3">
              <div className="text-sm font-semibold text-zinc-950">Rate details</div>
              <div className="mt-1 text-xs text-muted-foreground">Core identifiers and effective dates for this negotiated rate.</div>
            </div>
            <dl className="grid gap-x-6 gap-y-0 px-4 py-2 sm:grid-cols-2">
              {detailRows.map((row) => (
                <div key={row.label} className="border-b border-border/50 py-3 last:border-b-0 sm:last:border-b-0">
                  <dt className="text-[11px] font-bold uppercase tracking-wide text-zinc-950">{row.label}</dt>
                  <dd className="mt-1 text-sm font-medium text-zinc-950">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-2xl border border-border/70 bg-muted/10">
            <div className="border-b border-border/60 px-4 py-3">
              <div className="text-sm font-semibold text-zinc-950">Request origin</div>
              <div className="mt-1 text-xs text-muted-foreground">Who submitted this request and how it is tracked.</div>
            </div>
            <dl className="space-y-0 px-4 py-2">
              {originRows.map((row) => (
                <div key={row.label} className="border-b border-border/50 py-3 last:border-b-0">
                  <dt className="text-[11px] font-bold uppercase tracking-wide text-zinc-950">{row.label}</dt>
                  <dd className="mt-1 text-sm font-medium text-zinc-950">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ApprovalSummaryCard({ task }: { task: UnifiedTaskDetail }) {
  const approval = task.approval
  if (!approval) return null

  const isRateApproval = approval.entity_type === "contractor_rate_approval"
  const approvalStatus =
    isRateApproval ? rateStatusLabel(approval.status) : (approval.status ?? "—")
  const workflowStep =
    approval.step_order != null
      ? `Step ${approval.step_order}`
      : approval.current_step != null
        ? `Step ${approval.current_step}`
        : "—"

  const metrics =
    isRateApproval
      ? [
          { label: "Workflow step", value: workflowStep, strong: true },
          {
            label: "Required approvals",
            value: approval.required_approvals != null ? String(approval.required_approvals) : "—",
          },
          { label: "Approval status", value: approvalStatus },
          { label: "Task status", value: task.status ?? "—" },
        ]
      : []

  const rows: Array<{ label: string; value: string }> = [
    { label: "Entity", value: entityLabel(task) },
    { label: "Request #", value: `#${approval.request_id}` },
    { label: "Approver role", value: approval.approver_role_name ?? "—" },
    {
      label: "Submitted by",
      value: approval.created_by_display_name ?? (approval.created_by != null ? `User #${approval.created_by}` : "—"),
    },
    { label: "Due date", value: task.due_date ? formatDateTime(task.due_date) : "—" },
  ]

  return (
    <Card className="min-w-0 overflow-hidden border-border/80 shadow-sm">
      <CardHeader className="space-y-1 border-b border-border/60 bg-muted/20 py-3">
        <CardTitle className="text-base">
          {isRateApproval ? "Approval context" : "Request summary"}
        </CardTitle>
        <CardDescription className="text-xs">
          {isRateApproval
            ? "Workflow status, role routing, and decision context."
            : "Workflow context for this approval request."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant={taskStatusBadgeVariant(task.status)}>{task.status}</Badge>
          <Badge variant="outline">{approvalStatus}</Badge>
        </div>

        {metrics.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-xl border border-border/70 bg-muted/15 px-3 py-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-950">{metric.label}</div>
                <div className={cn("mt-1 text-sm font-semibold text-foreground", metric.strong && "text-xl tracking-tight")}>
                  {metric.value}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <dl className="divide-y divide-border/60">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-1 gap-0.5 py-2 first:pt-0 sm:grid-cols-3 sm:gap-3">
              <dt className="text-[11px] font-bold uppercase tracking-wide text-zinc-950 sm:col-span-1">{row.label}</dt>
              <dd className="text-sm text-foreground sm:col-span-2">{row.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

export function MyTaskDetailPage() {
  const { taskId } = useParams()
  const navigate = useNavigate()

  const [task, setTask] = React.useState<UnifiedTaskDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [acting, setActing] = React.useState(false)
  const [actionComment, setActionComment] = React.useState("")
  const [decisionDialogOpen, setDecisionDialogOpen] = React.useState(false)
  const [decisionAction, setDecisionAction] = React.useState<"approve" | "reject" | null>(null)

  const [, forcePermRefresh] = React.useReducer((x: number) => x + 1, 0)
  const approvalActionCodes = React.useMemo(() => {
    switch (task?.approval?.entity_type) {
      case "contractor_rate_approval":
        return ["contractor_rates.approve", "approval.act"]
      case "work_order_approval":
      case "work_order_rate_override":
        return ["work_orders.approve", "approval.act"]
      case "invoice_exception_approval":
        return ["invoices.approve_exceptions", "approval.act"]
      default:
        return ["approval.act"]
    }
  }, [task?.approval?.entity_type])
  const canApprovalAct = isSuperuser() || approvalActionCodes.some((code) => hasPermission(code))
  const canTaskAct = hasPermission("task.act")
  const canTaskClose = hasPermission("task.close")

  const [viewerUserId, setViewerUserId] = React.useState<number | null>(null)

  const syncMe = React.useCallback(async () => {
    try {
      const me = await getJson<{ id: number; is_superuser?: boolean; permissions?: string[] }>("/me")
      setViewerUserId(typeof me.id === "number" && Number.isFinite(me.id) ? me.id : null)
      persistAuthFromMe(me)
      forcePermRefresh()
    } catch {
      // ignore; requests below will surface errors
    }
  }, [])

  const load = React.useCallback(
    async (id: number) => {
      setLoading(true)
      setError(null)
      setTask(null)
      try {
        const t = await getJson<UnifiedTaskDetail>(`/tasks/${id}`)
        setTask(t)
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "Could not load task details."
        setError(msg)
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  React.useEffect(() => {
    const id = Number(taskId)
    if (!Number.isFinite(id) || id <= 0) {
      navigate("..", { replace: true })
      return
    }
    void (async () => {
      await syncMe()
      await load(id)
    })()
  }, [taskId, navigate, load, syncMe])

  async function start() {
    if (!task) return
    setActing(true)
    try {
      await postJson(`/tasks/${task.id}/start`, {})
      toast.success("Started.")
      await load(task.id)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Start failed."
      toast.error(msg)
    } finally {
      setActing(false)
    }
  }

  async function complete() {
    if (!task) return
    setActing(true)
    try {
      await postJson(`/tasks/${task.id}/complete`, {})
      toast.success("Completed.")
      await load(task.id)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Complete failed."
      toast.error(msg)
    } finally {
      setActing(false)
    }
  }

  async function close() {
    if (!task) return
    setActing(true)
    try {
      await postJson(`/tasks/${task.id}/close`, {})
      toast.success("Closed.")
      await load(task.id)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Close failed."
      toast.error(msg)
    } finally {
      setActing(false)
    }
  }

  async function approveOrReject(action: "approve" | "reject") {
    if (!task || task.task_type !== "approval") return
    setActing(true)
    try {
      await postJson(`/approvals/tasks/${task.id}/action`, {
        action,
        comment: actionComment.trim() ? actionComment.trim() : null,
      })
      toast.success(action === "approve" ? "Approved." : "Rejected.")
      setDecisionDialogOpen(false)
      setDecisionAction(null)
      setActionComment("")
      await load(task.id)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Action failed."
      toast.error(msg)
    } finally {
      setActing(false)
    }
  }

  const isSubmitterRejectionView = Boolean(
    task &&
      task.task_type === "approval" &&
      task.status === "rejected" &&
      viewerUserId != null &&
      task.created_by != null &&
      Number(task.created_by) === Number(viewerUserId),
  )

  const isReworkRequiredView = Boolean(
    task &&
      task.task_type === "rework" &&
      (task.status === "open" || task.status === "pending") &&
      viewerUserId != null &&
      task.created_by != null &&
      Number(task.created_by) === Number(viewerUserId),
  )

  const userCreationEditPath =
    task?.approval?.entity_type === "user_creation" && task.approval.entity_id != null
      ? `/dashboard/users/${task.approval.entity_id}/edit`
      : null

  const isApprovalLike = Boolean(task && (task.task_type === "approval" || task.task_type === "rework") && task.approval)
  const showApprovalSummaryAside = Boolean(
    task?.approval &&
      task.approval.entity_type !== "contractor_rate_approval" &&
      task.approval.entity_type !== "work_order_approval" &&
      task.approval.entity_type !== "work_order_rate_override" &&
      task.approval.entity_type !== "invoice_exception_approval",
  )
  const approvalStepNeedsDecision = Boolean(
    task &&
      task.task_type === "approval" &&
      task.approval &&
      task.approval.status === "pending" &&
      (task.status === "pending" || task.status === "open" || task.status === "in_progress"),
  )

  function handleDecisionDialogOpenChange(open: boolean) {
    if (acting) return
    setDecisionDialogOpen(open)
    if (!open) {
      setDecisionAction(null)
      setActionComment("")
    }
  }

  function openDecisionDialog(action: "approve" | "reject") {
    if (!canApprovalAct || acting) return
    setDecisionAction(action)
    setDecisionDialogOpen(true)
  }

  function renderApprovalDecisionActions(extraClassName?: string, compact = false) {
    if (!task || task.task_type !== "approval" || !task.approval) return null
    return (
      <div className={cn("w-full min-w-0 space-y-2.5", extraClassName)}>
        <div className={cn("flex flex-wrap justify-between gap-2", compact ? "items-center" : "items-start")}>
          {!canApprovalAct ? (
            <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
              Needs <span className="font-mono">{approvalActionCodes.join(" or ")}</span> on your role.
            </p>
          ) : compact ? null : (
            <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
              Add a reason or note in the popup before you finish this decision.
            </p>
          )}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => openDecisionDialog("reject")}
              disabled={acting || !canApprovalAct}
            >
              Reject
            </Button>
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={() => openDecisionDialog("approve")}
              disabled={acting || !canApprovalAct}
            >
              Approve
            </Button>
          </div>
        </div>
      </div>
    )
  }

  async function resubmitForApproval() {
    if (!task?.approval) return
    setActing(true)
    try {
      const res = await postJson<{ new_task_id: number; request_id: number }>(
        `/approvals/requests/${task.approval.request_id}/resubmit`,
        {},
      )
      toast.success("Sent back to approvers. Step 1 is open again.")
      const next = Number(res.new_task_id)
      if (Number.isFinite(next) && next > 0) {
        navigate(`/dashboard/tasks/${next}`, { replace: true })
      } else {
        await load(task.id)
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Resubmit failed."
      toast.error(msg)
    } finally {
      setActing(false)
    }
  }

  const recordOpen = task ? openRecordAction(task) : null
  const hideTopReviewSubtitle = Boolean(task?.approval?.entity_type === "contractor_rate_approval")

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-lg font-semibold tracking-tight">
            {task && !loading && isApprovalLike ? "Review Request" : "Task details"}
          </h2>
          {!hideTopReviewSubtitle ? (
            <p className="text-sm text-muted-foreground">
              {(() => {
                if (!task) return "Task"
                if (isApprovalLike && task.approval) {
                  const p = task.approval.payload as {
                    full_name?: unknown
                    title?: unknown
                    work_order_number?: unknown
                    work_order_title?: unknown
                    invoice_number?: unknown
                  }
                  if (task.approval.entity_type === "user_creation" && typeof p.full_name === "string" && p.full_name.trim() !== "")
                    return p.full_name
                  if (task.approval.entity_type === "user_creation") return "New user account"
                  if (task.approval.entity_type === "work_order_approval") {
                    if (typeof p.title === "string" && p.title.trim() !== "") return p.title
                    if (typeof p.work_order_number === "string" && p.work_order_number.trim() !== "") return p.work_order_number
                    return "Work order submission"
                  }
                  if (task.approval.entity_type === "work_order_rate_override") {
                    if (typeof p.work_order_title === "string" && p.work_order_title.trim() !== "") return p.work_order_title
                    return "Rate override request"
                  }
                  if (task.approval.entity_type === "invoice_exception_approval") {
                    if (typeof p.invoice_number === "string" && p.invoice_number.trim() !== "") return p.invoice_number
                    return "Invoice exception review"
                  }
                  return task.approval.entity_type.replace(/_/g, " ")
                }
                return task.title ?? "Task"
              })()}
            </p>
          ) : null}
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          {approvalStepNeedsDecision && task?.approval ? renderApprovalDecisionActions("w-auto space-y-0", true) : null}
          {!loading && recordOpen ? (
            <Button asChild size="sm" variant="default">
              <Link to={recordOpen.href}>{recordOpen.label}</Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link to="..">Back</Link>
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {isReworkRequiredView && task?.approval && !loading ? (
        <Alert className="border-amber-200/80 bg-amber-50/80 dark:border-amber-900/50 dark:bg-amber-950/30">
          <AlertTitle className="text-amber-950 dark:text-amber-50">Rework required</AlertTitle>
          <AlertDescription className="space-y-3 text-amber-950/90 dark:text-amber-100/90">
            <p>Update the record, then resubmit. This restarts the workflow from step 1 with fresh approver tasks.</p>
            {task.description ? (
              <div className="rounded-md border border-amber-200/80 bg-white/60 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/20">
                <div className="font-medium">Rejection reason</div>
                <div className="mt-1 whitespace-pre-wrap text-amber-950/90 dark:text-amber-100/90">{task.description}</div>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {userCreationEditPath ? (
                <Button asChild type="button" size="sm" variant="outline">
                  <Link to={userCreationEditPath}>Edit User Details</Link>
                </Button>
              ) : null}
              <Button type="button" size="sm" variant="default" onClick={() => void resubmitForApproval()} disabled={acting}>
                {acting ? "Submitting…" : "Resubmit for approval"}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {isSubmitterRejectionView && task?.approval && !loading ? (
        <Alert className="border-amber-200/80 bg-amber-50/80 dark:border-amber-900/50 dark:bg-amber-950/30">
          <AlertTitle className="text-amber-950 dark:text-amber-50">This request was rejected</AlertTitle>
          <AlertDescription className="space-y-3 text-amber-950/90 dark:text-amber-100/90">
            <p>
              Update the record if needed, then send it through the same approval path again. Approvers in step
              1 will get a new task; the same approval request continues with the updated details.
            </p>
            <div className="flex flex-wrap gap-2">
              {userCreationEditPath ? (
                <Button asChild type="button" size="sm" variant="outline">
                  <Link to={userCreationEditPath}>Edit User Details</Link>
                </Button>
              ) : null}
              <Button type="button" size="sm" variant="default" onClick={() => void resubmitForApproval()} disabled={acting}>
                {acting ? "Submitting…" : "Resubmit for approval"}
              </Button>
            </div>
            <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
              Tip: use <strong>Edit</strong> first if any field must change, then <strong>Resubmit</strong> to refresh
              the request payload and reopen step 1.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <Dialog open={decisionDialogOpen} onOpenChange={handleDecisionDialogOpenChange}>
        <DialogContent className="sm:max-w-lg" showCloseButton={!acting}>
          <DialogHeader>
            <DialogTitle>{decisionAction === "reject" ? "Reject this step" : "Approve this step"}</DialogTitle>
            <DialogDescription>
              {decisionAction === "reject"
                ? "Add the rejection reason or any note you want stored with this action."
                : "Add an approval note if you want it saved with this action."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="approval-comment-dialog">
              {decisionAction === "reject" ? "Reason or note" : "Note"}
            </Label>
            <Textarea
              id="approval-comment-dialog"
              value={actionComment}
              onChange={(e) => setActionComment(e.target.value)}
              placeholder={
                decisionAction === "reject"
                  ? "Add rejection reason..."
                  : "Optional note for the approver record..."
              }
              className="min-h-[140px] resize-y"
              disabled={acting}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleDecisionDialogOpenChange(false)}
              disabled={acting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={decisionAction === "reject" ? "destructive" : "default"}
              onClick={() => {
                if (decisionAction) {
                  void approveOrReject(decisionAction)
                }
              }}
              disabled={acting || !decisionAction}
            >
              {acting ? "Saving…" : decisionAction === "reject" ? "Reject" : "Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !task ? (
        <Alert>
          <AlertTitle>Task not found</AlertTitle>
          <AlertDescription>This task may have been reassigned or completed.</AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-4">
          {isApprovalLike && task.approval ? (
            <>
              <div
                className={cn(
                  "grid grid-cols-1 gap-4 lg:items-start",
                  showApprovalSummaryAside ? "lg:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]" : "",
                )}
              >
                {task.approval.entity_type === "contractor_rate_approval" ? (
                  <ContractorRateApprovalReviewCard task={task} />
                ) : (
                  <Card className="min-w-0 overflow-hidden border-border/80 shadow-sm">
                    <CardHeader className="space-y-1 border-b border-border/60 bg-muted/20 py-3">
                      <CardTitle className="text-base">What you&apos;re approving</CardTitle>
                      {task.approval.entity_type === "work_order_approval" ? (
                        <CardDescription className="text-xs">
                          Full work order detail — same execution sheet as the work order screen (live record when available).
                        </CardDescription>
                      ) : task.approval.entity_type === "work_order_rate_override" ? (
                        <CardDescription className="text-xs">
                          Governed rate vs requested override for this line item.
                        </CardDescription>
                      ) : task.approval.entity_type === "invoice_exception_approval" ? (
                        <CardDescription className="text-xs">
                          Live invoice data with the exact blocker reasons, work order references, and invoice preview.
                        </CardDescription>
                      ) : null}
                    </CardHeader>
                    <CardContent className="pt-3">
                      {task.approval.entity_type === "work_order_approval" &&
                      task.approval.entity_id != null &&
                      Number.isFinite(Number(task.approval.entity_id)) ? (
                        <WorkOrderApprovalReview
                          workOrderId={Number(task.approval.entity_id)}
                          fallbackPayload={task.approval.payload ?? {}}
                        />
                      ) : task.approval.entity_type === "work_order_rate_override" ? (
                        <WorkOrderRateOverrideApprovalReview payload={task.approval.payload ?? {}} />
                      ) : task.approval.entity_type === "invoice_exception_approval" &&
                        task.approval.entity_id != null &&
                        Number.isFinite(Number(task.approval.entity_id)) ? (
                        <InvoiceExceptionApprovalReview
                          invoiceId={Number(task.approval.entity_id)}
                          fallbackPayload={task.approval.payload ?? {}}
                        />
                      ) : (
                        (() => {
                          const rows = approvalPayloadEntries(task.approval!.payload, task.approval!.entity_type)
                          if (rows.length === 0) return <p className="text-sm text-muted-foreground">No request details available.</p>
                          return (
                            <dl className="divide-y divide-border/60">
                              {rows.map((row) => (
                                <div key={row.key} className="grid grid-cols-1 gap-0.5 py-2 first:pt-0 sm:grid-cols-3 sm:gap-3">
                                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:col-span-1">{row.label}</dt>
                                  <dd className="text-sm text-foreground sm:col-span-2">{row.value}</dd>
                                </div>
                              ))}
                            </dl>
                          )
                        })()
                      )}
                      <p className="mt-6 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                        Submitted by{" "}
                        {task.approval!.created_by_display_name ??
                          (task.approval!.created_by != null ? `User #${task.approval!.created_by}` : "—")}{" "}
                        · Request #{task.approval!.request_id}
                      </p>
                    </CardContent>
                  </Card>
                )}
                {showApprovalSummaryAside ? <ApprovalSummaryCard task={task} /> : null}
              </div>
              {task.approval.workflow_steps && task.approval.workflow_steps.length > 0 ? (
                <ApprovalWorkflowTimeline
                  steps={task.approval.workflow_steps}
                  viewerUserId={viewerUserId}
                  formatWhen={formatDateTime}
                />
              ) : null}
            </>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start">
              <Card>
                <CardHeader className="space-y-1 pb-2">
                  <CardTitle className="text-base">Task status</CardTitle>
                  <CardDescription className="text-xs">Status and actions.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={taskStatusBadgeVariant(task.status)}>
                        {task.status}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {task.task_type === "manual" ? (
                        <>
                          <Button type="button" size="sm" variant="secondary" onClick={() => void start()} disabled={acting || !canTaskAct}>
                            Start
                          </Button>
                          <Button type="button" size="sm" variant="default" onClick={() => void complete()} disabled={acting || !canTaskAct}>
                            Complete
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => void close()} disabled={acting || !canTaskClose}>
                            Close
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-0.5">
                    <div>
                      <span className="text-muted-foreground">Due: </span>
                      {task.due_date ? formatDateTime(task.due_date) : "—"}
                    </div>
                    {entityLabel(task) !== "—" ? (
                      <div>
                        <span className="text-muted-foreground">Entity: </span>
                        {entityLabel(task)}
                      </div>
                    ) : null}
                    {task.request_id ? (
                      <div>
                        <span className="text-muted-foreground">Approval request: </span>#{task.request_id}
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="space-y-1 pb-2">
                  <CardTitle className="text-base">Task</CardTitle>
                  <CardDescription className="text-xs">Summary</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1.5 text-sm">
                  <div>
                    <span className="text-muted-foreground">Entity: </span>
                    {entityLabel(task)}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status: </span>
                    {task.status ?? "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Created by: </span>
                    {task.created_by != null ? `User #${task.created_by}` : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">Due: {task.due_date ? formatDateTime(task.due_date) : "—"}</div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* {task.task_type === "approval" && task.approval ? (
            <Card>
              <CardHeader className="space-y-1 pb-2 sm:flex sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="space-y-0.5">
                  <CardTitle className="text-base">Your decision</CardTitle>
                  <CardDescription className="text-sm">
                    {task.approval.step_order != null
                      ? `Step ${task.approval.step_order}${
                          task.approval.approver_role_name ? ` · ${task.approval.approver_role_name}` : ""
                        }${task.approval.required_approvals != null ? ` · ${task.approval.required_approvals} approval(s) required` : ""}`
                      : "Approval step"}
                  </CardDescription>
                </div>
                <Badge variant={taskStatusBadgeVariant(task.status)} className="w-fit shrink-0">
                  {task.status}
                </Badge>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-end sm:gap-6">
                  <div className="flex w-full min-w-0 max-w-2xl flex-col gap-2 sm:ml-auto sm:items-stretch">
                    {approvalStepNeedsDecision ? (
                      <>
                        {renderApprovalDecisionEditor("sm:ml-auto sm:items-stretch")}
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground sm:text-right">No further actions on this step.</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null} */}
          {(() => {
            const parsed = readFormSchema(task.form_schema)
            if (!parsed || parsed.sections.length === 0) return null
            const data = task.form_data ?? {}
            return (
              <Card>
                <CardHeader className="space-y-1 pb-2">
                  <CardTitle className="text-base">Form</CardTitle>
                  <CardDescription className="text-xs">{isApprovalLike ? "Read-only snapshot." : "Task form."}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {parsed.sections.map((sec, idx) => (
                    <div key={idx} className="space-y-2">
                      {sec.title ? <div className="text-sm font-medium">{sec.title}</div> : null}
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        {sec.fields.map((f) => (
                          <div key={f.key} className={cn("space-y-0.5", f.type === "textarea" && "sm:col-span-2")}>
                            <div className="text-xs font-medium text-muted-foreground">{f.label ?? f.key}</div>
                            <div className="rounded-md border bg-muted/30 px-2.5 py-1.5 text-sm">
                              {String((data as any)[f.key] ?? "—")}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )
          })()}
        </div>
      )}
    </div>
  )
}
