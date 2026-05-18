import * as React from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ContractorDocuments, type ContractorDocument } from "@/components/contractors/ContractorDocuments"
import { ContractorHeader } from "@/components/contractors/ContractorHeader"
import { ContractorOverview } from "@/components/contractors/ContractorOverview"
import { ContractorPlants } from "@/components/contractors/ContractorPlants"
import { ContractorTimeline } from "@/components/contractors/ContractorTimeline"
import { ContractorAnalyticsDashboard } from "@/components/contractors/analytics/ContractorAnalyticsDashboard"
import { getJson, patchJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"

type Compliance = {
  state: "compliant" | "warning" | "non_compliant" | "no_data"
  expired_documents: number
  expiring_soon: number
  pending_verification: number
  missing_critical_types: string[]
  next_expiry: string | null
}

type ContractorInvoiceAnalytics = {
  tolerance_pct_config: number
  invoices_total: number
  invoices_blocked: number
  pending_variance_approvals: number
  variance_issues_tracked: number
  average_variance_pct: number | null
  overbilling_invoice_count: number
  invoice_accuracy_score: number | null
  approval_dependency_rate: number | null
  tolerance_usage_pressure_pct: number | null
}

type ContractorPublic = {
  id: number
  contractor_code: string | null
  name: string
  legal_name: string | null
  trade_name: string | null
  pan: string | null
  gstin: string | null
  cin: string | null
  contractor_type: string | null
  status: string
  contact_person: string | null
  contact_person_title: string | null
  email: string | null
  alternate_email: string | null
  phone: string | null
  alternate_phone: string | null
  address: string | null
  city: string | null
  state: string | null
  country: string | null
  postal_code: string | null
  gst_number: string | null
  pan_number: string | null
  registration_number: string | null
  website: string | null
  notes: string | null
  is_active: boolean
  plant_count: number
  compliance: Compliance | null
  invoice_compliance_score?: number | null
  invoice_analytics?: ContractorInvoiceAnalytics | null
  created_by: number | null
  updated_by: number | null
  created_at: string
  updated_at: string
}

export function ContractorDetailPage() {
  const navigate = useNavigate()
  const params = useParams()
  const id = Number(params.id)
  const [searchParams, setSearchParams] = useSearchParams()

  const [contractor, setContractor] = React.useState<ContractorPublic | null>(null)
  const [docs, setDocs] = React.useState<ContractorDocument[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const warnDays = 7

  const canEdit = hasPermission("contractor.update")
  const canActivate = hasPermission("contractor.activate") || hasPermission("contractor.update")

  const rawTab = (searchParams.get("tab") ?? "dashboard").toLowerCase()
  const allowedTabs = ["dashboard", "overview", "documents", "plants", "timeline"] as const
  const tabValue: string = (allowedTabs as readonly string[]).includes(rawTab) ? rawTab : "overview"

  React.useEffect(() => {
    if (searchParams.get("edit") === "1" && Number.isFinite(id) && id > 0) {
      navigate(`/dashboard/contractors/${id}/edit`, { replace: true })
    }
  }, [searchParams, id, navigate])

  async function loadContractor() {
    setError(null)
    try {
      const c = await getJson<ContractorPublic>(`/contractors/${id}`)
      setContractor(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contractor")
      setContractor(null)
    }
  }

  async function loadDocs() {
    try {
      const d = await getJson<ContractorDocument[]>(`/contractors/${id}/documents`)
      setDocs(d)
    } catch {
      setDocs([])
    }
  }

  React.useEffect(() => {
    if (!Number.isFinite(id) || id <= 0) {
      setError("Invalid contractor id")
      return
    }
    void loadContractor()
    void loadDocs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function changeStatus(status: string, reason?: string) {
    if (!contractor) return
    try {
      const updated = await patchJson<ContractorPublic>(`/contractors/${contractor.id}/status`, {
        status,
        reason: reason || null,
      })
      setContractor(updated)
      toast.success(`Status updated to ${updated.status}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to change status")
    }
  }

  if (!contractor && error) {
    return (
      <Card className="border-destructive/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Unable to load contractor</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-destructive">{error}</CardContent>
      </Card>
    )
  }

  if (!contractor) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Loading…</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Fetching contractor details.</CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-6">
      <ContractorHeader
        name={contractor.name}
        legalName={contractor.legal_name}
        contractorCode={contractor.contractor_code}
        contractorType={contractor.contractor_type}
        status={contractor.status}
        complianceState={contractor.compliance?.state ?? null}
        isActive={contractor.is_active}
        canEdit={canEdit}
        canActivate={canActivate}
        onEdit={() => navigate(`/dashboard/contractors/${contractor.id}/edit`)}
        onActivate={() => void changeStatus("active")}
        onSuspend={() => void changeStatus("suspended", "Suspended via Detail page")}
        onBlacklist={() => void changeStatus("blacklisted", "Blacklisted via Detail page")}
      />
      {error ? <div className="text-sm text-destructive">{error}</div> : null}

      <Tabs
        value={tabValue}
        onValueChange={(v) => {
          const next = new URLSearchParams(searchParams)
          if (v === "dashboard") next.delete("tab")
          else if (v === "overview") next.set("tab", "overview")
          else next.set("tab", v)
          next.delete("focus")
          setSearchParams(next, { replace: true })
        }}
        className="gap-4"
      >
        <TabsList variant="line" className="rounded-2xl bg-white p-2 shadow-sm">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="plants">Plants</TabsTrigger>
          <TabsTrigger value="timeline">Timeline & activity</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <ContractorAnalyticsDashboard contractorId={contractor.id} />
        </TabsContent>

        <TabsContent value="overview">
          <ContractorOverview contractor={contractor} />
        </TabsContent>

        <TabsContent value="documents">
          <ContractorDocuments
            contractorId={contractor.id}
            warnDays={warnDays}
            documents={docs}
            onRefresh={async () => {
              await loadDocs()
              await loadContractor()
            }}
          />
        </TabsContent>

        <TabsContent value="plants">
          <ContractorPlants contractorId={contractor.id} />
        </TabsContent>

        <TabsContent value="timeline">
          <ContractorTimeline contractorId={contractor.id} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
