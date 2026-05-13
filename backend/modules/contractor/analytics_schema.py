"""Pydantic shapes for ``GET /contractors/{id}/analytics/*`` payloads."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AnalyticsFilters(BaseModel):
    """Optional filters applied consistently across analytics endpoints."""

    date_from: date | None = None
    date_to: date | None = None
    plant_id: int | None = Field(default=None, ge=1)
    work_order_status: str | None = None
    negotiation_status: str | None = None
    part_search: str | None = None


class KpiCard(BaseModel):
    key: str
    label: str
    value: Decimal | int | str
    tone: str = "neutral"  # success | warning | danger | neutral


class ContractorAnalyticsSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    contractor_id: int
    name: str
    contractor_code: str | None
    status: str
    is_active: bool
    plant_names: list[str]
    plants: list[dict[str, Any]] = Field(default_factory=list)  # {id, name}
    active_since: date | None
    total_active_work_orders: int
    distinct_negotiated_parts: int
    approved_negotiations: int
    overall_savings_vs_initial: Decimal
    overall_premium_above_base: Decimal
    kpis: list[KpiCard]


class NegotiationRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    contractor_rate_id: int
    part_master_id: int
    part_code: str
    part_name: str
    status: str
    base_rate: Decimal
    negotiated_rate: Decimal
    initial_rate: Decimal | None
    savings_amount: Decimal | None
    savings_percentage: Decimal | None
    premium_above_base: Decimal
    rounds: int
    effective_from: date
    effective_to: date | None
    approved_at: datetime | None


class NegotiationTrendPoint(BaseModel):
    period: str  # YYYY-MM
    count: int
    avg_negotiated: Decimal | None


class NegotiationAnalytics(BaseModel):
    rows: list[NegotiationRow]
    status_counts: dict[str, int]
    bar_chart_parts: list[dict[str, Any]]  # {part_code, base_rate, negotiated_rate}
    trend: list[NegotiationTrendPoint]
    premium_ranking: list[dict[str, Any]]  # {part_code, premium_above_base}


class WorkOrderMonthly(BaseModel):
    month: str
    created: int
    completed: int


class WorkOrderAnalytics(BaseModel):
    totals_by_status: dict[str, int]
    by_plant: list[dict[str, Any]]
    by_month: list[WorkOrderMonthly]
    total_wo_value: Decimal
    total_invoiced: Decimal
    pending_invoice_amount: Decimal
    donut_status: list[dict[str, Any]]  # {name, value}
    value_trend: list[dict[str, Any]]  # {month, value}


class CommercialInsights(BaseModel):
    avg_premium_above_base: Decimal | None
    avg_negotiation_reduction_pct: Decimal | None
    total_savings_generated: Decimal
    highest_premium_part_code: str | None
    highest_premium_amount: Decimal | None
    highest_savings_part_code: str | None
    highest_savings_amount: Decimal | None
    pct_negotiations_above_base: Decimal
    pct_negotiations_below_base: Decimal
    risk_level: str  # low | medium | high


class PendingItem(BaseModel):
    kind: str
    severity: str  # info | warning | danger
    title: str
    detail: str | None = None
    href_hint: str | None = None
    entity_id: int | None = None


class PendingActions(BaseModel):
    items: list[PendingItem]


class AnalyticsTimelineEvent(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    category: str
    type: str
    title: str
    description: str | None
    timestamp: datetime
    metadata: dict[str, Any] | None = None
