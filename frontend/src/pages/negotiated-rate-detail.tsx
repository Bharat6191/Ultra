import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { ArrowLeft, Building2, CalendarDays, Send, X } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getJson, postJson } from "@/lib/api"
import { hasPermission, isSuperuser } from "@/lib/permissions"
import {
  rateStatusLabel,
  rateStatusVariant,
} from "@/components/contractors/rateStatus"
import {
  RateDetailPanel,
  type ContractorRatePublic,
} from "@/components/contractors/ContractorRatesPanel"
import { RateVersionHistoryButton } from "@/components/contractors/RateVersionHistoryDrawer"

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

  const canView = hasPermission("contractor_rates.view") || isSuperuser()
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
          You need <span className="font-mono">contractor_rates.view</span> to access this page.
        </AlertDescription>
      </Alert>
    )
  }

  if (error && !rate) {
    return (
      <div className="space-y-3">
        <Link
          to="/dashboard/negotiated-rates"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back to negotiated rates
        </Link>
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

  const partSubtitle = [rate.pricing_method, rate.unit_type].filter(Boolean).join(" · ")
  const canSubmit = canCreate && (rate.status === "draft" || rate.status === "rejected")
  const canCancelNow =
    canUpdate && (rate.status === "draft" || rate.status === "pending_approval")

  return (
    <div className="space-y-4">
      {/* Header / breadcrumb */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/dashboard/negotiated-rates"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Back to negotiated rates
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            <span className="font-mono text-xl">{rate.part_code ?? "—"}</span>
            {rate.part_name ? (
              <>
                <span className="text-muted-foreground"> · </span>
                <span className="text-muted-foreground">{rate.part_name}</span>
              </>
            ) : null}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Building2 className="size-3.5" />
              {rate.contractor_name ? (
                <Link
                  to={`/dashboard/contractors/${rate.contractor_id}`}
                  className="text-foreground underline-offset-2 hover:underline"
                >
                  {rate.contractor_name}
                </Link>
              ) : (
                `Contractor #${rate.contractor_id}`
              )}
            </span>
            <span>· {rate.org_unit_name ?? "—"}</span>
            {partSubtitle ? <span className="capitalize">· {partSubtitle.replace(/_/g, " ")}</span> : null}
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5" />
              {rate.effective_from}
              {rate.effective_to ? ` → ${rate.effective_to}` : " → open"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={rateStatusVariant(rate.status)}>{rateStatusLabel(rate.status)}</Badge>
          <RateVersionHistoryButton
            resource="contractor-rates"
            parentId={rate.id}
            title={`${rate.part_code ?? "Part"} · ${rate.contractor_name ?? `#${rate.contractor_id}`}`}
            subtitle={`${rate.org_unit_name ?? "—"}${partSubtitle ? ` · ${partSubtitle.replace(/_/g, " ")}` : ""}`}
          />
          {canSubmit ? (
            <Button size="sm" onClick={submitForApproval} disabled={actionBusy}>
              <Send className="size-3.5" /> Submit for approval
            </Button>
          ) : null}
          {canCancelNow ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={cancelRate}
              disabled={actionBusy}
            >
              <X className="size-3.5" /> Cancel
            </Button>
          ) : null}
        </div>
      </div>

      <RateDetailPanel rate={rate} canUpdate={canUpdate} />
    </div>
  )
}

export default NegotiatedRateDetailPage
