"""
Stage 9.5 — Occupancy Forecast.

For each property, compute a rolling-window occupancy % for each of the next
`days_ahead` days. Sourcebench units are single-unit STRs, so a strict
per-day view is binary; we use a centred 7-day window (or edge-clipped near
boundaries) so the Critical/Low/Healthy/Peak buckets carry real signal.

Refreshed on-demand and after every RoomMaster webhook so the forecast is
live-tracking the pipeline.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional


WINDOW_DAYS = 7  # rolling window size


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _bucket(pct: float) -> str:
    if pct < 30:
        return "Critical"
    if pct < 50:
        return "Low"
    if pct < 80:
        return "Healthy"
    return "Peak"


def _parse_date(v: Any) -> Optional[date]:
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v)[:10]).date()
    except Exception:
        return None


async def _load_bookings_for_property(
    db, property_id: str, window_start: date, window_end: date,
) -> List[Dict[str, Any]]:
    q = {
        "property_id": property_id,
        "is_cancelled": {"$ne": True},
        "$or": [
            {"checkin_date": {"$lte": window_end.isoformat()}},
            {"check_in_date": {"$lte": window_end.isoformat()}},
        ],
    }
    cursor = db.reservations.find(q, {
        "_id": 0, "checkin_date": 1, "check_in_date": 1,
        "checkout_date": 1, "check_out_date": 1,
    })
    items = await cursor.to_list(length=2000)
    # Client-side range trim: keep reservations whose stay overlaps [window_start, window_end]
    out = []
    for r in items:
        ci = _parse_date(r.get("checkin_date") or r.get("check_in_date"))
        co = _parse_date(r.get("checkout_date") or r.get("check_out_date"))
        if not ci or not co:
            continue
        # overlap = ci < window_end AND co > window_start
        if ci <= window_end and co > window_start:
            out.append({"ci": ci, "co": co})
    return out


def _booked_dates(bookings: List[Dict[str, Any]]) -> set:
    booked: set = set()
    for b in bookings:
        d = b["ci"]
        while d < b["co"]:
            booked.add(d)
            d += timedelta(days=1)
    return booked


async def build_forecast_for_property(
    db, property_id: str, *, days_ahead: int = 30,
) -> List[Dict[str, Any]]:
    today = datetime.now(timezone.utc).date()
    # widen the fetch by WINDOW_DAYS on each side so edge dates have coverage
    fetch_start = today - timedelta(days=WINDOW_DAYS)
    fetch_end = today + timedelta(days=days_ahead + WINDOW_DAYS)
    bookings = await _load_bookings_for_property(db, property_id, fetch_start, fetch_end)
    booked = _booked_dates(bookings)

    docs: List[Dict[str, Any]] = []
    ts = now_iso()
    for i in range(days_ahead):
        d = today + timedelta(days=i)
        # Centred 7-day window (or clipped near today)
        half = WINDOW_DAYS // 2
        w_start = d - timedelta(days=half)
        w_end = d + timedelta(days=WINDOW_DAYS - half)
        reserved = 0
        window_size = 0
        cur = w_start
        while cur < w_end:
            window_size += 1
            if cur in booked:
                reserved += 1
            cur += timedelta(days=1)
        pct = round((reserved / window_size) * 100, 1) if window_size else 0.0

        # Trend vs 7 days ago (same date)
        d_prev = d - timedelta(days=7)
        w_prev_start = d_prev - timedelta(days=half)
        w_prev_end = d_prev + timedelta(days=WINDOW_DAYS - half)
        reserved_prev = 0
        wsize_prev = 0
        cur = w_prev_start
        while cur < w_prev_end:
            wsize_prev += 1
            if cur in booked:
                reserved_prev += 1
            cur += timedelta(days=1)
        pct_prev = (reserved_prev / wsize_prev) * 100 if wsize_prev else 0.0
        if pct > pct_prev + 5:
            trend = "up"
        elif pct < pct_prev - 5:
            trend = "down"
        else:
            trend = "stable"

        docs.append({
            "id": str(uuid.uuid4()),
            "property_id": property_id,
            "date": d.isoformat(),
            "occupancy_pct": pct,
            "occupancy_bucket": _bucket(pct),
            "reserved_count": reserved,
            "available_count": window_size - reserved,
            "max_occupancy": window_size,
            "confidence_score": 0.85 if i < 21 else 0.6,  # further out = less confident
            "trend": trend,
            "created_at": ts,
            "updated_at": ts,
        })
    return docs


async def refresh_forecast(
    db, property_id: Optional[str] = None, *, days_ahead: int = 30,
) -> Dict[str, Any]:
    """Wipe + rewrite forecast for one property (or all)."""
    if property_id:
        property_ids = [property_id]
    else:
        cursor = db.properties.find({}, {"_id": 0, "id": 1})
        property_ids = [p["id"] for p in await cursor.to_list(length=200)]

    total = 0
    for pid in property_ids:
        docs = await build_forecast_for_property(db, pid, days_ahead=days_ahead)
        await db.forecast_occupancy.delete_many({"property_id": pid})
        if docs:
            await db.forecast_occupancy.insert_many([d.copy() for d in docs])
        total += len(docs)
    return {"properties": len(property_ids), "cells_written": total}


async def get_forecast(
    db, property_id: Optional[str] = None, *, days_ahead: int = 30,
) -> List[Dict[str, Any]]:
    q: Dict[str, Any] = {}
    if property_id and property_id != "all":
        q["property_id"] = property_id
    today = datetime.now(timezone.utc).date()
    q["date"] = {
        "$gte": today.isoformat(),
        "$lte": (today + timedelta(days=days_ahead)).isoformat(),
    }
    cursor = db.forecast_occupancy.find(q, {"_id": 0}).sort([("date", 1), ("property_id", 1)])
    return await cursor.to_list(length=5000)


def summarize(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Portfolio-level stats over a set of forecast rows."""
    if not rows:
        return {"avg_next_7_days": 0.0, "peak_date": None, "peak_pct": 0.0, "critical_count": 0}
    today = datetime.now(timezone.utc).date()
    next7 = [r for r in rows if r["date"] <= (today + timedelta(days=7)).isoformat()]
    avg_next_7 = round(sum(r["occupancy_pct"] for r in next7) / len(next7), 1) if next7 else 0.0
    peak = max(rows, key=lambda r: r["occupancy_pct"])
    critical_props = {r["property_id"] for r in rows if r["occupancy_bucket"] == "Critical"}
    return {
        "avg_next_7_days": avg_next_7,
        "peak_date": peak["date"],
        "peak_pct": peak["occupancy_pct"],
        "critical_count": len(critical_props),
    }
