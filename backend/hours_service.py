"""Stage 7 — Staff hours tracking + weekly aggregation + CSV export."""
from __future__ import annotations
import csv, io, uuid
from datetime import datetime, timezone, date, timedelta
from typing import Any, Dict, List, Optional

HOUR_STATUSES = ["Draft", "Submitted", "Approved", "Rejected"]
WEEKLY_THRESHOLD = 38.0


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_time(v: str):
    if not v:
        return None
    parts = v.split(":")
    if len(parts) < 2:
        return None
    return int(parts[0]) * 60 + int(parts[1])


def compute_total_hours(clock_in: str, clock_out: str) -> float:
    a = _to_time(clock_in)
    b = _to_time(clock_out)
    if a is None or b is None or b <= a:
        return 0.0
    return round((b - a) / 60.0, 2)


def build_hours(*, staff_member_id: str, staff_member_name: str, work_date: str,
                clock_in_time: str, clock_out_time: str, property_id: Optional[str],
                property_name: str = "", notes: str = "",
                submitted_by: str) -> Dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "staff_member_id": staff_member_id,
        "staff_member_name": staff_member_name,
        "date": work_date,
        "clock_in_time": clock_in_time,
        "clock_out_time": clock_out_time,
        "total_hours": compute_total_hours(clock_in_time, clock_out_time),
        "property_id": property_id,
        "property_name": property_name,
        "notes": (notes or "").strip(),
        "submitted_by": submitted_by,
        "status": "Draft",
        "approved_by": "",
        "approved_at": None,
        "rejection_reason": "",
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }


def week_key(iso_date: str) -> str:
    d = date.fromisoformat(iso_date)
    monday = d - timedelta(days=d.weekday())
    return monday.isoformat()


def build_summary(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Group by staff × week, flag weeks over 38h. Returns:
       {by_staff:[{staff_member_id, staff_member_name, total_hours, weeks:[{week_start,hours,overtime}]}],
        by_property:[{property_name, total_hours}], grand_total}"""
    by_staff: Dict[str, Dict[str, Any]] = {}
    by_prop: Dict[str, float] = {}
    grand = 0.0
    for r in records:
        if r.get("status") not in ("Approved", "Submitted"):
            continue
        if r.get("status") == "Submitted":
            pass  # count both submitted and approved in totals
        hrs = float(r.get("total_hours") or 0)
        grand += hrs
        sid = r["staff_member_id"]
        staff = by_staff.setdefault(sid, {
            "staff_member_id": sid,
            "staff_member_name": r.get("staff_member_name", ""),
            "total_hours": 0.0,
            "weeks": {},
        })
        staff["total_hours"] += hrs
        wk = week_key(r["date"])
        staff["weeks"].setdefault(wk, 0.0)
        staff["weeks"][wk] += hrs
        pn = r.get("property_name") or "—"
        by_prop[pn] = by_prop.get(pn, 0.0) + hrs

    out_staff = []
    for s in by_staff.values():
        weeks = [{"week_start": w, "hours": round(h, 2), "overtime": h > WEEKLY_THRESHOLD}
                 for w, h in sorted(s["weeks"].items())]
        out_staff.append({
            "staff_member_id": s["staff_member_id"],
            "staff_member_name": s["staff_member_name"],
            "total_hours": round(s["total_hours"], 2),
            "weeks": weeks,
            "any_overtime": any(w["overtime"] for w in weeks),
        })
    out_staff.sort(key=lambda x: -x["total_hours"])
    out_prop = [{"property_name": k, "total_hours": round(v, 2)} for k, v in by_prop.items()]
    out_prop.sort(key=lambda x: -x["total_hours"])
    return {"by_staff": out_staff, "by_property": out_prop, "grand_total": round(grand, 2)}


def to_csv(records: List[Dict[str, Any]]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["staff_name", "date", "clock_in", "clock_out", "total_hours", "property", "status"])
    for r in records:
        w.writerow([
            r.get("staff_member_name", ""), r.get("date", ""),
            r.get("clock_in_time", ""), r.get("clock_out_time", ""),
            r.get("total_hours", 0), r.get("property_name") or "",
            r.get("status", ""),
        ])
    return buf.getvalue()
