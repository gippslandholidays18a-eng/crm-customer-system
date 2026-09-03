"""
Stage 6C — Compliance & housekeeping schedule service.

Each schedule item describes a recurring obligation for one property
(e.g. annual smoke alarm check, quarterly deep clean). Items expose:
    - cadence_days        recurrence
    - last_done_at        last completion date (ISO yyyy-mm-dd)
    - next_due_at         last_done_at + cadence_days (or seeded today + cadence_days)
    - linked_task_id      currently-open task auto-created for this item (or null)
    - active              soft-deactivation flag (skips auto-task creation)

When a task that carries a `schedule_item_id` (or a matching
category+subtype+property) is marked done, the matching item is bumped:
last_done_at = task completion date, next_due_at recomputed, linked_task_id
cleared so a fresh task can be auto-created on the next cycle.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

# Default per-property templates — chosen by the user (1a + 2a) -----------

COMPLIANCE_DEFAULTS = [
    {"subtype": "smoke_alarm",          "label": "Smoke alarm check",        "cadence_days": 365},
    {"subtype": "gas_safety",           "label": "Gas safety check",         "cadence_days": 365},
    {"subtype": "electrical_safety",    "label": "Electrical safety",        "cadence_days": 365 * 5},
    {"subtype": "pool_fence",           "label": "Pool fence compliance",    "cadence_days": 365},
    {"subtype": "insurance_renewal",    "label": "Insurance renewal",        "cadence_days": 365},
    {"subtype": "council_registration", "label": "Council STR registration", "cadence_days": 365},
]

HOUSEKEEPING_DEFAULTS = [
    {"subtype": "deep_clean",          "label": "Deep clean",                 "cadence_days": 90},
    {"subtype": "mattress_flip",       "label": "Mattress flip / rotate",     "cadence_days": 90},
    {"subtype": "oven_rangehood",      "label": "Oven & rangehood deep clean","cadence_days": 90},
    {"subtype": "carpet_upholstery",   "label": "Carpet & upholstery",        "cadence_days": 365},
    {"subtype": "window_clean",        "label": "Window clean",               "cadence_days": 180},
    {"subtype": "pillow_rotation",     "label": "Pillow & blanket rotation",  "cadence_days": 180},
]

DEFAULT_LEAD_DAYS = 14  # auto-create the task this many days before next_due_at


def _today() -> str:
    return date.today().isoformat()


def _add_days(iso: Optional[str], days: int) -> str:
    base = date.fromisoformat(iso) if iso else date.today()
    return (base + timedelta(days=days)).isoformat()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_item(
    *,
    property_id: str,
    property_name: str,
    kind: str,
    subtype: str,
    label: str,
    cadence_days: int,
    last_done_at: Optional[str] = None,
    notes: str = "",
    lead_days: int = DEFAULT_LEAD_DAYS,
) -> Dict[str, Any]:
    now = _now_iso()
    return {
        "id": str(uuid.uuid4()),
        "property_id": property_id,
        "property_name": property_name,
        "kind": kind,                # "compliance" | "housekeeping"
        "subtype": subtype,
        "label": label,
        "cadence_days": int(cadence_days),
        "last_done_at": last_done_at,
        "last_done_by_name": "",
        "next_due_at": _add_days(last_done_at, int(cadence_days)),
        "notes": notes or "",
        "active": True,
        "linked_task_id": None,
        "auto_task_lead_days": int(lead_days),
        "created_at": now,
        "updated_at": now,
    }


def default_items_for_property(property_id: str, property_name: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for spec in COMPLIANCE_DEFAULTS:
        items.append(build_item(
            property_id=property_id, property_name=property_name,
            kind="compliance", **spec,
        ))
    for spec in HOUSEKEEPING_DEFAULTS:
        items.append(build_item(
            property_id=property_id, property_name=property_name,
            kind="housekeeping", **spec,
        ))
    return items


def status_for_item(item: Dict[str, Any], today_iso: Optional[str] = None) -> str:
    """Returns 'overdue' | 'due_soon' | 'ok' | 'inactive'."""
    if not item.get("active", True):
        return "inactive"
    today_iso = today_iso or _today()
    due = item.get("next_due_at")
    if not due:
        return "ok"
    if due < today_iso:
        return "overdue"
    lead = int(item.get("auto_task_lead_days") or DEFAULT_LEAD_DAYS)
    soon = _add_days(today_iso, lead)
    if due <= soon:
        return "due_soon"
    return "ok"


def bump_after_completion(item: Dict[str, Any], when_iso: Optional[str], actor_name: str) -> Dict[str, Any]:
    """Returns a $set patch advancing the schedule after a task completion."""
    when = (when_iso or _today())[:10]
    cadence = int(item.get("cadence_days") or 365)
    return {
        "last_done_at": when,
        "last_done_by_name": actor_name or "",
        "next_due_at": _add_days(when, cadence),
        "linked_task_id": None,
        "updated_at": _now_iso(),
    }


def needs_task(item: Dict[str, Any], today_iso: Optional[str] = None) -> bool:
    """A schedule item needs an auto-task when:
       - it is active,
       - it has no linked task already open,
       - and it is within the lead window of next_due_at (or already overdue).
    """
    if not item.get("active", True):
        return False
    if item.get("linked_task_id"):
        return False
    today_iso = today_iso or _today()
    due = item.get("next_due_at")
    if not due:
        return False
    lead = int(item.get("auto_task_lead_days") or DEFAULT_LEAD_DAYS)
    return due <= _add_days(today_iso, lead)


def task_priority_for(item: Dict[str, Any], today_iso: Optional[str] = None) -> str:
    today_iso = today_iso or _today()
    due = item.get("next_due_at") or today_iso
    if due < today_iso:
        return "urgent"
    lead = int(item.get("auto_task_lead_days") or DEFAULT_LEAD_DAYS)
    if due <= _add_days(today_iso, max(1, lead // 2)):
        return "high"
    return "medium"


def summarise(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    today_iso = _today()
    out = {
        "total": 0,
        "by_kind": {"compliance": 0, "housekeeping": 0},
        "by_status": {"overdue": 0, "due_soon": 0, "ok": 0, "inactive": 0},
    }
    for it in items:
        out["total"] += 1
        out["by_kind"][it.get("kind", "compliance")] = out["by_kind"].get(it.get("kind", "compliance"), 0) + 1
        out["by_status"][status_for_item(it, today_iso)] += 1
    return out
