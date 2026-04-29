import * as React from "react"
import { useParams } from "react-router-dom"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ContractorDocuments, type ContractorDocument } from "@/components/contractors/ContractorDocuments"
import { ContractorHeader } from "@/components/contractors/ContractorHeader"
import { ContractorOverview } from "@/components/contractors/ContractorOverview"
import { ContractorTimeline } from "@/components/contractors/ContractorTimeline"
import { getJson } from "@/lib/api"

type ContractorPublic = {
  id: number
  name: string
  contact_person: string | null
  email: string | null
  phone: string | null
  address: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export function ContractorDetailPage() {
  const params = useParams()
  const id = Number(params.id)

  const [contractor, setContractor] = React.useState<ContractorPublic | null>(null)
  const [docs, setDocs] = React.useState<ContractorDocument[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

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
      <ContractorHeader name={contractor.name} isActive={contractor.is_active} />

      {error ? <div className="text-sm text-destructive">{error}</div> : null}

      <Tabs defaultValue="overview">
        <TabsList variant="default">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <ContractorOverview contractor={contractor} />
        </TabsContent>

        <TabsContent value="documents">
          <ContractorDocuments contractorId={contractor.id} warnDays={7} />
        </TabsContent>

        <TabsContent value="timeline">
          <ContractorTimeline
            contractor={{ id: contractor.id, created_at: contractor.created_at, name: contractor.name }}
            documents={(docs ?? []).map((d) => ({
              created_at: d.created_at,
              document_name: d.document_name,
              document_type: d.document_type,
            }))}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

