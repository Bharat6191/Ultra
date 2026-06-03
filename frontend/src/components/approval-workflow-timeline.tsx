import { Check, Circle, CircleUserRound, Clock, Mail, User, X } from "lucide-react"

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
  /** Active users in the approver role (can act on this step). */
  pool_size?: number
  /** Sample of names in that pool (capped on server; may be shorter than pool_size). */
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
      return <Check className="size-3.5" strokeWidth={2.5} />
    case "current":
      return <Clock className="size-3.5" strokeWidth={2.5} />
    case "rejected":
      return <X className="size-3.5" strokeWidth={2.5} />
    default:
      return <Circle className="size-2.5 fill-current opacity-50" />
  }
}

function phaseStyles(phase: WorkflowStepPhase): { ring: string; fill: string; line: string } {
  switch (phase) {
    case "completed":
      return {
        ring: "border-emerald-500/80 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200",
        fill: "text-emerald-600 dark:text-emerald-400",
        line: "bg-emerald-200/80 dark:bg-emerald-800/50",
      }
    case "current":
      return {
        ring: "border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-100",
        fill: "text-amber-500 dark:text-amber-400",
        line: "bg-amber-200/80 dark:bg-amber-800/50",
      }
    case "rejected":
      return {
        ring: "border-red-400 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200",
        fill: "text-red-500 dark:text-red-400",
        line: "bg-border",
      }
    default:
      return {
        ring: "border-border/60 bg-muted/40 text-muted-foreground/50",
        fill: "text-muted-foreground/25",
        line: "bg-border/60",
      }
  }
}

function rowTextStyles(phase: WorkflowStepPhase): string {
  switch (phase) {
    case "completed":
      return "text-muted-foreground"
    case "current":
      return "text-amber-950 dark:text-amber-50"
    case "rejected":
      return "text-foreground/80"
    default:
      return "text-muted-foreground/40"
  }
}

function phaseStateBadge(phase: WorkflowStepPhase) {
  switch (phase) {
    case "completed":
      return (
        <Badge
          variant="outline"
          className="h-5 border-emerald-300/80 bg-emerald-50/90 font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
        >
          Completed
        </Badge>
      )
    case "current":
      return (
        <Badge
          variant="outline"
          className="h-5 border-amber-400/80 bg-amber-50/90 font-semibold text-amber-900 dark:border-amber-600 dark:bg-amber-950/50 dark:text-amber-100"
        >
          In progress
        </Badge>
      )
    case "rejected":
      return (
        <Badge variant="outline" className="h-5 border-red-200 bg-red-50 font-semibold text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
          Rejected
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className="h-5 font-normal text-muted-foreground">
          Not started
        </Badge>
      )
  }
}

/** Vertical segment below this node (to the next step). */
function segmentClassForPhase(phase: WorkflowStepPhase): string {
  switch (phase) {
    case "completed":
      return "bg-emerald-300/90 dark:bg-emerald-800/50"
    case "current":
      return "bg-amber-200/80 dark:bg-amber-800/50"
    case "rejected":
      return "bg-border"
    default:
      return "bg-border/40"
  }
}

function poolText(step: TaskApprovalStepLine): string {
  const n = step.pool_size ?? 0
  const names = step.pool_member_names ?? []
  const cap = names.length
  if (n <= 0) return "No eligible approvers found for this role (configuration issue)."
  if (cap === 0) return `${n} people are in the approver group for this step (names not loaded).`
  const more = n > cap ? ` · showing ${cap} of ${n} names` : ""
  return `${n} people can approve in this step${more}: ${names.join(", ")}`
}

export function ApprovalWorkflowTimeline({ steps, viewerUserId, formatWhen }: Props) {
  if (steps.length === 0) return null

  const nCompleted = steps.filter((s) => s.phase === "completed").length
  const nCurrent = steps.filter((s) => s.phase === "current").length
  const nUpcoming = steps.filter((s) => s.phase === "upcoming").length
  const nRejected = steps.filter((s) => s.phase === "rejected").length

  return (
    <div className="rounded-xl border border-border/80 bg-card text-card-foreground shadow-sm">
      <div className="border-b border-border/60 bg-muted/15 px-4 py-2.5">
        <h3 className="text-sm font-semibold">Approval Progress</h3>
        <p className="text-xs text-muted-foreground">
          {steps[0].total_steps} {steps[0].total_steps === 1 ? "level" : "levels"} in this workflow
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {nCompleted > 0 ? (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-emerald-50 px-1.5 py-0.5 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
              <Check className="size-2.5" />
              {nCompleted} completed
            </span>
          ) : null}
          {nCurrent > 0 ? (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-50 px-1.5 py-0.5 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
              <Clock className="size-2.5" />
              {nCurrent} in progress
            </span>
          ) : null}
          {nUpcoming > 0 ? (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-muted/60 px-1.5 py-0.5 text-muted-foreground">
              {nUpcoming} not started
            </span>
          ) : null}
          {nRejected > 0 ? (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-red-50 px-1.5 py-0.5 text-red-800 dark:bg-red-950/40 dark:text-red-200">
              {nRejected} rejected
            </span>
          ) : null}
        </p>
      </div>
      <ol className="relative px-4 py-3">
        {steps.map((step, i) => {
          const st = phaseStyles(step.phase)
          const isLast = i === steps.length - 1
          const segClass = segmentClassForPhase(step.phase)
          const approvals = step.actions.filter((a) => a.action === "approve" || a.action === "approved")
          const rejections = step.actions.filter((a) => a.action === "reject" || a.action === "rejected")
          const showMulti = step.required_approvals > 1
          return (
            <li key={step.step_order} className="relative flex gap-3 pb-6 last:pb-0">
              {!isLast ? (
                <div
                  className={cn("absolute left-[15px] top-8 h-[calc(100%-0.25rem)] w-px", segClass)}
                  aria-hidden
                />
              ) : null}
              <div
                className={cn(
                  "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-background",
                  st.ring,
                )}
              >
                {phaseIcon(step.phase)}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  {phaseStateBadge(step.phase)}
                  <p className={cn("text-sm leading-tight", rowTextStyles(step.phase))}>
                    <span className="font-bold text-foreground">Step {step.step_order}</span>
                    <span className="font-semibold"> of {step.total_steps}</span>
                    <span className="font-medium"> — {step.approver_role_name}</span>
                  </p>
                </div>
                {step.phase === "completed" ? (
                  <p className="text-xs text-emerald-800/90 dark:text-emerald-200/90">
                    This step is <strong>finished</strong>. {step.approved_count} of {step.required_approvals} required
                    approval(s) were recorded before the request moved on.
                  </p>
                ) : null}
                {step.phase === "current" ? (
                  <p className="text-xs text-amber-900/90 dark:text-amber-100/90">
                    <strong>Pending on this step</strong> — approvers in this group must act before the request can
                    continue.
                    {showMulti
                      ? ` ${step.approved_count} of ${step.required_approvals} required approval(s) so far.`
                      : ` (${step.approved_count ? `${step.approved_count} action(s) so far` : "no action yet"})`}
                  </p>
                ) : null}
                {step.phase === "upcoming" ? (
                  <p className="text-xs text-muted-foreground/80">
                    <strong>Not started</strong> — this step will begin after earlier steps are fully completed.
                  </p>
                ) : null}
                {step.phase === "rejected" ? (
                  <p className="text-xs text-red-800/90 dark:text-red-200/90">The process stopped on this step.</p>
                ) : null}
                {step.phase !== "completed" && step.phase !== "rejected" ? (
                  <p className="text-xs text-muted-foreground">
                    Rule: needs{" "}
                    <span className="font-medium text-foreground/80">
                      {step.required_approvals}{" "}
                      {step.required_approvals === 1 ? "approval" : "distinct approvals"}
                    </span>{" "}
                    {showMulti
                      ? `(any combination of up to ${step.pool_size} people in the approver group)`
                      : step.pool_size
                        ? `(from the ${step.pool_size}-person approver group)`
                        : null}
                  </p>
                ) : null}
                {step.phase === "completed" && step.approved_count > 0 ? (
                  <p className="text-[11px] text-muted-foreground">Who already approved (this step) is listed below.</p>
                ) : null}
                {step.phase !== "completed" && (step.pool_size ?? 0) > 0 ? (
                  <div
                    className={cn(
                      "flex gap-1.5 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-xs text-muted-foreground",
                      step.phase === "upcoming" && "opacity-70",
                    )}
                  >
                    <CircleUserRound className="mt-0.5 size-3.5 shrink-0 opacity-60" aria-hidden />
                    <span className="min-w-0 leading-snug">{poolText(step)}</span>
                  </div>
                ) : null}
                <p className={cn("text-xs", step.phase === "upcoming" ? "text-muted-foreground/50" : "text-muted-foreground")}>
                  {step.status_label}
                </p>

                {step.actions.length > 0 ? (
                  <div className="mt-2 space-y-3 border-t border-border/50 pt-2">
                    {approvals.length > 0 ? (
                      <div>
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {showMulti
                            ? `Approvals (step ${step.step_order} · ${approvals.length} of up to ${step.required_approvals} required slot(s) filled)`
                            : `Who approved (step ${step.step_order})`}
                        </p>
                        <ul className="space-y-2">
                          {approvals.map((a, j) => {
                            const isYou = viewerUserId != null && a.actor_user_id === viewerUserId
                            const n = j + 1
                            return (
                              <li
                                key={`${step.step_order}-a-${a.actor_user_id}-${j}-${a.created_at ?? j}`}
                                className="rounded-md border border-emerald-200/60 bg-emerald-50/50 px-2 py-1.5 dark:border-emerald-900/50 dark:bg-emerald-950/20"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                  <span className="inline-flex flex-wrap items-center gap-1.5 font-medium text-emerald-900 dark:text-emerald-100">
                                    {showMulti ? (
                                      <span className="rounded bg-emerald-600/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:text-emerald-200">
                                        #{n}
                                      </span>
                                    ) : null}
                                    <User className="size-3 shrink-0 opacity-70" aria-hidden />
                                    {a.actor_display_name}
                                    {isYou ? <span className="text-emerald-700/80">(You)</span> : null}
                                    <span className="rounded-sm bg-white/80 px-1.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                                      approved
                                    </span>
                                  </span>
                                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                                    {a.created_at ? formatWhen(a.created_at) : "—"}
                                  </span>
                                </div>
                                {a.comment ? (
                                  <div className="mt-1 flex gap-1.5 pl-0.5 text-xs text-emerald-900/80 dark:text-emerald-200/90">
                                    <Mail className="mt-0.5 size-3 shrink-0 opacity-50" aria-hidden />
                                    <span className="whitespace-pre-wrap leading-snug">{a.comment}</span>
                                  </div>
                                ) : null}
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    ) : null}
                    {rejections.length > 0 ? (
                      <div>
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-destructive/90">
                          Rejection (step {step.step_order})
                        </p>
                        <ul className="space-y-2">
                          {rejections.map((a, j) => {
                            const isYou = viewerUserId != null && a.actor_user_id === viewerUserId
                            return (
                              <li
                                key={`${step.step_order}-r-${a.actor_user_id}-${j}`}
                                className="rounded-md border border-red-200/70 bg-red-50/50 px-2 py-1.5 dark:border-red-900/50 dark:bg-red-950/20"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                  <span className="inline-flex items-center gap-1.5 font-medium text-red-800 dark:text-red-200">
                                    <User className="size-3 shrink-0" aria-hidden />
                                    {a.actor_display_name}
                                    {isYou ? <span className="text-red-600/80">(You)</span> : null}
                                    <span className="text-[10px] font-semibold uppercase">rejected</span>
                                  </span>
                                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                                    {a.created_at ? formatWhen(a.created_at) : "—"}
                                  </span>
                                </div>
                                {a.comment ? (
                                  <div className="mt-1 flex gap-1.5 text-xs text-red-800/90 dark:text-red-200/90">
                                    <Mail className="mt-0.5 size-3 shrink-0" aria-hidden />
                                    <span className="whitespace-pre-wrap leading-snug">{a.comment}</span>
                                  </div>
                                ) : null}
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
