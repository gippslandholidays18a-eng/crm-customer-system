"""Stage 7 — Staff calendar (shifts + time-off) + iCal export."""
from __future__ import annotations
import secrets, uuid
from datetime import datetime, timezone, date, timedelta
from typing import Any, Dict, List, Optional

SHIFT_TYPES = ["Work Day", "On Call", "Training", "Other"]
LEAVE_TYPES = ["Annual Leave", "Sick Leave", "Personal Leave", "Public Holiday", "Unpaid Leave", "Other"]
TIMEOFF_STATUSES = ["Pending", "Approved", "Declined"]

STAFF_COLORS = ["#D9A05B", "#5BD1A8", "#7AB8FF", "#B486E0", "#E0904E", "#E05A50", "#16B5C6", "#F2C94C", "#9B59B6", "#3498DB"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_token() -> str:
    return secrets.token_urlsafe(24)


def color_for_staff(user_id: str, ordered_ids: List[str]) -> str:
    try:
        idx = ordered_ids.index(user_id)
    except ValueError:
        idx = abs(hash(user_id)) % len(STAFF_COLORS)
    return STAFF_COLORS[idx % len(STAFF_COLORS)]


def build_shift(*, staff_member_id: str, staff_member_name: str, shift_date: str,
                shift_type: str, start_time: str, end_time: str,
                properties_assigned: Optional[List[str]] = None, notes: str = "",
                created_by: str, created_by_name: str) -> Dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "staff_member_id": staff_member_id,
        "staff_member_name": staff_member_name,
        "date": shift_date,
        "shift_type": shift_type if shift_type in SHIFT_TYPES else "Work Day",
        "start_time": start_time or "",
        "end_time": end_time or "",
        "properties_assigned": properties_assigned or [],
        "notes": (notes or "").strip(),
        "created_by": created_by,
        "created_by_name": created_by_name,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }


def build_timeoff(*, staff_member_id: str, staff_member_name: str, start_date: str,
                  end_date: str, leave_type: str, notes: str = "",
                  created_by: str, created_by_name: str,
                  status: str = "Pending") -> Dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "staff_member_id": staff_member_id,
        "staff_member_name": staff_member_name,
        "start_date": start_date,
        "end_date": end_date or start_date,
        "leave_type": leave_type if leave_type in LEAVE_TYPES else "Other",
        "status": status if status in TIMEOFF_STATUSES else "Pending",
        "notes": (notes or "").strip(),
        "decline_reason": "",
        "approved_by": "",
        "approved_at": None,
        "created_by": created_by,
        "created_by_name": created_by_name,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }


def build_ical_feed(*, calendar_name: str, events: List[Dict[str, Any]]) -> bytes:
    """Emit an .ics byte-string for the given approved time-off events."""
    from icalendar import Calendar, Event

    cal = Calendar()
    cal.add("prodid", "-//Sourcebench//STR CRM//EN")
    cal.add("version", "2.0")
    cal.add("x-wr-calname", calendar_name)
    cal.add("method", "PUBLISH")

    for e in events:
        ev = Event()
        ev.add("uid", f"{e['id']}@sourcebench")
        summary = f"{e.get('staff_member_name','Staff')} — {e.get('leave_type','Leave')}"
        ev.add("summary", summary)
        ev.add("description", e.get("notes", "") or "")
        try:
            start = date.fromisoformat(e["start_date"])
            end = date.fromisoformat(e.get("end_date") or e["start_date"])
        except Exception:
            continue
        # iCal end date is exclusive for all-day events, so bump by 1.
        ev.add("dtstart", start)
        ev.add("dtend", end + timedelta(days=1))
        ev.add("dtstamp", datetime.now(timezone.utc))
        ev.add("status", "CONFIRMED")
        cal.add_component(ev)
    return cal.to_ical()


def can_view_calendar(actor: Dict[str, Any], target_staff_id: str) -> bool:
    if actor.get("role") in ("admin", "manager"):
        return True
    return actor.get("id") == target_staff_id
