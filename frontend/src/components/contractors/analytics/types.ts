/** Mirrors ``modules/contractor/analytics_schema.py`` JSON (snake_case). */

export type KpiCard = {
  key: string
  label: string
  value: number | string
  tone: string
}

export type ContractorAnalyticsSummary = {
  contractor_id: number
  name: string
  contractor_code: string | null
  status: string
  is_active: boolean
  plant_names: string[]
  plants: { id: number; name: string }[]
  active_since: string | null
  total_active_work_orders: number
  distinct_negotiated_parts: number
  approved_negotiations: number
  overall_savings_vs_initial: string | number
  overall_premium_above_base: string | number
  kpis: KpiCard[]
}

export type NegotiationRow = {
  contractor_rate_id: number
  part_master_id: number
  part_code: string
  part_name: string
  status: string
  base_rate: string | number
  negotiated_rate: string | number
  initial_rate: string | number | null
  savings_amount: string | number | null
  savings_percentage: string | number | null
  premium_above_base: string | number
  rounds: number
  effective_from: string
  effective_to: string | null
  approved_at: string | null
}

export type NegotiationAnalytics = {
  rows: NegotiationRow[]
  status_counts: Record<string, number>
  bar_chart_parts: { part_code: string; base_rate: number; negotiated_rate: number }[]
  trend: { period: string; count: number; avg_negotiated: string | number | null }[]
  premium_ranking: { part_code: string; premium_above_base: number }[]
}

export type WorkOrderAnalytics = {
  totals_by_status: Record<string, number>
  by_plant: { plant_id: number; plant_name: string; count: number; value: string | number }[]
  by_month: { month: string; created: number; completed: number }[]
  total_wo_value: string | number
  total_invoiced: string | number
  pending_invoice_amount: string | number
  donut_status: { name: string; value: number }[]
  value_trend: { month: string; value: number }[]
}

export type CommercialInsights = {
  avg_premium_above_base: string | number | null
  avg_negotiation_reduction_pct: string | number | null
  total_savings_generated: string | number
  highest_premium_part_code: string | null
  highest_premium_amount: string | number | null
  highest_savings_part_code: string | null
  highest_savings_amount: string | number | null
  pct_negotiations_above_base: string | number
  pct_negotiations_below_base: string | number
  risk_level: string
}

export type PendingItem = {
  kind: string
  severity: string
  title: string
  detail: string | null
  href_hint: string | null
  entity_id: number | null
}

export type PendingActions = {
  items: PendingItem[]
}

export type AnalyticsTimelineEvent = {
  category: string
  type: string
  title: string
  description: string | null
  timestamp: string
  metadata: Record<string, unknown> | null
}
