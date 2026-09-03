"""
Stage 8 — Seasonal pricing engine.

Per-property, per-date rates. Auto-suggests season based on AU calendar
(peak/shoulder/off/holiday). Nightly rate for a stay = mean of per-date
`final_nightly_rate` values across the check-in → check-out-minus-one range.
"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple


SEASONS = {"peak", "shoulder", "off", "holiday"}
DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_date(v: str) -> date:
    return datetime.fromisoformat(str(v)).date()


def suggest_season(d: date) -> str:
    """Cheap AU-oriented season classifier."""
    m, day = d.month, d.day
    # Holidays (rough): Easter approximate + long weekends. Keep it conservative;
    # user can override via `notes` on the calendar cell.
    if (m == 4 and 19 <= day <= 22) or (m == 4 and day == 25):
        return "holiday"
    if m == 6 and 8 <= day <= 10:      # King's Birthday weekend
        return "holiday"
    if (m == 12 and day >= 20) or (m == 1 and day <= 31):
        return "peak"
    if m == 7:
        return "peak"
    if m == 6:
        return "off"
    if m in (2, 3, 4, 5, 8, 9, 10):
        return "shoulder"
    return "shoulder"


def build_cell(
    property_id: str,
    d: date,
    *,
    base_nightly_rate: float,
    multiplier: float = 1.0,
    season: Optional[str] = None,
    notes: str = "",
) -> Dict[str, Any]:
    ts = now_iso()
    season = season if season in SEASONS else suggest_season(d)
    final = round(float(base_nightly_rate) * float(multiplier), 2)
    return {
        "id": str(uuid.uuid4()),
        "property_id": property_id,
        "date": d.isoformat(),
        "day_of_week": DAY_NAMES[d.weekday()],
        "season": season,
        "base_nightly_rate": float(base_nightly_rate),
        "multiplier": float(multiplier),
        "final_nightly_rate": final,
        "notes": notes,
        "created_at": ts,
        "updated_at": ts,
    }


async def upsert_cell(db, property_id: str, d: str, patch: Dict[str, Any]) -> Dict[str, Any]:
    day = _parse_date(d)
    existing = await db.pricing_calendar.find_one(
        {"property_id": property_id, "date": day.isoformat()}, {"_id": 0},
    )
    base = patch.get("base_nightly_rate", (existing or {}).get("base_nightly_rate", 0))
    mult = patch.get("multiplier", (existing or {}).get("multiplier", 1.0))
    season = patch.get("season", (existing or {}).get("season") or suggest_season(day))
    notes = patch.get("notes", (existing or {}).get("notes", ""))
    doc = build_cell(property_id, day, base_nightly_rate=base, multiplier=mult, season=season, notes=notes)
    if existing:
        doc["id"] = existing.get("id") or doc["id"]
        doc["created_at"] = existing.get("created_at") or doc["created_at"]
        await db.pricing_calendar.update_one(
            {"property_id": property_id, "date": day.isoformat()},
            {"$set": {k: v for k, v in doc.items() if k != "id"}},
        )
    else:
        await db.pricing_calendar.insert_one(doc.copy())
    return doc


async def list_range(
    db, property_id: Optional[str], date_from: str, date_to: str,
) -> List[Dict[str, Any]]:
    q: Dict[str, Any] = {"date": {"$gte": date_from, "$lte": date_to}}
    if property_id and property_id != "all":
        q["property_id"] = property_id
    cursor = db.pricing_calendar.find(q, {"_id": 0}).sort([("date", 1), ("property_id", 1)])
    return await cursor.to_list(length=5000)


async def calculate_nightly_rate(
    db, property_id: str, check_in: str, check_out: str,
) -> Dict[str, Any]:
    d1, d2 = _parse_date(check_in), _parse_date(check_out)
    nights = (d2 - d1).days
    if nights <= 0:
        return {"nights": 0, "avg_rate": 0.0, "total": 0.0, "coverage": 0}
    dates = [d1 + timedelta(days=i) for i in range(nights)]
    iso_dates = [d.isoformat() for d in dates]
    cells = await db.pricing_calendar.find(
        {"property_id": property_id, "date": {"$in": iso_dates}}, {"_id": 0},
    ).to_list(length=nights)
    by_date = {c["date"]: c for c in cells}
    rates: List[float] = []
    for d in dates:
        c = by_date.get(d.isoformat())
        if c:
            rates.append(float(c.get("final_nightly_rate") or 0))
    if not rates:
        return {"nights": nights, "avg_rate": 0.0, "total": 0.0, "coverage": 0}
    avg = round(sum(rates) / len(rates), 2)
    return {
        "nights": nights,
        "avg_rate": avg,
        "total": round(avg * nights, 2),
        "coverage": len(rates),
    }


def parse_csv_import(text: str) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Parse a bulk-import CSV. Columns: date, property_id (or property_name), base_nightly_rate, multiplier, season, notes."""
    errors: List[str] = []
    reader = csv.DictReader(io.StringIO(text))
    rows: List[Dict[str, Any]] = []
    for i, row in enumerate(reader, start=2):
        r = {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
        try:
            d = _parse_date(r["date"])
        except Exception:
            errors.append(f"Row {i}: invalid date")
            continue
        try:
            base = float(r.get("base_nightly_rate") or r.get("rate") or 0)
        except Exception:
            errors.append(f"Row {i}: invalid base rate")
            continue
        try:
            mult = float(r.get("multiplier") or 1.0)
        except Exception:
            mult = 1.0
        rows.append({
            "date": d.isoformat(),
            "property_id": r.get("property_id"),
            "property_name": r.get("property_name"),
            "base_nightly_rate": base,
            "multiplier": mult,
            "season": (r.get("season") or "").lower() or suggest_season(d),
            "notes": r.get("notes", ""),
        })
    return rows, errors


def render_export_csv(cells: Iterable[Dict[str, Any]]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["date", "property_id", "day_of_week", "season",
                "base_nightly_rate", "multiplier", "final_nightly_rate", "notes"])
    for c in cells:
        w.writerow([
            c.get("date"), c.get("property_id"), c.get("day_of_week"),
            c.get("season"), c.get("base_nightly_rate"), c.get("multiplier"),
            c.get("final_nightly_rate"), c.get("notes"),
        ])
    return buf.getvalue()
