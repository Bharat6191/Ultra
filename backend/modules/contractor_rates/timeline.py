"""Unified, business-focused timeline for a single contractor rate negotiation.

Merges audit logs, negotiation rounds, and approval actions, then filters technical
noise (version snapshots, duplicate approvals, redundant round audit rows) and enriches
entries with structured field changes and commercial highlights.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from modules.approvals.model import ApprovalAction, ApprovalRequest, ApprovalTask
from modules.contractor_rates.models import (
    ContractorRate,
    ContractorRateAuditLog,
    NegotiationLog,
)
from modules.errors import NotFoundError
from modules.part_master.models import PartMaster
from modules.users.model import User

_SKIP_AUDIT = frozenset({"VERSION_CREATED", "NEGOTIATION_ADDED"})

_FIELD_LABELS: dict[str, str] = {
    "negotiated_rate": "Negotiated rate",
    "initial_rate": "Opening ask",
    "previous_rate": "Previous rate",
    "savings_amount": "Savings",
    "savings_percentage": "Savings %",
    "effective_from": "Effective from",
    "effective_to": "Effective to",
    "status": "Status",
    "remarks": "Remarks",
}

_MONEY_FIELDS = frozenset(
    {
        "negotiated_rate",
        "initial_rate",
        "previous_rate",
        "savings_amount",
        "proposed_rate",
        "counter_rate",
        "base_rate",
    }
)


def _parse_decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _format_money(value: Any) -> str | None:
    d = _parse_decimal(value)
    if d is None:
        return None
    return f"₹{d:,.2f}"


def _format_field_value(field: str, value: Any) -> str | None:
    if value is None:
        return None
    if field in _MONEY_FIELDS:
        return _format_money(value) or str(value)
    if field == "savings_percentage":
        d = _parse_decimal(value)
        return f"{d:.2f}%" if d is not None else str(value)
    return str(value)


def _build_vs_base_tolerance(negotiated: Any, base_rate: Any) -> dict[str, Any] | None:
    """Signed variance vs Part Master base.

    Positive pct/amount => negotiated above base (loss for org).
    Negative => below base (gain for org).
    """
    neg = _parse_decimal(negotiated)
    base = _parse_decimal(base_rate)
    if neg is None or base is None or base <= 0:
        return None
    amount = neg - base
    pct = float((amount / base) * Decimal("100"))
    if amount > 0:
        tone = "loss"
        amount_display = f"+{_format_money(amount)} above base"
    elif amount < 0:
        tone = "gain"
        amount_display = f"{_format_money(abs(amount))} below base"
    else:
        tone = "neutral"
        amount_display = "at base"
    pct_display = f"{('+' if amount > 0 else '')}{pct:.2f}%"
    return {
        "amount": str(amount),
        "pct": pct,
        "amount_display": amount_display,
        "pct_display": pct_display,
        "tone": tone,
    }


class ContractorRateTimelineService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def _user_name(self, user_id: int | None) -> str | None:
        if user_id is None:
            return None
        u = self._db.get(User, int(user_id))
        return u.full_name if u else None

    def get_timeline(self, contractor_rate_id: int) -> list[dict[str, Any]]:
        rate = self._db.get(ContractorRate, int(contractor_rate_id))
        if rate is None:
            raise NotFoundError("ContractorRate", contractor_rate_id)

        part = self._db.get(PartMaster, int(rate.part_master_id))
        base_rate = getattr(part, "base_rate", None) if part is not None else None

        raw: list[dict[str, Any]] = []
        raw.extend(self._audit_events(int(contractor_rate_id)))
        raw.extend(self._round_events(int(contractor_rate_id)))
        raw.extend(self._approval_events(rate))

        raw.sort(key=lambda e: (e["occurred_at"] or datetime.min, e.get("_sort_key", "")))
        return _normalize_timeline(raw, base_rate=base_rate)

    def _audit_events(self, contractor_rate_id: int) -> list[dict[str, Any]]:
        rows = self._db.scalars(
            select(ContractorRateAuditLog)
            .where(ContractorRateAuditLog.contractor_rate_id == contractor_rate_id)
            .order_by(ContractorRateAuditLog.created_at.asc(), ContractorRateAuditLog.id.asc())
        ).all()
        out: list[dict[str, Any]] = []
        for a in rows:
            if a.action in _SKIP_AUDIT:
                continue
            out.append(
                {
                    "occurred_at": a.created_at,
                    "kind": "audit",
                    "action": a.action,
                    "actor_user_id": a.changed_by,
                    "actor_name": self._user_name(a.changed_by),
                    "title": _audit_title(a),
                    "description": None,
                    "payload": {
                        "old_value": a.old_value,
                        "new_value": a.new_value,
                        "metadata": a.metadata_json,
                    },
                    "_sort_key": f"audit:{a.id}",
                }
            )
        return out

    def _round_events(self, contractor_rate_id: int) -> list[dict[str, Any]]:
        rows = self._db.scalars(
            select(NegotiationLog)
            .where(NegotiationLog.contractor_rate_id == contractor_rate_id)
            .order_by(NegotiationLog.round_number.asc())
        ).all()
        out: list[dict[str, Any]] = []
        prior_proposed: Decimal | None = None
        for r in rows:
            proposed = _parse_decimal(r.proposed_rate)
            counter = _parse_decimal(r.counter_rate)
            summary = (r.round_summary or "").strip()
            payload: dict[str, Any] = {
                "round_number": int(r.round_number),
                "proposed_rate": str(r.proposed_rate) if r.proposed_rate is not None else None,
                "counter_rate": str(r.counter_rate) if r.counter_rate is not None else None,
                "remarks": r.remarks,
                "round_summary": summary or None,
                "is_opening_round": bool(
                    int(r.round_number) == 1 and summary == "Opening evidence"
                ),
            }
            if proposed is not None and prior_proposed is not None:
                delta = proposed - prior_proposed
                payload["delta_from_prior_round"] = str(delta)
            if proposed is not None:
                prior_proposed = proposed

            out.append(
                {
                    "occurred_at": r.created_at,
                    "kind": "negotiation",
                    "action": "ROUND",
                    "actor_user_id": r.created_by,
                    "actor_name": self._user_name(r.created_by),
                    "title": f"Round {r.round_number}",
                    "description": r.remarks,
                    "payload": payload,
                    "_sort_key": f"round:{r.id}",
                }
            )
        return out

    def _approval_events(self, rate: ContractorRate) -> list[dict[str, Any]]:
        if rate.approval_request_id is None:
            return []
        req = self._db.scalar(
            select(ApprovalRequest)
            .where(ApprovalRequest.id == int(rate.approval_request_id))
            .options(
                selectinload(ApprovalRequest.tasks)
                .selectinload(ApprovalTask.actions),
                selectinload(ApprovalRequest.tasks).selectinload(ApprovalTask.step),
            )
        )
        if req is None:
            return []
        task_ids = [int(t.id) for t in (req.tasks or [])]
        if not task_ids:
            return []
        task_by_id = {int(t.id): t for t in req.tasks or []}
        actions = self._db.scalars(
            select(ApprovalAction)
            .where(ApprovalAction.task_id.in_(task_ids))
            .order_by(ApprovalAction.created_at.asc(), ApprovalAction.id.asc())
        ).all()
        out: list[dict[str, Any]] = []
        for act in actions:
            action = str(act.action).lower()
            task = task_by_id.get(int(act.task_id))
            step_order = int(task.step.step_order) if task and task.step else None
            is_approve = action == "approve"
            out.append(
                {
                    "occurred_at": act.created_at,
                    "kind": "approval",
                    "action": "APPROVE" if is_approve else "REJECT",
                    "actor_user_id": act.user_id,
                    "actor_name": self._user_name(act.user_id),
                    "title": "Approved" if is_approve else "Rejected",
                    "description": act.comment,
                    "payload": {
                        "task_id": int(act.task_id),
                        "approval_step": step_order,
                        "comment": act.comment,
                    },
                    "_sort_key": f"approval:{act.id}",
                }
            )
        return out


def _audit_title(a: ContractorRateAuditLog) -> str:
    mapping = {
        "CREATED": "Negotiation opened",
        "UPDATED": "Changes made",
        "VALIDITY_CHANGED": "Validity updated",
        "SENT_FOR_APPROVAL": "Submitted for approval",
        "APPROVED": "Approved",
        "REJECTED": "Rejected",
        "RATE_ACTIVATED": "Rate activated",
        "RATE_DEACTIVATED": "Rate deactivated",
        "CANCELLED": "Cancelled",
        "EXPIRED": "Expired",
    }
    return mapping.get(a.action, a.action.replace("_", " ").title())


def _build_changes(old: dict[str, Any] | None, new: dict[str, Any] | None) -> list[dict[str, Any]]:
    old = old or {}
    new = new or {}
    keys = sorted(set(old.keys()) | set(new.keys()))
    changes: list[dict[str, Any]] = []
    for key in keys:
        ov, nv = old.get(key), new.get(key)
        if ov == nv:
            continue
        changes.append(
            {
                "field": key,
                "label": _FIELD_LABELS.get(key, key.replace("_", " ").title()),
                "old": _format_field_value(key, ov),
                "new": _format_field_value(key, nv),
            }
        )
    return changes


def _merge_creation_with_opening_round(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fold CREATED audit into round 1 when both belong to the same opening action."""
    window = timedelta(seconds=120)
    created_idxs = [
        i
        for i, e in enumerate(raw)
        if e.get("kind") == "audit" and str(e.get("action", "")).upper() == "CREATED"
    ]
    if not created_idxs:
        return raw

    drop: set[int] = set()
    for ci in created_idxs:
        created = raw[ci]
        c_ts = created.get("occurred_at")
        for i, evt in enumerate(raw):
            if i == ci or i in drop:
                continue
            if evt.get("kind") != "negotiation" or str(evt.get("action", "")).upper() != "ROUND":
                continue
            pl = evt.get("payload") or {}
            if int(pl.get("round_number") or 0) != 1:
                continue
            is_opening = bool(
                pl.get("is_opening_round")
                or (pl.get("round_summary") or "").strip() == "Opening evidence"
            )
            if not is_opening:
                continue
            r_ts = evt.get("occurred_at")
            if c_ts and r_ts and abs((c_ts - r_ts).total_seconds()) > window.total_seconds():
                continue
            merged = dict(evt)
            merged["_merged_created"] = created
            raw[i] = merged
            drop.add(ci)
            break

    return [e for i, e in enumerate(raw) if i not in drop]


def _apply_created_highlights(
    highlights: dict[str, Any],
    *,
    new_value: dict[str, Any],
    metadata: dict[str, Any],
) -> None:
    if new_value.get("negotiated_rate"):
        highlights["negotiated_rate"] = _format_money(new_value["negotiated_rate"])
    if metadata.get("base_rate"):
        highlights["base_rate"] = _format_money(metadata["base_rate"])
    if metadata.get("initial_rate"):
        highlights["initial_rate"] = _format_money(metadata["initial_rate"])
    if metadata.get("previous_rate"):
        highlights["previous_rate"] = _format_money(metadata["previous_rate"])
    if new_value.get("savings_amount"):
        highlights["savings_amount"] = _format_money(new_value["savings_amount"])
    if new_value.get("savings_percentage"):
        highlights["savings_percentage"] = _format_field_value(
            "savings_percentage", new_value["savings_percentage"]
        )
    if new_value.get("effective_from"):
        highlights["effective_from"] = str(new_value["effective_from"])
    if new_value.get("effective_to"):
        highlights["effective_to"] = str(new_value["effective_to"])


def _enrich_event(evt: dict[str, Any], *, base_rate: Any, seen_rejection: bool) -> dict[str, Any] | None:
    """Return enriched public event or None to drop."""
    action = str(evt["action"]).upper()
    kind = evt["kind"]
    payload = dict(evt.get("payload") or {})
    old_value = payload.get("old_value") or {}
    new_value = payload.get("new_value") or {}
    metadata = payload.get("metadata") or {}

    highlights: dict[str, Any] = {}
    changes: list[dict[str, Any]] = []
    comment: str | None = evt.get("description")
    title = evt["title"]
    is_resubmit = False
    negotiated_for_tolerance: Any = None
    effective_base = base_rate or metadata.get("base_rate")

    if kind == "audit":
        if action == "CREATED":
            title = "Negotiation opened"
            _apply_created_highlights(highlights, new_value=new_value, metadata=metadata)
            negotiated_for_tolerance = new_value.get("negotiated_rate")
            if metadata.get("base_rate"):
                effective_base = metadata["base_rate"]

        elif action in ("UPDATED", "VALIDITY_CHANGED"):
            title = "Validity updated" if action == "VALIDITY_CHANGED" else "Changes made"
            meta_fields = metadata.get("fields")
            if meta_fields:
                keys = list(meta_fields)
                filtered_old = {k: old_value.get(k) for k in keys if k in old_value or k in new_value}
                filtered_new = {k: new_value.get(k) for k in keys if k in old_value or k in new_value}
                changes = _build_changes(filtered_old, filtered_new)
            else:
                changes = _build_changes(old_value, new_value)
            if not changes and action == "UPDATED":
                return None
            for ch in changes:
                if ch["field"] in ("negotiated_rate", "savings_amount", "savings_percentage"):
                    if ch.get("new"):
                        highlights[ch["field"]] = ch["new"]
            if new_value.get("negotiated_rate") is not None:
                negotiated_for_tolerance = new_value.get("negotiated_rate")

        elif action == "SENT_FOR_APPROVAL":
            title = "Resubmitted for approval" if seen_rejection else "Submitted for approval"
            is_resubmit = seen_rejection
            comment = None

        elif action == "REJECTED":
            comment = metadata.get("comment") or comment
            title = "Rejected"
            # Prefer approval-action row when both exist; handled in dedupe pass.

        elif action == "APPROVED":
            title = "Approved"

        elif action == "RATE_ACTIVATED":
            title = "Rate activated"
            comment = None
            if new_value.get("negotiated_rate"):
                highlights["negotiated_rate"] = _format_money(new_value["negotiated_rate"])
            if new_value.get("effective_from"):
                highlights["effective_from"] = str(new_value["effective_from"])
            if new_value.get("effective_to"):
                highlights["effective_to"] = str(new_value["effective_to"])
            elif new_value.get("effective_to") is None and "effective_to" in new_value:
                highlights["effective_to"] = "Open-ended"
            negotiated_for_tolerance = new_value.get("negotiated_rate")

        elif action in ("RATE_DEACTIVATED", "EXPIRED", "CANCELLED"):
            changes = _build_changes(old_value, new_value)

    elif kind == "negotiation" and action == "ROUND":
        merged_created = evt.get("_merged_created")
        if merged_created:
            title = "Negotiation opened — Round 1"
            action = "CREATED"
            c_payload = merged_created.get("payload") or {}
            c_new = c_payload.get("new_value") or {}
            c_meta = c_payload.get("metadata") or {}
            _apply_created_highlights(highlights, new_value=c_new, metadata=c_meta)
            negotiated_for_tolerance = c_new.get("negotiated_rate")
            if c_meta.get("base_rate"):
                effective_base = c_meta["base_rate"]
            if c_new.get("remarks") and not comment:
                comment = str(c_new.get("remarks"))
        proposed = payload.get("proposed_rate")
        counter = payload.get("counter_rate")
        if proposed and "negotiated_rate" not in highlights:
            highlights["proposed_rate"] = _format_money(proposed)
        if counter:
            highlights["counter_rate"] = _format_money(counter)
        delta = payload.get("delta_from_prior_round")
        if delta:
            d = _parse_decimal(delta)
            if d is not None:
                sign = "+" if d > 0 else ""
                highlights["delta_from_prior_round"] = f"{sign}{_format_money(d)}"
        if negotiated_for_tolerance is None:
            negotiated_for_tolerance = counter or proposed

    elif kind == "approval":
        step = payload.get("approval_step")
        if action == "APPROVE":
            title = f"Approved (step {step})" if step else "Approved"
        else:
            title = f"Rejected (step {step})" if step else "Rejected"
        comment = payload.get("comment") or comment

    public_payload: dict[str, Any] = {}
    if changes:
        public_payload["changes"] = changes
    if highlights:
        public_payload["highlights"] = highlights
    if comment:
        public_payload["comment"] = comment
    if is_resubmit:
        public_payload["is_resubmit"] = True
    vs_base = _build_vs_base_tolerance(negotiated_for_tolerance, effective_base)
    if vs_base:
        public_payload["vs_base_tolerance"] = vs_base
    if kind == "negotiation":
        for k in (
            "round_number",
            "proposed_rate",
            "counter_rate",
            "remarks",
            "delta_from_prior_round",
            "is_opening_round",
        ):
            if k in payload:
                public_payload[k] = payload[k]

    return {
        "occurred_at": evt["occurred_at"],
        "kind": kind,
        "action": action,
        "actor_user_id": evt.get("actor_user_id"),
        "actor_name": evt.get("actor_name"),
        "title": title,
        "description": comment,
        "payload": public_payload or None,
        "_sort_key": evt.get("_sort_key", ""),
    }


def _normalize_timeline(raw: list[dict[str, Any]], *, base_rate: Any) -> list[dict[str, Any]]:
    """Filter duplicates and enrich for the UI."""
    raw = [
        e
        for e in raw
        if not (e.get("kind") == "audit" and e.get("action") in _SKIP_AUDIT)
    ]
    raw = _merge_creation_with_opening_round(raw)

    # Drop audit APPROVED when activation follows shortly (approval_finalized path).
    activation_times = [
        e["occurred_at"]
        for e in raw
        if e.get("kind") == "audit" and e.get("action") == "RATE_ACTIVATED"
    ]
    window = timedelta(seconds=120)

    def _near_activation(ts: datetime | None) -> bool:
        if ts is None:
            return False
        return any(
            act_ts is not None and abs((ts - act_ts).total_seconds()) <= window.total_seconds()
            for act_ts in activation_times
        )

    filtered: list[dict[str, Any]] = []
    for evt in raw:
        action = str(evt.get("action", "")).upper()
        kind = evt.get("kind")
        if kind == "audit" and action == "APPROVED":
            meta = (evt.get("payload") or {}).get("metadata") or {}
            if meta.get("via") == "approval_finalized" or _near_activation(evt.get("occurred_at")):
                continue
        filtered.append(evt)

    # Drop audit REJECTED when an approval REJECT exists within 60s.
    reject_times = {
        e["occurred_at"]
        for e in filtered
        if e.get("kind") == "approval" and str(e.get("action", "")).upper() == "REJECT"
    }
    reject_window = timedelta(seconds=60)
    deduped: list[dict[str, Any]] = []
    for evt in filtered:
        if evt.get("kind") == "audit" and evt.get("action") == "REJECTED":
            ts = evt.get("occurred_at")
            if ts and any(
                rt is not None and abs((ts - rt).total_seconds()) <= reject_window.total_seconds()
                for rt in reject_times
            ):
                continue
        deduped.append(evt)

    # Drop final approval APPROVE when rate activation follows within 30s.
    act_window = timedelta(seconds=30)
    final_activations = [e for e in deduped if e.get("action") == "RATE_ACTIVATED"]
    if final_activations:
        last_activation = final_activations[-1]["occurred_at"]
        trimmed: list[dict[str, Any]] = []
        for evt in deduped:
            if (
                evt.get("kind") == "approval"
                and str(evt.get("action", "")).upper() == "APPROVE"
                and last_activation
                and evt.get("occurred_at")
                and abs((evt["occurred_at"] - last_activation).total_seconds())
                <= act_window.total_seconds()
            ):
                continue
            trimmed.append(evt)
        deduped = trimmed

    seen_rejection = False
    out: list[dict[str, Any]] = []
    for evt in deduped:
        enriched = _enrich_event(evt, base_rate=base_rate, seen_rejection=seen_rejection)
        if enriched is None:
            continue
        action = str(enriched.get("action", "")).upper()
        if action in ("REJECTED", "REJECT"):
            seen_rejection = True
        # Strip internal keys
        enriched.pop("_sort_key", None)
        out.append(enriched)

    return out
