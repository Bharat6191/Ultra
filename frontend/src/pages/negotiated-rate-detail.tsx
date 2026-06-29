import * as React from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { Send, X } from "lucide-react"

import { PageBackLink } from "@/components/layout/page-back-link"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getJson, postJson } from "@/lib/api"
import { canReadNegotiatedRates, hasPermission, isSuperuser } from "@/lib/permissions"
import { rateStatusLabel, rateStatusVariant } from "@/components/contractors/rateStatus"
import {
  RateDetailPanel,
  type ContractorRatePublic,
} from "@/components/contractors/ContractorRatesPanel"
/**
 * Single-rate detail page. The page focuses on **one** negotiated rate: header,
 * stepper, savings, rounds, and timeline. It is intentionally NOT scoped to a
 * contractor (no list of other rates) so the user can act on this rate without
 * any contractor-level context bleeding through.
 *
 * Route: ``/dashboard/negotiated-rates/:rateId``
 */
export function NegotiatedRateDetailPage() {
  const params = useParams()
  const rateId = Number(params.rateId)

  const [rate, setRate] = React.useState<ContractorRatePublic | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [actionBusy, setActionBusy] = React.useState(false)

  const canView = canReadNegotiatedRates()
  const canUpdate = hasPermission("contractor_rates.update") || isSuperuser()
  const canCreate = hasPermission("contractor_rates.create") || isSuperuser()

  const load = React.useCallback(async () => {
    if (!Number.isFinite(rateId)) return
    setError(null)
    try {
      const r = await getJson<ContractorRatePublic>(`/contractor-rates/${rateId}`)
      setRate(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rate")
      setRate(null)
    }
  }, [rateId])

  React.useEffect(() => {
    if (canView) void load()
  }, [canView, load])

  async function submitForApproval() {
    if (!rate) return
    setActionBusy(true)
    try {
      await postJson(`/contractor-rates/${rate.id}/submit`, {})
      toast.success("Submitted for approval")
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submit failed")
    } finally {
      setActionBusy(false)
    }
  }

  async function cancelRate() {
    if (!rate) return
    if (!confirm(`Cancel rate #${rate.id}? This cannot be undone.`)) return
    setActionBusy(true)
    try {
      await postJson(`/contractor-rates/${rate.id}/cancel`, {})
      toast.success("Negotiation cancelled")
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed")
    } finally {
      setActionBusy(false)
    }
  }

  if (!canView) {
    return (
      <Alert>
        <AlertTitle>Permission required</AlertTitle>
        <AlertDescription>
          You need <span className="font-mono">contractor_rates.view</span> or{" "}
          <span className="font-mono">contractor_rates.approve</span> to access this page.
        </AlertDescription>
      </Alert>
    )
  }

  if (error && !rate) {
    return (
      <div className="space-y-3">
        <PageBackLink to="/dashboard/negotiated-rates" label="Negotiations" />
        <Alert variant="destructive">
          <AlertTitle>Could not load this negotiation</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!rate) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Loading…</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Fetching negotiation.</CardContent>
      </Card>
    )
  }

  const canSubmit = canCreate && (rate.status === "draft" || rate.status === "rejected")
  const canCancelNow =
    canUpdate && (rate.status === "draft" || rate.status === "pending_approval")

  return (
    <div className="space-y-4 [&_.text-gray-500]:text-foreground [&_.text-gray-600]:text-foreground [&_.text-gray-700]:text-foreground [&_.text-gray-800]:text-foreground [&_.text-muted-foreground]:text-foreground">
      {/* Header / breadcrumb */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageBackLink
            to="/dashboard/negotiated-rates"
            label={rate.part_code ?? `#${rate.id}`}
            className={rate.part_code ? "font-mono" : undefined}
          />
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            <span className="font-mono text-xl">{rate.part_code ?? "—"}</span>
            {rate.part_name ? (
              <>
                <span className="text-muted-foreground"> · </span>
                <span className="text-muted-foreground">{rate.part_name}</span>
              </>
            ) : null}
          </h1>
           <p className="text-xs text-muted-foreground">
                {rate.org_unit_name ?? "—"} · {(rate.pricing_method ?? "").replace(/_/g, " ")} ·{" "}
                {rate.unit_type ?? "—"}
              </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSubmit ? (
            <Button size="sm" onClick={submitForApproval} disabled={actionBusy}>
              <Send className="size-3.5" /> Submit for approval
            </Button>
          ) : null}
          {rate.status === "pending_approval" ? (
            <Badge variant={rateStatusVariant(rate.status)}>{rateStatusLabel(rate.status)}</Badge>
          ) : null}
          {canCancelNow ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={cancelRate}
              disabled={actionBusy}
            >
              <X className="size-3.5" /> Cancel
            </Button>
          ) : null}
        </div>
      </div>

      <RateDetailPanel
        rate={rate}
        canUpdate={canUpdate}
        canCreate={canCreate}
        onAfterMutation={() => void load()}
      />
    </div>
  )
}

export default NegotiatedRateDetailPage
