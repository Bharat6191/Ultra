import { pdf } from "@react-pdf/renderer"
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { getBlob } from "@/lib/api"
import type {
  CommercialInsights,
  ContractorAnalyticsSummary,
  NegotiationAnalytics,
  WorkOrderAnalytics,
} from "@/components/contractors/analytics/types"

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica" },
  h1: { fontSize: 18, marginBottom: 8 },
  h2: { fontSize: 12, marginTop: 12, marginBottom: 4 },
  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: "40%", color: "#444" },
  val: { width: "60%" },
  small: { fontSize: 8, color: "#666", marginTop: 16 },
})

function buildQuery(q: Record<string, string | undefined>): string {
  const p = new URLSearchParams()
  Object.entries(q).forEach(([k, v]) => {
    if (v) p.set(k, v)
  })
  const s = p.toString()
  return s ? `?${s}` : ""
}

export function ContractorReportExport({
  contractorId,
  filters,
  summary,
  neg,
  wo,
  commercial,
}: {
  contractorId: number
  filters: {
    date_from?: string
    date_to?: string
    plant_id?: string
    work_order_status?: string
    negotiation_status?: string
    part_search?: string
  }
  summary: ContractorAnalyticsSummary | null
  neg: NegotiationAnalytics | null
  wo: WorkOrderAnalytics | null
  commercial: CommercialInsights | null
}) {
  const q = buildQuery({
    date_from: filters.date_from,
    date_to: filters.date_to,
    plant_id: filters.plant_id,
    work_order_status: filters.work_order_status,
    negotiation_status: filters.negotiation_status,
    part_search: filters.part_search,
  })

  async function downloadExcel() {
    try {
      const blob = await getBlob(`/contractors/${contractorId}/analytics/report${q}`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `contractor-${contractorId}-analytics.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast.success("Excel report downloaded")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed")
    }
  }

  async function downloadPdf() {
    if (!summary || !neg || !wo || !commercial) {
      toast.error("Load analytics before exporting PDF")
      return
    }
    try {
    const genAt = new Date().toISOString()
    let userLine = ""
    try {
      const raw = localStorage.getItem("auth_profile")
      if (raw) {
        const p = JSON.parse(raw) as { email?: string }
        if (p.email) userLine = p.email
      }
    } catch {
      /* ignore */
    }
    const doc = (
      <Document>
        <Page size="A4" style={styles.page}>
          <Text style={styles.h1}>Contractor analytics report</Text>
          <Text style={styles.h2}>Profile</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Name</Text>
            <Text style={styles.val}>{summary.name}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Code</Text>
            <Text style={styles.val}>{summary.contractor_code ?? "—"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Status</Text>
            <Text style={styles.val}>{summary.status}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Plants</Text>
            <Text style={styles.val}>{summary.plant_names.join(", ") || "—"}</Text>
          </View>
          <Text style={styles.h2}>KPI snapshot</Text>
          {summary.kpis.slice(0, 12).map((k) => (
            <View key={k.key} style={styles.row}>
              <Text style={styles.label}>{k.label}</Text>
              <Text style={styles.val}>{String(k.value)}</Text>
            </View>
          ))}
          <Text style={styles.h2}>Commercial</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Risk level</Text>
            <Text style={styles.val}>{commercial.risk_level}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Total savings</Text>
            <Text style={styles.val}>{String(commercial.total_savings_generated)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>% above base</Text>
            <Text style={styles.val}>{String(commercial.pct_negotiations_above_base)}</Text>
          </View>
          <Text style={styles.h2}>Negotiations ({neg.rows.length})</Text>
          {neg.rows.slice(0, 40).map((r) => (
            <View key={r.contractor_rate_id} style={styles.row}>
              <Text style={styles.label}>{r.part_code}</Text>
              <Text style={styles.val}>
                {r.status} · neg {String(r.negotiated_rate)} · base {String(r.base_rate)}
              </Text>
            </View>
          ))}
          <Text style={styles.h2}>Work orders</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Total value</Text>
            <Text style={styles.val}>{String(wo.total_wo_value)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Invoiced</Text>
            <Text style={styles.val}>{String(wo.total_invoiced)}</Text>
          </View>
          <Text style={styles.small}>
            Generated {genAt}
            {userLine ? ` · ${userLine}` : ""}. Charts are included in the web dashboard and Excel export.
          </Text>
        </Page>
      </Document>
    )
    const blob = await pdf(doc).toBlob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `contractor-${contractorId}-analytics.pdf`
    a.click()
    URL.revokeObjectURL(url)
    toast.success("PDF report downloaded")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF export failed")
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => void downloadExcel()}>
        Download Excel
      </Button>
      <Button type="button" size="sm" onClick={() => void downloadPdf()}>
        Download PDF
      </Button>
    </div>
  )
}
