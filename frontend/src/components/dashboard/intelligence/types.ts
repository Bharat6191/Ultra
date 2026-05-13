export type SparkSeries = { period: string; value: number }

export type ExecutiveBlock = {
  active_contractors?: number
  work_orders_total?: number
  work_orders_active?: number
  work_orders_pending?: number
  work_orders_completed?: number
  invoice_total_value?: number
  invoice_pending_value?: number
  invoice_approved_value?: number
  invoice_rejected_value?: number
  negotiations_total?: number
  negotiations_pending?: number
  negotiation_savings_total?: number
  premium_above_base_total?: number
  pending_approval_tasks?: number
  expiring_rates_30d?: number
  monthly_spend_current?: number
  monthly_spend_previous?: number
  monthly_savings_current?: number
  monthly_savings_previous?: number
  sparklines?: {
    work_orders_created?: SparkSeries[]
    invoice_spend?: SparkSeries[]
    negotiations_created?: SparkSeries[]
  }
}

export type DashboardIntelligenceResponse = {
  enabled: boolean
  message?: string
  filters?: Record<string, string | number | null | undefined>
  executive?: ExecutiveBlock
  operations?: {
    donut_status?: { name: string; value: number }[]
    monthly_trend?: { month: string; created: number; completed: number }[]
    plant_workload?: { name: string; count: number }[]
    contractor_allocation?: { name: string; count: number }[]
    pending_aging?: { bucket: string; count: number }[]
    insights?: string[]
  }
  negotiations?: {
    funnel?: Record<string, number>
    trend?: { month: string; count: number }[]
    savings_vs_premium?: { month: string; savings: number; premium: number }[]
    top_premium_contractors?: { name: string; premium: number }[]
    top_savings_contractors?: { name: string; savings: number }[]
    top_negotiated_parts?: { part_code: string; count: number }[]
    top_savings_parts?: { part_code: string; savings: number }[]
    insights?: string[]
  }
  financial?: {
    status_amounts?: { name: string; value: number }[]
    plant_spend?: { name: string; value: number }[]
    contractor_spend?: { name: string; value: number }[]
    monthly_spend_trend?: { month: string; value: number }[]
    savings_vs_spend_trend?: { month: string; spend: number; savings: number }[]
    invoice_approval_aging?: { bucket: string; count: number }[]
    alerts?: string[]
  }
  parts?: {
    top_by_lines?: { part_code: string; lines: number; value: number }[]
  }
  contractor_intel?: {
    top_work_orders?: { name: string; count: number }[]
    top_premium?: { name: string; premium: number }[]
    top_savings?: { name: string; savings: number }[]
    top_invoice_spend?: { name: string; value: number }[]
  }
  pending_actions?: {
    kind: string
    severity: string
    title: string
    detail?: string
    href?: string
  }[]
  timeline?: { at: string; type: string; title: string; subtitle?: string }[]
}
