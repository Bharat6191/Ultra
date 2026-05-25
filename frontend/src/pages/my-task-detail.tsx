import * as React from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { ApprovalWorkflowTimeline, type TaskApprovalStepLine } from "@/components/approval-workflow-timeline"
import {
  WorkOrderApprovalReview,
  WorkOrderRateOverrideApprovalReview,
} from "@/components/tasks/work-order-task-review"
import { InvoiceExceptionApprovalReview } from "@/components/tasks/invoice-task-review"
import { ApiError, getJson, postJson } from "@/lib/api"
import { hasPermission, isSuperuser, persistAuthFromMe } from "@/lib/permissions"
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

function timeMs(iso: string | null | undefined): number {
  if (!iso) return Number.NEGATIVE_INFINITY
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
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

  if (et === "contractor_rate_approval") return hasPermission("contractor_rates.view") ? base : null

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

type TaskCommentsCardProps = {
  comment: string
  onCommentChange: (v: string) => void
  sortedComments: TaskComment[]
  onAddComment: () => void
  commenting: boolean
}

function TaskCommentsCard({ comment, onCommentChange, sortedComments, onAddComment, commenting }: TaskCommentsCardProps) {
  return (
    <Card className="min-h-0">
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="text-base">Comments</CardTitle>
        <CardDescription className="text-xs">Add a note and review history.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="task-comment" className="text-xs">
            Comment
          </Label>
          <textarea
            id="task-comment"
            className={cn(
              "min-h-[72px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
            )}
            value={comment}
            onChange={(e) => onCommentChange(e.target.value)}
            rows={3}
            placeholder="Write a comment…"
          />
        </div>
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="secondary" onClick={onAddComment} disabled={commenting || !comment.trim()}>
            {commenting ? "Adding…" : "Add comment"}
          </Button>
        </div>
        <Separator />
        {sortedComments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          <ul className="max-h-[min(40vh,20rem)] space-y-2 overflow-y-auto pr-0.5">
            {sortedComments.map((c) => (
              <li key={c.id} className="rounded-md border bg-muted/30 px-2.5 py-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {c.user_display_name ?? (c.user_id != null ? `User #${c.user_id}` : "—")}
                  </span>
                  <span className="text-xs text-muted-foreground">{c.created_at ? formatDateTime(c.created_at) : "—"}</span>
                </div>
                <div className="mt-0.5 text-sm whitespace-pre-wrap leading-snug">{c.comment}</div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function taskAuditTitle(ev: TaskAuditLog): string {
  const a = ev.action.toLowerCase()
  if (a === "created") return "Task created for this approval step"
  if (a === "approved" || a === "approve") return "Approved on this task"
  if (a === "rejected" || a === "reject") return "Rejected on this task"
  if (a === "commented") return "Comment on task thread"
  if (a === "resubmitted") return "Resubmitted for approval after changes"
  if (a === "started") return "Task started"
  if (a === "completed") return "Task completed"
  if (a === "closed") return "Task closed"
  if (a === "assigned") return "Task reassigned"
  return ev.action.replace(/_/g, " ")
}

function actorLine(ev: TaskAuditLog): string {
  if (ev.actor_display_name) return ev.actor_display_name
  if (ev.actor_user_id != null) return `User #${ev.actor_user_id}`
  return "—"
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

export function MyTaskDetailPage() {
  const { taskId } = useParams()
  const navigate = useNavigate()

  const [task, setTask] = React.useState<UnifiedTaskDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [comment, setComment] = React.useState("")
  const [commenting, setCommenting] = React.useState(false)
  const [acting, setActing] = React.useState(false)
  const [actionComment, setActionComment] = React.useState("")

  const [, forcePermRefresh] = React.useReducer((x: number) => x + 1, 0)
  const approvalActionCode =
    task?.approval?.entity_type === "invoice_exception_approval"
      ? "invoices.approve_exceptions"
      : "approval.act"
  const canApprovalAct =
    hasPermission("approval.act") ||
    (task?.approval?.entity_type === "invoice_exception_approval" &&
      hasPermission("invoices.approve_exceptions"))
  const canTaskAct = hasPermission("task.act")
  const canTaskClose = hasPermission("task.close")

  const [viewerUserId, setViewerUserId] = React.useState<number | null>(null)

  const sortedAudit = React.useMemo(() => {
    const logs = task?.audit_logs ?? []
    return [...logs].sort((a, b) => timeMs(b.created_at) - timeMs(a.created_at))
  }, [task])

  const sortedComments = React.useMemo(() => {
    const rows = task?.comments ?? []
    return [...rows].sort((a, b) => timeMs(b.created_at) - timeMs(a.created_at))
  }, [task])

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
      setActionComment("")
      await load(task.id)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Action failed."
      toast.error(msg)
    } finally {
      setActing(false)
    }
  }

  async function addComment() {
    if (!task) return
    const trimmed = comment.trim()
    if (!trimmed) return
    setCommenting(true)
    try {
      await postJson(`/tasks/${task.id}/comments`, { comment: trimmed })
      toast.success("Comment added.")
      setComment("")
      await load(task.id)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not add comment."
      toast.error(msg)
    } finally {
      setCommenting(false)
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
  const approvalStepNeedsDecision = Boolean(
    task &&
      task.task_type === "approval" &&
      task.approval &&
      task.approval.status === "pending" &&
      (task.status === "pending" || task.status === "open" || task.status === "in_progress"),
  )

  function renderApprovalDecisionEditor(extraClassName?: string) {
    if (!task || task.task_type !== "approval" || !task.approval) return null
    return (
      <div className={cn("flex w-full min-w-0 max-w-2xl flex-col gap-2", extraClassName)}>
        <textarea
          className={cn(
            "min-h-[64px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
          )}
          value={actionComment}
          onChange={(e) => setActionComment(e.target.value)}
          rows={2}
          placeholder="Optional note for the approver record…"
          disabled={acting}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => void approveOrReject("reject")}
            disabled={acting || !canApprovalAct}
          >
            Reject
          </Button>
          <Button
            type="button"
            size="sm"
            variant="default"
            onClick={() => void approveOrReject("approve")}
            disabled={acting || !canApprovalAct}
          >
            Approve
          </Button>
        </div>
        {!canApprovalAct ? (
          <p className="text-right text-xs text-muted-foreground">
            Needs <span className="font-mono">{approvalActionCode}</span>
            {task?.approval?.entity_type === "invoice_exception_approval" ? " or approval.act" : ""} on your role.
          </p>
        ) : null}
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

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-lg font-semibold tracking-tight">
            {task && !loading && isApprovalLike ? "Review Request" : "Task details"}
          </h2>
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
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
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
                  <Link to={userCreationEditPath}>Edit user details</Link>
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
                  <Link to={userCreationEditPath}>Edit user details</Link>
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

      {approvalStepNeedsDecision && task?.approval && !loading ? (
        <Card className="border-emerald-200/80 bg-emerald-50/40 shadow-sm dark:border-emerald-900/50 dark:bg-emerald-950/20">
          <CardHeader className="space-y-1 pb-2 sm:flex sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="space-y-0.5">
              <CardTitle className="text-base">Approve or reject this step</CardTitle>
              <CardDescription className="text-sm">
                {task.approval.step_order != null
                  ? `Step ${task.approval.step_order}${
                      task.approval.approver_role_name ? ` of ${task.approval.approver_role_name}` : ""
                    }${task.approval.required_approvals != null ? ` · ${task.approval.required_approvals} approval(s) required` : ""}`
                  : "Approval step"}
              </CardDescription>
            </div>
            <Badge variant={taskStatusBadgeVariant(task.status)} className="w-fit shrink-0">
              {task.status}
            </Badge>
          </CardHeader>
          <CardContent className="pt-0">
            {renderApprovalDecisionEditor("max-w-none")}
          </CardContent>
        </Card>
      ) : null}

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
                  task.approval.entity_type === "work_order_approval" ||
                    task.approval.entity_type === "work_order_rate_override" ||
                    task.approval.entity_type === "invoice_exception_approval"
                    ? ""
                    : "lg:grid-cols-2",
                )}
              >
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
                {task.approval.entity_type === "invoice_exception_approval" ? null : (
                  <TaskCommentsCard
                    comment={comment}
                    onCommentChange={setComment}
                    sortedComments={sortedComments}
                    onAddComment={() => void addComment()}
                    commenting={commenting}
                  />
                )}
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

          {task.task_type === "approval" && task.approval ? (
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
          ) : null}

          {task.task_type === "manual" ? (
            <TaskCommentsCard
              comment={comment}
              onCommentChange={setComment}
              sortedComments={sortedComments}
              onAddComment={() => void addComment()}
              commenting={commenting}
            />
          ) : null}

          <Card>
            <CardHeader className="space-y-1 pb-2">
              <CardTitle className="text-base">History</CardTitle>
              <CardDescription className="text-xs">Task activity · newest first</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                {sortedAudit.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No task-level events yet.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {sortedAudit.map((ev) => (
                      <li key={ev.id} className="rounded-md border bg-muted/30 px-2.5 py-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{taskAuditTitle(ev)}</span>
                          <span className="text-xs text-muted-foreground">
                            {ev.created_at ? formatDateTime(ev.created_at) : "—"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">{actorLine(ev)}</p>
                        {ev.new_value && typeof (ev.new_value as { comment?: unknown }).comment === "string" ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {String((ev.new_value as { comment: string }).comment)}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>

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
