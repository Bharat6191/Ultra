import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowDown, ArrowLeft, ArrowUp, Building2, CalendarDays, Equal, Handshake, Pencil } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { RateVersionHistoryButton } from "@/components/contractors/RateVersionHistoryDrawer"
import { formatMoney, formatPercent } from "@/components/contractors/rateStatus"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ApiError, getJson } from "@/lib/api"
import { hasPermission, isSuperuser } from "@/lib/permissions"

type RateMasterPublic = {
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
  created_at: string
  updated_at: string
}

type RateCardNegotiation = {
  contractor_id: number
  contractor_name: string
  contractor_rate_id: number
  negotiated_rate: string
  contractor_rate_status: string | null
  vs_base_amount: string | null
  vs_base_percentage: string | null
}

type RateCardRowLite = {
  rate_master_id: number
  negotiations: RateCardNegotiation[]
}

function negotiationStatusClass(status: string | null | undefined): string {
  switch (status) {
    case "active":
      return "border-0 bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
    case "upcoming":
      return "border-0 bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200"
    case "expired":
      return "border-0 bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
    case "draft":
      return "border-0 bg-zinc-100 text-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100"
    case "pending_approval":
      return "border-0 bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
    case "rejected":
    case "cancelled":
      return "border-0 bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200"
    default:
      return ""
  }
}

function VsBaseCell({ amount, percent }: { amount: string | null; percent: string | null }) {
  if (amount === null || percent === null) return <span className="text-muted-foreground">—</span>
  const amt = Number(amount)
  const isSaving = amt < 0
  const isPremium = amt > 0
  const Icon = isSaving ? ArrowDown : isPremium ? ArrowUp : Equal
  const cls = isSaving
    ? "text-emerald-700 dark:text-emerald-300"
    : isPremium
      ? "text-rose-700 dark:text-rose-300"
      : "text-muted-foreground"
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${cls}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{formatMoney(amount)}</span>
      <span className="text-xs">({formatPercent(percent)})</span>
    </span>
  )
}

/**
 * Single base-rate screen. Route: ``/dashboard/rate-master/:rateMasterId``
 */
export function RateMasterDetailPage() {
  const params = useParams()
  const rateMasterId = Number(params.rateMasterId)

  const [rate, setRate] = React.useState<RateMasterPublic | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [negotiations, setNegotiations] = React.useState<RateCardNegotiation[]>([])
  const [negLoading, setNegLoading] = React.useState(false)
  const [negError, setNegError] = React.useState<string | null>(null)

  const canView = hasPermission("rate_master.view") || isSuperuser()
  const canUpdate = hasPermission("rate_master.update") || isSuperuser()
  const canOpenNegotiation =
    hasPermission("contractor_rates.view") || isSuperuser()
  const canViewContractor = hasPermission("contractor.view") || isSuperuser()

  const load = React.useCallback(async () => {
    if (!Number.isFinite(rateMasterId)) return
    setError(null)
    try {
      const r = await getJson<RateMasterPublic>(`/rate-master/${rateMasterId}`)
      setRate(r)
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to load rate"
      setError(msg)
      setRate(null)
    }
  }, [rateMasterId])

  React.useEffect(() => {
    if (canView) void load()
  }, [canView, load])

  React.useEffect(() => {
    if (!rate || !canView) return
    let cancelled = false
    setNegLoading(true)
    setNegError(null)
    void (async () => {
      try {
        const rows = await getJson<RateCardRowLite[]>(
          `/rate-card?rate_master_id=${rate.id}&active_base_only=false`,
        )
        if (cancelled) return
        const row = rows.find((x) => x.rate_master_id === rate.id) ?? rows[0]
        setNegotiations(row?.negotiations ?? [])
      } catch (e) {
        if (!cancelled) {
          setNegError(e instanceof Error ? e.message : "Failed to load negotiated rates")
          setNegotiations([])
        }
      } finally {
        if (!cancelled) setNegLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [rate, canView])

  if (!canView) {
    return (
      <Alert>
        <AlertTitle>Permission required</AlertTitle>
        <AlertDescription>
          You need <span className="font-mono">rate_master.view</span> to open this page.
        </AlertDescription>
      </Alert>
    )
  }

  if (error && !rate) {
    return (
      <div className="space-y-3">
        <Link
          to="/dashboard/rate-master"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back to rate master
        </Link>
        <Alert variant="destructive">
          <AlertTitle>Could not load this base rate</AlertTitle>
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
        <CardContent className="text-sm text-muted-foreground">Fetching base rate.</CardContent>
      </Card>
    )
  }

  const skillLabel = (rate.skill_type ?? "").replace(/_/g, " ")

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/dashboard/rate-master"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Back to rate master
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {rate.job_type}
            {skillLabel ? (
              <>
                <span className="text-muted-foreground"> · </span>
                <span className="capitalize text-muted-foreground">{skillLabel}</span>
              </>
            ) : null}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Building2 className="size-3.5" />
              {rate.org_unit_name ?? `Plant #${rate.org_unit_id}`}
            </span>
            <span>· per {rate.unit}</span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5" />
              {rate.effective_from}
              {rate.effective_to ? ` → ${rate.effective_to}` : " → open"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={rate.is_active ? "success" : "secondary"}>
            {rate.is_active ? "Active base" : "Inactive base"}
          </Badge>
          <RateVersionHistoryButton
            resource="rate-master"
            parentId={rate.id}
            title={`${rate.job_type} (${rate.skill_type})`}
            subtitle={`${rate.org_unit_name ?? `Plant #${rate.org_unit_id}`} · ${rate.unit}`}
          />
          {canUpdate ? (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/dashboard/rate-master?highlight=${rate.id}`}>
                <Pencil className="mr-1 size-3.5" /> Edit on grid
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Baseline</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs font-medium text-muted-foreground">Base rate</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums">
              {formatMoney(rate.base_rate)}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground">Plant ID</div>
            <div className="mt-0.5">{rate.org_unit_id}</div>
          </div>
          {rate.notes ? (
            <div className="sm:col-span-2">
              <div className="text-xs font-medium text-muted-foreground">Notes</div>
              <div className="mt-0.5 whitespace-pre-wrap">{rate.notes}</div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Handshake className="size-4 opacity-70" />
            Negotiated rates by contractor
          </CardTitle>
          <CardDescription>
            Compared to this baseline ({formatMoney(rate.base_rate)} per {rate.unit}).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {negError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load negotiations</AlertTitle>
              <AlertDescription>{negError}</AlertDescription>
            </Alert>
          ) : null}
          {negLoading ? (
            <p className="text-sm text-muted-foreground">Loading contractor rates…</p>
          ) : negotiations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No negotiated rates are linked to this base row yet.{" "}
              <Link to="/dashboard/negotiated-rates" className="font-medium underline underline-offset-2">
                Negotiated rates
              </Link>
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contractor</TableHead>
                    <TableHead className="text-right">Negotiated rate</TableHead>
                    <TableHead>vs baseline</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right"> </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {negotiations.map((n) => (
                    <TableRow key={n.contractor_rate_id}>
                      <TableCell className="font-medium">
                        {canViewContractor ? (
                          <Link
                            to={`/dashboard/contractors/${n.contractor_id}`}
                            className="hover:underline"
                          >
                            {n.contractor_name}
                          </Link>
                        ) : (
                          <span>{n.contractor_name}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(n.negotiated_rate)}
                      </TableCell>
                      <TableCell>
                        <VsBaseCell amount={n.vs_base_amount} percent={n.vs_base_percentage} />
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`rounded-md capitalize ${negotiationStatusClass(n.contractor_rate_status)}`}
                        >
                          {(n.contractor_rate_status ?? "—").replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canOpenNegotiation ? (
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/dashboard/negotiated-rates/${n.contractor_rate_id}`}>
                              Open
                            </Link>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default RateMasterDetailPage
