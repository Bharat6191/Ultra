"""Business timeline filtering and enrichment for contractor rates."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from modules.contractor_rates.timeline import (
    _build_vs_base_tolerance,
    _enrich_event,
    _normalize_timeline,
)


def _ts(offset_sec: int = 0) -> datetime:
    base = datetime(2026, 1, 15, 10, 0, 0, tzinfo=timezone.utc)
    return base + timedelta(seconds=offset_sec)


def test_skips_version_created_and_duplicate_approval():
    raw = [
        {
            "occurred_at": _ts(0),
            "kind": "audit",
            "action": "VERSION_CREATED",
            "title": "Version Created",
            "description": None,
            "payload": {},
            "_sort_key": "a1",
        },
        {
            "occurred_at": _ts(1),
            "kind": "audit",
            "action": "CREATED",
            "title": "Negotiation opened",
            "description": None,
            "payload": {
                "new_value": {"negotiated_rate": "100.00"},
                "metadata": {"base_rate": "120.00"},
            },
            "_sort_key": "a2",
        },
        {
            "occurred_at": _ts(10),
            "kind": "audit",
            "action": "APPROVED",
            "title": "Approved",
            "description": None,
            "payload": {"metadata": {"via": "approval_finalized"}},
            "_sort_key": "a3",
        },
        {
            "occurred_at": _ts(11),
            "kind": "audit",
            "action": "RATE_ACTIVATED",
            "title": "Rate activated",
            "description": None,
            "payload": {
                "new_value": {
                    "negotiated_rate": "100.00",
                    "effective_from": "2026-02-01",
                },
                "metadata": {"via": "approval_finalized"},
            },
            "_sort_key": "a4",
        },
    ]
    out = _normalize_timeline(raw, base_rate=Decimal("120"))
    actions = [e["action"] for e in out]
    assert "VERSION_CREATED" not in actions
    assert actions.count("APPROVED") == 1
    assert actions[-1] == "APPROVED"
    assert out[-1]["title"] == "Approved"
    assert out[-1]["payload"]["highlights"]["negotiated_rate"] == "₹100.00"


def test_round_vs_base_tolerance_gain_when_below_base():
    evt = {
        "occurred_at": _ts(),
        "kind": "negotiation",
        "action": "ROUND",
        "title": "Round 1",
        "description": "First offer",
        "payload": {"proposed_rate": "90.00", "round_number": 1},
        "_sort_key": "r1",
    }
    enriched = _enrich_event(evt, base_rate=Decimal("100"), seen_rejection=False)
    assert enriched is not None
    tol = enriched["payload"]["vs_base_tolerance"]
    assert tol["tone"] == "gain"
    assert tol["pct"] == -10.0
    assert enriched["payload"]["highlights"]["proposed_rate"] == "₹90.00"


def test_merge_created_with_opening_round_one():
    raw = [
        {
            "occurred_at": _ts(0),
            "kind": "audit",
            "action": "CREATED",
            "title": "Negotiation opened",
            "description": None,
            "payload": {
                "new_value": {"negotiated_rate": "125.00", "effective_from": "2026-05-15"},
                "metadata": {"base_rate": "118.50", "initial_rate": "130.00"},
            },
            "_sort_key": "a1",
        },
        {
            "occurred_at": _ts(1),
            "kind": "negotiation",
            "action": "ROUND",
            "title": "Round 1",
            "description": None,
            "payload": {
                "round_number": 1,
                "proposed_rate": "125.00",
                "is_opening_round": True,
                "round_summary": "Opening evidence",
            },
            "_sort_key": "r1",
        },
    ]
    out = _normalize_timeline(raw, base_rate=Decimal("118.50"))
    assert len(out) == 1
    assert out[0]["title"] == "Negotiation opened — Round 1"
    assert out[0]["action"] == "CREATED"
    assert "negotiated_rate" in (out[0]["payload"] or {}).get("highlights", {})


def test_vs_base_tolerance_loss_when_above_base():
    tol = _build_vs_base_tolerance("110", "100")
    assert tol is not None
    assert tol["tone"] == "loss"
    assert tol["pct"] == 10.0


def test_draft_updates_stay_separate_timeline_entries():
    raw = [
        {
            "occurred_at": _ts(0),
            "kind": "negotiation",
            "action": "ROUND",
            "title": "Round 1",
            "description": None,
            "payload": {
                "round_number": 1,
                "proposed_rate": "125.00",
                "is_opening_round": True,
                "round_summary": "Opening evidence",
            },
            "_sort_key": "r1",
        },
        {
            "occurred_at": _ts(1),
            "kind": "audit",
            "action": "CREATED",
            "title": "Negotiation opened",
            "description": None,
            "payload": {
                "new_value": {"negotiated_rate": "125.00"},
                "metadata": {"base_rate": "118.50"},
            },
            "_sort_key": "a1",
        },
        {
            "occurred_at": _ts(5),
            "kind": "audit",
            "action": "UPDATED",
            "title": "Changes made",
            "description": None,
            "payload": {
                "old_value": {"negotiated_rate": "125.00"},
                "new_value": {"negotiated_rate": "127.00"},
                "metadata": {"via": "draft_round_revision", "round_number": 1},
            },
            "_sort_key": "u1",
        },
    ]
    out = _normalize_timeline(raw, base_rate=Decimal("118.50"))
    assert len(out) == 2
    titles = {e["title"] for e in out}
    assert "Negotiation opened — Round 1" in titles
    assert "Round 1 updated" in titles


def test_sent_for_approval_is_title_only_milestone():
    evt = {
        "occurred_at": _ts(),
        "kind": "audit",
        "action": "SENT_FOR_APPROVAL",
        "title": "Submitted for approval",
        "description": None,
        "payload": {
            "old_value": {"status": "draft", "negotiated_rate": "127.00"},
            "new_value": {"status": "pending_approval", "negotiated_rate": "127.00"},
            "metadata": {"approval_request_id": 42},
        },
        "_sort_key": "s1",
    }
    enriched = _enrich_event(evt, base_rate=Decimal("118.50"), seen_rejection=False)
    assert enriched is not None
    assert enriched["title"] == "Submitted for approval"
    payload = enriched.get("payload") or {}
    assert "changes" not in payload
    assert "highlights" not in payload
    assert "vs_base_tolerance" not in payload


def test_normalize_timeline_includes_sent_for_approval():
    raw = [
        {
            "occurred_at": _ts(0),
            "kind": "audit",
            "action": "CREATED",
            "title": "Negotiation opened",
            "description": None,
            "payload": {
                "new_value": {"negotiated_rate": "100.00"},
                "metadata": {"base_rate": "120.00"},
            },
            "_sort_key": "a1",
        },
        {
            "occurred_at": _ts(5),
            "kind": "audit",
            "action": "SENT_FOR_APPROVAL",
            "title": "Submitted for approval",
            "description": None,
            "payload": {
                "old_value": {"status": "draft", "negotiated_rate": "100.00"},
                "new_value": {"status": "pending_approval", "negotiated_rate": "100.00"},
                "metadata": {},
            },
            "_sort_key": "s1",
        },
    ]
    out = _normalize_timeline(raw, base_rate=Decimal("120"))
    actions = [e["action"] for e in out]
    assert "SENT_FOR_APPROVAL" in actions
    submit_evt = next(e for e in out if e["action"] == "SENT_FOR_APPROVAL")
    assert submit_evt["title"] == "Submitted for approval"


def test_rate_activation_shows_approver_as_approved():
    raw = [
        {
            "occurred_at": _ts(0),
            "kind": "approval",
            "action": "APPROVE",
            "actor_user_id": 9,
            "actor_name": "Jane Approver",
            "title": "Approved",
            "description": "Looks good",
            "payload": {"approval_step": 1, "comment": "Looks good"},
            "_sort_key": "p1",
        },
        {
            "occurred_at": _ts(1),
            "kind": "audit",
            "action": "RATE_ACTIVATED",
            "actor_user_id": None,
            "actor_name": None,
            "title": "Rate activated",
            "description": None,
            "payload": {
                "new_value": {"negotiated_rate": "100.00", "effective_from": "2026-05-15"},
                "metadata": {"via": "approval_finalized"},
            },
            "_sort_key": "a1",
        },
    ]
    out = _normalize_timeline(raw, base_rate=Decimal("120"), approved_by_name="Jane Approver")
    assert len(out) == 1
    assert out[0]["title"] == "Approved"
    assert out[0]["action"] == "APPROVED"
    assert out[0]["actor_name"] == "Jane Approver"
    assert out[0]["description"] == "Looks good"


def test_updated_builds_change_rows():
    evt = {
        "occurred_at": _ts(),
        "kind": "audit",
        "action": "UPDATED",
        "title": "Changes made",
        "description": None,
        "payload": {
            "old_value": {"negotiated_rate": "100.00"},
            "new_value": {"negotiated_rate": "95.00"},
        },
        "_sort_key": "u1",
    }
    enriched = _enrich_event(evt, base_rate=None, seen_rejection=False)
    assert enriched is not None
    changes = enriched["payload"]["changes"]
    assert len(changes) == 1
    assert changes[0]["label"] == "Negotiated rate"
    assert changes[0]["old"] == "₹100.00"
    assert changes[0]["new"] == "₹95.00"
