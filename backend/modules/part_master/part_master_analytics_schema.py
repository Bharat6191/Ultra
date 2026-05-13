"""Pydantic shapes for ``GET /part-master/{id}/analytics/*`` payloads."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from modules.contractor.analytics_schema import (
    AnalyticsTimelineEvent,
    NegotiationTrendPoint,
)


class PartAnalyticsFilters(BaseModel):
    """Optional filters for part-level analytics (work orders + rates)."""

    date_from: date | None = None
    date_to: date | None = None
    plant_id: int | None = Field(default=None, ge=1)
    contractor_id: int | None = Field(default=None, ge=1)
    work_order_status: str | None = None
    negotiation_status: str | None = None


class KpiCard(BaseModel):
    key: str
    label: str
    value: Decimal | int | str
    tone: str = "neutral"


class PartMasterHeaderBlock(BaseModel):
    part_master_id: int
    part_code: str
    part_name: str
    description: str | None
    part_category: str  # pricing_method label for UI
    part_type: str  # rate_unit_type
    unit_of_measurement: str  # unit_type
    weight_per_unit: Decimal | None
    base_rate: Decimal
    is_active: bool
    record_status: str
    home_plant_name: str | None
    plant_names_used: list[str]
    plant_filter_options: list[dict[str, Any]] = Field(default_factory=list)
    total_contractors_touching: int
    active_contractors: int
    total_negotiation_records: int
    total_active_work_orders: int
    lowest_negotiated_rate: Decimal | None
    highest_negotiated_rate: Decimal | None
    average_negotiated_rate: Decimal | None


class PartMasterAnalyticsSummary(BaseModel):
    header: PartMasterHeaderBlock
    kpis: list[KpiCard]


class PartContractorComparisonRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    contractor_id: int
    contractor_name: str
    contractor_code: str | None
    contractor_rate_id: int
    base_rate: Decimal
    initial_rate: Decimal | None
    final_negotiated_rate: Decimal
    savings_pct: Decimal | None
    premium_above_base_pct: Decimal
    effective_from: date
    effective_to: date | None
    status: str
    rounds: int
    last_negotiation_at: datetime | None
    approved_by_name: str | None
    active_work_orders: int
    total_work_order_value: Decimal


class PartContractorsAnalytics(BaseModel):
    rows: list[PartContractorComparisonRow]
    bar_by_contractor: list[dict[str, Any]]
    negotiation_trend: list[NegotiationTrendPoint]
    scatter_volume: list[dict[str, Any]]
    premium_heatmap: list[dict[str, Any]]
    leaderboard: dict[str, Any]


class PartNegotiationBundle(BaseModel):
    status_counts: dict[str, int]
    trend: list[NegotiationTrendPoint]


class PartWorkOrderMonthly(BaseModel):
    month: str
    created: int
    completed: int
    quantity: Decimal


class PartWorkOrderAnalytics(BaseModel):
    totals_by_status: dict[str, int]
    by_plant: list[dict[str, Any]]
    by_contractor: list[dict[str, Any]]
    by_month: list[PartWorkOrderMonthly]
    total_wo_value: Decimal
    total_invoiced_for_part: Decimal
    pending_invoice_amount_for_part: Decimal
    donut_status: list[dict[str, Any]]
    value_trend: list[dict[str, Any]]
    qty_trend: list[dict[str, Any]]
    total_consumption_qty: Decimal
    avg_order_quantity: Decimal | None


class PartCommercialInsights(BaseModel):
    lowest_negotiated_rate: Decimal | None
    highest_negotiated_rate: Decimal | None
    average_market_negotiated_rate: Decimal | None
    spread_low_high: Decimal | None
    total_savings_through_negotiation: Decimal
    total_extra_above_base: Decimal
    highest_premium_contractor_name: str | None
    best_value_contractor_name: str | None
    pct_rates_below_base: Decimal
    pct_rates_above_base: Decimal
    risk_level: str
    insight_lines: list[str]
    cost_trend: list[dict[str, Any]]


class PartCompetitionRow(BaseModel):
    contractor_id: int
    contractor_name: str
    rate_rank: int
    work_order_count: int
    completion_rate_pct: Decimal | None
    negotiation_success_pct: Decimal | None
    pending_approvals: int
    avg_rounds: Decimal | None


class PartCompetitionAnalytics(BaseModel):
    rows: list[PartCompetitionRow]


# Timeline reuses AnalyticsTimelineEvent; pending reuses PendingActions
