import { Check, Circle, Clock, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type WorkflowStepPhase = "completed" | "current" | "upcoming" | "rejected"

export type TaskApprovalActionLine = {
  actor_user_id: number
  actor_display_name: string
  action: string
  comment: string | null
  created_at: string | null
}

export type TaskApprovalStepLine = {
  step_order: number
  approver_role_name: string
  required_approvals: number
  total_steps: number
  phase: WorkflowStepPhase
  approved_count: number
  actions: TaskApprovalActionLine[]
  status_label: string
  pool_size?: number
  pool_member_names?: string[]
}

type Props = {
  steps: TaskApprovalStepLine[]
  viewerUserId: number | null
  formatWhen: (iso: string | null | undefined) => string
}

function phaseIcon(phase: WorkflowStepPhase) {
  switch (phase) {
    case "completed":
      return <Check className="size-4" strokeWidth={2.5} />
    case "current":
      return <Clock className="size-4" strokeWidth={2.25} />
    case "rejected":
      return <X className="size-4" strokeWidth={2.5} />
    default:
      return <Circle className="size-3 fill-current opacity-60" />
  }
}

function phaseStyles(phase: WorkflowStepPhase): { ring: string; line: string } {
  switch (phase) {
    case "completed":
      return {
        ring: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
        line: "bg-emerald-200 dark:bg-emerald-900/60",
      }
    case "current":
      return {
        ring: "border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100",
        line: "bg-amber-200 dark:bg-amber-900/60",
      }
    case "rejected":
      return {
        ring: "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200",
        line: "bg-red-200 dark:bg-red-900/60",
      }
    default:
      return {
        ring: "border-border/70 bg-muted/30 text-muted-foreground",
        line: "bg-border/70",
      }
  }
}

function segmentClassForPhase(phase: WorkflowStepPhase): string {
  switch (phase) {
    case "completed":
      return "bg-emerald-200 dark:bg-emerald-900/60"
    case "current":
      return "bg-amber-200 dark:bg-amber-900/60"
    case "rejected":
      return "bg-red-200 dark:bg-red-900/60"
    default:
      return "bg-border/70"
  }
}

function phaseStateBadge(phase: WorkflowStepPhase) {
  switch (phase) {
    case "completed":
      return (
        <Badge
          variant="outline"
          className="rounded-full border-emerald-300 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          Completed
        </Badge>
      )
    case "current":
      return (
        <Badge
          variant="outline"
          className="rounded-full border-amber-400 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
        >
          In progress
        </Badge>
      )
    case "rejected":
      return (
        <Badge
          variant="outline"
          className="rounded-full border-red-300 bg-red-50 px-3 py-1 text-[11px] font-semibold text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
        >
          Rejected
        </Badge>
      )
    default:
      return (
        <Badge
          variant="outline"
          className="rounded-full border-border/70 bg-muted/20 px-3 py-1 text-[11px] font-semibold text-muted-foreground"
        >
          Not started
        </Badge>
      )
  }
}

function phaseBusinessLabel(phase: WorkflowStepPhase): string {
  switch (phase) {
    case "completed":
      return "Completed"
    case "current":
      return "In Progress"
    case "rejected":
      return "Rejected"
    default:
      return "Not Started"
  }
}

function actionBusinessLabel(action: string | null | undefined): string {
  switch (String(action ?? "").trim().toLowerCase()) {
    case "approve":
    case "approved":
      return "Approved"
    case "reject":
    case "rejected":
      return "Rejected"
    default: {
      const raw = String(action ?? "").trim()
      return raw ? raw.charAt(0).toUpperCase() + raw.slice(1).replace(/_/g, " ") : "—"
    }
  }
}

function actionActorLabel(action: string | null | undefined): string {
  switch (String(action ?? "").trim().toLowerCase()) {
    case "approve":
    case "approved":
      return "Approved by"
    case "reject":
    case "rejected":
      return "Rejected by"
    default:
      return "Updated by"
  }
}

function pendingActorLabel(step: TaskApprovalStepLine): string {
  switch (step.phase) {
    case "current":
      return "Pending with"
    case "upcoming":
      return "Next approver"
    case "rejected":
      return "Rejected by"
    default:
      return "Approved by"
  }
}

function pendingActorValue(step: TaskApprovalStepLine): string {
  if (step.phase === "upcoming") return step.approver_role_name
  const names = step.pool_member_names ?? []
  const total = step.pool_size ?? 0
  if (names.length > 0) {
    const suffix = total > names.length ? ` +${total - names.length} more` : ""
    return `${names.join(", ")}${suffix}`
  }
  if (total > 0) return `${total} approver${total === 1 ? "" : "s"} in ${step.approver_role_name}`
  return step.approver_role_name
}

function actionCommentText(comment: string | null | undefined): string {
  return comment && comment.trim() ? comment.trim() : "No comment added."
}

function phaseActionText(step: TaskApprovalStepLine): string {
  switch (step.phase) {
    case "completed":
      return "Approved"
    case "rejected":
      return "Rejected"
    case "current":
      return "Awaiting approval"
    default:
      return "Waiting for earlier approvals"
  }
}

function actionActorText(
  actorDisplayName: string | null | undefined,
  viewerUserId: number | null,
  actorUserId: number | null | undefined,
): string {
  const name = actorDisplayName && actorDisplayName.trim() ? actorDisplayName.trim() : "—"
  return viewerUserId != null && actorUserId != null && Number(actorUserId) === Number(viewerUserId)
    ? `${name} (You)`
    : name
}

function SummaryChip({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  )
}

function FieldLine({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <p className="text-sm leading-6 text-foreground">
      <span className="font-semibold text-foreground">{label}:</span>{" "}
      <span className="whitespace-pre-wrap break-words text-foreground">{value}</span>
    </p>
  )
}

export function ApprovalWorkflowTimeline({ steps, viewerUserId, formatWhen }: Props) {
  if (steps.length === 0) return null

  const totalSteps = steps[0]?.total_steps ?? steps.length
  const nCompleted = steps.filter((step) => step.phase === "completed").length
  const nCurrent = steps.filter((step) => step.phase === "current").length
  const nUpcoming = steps.filter((step) => step.phase === "upcoming").length
  const nRejected = steps.filter((step) => step.phase === "rejected").length

  return (
    <div className="rounded-xl border border-border/80 bg-card text-card-foreground shadow-sm">
      <div className="border-b border-border/60 px-4 py-4 sm:px-6">
        <h3 className="text-lg font-semibold text-foreground">Approval Progress</h3>
        <p className="text-sm text-muted-foreground">
          {totalSteps} level{totalSteps === 1 ? "" : "s"} in this workflow
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {nCompleted > 0 ? (
            <SummaryChip className="bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
              {nCompleted} completed
            </SummaryChip>
          ) : null}
          {nCurrent > 0 ? (
            <SummaryChip className="bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              <Clock className="size-3.5" />
              {nCurrent} in progress
            </SummaryChip>
          ) : null}
          {nUpcoming > 0 ? (
            <SummaryChip className="bg-muted/30 text-muted-foreground">
              {nUpcoming} not started
            </SummaryChip>
          ) : null}
          {nRejected > 0 ? (
            <SummaryChip className="bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200">
              {nRejected} rejected
            </SummaryChip>
          ) : null}
        </div>
      </div>

      <ol className="relative px-4 py-5 sm:px-6">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1
          const styles = phaseStyles(step.phase)
          const detailRows =
            step.actions.length > 0
              ? step.actions
              : [
                  {
                    actor_user_id: -1,
                    actor_display_name: pendingActorValue(step),
                    action: phaseActionText(step),
                    comment: step.phase === "rejected" ? "No rejection note added." : "—",
                    created_at: null,
                  } satisfies TaskApprovalActionLine,
                ]

          return (
            <li key={step.step_order} className="relative flex gap-4 pb-6 last:pb-0">
              {!isLast ? (
                <div
                  className={cn("absolute left-[17px] top-10 h-[calc(100%-0.5rem)] w-px", segmentClassForPhase(step.phase))}
                  aria-hidden
                />
              ) : null}

              <div
                className={cn(
                  "relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 bg-background",
                  styles.ring,
                )}
              >
                {phaseIcon(step.phase)}
              </div>

              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  {phaseStateBadge(step.phase)}
                  <h4 className="text-lg font-semibold leading-tight text-foreground">
                    Step {step.step_order} of {step.total_steps} — {step.approver_role_name}
                  </h4>
                </div>

                <div className="space-y-3">
                  {detailRows.map((action, actionIndex) => (
                    <div
                      key={`${step.step_order}-${action.actor_user_id}-${action.action}-${action.created_at ?? actionIndex}`}
                      className={cn(
                        "space-y-1.5",
                        actionIndex > 0 && "border-t border-border/50 pt-3",
                      )}
                    >
                      {detailRows.length > 1 ? (
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Approval {actionIndex + 1}
                        </p>
                      ) : null}
                      <FieldLine label="Status" value={phaseBusinessLabel(step.phase)} />
                      <FieldLine
                        label={step.actions.length > 0 ? actionActorLabel(action.action) : pendingActorLabel(step)}
                        value={
                          step.actions.length > 0
                            ? actionActorText(action.actor_display_name, viewerUserId, action.actor_user_id)
                            : action.actor_display_name
                        }
                      />
                      <FieldLine
                        label="Action"
                        value={step.actions.length > 0 ? actionBusinessLabel(action.action) : phaseActionText(step)}
                      />
                      <FieldLine label="Comment / Note" value={actionCommentText(action.comment)} />
                      <FieldLine label="Date & Time" value={action.created_at ? formatWhen(action.created_at) : "—"} />
                    </div>
                  ))}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
