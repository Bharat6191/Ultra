import { pdf } from "@react-pdf/renderer"
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { getBlob, getJson } from "@/lib/api"
import type {
  PartAnalyticsFilters,
  PartCommercialInsights,
  PartContractorsAnalytics,
  PartMasterAnalyticsSummary,
  PartWorkOrderAnalytics,
} from "@/components/parts/analytics/types"

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica" },
  h1: { fontSize: 16, marginBottom: 6 },
  h2: { fontSize: 11, marginTop: 10, marginBottom: 3 },
  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: "42%", color: "#444" },
  val: { width: "58%" },
  small: { fontSize: 7, color: "#666", marginTop: 12 },
})

function buildQuery(q: Record<string, string | undefined>): string {
  const p = new URLSearchParams()
  Object.entries(q).forEach(([k, v]) => {
    if (v) p.set(k, v)
  })
  const s = p.toString()
  return s ? `?${s}` : ""
}

export function PartReportExport({
  partMasterId,
  filters,
}: {
  partMasterId: number
  filters: PartAnalyticsFilters
}) {
  const q = buildQuery({
    date_from: filters.date_from,
    date_to: filters.date_to,
    plant_id: filters.plant_id,
    contractor_id: filters.contractor_id,
    work_order_status: filters.work_order_status,
    negotiation_status: filters.negotiation_status,
  })

  async function downloadExcel() {
    try {
      const blob = await getBlob(`/part-master/${partMasterId}/analytics/report${q}`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `part-master-${partMasterId}-analytics.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast.success("Excel report downloaded")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed")
    }
  }

  async function downloadPdf() {
    try {
      const base = `/part-master/${partMasterId}/analytics`
      const [summary, ctr, wo, com] = await Promise.all([
        getJson<PartMasterAnalyticsSummary>(`${base}/summary${q}`),
        getJson<PartContractorsAnalytics>(`${base}/contractors${q}`),
        getJson<PartWorkOrderAnalytics>(`${base}/work-orders${q}`),
        getJson<PartCommercialInsights>(`${base}/commercial${q}`),
      ])
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
      const h = summary.header
      const doc = (
        <Document>
          <Page size="A4" style={styles.page}>
            <Text style={styles.h1}>Part intelligence report</Text>
            <Text style={styles.h2}>Part profile</Text>
            <View style={styles.row}>
              <Text style={styles.label}>Part number</Text>
              <Text style={styles.val}>{h.part_code}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Name</Text>
              <Text style={styles.val}>{h.part_name}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Base rate</Text>
              <Text style={styles.val}>{String(h.base_rate)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Plants in use</Text>
              <Text style={styles.val}>{h.plant_names_used.join(", ") || "—"}</Text>
            </View>
            <Text style={styles.h2}>KPI snapshot</Text>
            {summary.kpis.slice(0, 14).map((k) => (
              <View key={k.key} style={styles.row}>
                <Text style={styles.label}>{k.label}</Text>
                <Text style={styles.val}>{String(k.value)}</Text>
              </View>
            ))}
            <Text style={styles.h2}>Commercial</Text>
            <View style={styles.row}>
              <Text style={styles.label}>Risk</Text>
              <Text style={styles.val}>{com.risk_level}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Spread low–high</Text>
              <Text style={styles.val}>{String(com.spread_low_high ?? "—")}</Text>
            </View>
            {com.insight_lines.slice(0, 6).map((line, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.label}>Insight</Text>
                <Text style={styles.val}>{line}</Text>
              </View>
            ))}
            <Text style={styles.h2}>Contractor rates ({ctr.rows.length})</Text>
            {ctr.rows.slice(0, 35).map((r) => (
              <View key={r.contractor_rate_id} style={styles.row}>
                <Text style={styles.label}>{r.contractor_name}</Text>
                <Text style={styles.val}>
                  {r.status} · neg {String(r.final_negotiated_rate)} · base {String(r.base_rate)}
                </Text>
              </View>
            ))}
            <Text style={styles.h2}>Work orders</Text>
            <View style={styles.row}>
              <Text style={styles.label}>Total WO value</Text>
              <Text style={styles.val}>{String(wo.total_wo_value)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Invoiced (part lines)</Text>
              <Text style={styles.val}>{String(wo.total_invoiced_for_part)}</Text>
            </View>
            <Text style={styles.small}>
              Generated {genAt}
              {userLine ? ` · ${userLine}` : ""}. Charts are on the web dashboard and in Excel.
            </Text>
          </Page>
        </Document>
      )
      const blob = await pdf(doc).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `part-master-${partMasterId}-analytics.pdf`
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
