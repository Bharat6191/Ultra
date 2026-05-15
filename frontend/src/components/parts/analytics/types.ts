/** Types for GET /part-master/{id}/analytics/* */

export type PartAnalyticsFilters = {
  date_from?: string
  date_to?: string
  plant_id?: string
  contractor_id?: string
  work_order_status?: string
  negotiation_status?: string
}

export type KpiCard = { key: string; label: string; value: number | string; tone: string }

export type PartMasterHeaderBlock = {
  part_master_id: number
  part_code: string
  part_name: string
  description: string | null
  part_category: string
  part_type: string
  unit_of_measurement: string
  weight_per_unit: string | number | null
  base_rate: string | number
  is_active: boolean
  record_status: string
  home_plant_name: string | null
  plant_names_used: string[]
  plant_filter_options: { id: number; name: string }[]
  total_contractors_touching: number
  active_contractors: number
  total_negotiation_records: number
  total_active_work_orders: number
  lowest_negotiated_rate: string | number | null
  highest_negotiated_rate: string | number | null
  average_negotiated_rate: string | number | null
}

export type PartMasterAnalyticsSummary = {
  header: PartMasterHeaderBlock
  kpis: KpiCard[]
}

export type PartContractorComparisonRow = {
  contractor_id: number
  contractor_name: string
  contractor_code: string | null
  contractor_rate_id: number
  base_rate: string | number
  initial_rate: string | number | null
  final_negotiated_rate: string | number
  savings_pct: string | number | null
  premium_above_base_pct: string | number
  effective_from: string
  effective_to: string | null
  status: string
  rounds: number
  last_negotiation_at: string | null
  approved_by_name: string | null
  active_work_orders: number
  total_work_order_value: string | number
}

export type PartContractorsAnalytics = {
  rows: PartContractorComparisonRow[]
  bar_by_contractor: { name: string; negotiated_rate: number; base_rate: number }[]
  negotiation_trend: { period: string; count: number; avg_negotiated: string | number | null }[]
  scatter_volume: { contractor_id: number; name: string; work_orders: number; negotiated_rate: number }[]
  premium_heatmap: { contractor: string; premium_pct: number; negotiated_rate: number }[]
  leaderboard: Record<string, { contractor_id?: number; name?: string; rate?: number; work_orders?: number; savings_amount?: number } | null>
}

export type PartNegotiationBundle = {
  status_counts: Record<string, number>
  trend: { period: string; count: number; avg_negotiated: string | number | null }[]
}

export type PartWorkOrderMonthly = { month: string; created: number; completed: number; quantity: string | number }

export type PartWorkOrderRow = {
  work_order_id: number
  work_order_number: string
  contractor_id: number
  contractor_name: string
  quantity: string | number
  wo_value: string | number
  invoiced_value: string | number
  pending_value: string | number
  status: string
  completion_pct: string | number | null
  start_date: string | null
  end_date: string | null
}

export type PartWorkOrderAnalytics = {
  totals_by_status: Record<string, number>
  by_plant: { plant_id: number; plant_name: string; count: number; value: number }[]
  by_contractor: { contractor_id: number; contractor_name: string; count: number; value: number }[]
  by_month: PartWorkOrderMonthly[]
  total_wo_value: string | number
  total_invoiced_for_part: string | number
  pending_invoice_amount_for_part: string | number
  donut_status: { name: string; value: number }[]
  value_trend: { month: string; value: number }[]
  qty_trend: { month: string; quantity: number }[]
  total_consumption_qty: string | number
  avg_order_quantity: string | number | null
  rows: PartWorkOrderRow[]
}

export type PartCommercialInsights = {
  lowest_negotiated_rate: string | number | null
  highest_negotiated_rate: string | number | null
  average_market_negotiated_rate: string | number | null
  spread_low_high: string | number | null
  total_savings_through_negotiation: string | number
  total_extra_above_base: string | number
  highest_premium_contractor_name: string | null
  best_value_contractor_name: string | null
  pct_rates_below_base: string | number
  pct_rates_above_base: string | number
  risk_level: string
  insight_lines: string[]
  cost_trend: { month: string; avg_rate: number }[]
}

export type PartCompetitionRow = {
  contractor_id: number
  contractor_name: string
  rate_rank: number
  work_order_count: number
  completion_rate_pct: string | number | null
  negotiation_success_pct: string | number | null
  pending_approvals: number
  avg_rounds: string | number | null
}

export type PartCompetitionAnalytics = { rows: PartCompetitionRow[] }

export type PendingItem = {
  kind: string
  severity: string
  title: string
  detail: string | null
  href_hint: string | null
  entity_id: number | null
}

export type PendingActions = { items: PendingItem[] }

export type AnalyticsTimelineEvent = {
  category: string
  type: string
  title: string
  description: string | null
  timestamp: string
  metadata?: Record<string, unknown> | null
}
