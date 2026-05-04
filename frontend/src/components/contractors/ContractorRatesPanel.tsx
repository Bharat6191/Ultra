import * as React from "react"
import { toast } from "sonner"
import {
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Hourglass,
  MessagesSquare,
  Plus,
  Send,
  TrendingUp,
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getJson, postJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"
import {
  formatMoney,
  formatPercent,
  rateStatusLabel,
  rateStatusVariant,
  rateStepperIndex,
  RATE_STEPPER_STEPS,
} from "@/components/contractors/rateStatus"
import {
  NegotiationRoundDialog,
  NewNegotiationDialog,
  type NewRateForm,
  type RateMasterPick,
  type RoundForm,
} from "@/components/contractors/ContractorRateDialog"
import { ContractorRateTimeline } from "@/components/contractors/ContractorRateTimeline"

export type RateMasterPublic = {
  id: number
  job_type: string
  skill_type: string
  unit: string
  base_rate: number | string
  org_unit_id: number
  org_unit_name: string | null
  effective_from: string
  effective_to: string | null
  is_active: boolean
  notes: string | null
}

export type NegotiationRoundPublic = {
  id: number
  round_number: number
  proposed_rate: number | string | null
  counter_rate: number | string | null
  remarks: string | null
  created_by_name: string | null
  created_at: string
}

export type ContractorRatePublic = {
  id: number
  contractor_id: number
  contractor_name: string | null
  rate_master_id: number
  job_type: string | null
  skill_type: string | null
  unit: string | null
  org_unit_id: number | null
  org_unit_name: string | null
  base_rate: number | string | null
  negotiated_rate: number | string
  initial_rate: number | string | null
  previous_rate: number | string | null
  savings_amount: number | string | null
  savings_percentage: number | string | null
  vs_base_amount: number | string | null
  vs_base_percentage: number | string | null
  effective_from: string
  effective_to: string | null
  status: string
  current_round: number
  remarks: string | null
  approval_request_id: number | null
  approved_by: number | null
  approved_at: string | null
  rejected_by: number | null
  rejected_at: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
  rounds: NegotiationRoundPublic[]
}

export type RatesSummary = {
  total_negotiations: number
  pending_approvals: number
  approved: number
  rejected: number
  /** Negotiation savings — anchored on the contractor's initial ask, always >= 0. */
  total_savings: number | string
  avg_savings_percentage: number | string
  /** Vs-base KPIs — surface so the dashboard can flag when contractors land
   *  ABOVE the procurement baseline without poisoning the savings figure. */
  total_premium_above_base?: number | string
  total_below_base_savings?: number | string
  approved_above_base?: number
  approved_below_base?: number
  approved_at_base?: number
}


/**
 * Self-contained rates UI for a single contractor: loads its own data, owns its
 * dialogs, and exposes a `focusRateId` so other pages can deep-link to a specific
 * rate (e.g. opening from a My Tasks approval).
 *
 * Pass ``readOnly`` to suppress every mutating affordance (New negotiation,
 * Submit / Cancel actions, Add round button). The panel still loads, lists, and
 * shows the timeline so the contractor profile tab can display the negotiation
 * history without offering edit controls.
 */
export function ContractorRatesPanel({
  contractorId,
  focusRateId,
  onFocusHandled,
  readOnly = false,
}: {
  contractorId: number
  focusRateId?: number | null
  onFocusHandled?: () => void
  readOnly?: boolean
}) {
  const [rates, setRates] = React.useState<ContractorRatePublic[] | null>(null)
  const [summary, setSummary] = React.useState<RatesSummary | null>(null)
  const [rateMasters, setRateMasters] = React.useState<RateMasterPublic[]>([])
  const [error, setError] = React.useState<string | null>(null)

  const [selectedRateId, setSelectedRateId] = React.useState<number | null>(null)
  const [newOpen, setNewOpen] = React.useState(false)
  const [newSaving, setNewSaving] = React.useState(false)
  const [newError, setNewError] = React.useState<string | null>(null)
  const [roundOpen, setRoundOpen] = React.useState(false)
  const [roundSaving, setRoundSaving] = React.useState(false)
  const [roundError, setRoundError] = React.useState<string | null>(null)

  const canView = hasPermission("contractor_rates.view")
  // ``readOnly`` strips every mutating affordance regardless of RBAC, used by
  // the contractor master tab to show negotiation history without edit access.
  const canCreate = !readOnly && hasPermission("contractor_rates.create")
  const canUpdate = !readOnly && hasPermission("contractor_rates.update")

  const detailRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!contractorId || !canView) return
    void load()
  }, [contractorId, canView])

  // Honour deep-links from the my-tasks page (focusRateId=<id>): once data has
  // loaded, jump to that row and scroll the detail panel into view.
  React.useEffect(() => {
    if (focusRateId && rates && rates.some((r) => r.id === focusRateId)) {
      setSelectedRateId(focusRateId)
      onFocusHandled?.()
      // Defer to next paint so the panel is rendered.
      requestAnimationFrame(() => {
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRateId, rates])

  async function load() {
    setError(null)
    try {
      const [list, sum, rm] = await Promise.all([
        getJson<ContractorRatePublic[]>(
          `/contractor-rates?contractor_id=${contractorId}`,
        ),
        getJson<RatesSummary>(`/contractor-rates/summary?contractor_id=${contractorId}`),
        getJson<RateMasterPublic[]>(`/rate-master?active=true`).catch(() => []),
      ])
      setRates(list)
      setSummary(sum)
      setRateMasters(rm)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contractor rates")
    }
  }

  const selectedRate = React.useMemo(
    () => rates?.find((r) => r.id === selectedRateId) ?? null,
    [rates, selectedRateId],
  )

  const activeRates = React.useMemo(
    () => (rates ?? []).filter((r) => r.status === "approved"),
    [rates],
  )

  const rateMasterPicks: RateMasterPick[] = React.useMemo(
    () =>
      rateMasters.map((rm) => ({
        id: rm.id,
        job_type: rm.job_type,
        skill_type: rm.skill_type,
        unit: rm.unit,
        base_rate: rm.base_rate,
        org_unit_id: rm.org_unit_id,
        org_unit_name: rm.org_unit_name,
      })),
    [rateMasters],
  )

  async function createDraft(form: NewRateForm) {
    if (form.rate_master_id === null) {
      setNewError("Pick a base rate first.")
      return
    }
    setNewSaving(true)
    setNewError(null)
    try {
      const created = await postJson<ContractorRatePublic>(`/contractor-rates`, {
        contractor_id: contractorId,
        rate_master_id: form.rate_master_id,
        negotiated_rate: form.negotiated_rate,
        // Forward the opening ask only when entered; the backend defaults
        // ``initial_rate`` to the negotiated_rate otherwise.
        initial_rate: form.initial_rate.trim() ? form.initial_rate : null,
        effective_from: form.effective_from,
        effective_to: form.effective_to || null,
        remarks: form.remarks || null,
      })
      toast.success(`Draft created for ${created.job_type ?? "rate"}`)
      setNewOpen(false)
      await load()
      setSelectedRateId(created.id)
    } catch (e) {
      setNewError(e instanceof Error ? e.message : "Failed to create draft")
    } finally {
      setNewSaving(false)
    }
  }

  async function submitForApproval(rate: ContractorRatePublic) {
    try {
      await postJson(`/contractor-rates/${rate.id}/submit`, {})
      toast.success("Submitted for approval")
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submit failed")
    }
  }

  async function cancelRate(rate: ContractorRatePublic) {
    if (!confirm(`Cancel draft #${rate.id}? This cannot be undone.`)) return
    try {
      await postJson(`/contractor-rates/${rate.id}/cancel`, {})
      toast.success("Negotiation cancelled")
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed")
    }
  }

  async function addRound(form: RoundForm) {
    if (selectedRateId === null) return
    setRoundSaving(true)
    setRoundError(null)
    try {
      await postJson(`/contractor-rates/${selectedRateId}/negotiate`, {
        proposed_rate: form.proposed_rate || null,
        counter_rate: form.counter_rate || null,
        remarks: form.remarks || null,
        apply_to_negotiated_rate: form.apply_to_negotiated_rate,
      })
      toast.success("Round added")
      setRoundOpen(false)
      await load()
    } catch (e) {
      setRoundError(e instanceof Error ? e.message : "Add round failed")
    } finally {
      setRoundSaving(false)
    }
  }

  if (!canView) {
    return (
      <Card className="border-destructive/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Negotiated rates</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You don't have permission to view negotiated rates.
        </CardContent>
      </Card>
    )
  }

  if (!rates || !summary) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Loading rates…</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {error ?? "Fetching rates and savings."}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-6">
      {/* Action header (no page chrome — composed by the parent). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Negotiated rates</h2>
          <p className="text-xs text-muted-foreground">
            Negotiate rates per job/plant, route to procurement approval, and track savings.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="size-4" /> New negotiation
          </Button>
        ) : null}
      </div>

      {/* Summary KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total negotiations"
          value={summary.total_negotiations}
          icon={<MessagesSquare className="size-4" />}
        />
        <KpiCard
          title="Pending approvals"
          value={summary.pending_approvals}
          icon={<Hourglass className="size-4" />}
          tone="warning"
        />
        <KpiCard
          title="Total savings"
          value={formatMoney(summary.total_savings)}
          icon={<CircleDollarSign className="size-4" />}
          tone="success"
        />
        <KpiCard
          title="Avg savings %"
          value={formatPercent(summary.avg_savings_percentage)}
          icon={<TrendingUp className="size-4" />}
          tone="success"
        />
      </div>

      {error ? <div className="text-sm text-destructive">{error}</div> : null}

      {/* Active rate cards */}
      {activeRates.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Currently active rates</CardTitle>
            <p className="text-xs text-muted-foreground">
              Approved rates that are in force right now.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {activeRates.map((r) => (
                <ActiveRateCard key={r.id} rate={r} onSelect={() => setSelectedRateId(r.id)} />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* All rates table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">All negotiations</CardTitle>
          <p className="text-xs text-muted-foreground">
            Drafts, submitted requests, approved/expired rates, and rejections.
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job · Skill</TableHead>
                <TableHead>Plant</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead className="text-right">Negotiated</TableHead>
                <TableHead className="text-right">Savings</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    No negotiations yet — start one above.
                  </TableCell>
                </TableRow>
              ) : (
                rates.map((r) => (
                  <TableRow
                    key={r.id}
                    className={`cursor-pointer ${selectedRateId === r.id ? "bg-emerald-50/30" : ""}`}
                    onClick={() => setSelectedRateId(r.id)}
                  >
                    <TableCell>
                      <div className="font-medium text-foreground">{r.job_type ?? "—"}</div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {(r.skill_type ?? "").replace(/_/g, " ") || "—"}
                      </div>
                    </TableCell>
                    <TableCell>{r.org_unit_name ?? "—"}</TableCell>
                    <TableCell className="text-right">{formatMoney(r.base_rate)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatMoney(r.negotiated_rate)}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.savings_amount !== null ? (
                        <div>
                          <div className="font-medium">
                            {formatMoney(r.savings_amount)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatPercent(r.savings_percentage)}
                          </div>
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>{r.effective_from}</div>
                      <div className="text-muted-foreground">
                        {r.effective_to ? `→ ${r.effective_to}` : "→ open"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={rateStatusVariant(r.status)}>
                        {rateStatusLabel(r.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div
                        className="flex items-center justify-end gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canCreate && (r.status === "draft" || r.status === "rejected") ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void submitForApproval(r)}
                          >
                            <Send className="size-3.5" /> Submit
                          </Button>
                        ) : null}
                        {canUpdate && (r.status === "draft" || r.status === "pending_approval") ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void cancelRate(r)}
                          >
                            Cancel
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedRateId(r.id)}
                        >
                          Open <ChevronRight className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail panel for the selected rate */}
      {selectedRate ? (
        <div ref={detailRef}>
          <RateDetailPanel
            rate={selectedRate}
            onAddRound={() => setRoundOpen(true)}
            canUpdate={canUpdate}
          />
        </div>
      ) : null}

      {/* Dialogs */}
      <NewNegotiationDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        rateMasters={rateMasterPicks}
        saving={newSaving}
        error={newError}
        onSave={createDraft}
      />
      <NegotiationRoundDialog
        open={roundOpen}
        onOpenChange={setRoundOpen}
        saving={roundSaving}
        error={roundError}
        currentRate={selectedRate?.negotiated_rate ?? null}
        baseRate={selectedRate?.base_rate ?? null}
        onSave={addRound}
      />
    </div>
  )
}


function KpiCard({
  title,
  value,
  icon,
  tone,
}: {
  title: string
  value: React.ReactNode
  icon?: React.ReactNode
  tone?: "success" | "warning" | "info" | "neutral"
}) {
  const toneClasses: Record<string, string> = {
    success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    warning: "bg-amber-50 text-amber-700 ring-amber-200",
    info: "bg-sky-50 text-sky-700 ring-sky-200",
    neutral: "bg-gray-50 text-gray-600 ring-gray-200",
  }
  const cls = toneClasses[tone ?? "neutral"]
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
        </div>
        {icon ? (
          <span className={`grid size-9 place-items-center rounded-xl ring-2 ${cls}`}>{icon}</span>
        ) : null}
      </CardContent>
    </Card>
  )
}


function ActiveRateCard({
  rate,
  onSelect,
}: {
  rate: ContractorRatePublic
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex flex-col items-stretch rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-foreground">{rate.job_type ?? "—"}</div>
          <div className="text-xs text-muted-foreground capitalize">
            {(rate.skill_type ?? "").replace(/_/g, " ") || "—"} · per {rate.unit ?? "—"}
          </div>
        </div>
        <Badge variant="success">Active</Badge>
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="text-xs text-muted-foreground">Negotiated</div>
          <div className="text-2xl font-semibold tracking-tight">
            {formatMoney(rate.negotiated_rate)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Base</div>
          <div className="text-sm">{formatMoney(rate.base_rate)}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <span>{rate.org_unit_name ?? "—"}</span>
        <span className="text-right">
          {rate.savings_amount !== null
            ? `Save ${formatMoney(rate.savings_amount)} (${formatPercent(
                rate.savings_percentage,
              )})`
            : "—"}
        </span>
      </div>
    </button>
  )
}


export function RateDetailPanel({
  rate,
  onAddRound,
  canUpdate,
}: {
  rate: ContractorRatePublic
  onAddRound: () => void
  canUpdate: boolean
}) {
  const stepIdx = rateStepperIndex(rate.status)
  const isTerminal = rate.status === "rejected" || rate.status === "cancelled"
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                {rate.job_type} ·{" "}
                <span className="capitalize">
                  {(rate.skill_type ?? "").replace(/_/g, " ")}
                </span>
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {rate.org_unit_name ?? "—"} · per {rate.unit ?? "—"}
              </p>
            </div>
            <Badge variant={rateStatusVariant(rate.status)}>{rateStatusLabel(rate.status)}</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* Stepper */}
          <ol className="flex items-center gap-1">
            {RATE_STEPPER_STEPS.map((step, i) => {
              const reached = !isTerminal && stepIdx >= i
              const current = !isTerminal && stepIdx === i
              return (
                <React.Fragment key={step.key}>
                  <li className="flex items-center gap-2">
                    <span
                      className={`grid size-6 place-items-center rounded-full text-xs font-semibold ring-2 ${
                        reached
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          : "bg-gray-50 text-gray-500 ring-gray-200"
                      }`}
                    >
                      {reached ? <CheckCircle2 className="size-3.5" /> : i + 1}
                    </span>
                    <span
                      className={`text-xs ${current ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                    >
                      {step.label}
                    </span>
                  </li>
                  {i < RATE_STEPPER_STEPS.length - 1 ? (
                    <li
                      className={`mx-1 h-px flex-1 ${
                        reached ? "bg-emerald-200" : "bg-gray-200"
                      }`}
                    />
                  ) : null}
                </React.Fragment>
              )
            })}
            {isTerminal ? (
              <li className="ml-3 inline-flex">
                <Badge variant="error">{rate.status === "rejected" ? "Rejected" : "Cancelled"}</Badge>
              </li>
            ) : null}
          </ol>

          {/* Rate facts */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact label="Base rate" value={formatMoney(rate.base_rate)} />
            <Fact label="Initial ask" value={formatMoney(rate.initial_rate)} />
            <Fact label="Agreed rate" value={formatMoney(rate.negotiated_rate)} strong />
            <Fact
              label="Negotiated down by"
              value={
                rate.savings_amount !== null && Number(rate.savings_amount) > 0
                  ? `${formatMoney(rate.savings_amount)} (${formatPercent(rate.savings_percentage)})`
                  : "—"
              }
              strong
            />
          </div>

          {/* Negotiation savings highlight (initial ask -> agreed). */}
          {rate.savings_amount !== null && Number(rate.savings_amount) > 0 ? (
            <div className="rounded-lg border bg-emerald-50/60 p-3 text-sm text-emerald-800">
              Negotiated down by <strong>{formatMoney(rate.savings_amount)}</strong> (
              {formatPercent(rate.savings_percentage)}) from the contractor's opening ask of{" "}
              <strong>{formatMoney(rate.initial_rate)}</strong>.
            </div>
          ) : null}

          {/* Vs-base callout — visible whenever the agreed rate sits above
              the procurement baseline. Kept distinct (amber, not red) so it
              reads as informational ("you ended up paying X above base")
              rather than alarming. */}
          {rate.vs_base_amount !== null && Number(rate.vs_base_amount) > 0 ? (
            <div className="rounded-lg border bg-amber-50/70 p-3 text-sm text-amber-900">
              Premium of <strong>{formatMoney(rate.vs_base_amount)}</strong> (
              {formatPercent(rate.vs_base_percentage)}) above the base rate of{" "}
              <strong>{formatMoney(rate.base_rate)}</strong>. This is tracked
              separately from negotiation savings on the dashboard.
            </div>
          ) : rate.vs_base_amount !== null && Number(rate.vs_base_amount) < 0 ? (
            <div className="rounded-lg border bg-emerald-50/40 p-3 text-sm text-emerald-900">
              Below base by <strong>{formatMoney(Math.abs(Number(rate.vs_base_amount)))}</strong>{" "}
              ({formatPercent(rate.vs_base_percentage)}).
            </div>
          ) : null}

          {/* Negotiation rounds */}
          <div>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Negotiation rounds</h4>
              {canUpdate &&
              (rate.status === "draft" ||
                rate.status === "pending_approval" ||
                rate.status === "rejected") ? (
                <Button size="sm" variant="outline" onClick={onAddRound}>
                  <Plus className="size-3.5" /> Add round
                </Button>
              ) : null}
            </div>
            {rate.rounds.length === 0 ? (
              <p className="mt-2 rounded-md border border-dashed bg-gray-50 p-3 text-xs text-muted-foreground">
                No rounds yet. Add a counter-offer or proposal to start the discussion.
              </p>
            ) : (
              <ol className="mt-2 space-y-2">
                {rate.rounds.map((rnd) => (
                  <li
                    key={rnd.id}
                    className="rounded-xl border bg-white p-3 text-sm shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
                          Round {rnd.round_number}
                        </span>
                        {rnd.proposed_rate !== null ? (
                          <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                            Proposed {formatMoney(rnd.proposed_rate)}
                          </span>
                        ) : null}
                        {rnd.counter_rate !== null ? (
                          <span className="rounded-md bg-sky-50 px-2 py-0.5 text-xs text-sky-700">
                            Counter {formatMoney(rnd.counter_rate)}
                          </span>
                        ) : null}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(rnd.created_at).toLocaleString()}
                      </span>
                    </div>
                    {rnd.remarks ? (
                      <p className="mt-1 text-muted-foreground">{rnd.remarks}</p>
                    ) : null}
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      by {rnd.created_by_name ?? "System"}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </CardContent>
      </Card>

      <ContractorRateTimeline rateId={rate.id} />
    </div>
  )
}


function Fact({
  label,
  value,
  strong,
}: {
  label: string
  value: React.ReactNode
  strong?: boolean
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 ${strong ? "text-base font-semibold text-foreground" : "text-sm"}`}>
        {value}
      </div>
    </div>
  )
}
