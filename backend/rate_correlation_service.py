"""
Stage 9.5 — Historical rate–occupancy correlation.

Groups the last 52 weeks of reservations by property × ISO-week, computes
avg_nightly_rate, weekly occupancy (booked nights / 7), and an elasticity
score = mean(Δocc% / Δrate%) across consecutive weeks. Also flags weeks
where the rate dropped >20% vs prior week as promotional.
"""

from __future__ import annotations

import statistics
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from pricing_service import suggest_season


LOOKBACK_WEEKS = 52


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_date(v: Any) -> Optional[date]:
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v)[:10]).date()
    except Exception:
        return None


def _iso_week_start(d: date) -> date:
    return d - timedelta(days=d.isoweekday() - 1)  # Monday


async def _load_reservations(db, since: date) -> List[Dict[str, Any]]:
    q = {"is_cancelled": {"$ne": True}}
    cursor = db.reservations.find(q, {
        "_id": 0, "property_id": 1, "property_name": 1,
        "checkin_date": 1, "check_in_date": 1,
        "checkout_date": 1, "check_out_date": 1,
        "booking_value": 1, "nights": 1,
        "classified_source": 1, "raw_booking_source": 1,
    })
    items = await cursor.to_list(length=20000)
    out = []
    for r in items:
        ci = _parse_date(r.get("checkin_date") or r.get("check_in_date"))
        co = _parse_date(r.get("checkout_date") or r.get("check_out_date"))
        if not ci or not co or co <= ci:
            continue
        if co < since:
            continue
        r["_ci"] = ci
        r["_co"] = co
        out.append(r)
    return out


def _direct_or_ota(src: str) -> str:
    s = (src or "").lower()
    if "direct" in s or "phone" in s or "email" in s or "website" in s:
        return "direct"
    return "ota"


def _slice_by_week(res: List[Dict[str, Any]], week_start: date) -> Dict[str, Any]:
    """Return stats for a single week [week_start, week_start+7)."""
    week_end = week_start + timedelta(days=7)
    booked_dates: set = set()
    rates: List[float] = []
    direct = ota = 0
    booking_count = 0
    for r in res:
        # overlap of stay with the week
        s = max(r["_ci"], week_start)
        e = min(r["_co"], week_end)
        if e <= s:
            continue
        nights = (e - s).days
        if nights <= 0:
            continue
        # per-night rate from booking_value / stay nights
        total = float(r.get("booking_value") or 0.0)
        stay_nights = max((r["_co"] - r["_ci"]).days, 1)
        per_night = total / stay_nights if stay_nights else 0.0
        if per_night > 0:
            rates.append(per_night)
        # add booked dates
        d = s
        while d < e:
            booked_dates.add(d)
            d += timedelta(days=1)
        booking_count += 1
        if _direct_or_ota(r.get("classified_source") or r.get("raw_booking_source") or "") == "direct":
            direct += 1
        else:
            ota += 1

    occ_nights = len(booked_dates)
    occ_pct = round((occ_nights / 7) * 100, 1)
    avg_rate = round(statistics.fmean(rates), 2) if rates else 0.0
    total_bookings = direct + ota
    direct_pct = round((direct / total_bookings) * 100, 1) if total_bookings else 0.0
    ota_pct = round((ota / total_bookings) * 100, 1) if total_bookings else 0.0
    return {
        "avg_nightly_rate": avg_rate,
        "occupancy_pct": occ_pct,
        "booking_count": booking_count,
        "direct_pct": direct_pct,
        "ota_pct": ota_pct,
    }


def _elasticity(weeks: List[Dict[str, Any]]) -> float:
    """Median of Δocc% / Δrate% over consecutive weeks. Neg = price-sensitive."""
    ratios: List[float] = []
    for prev, cur in zip(weeks, weeks[1:]):
        if not prev.get("avg_nightly_rate") or not cur.get("avg_nightly_rate"):
            continue
        r_prev, r_cur = prev["avg_nightly_rate"], cur["avg_nightly_rate"]
        if r_prev == 0:
            continue
        drate_pct = (r_cur - r_prev) / r_prev * 100
        if abs(drate_pct) < 1:
            continue  # ignore noise
        docc_pct = cur["occupancy_pct"] - prev["occupancy_pct"]
        ratios.append(docc_pct / drate_pct)
    if not ratios:
        return 0.0
    return round(statistics.median(ratios), 2)


async def refresh_correlation(db) -> Dict[str, Any]:
    today = datetime.now(timezone.utc).date()
    monday = _iso_week_start(today)
    since = monday - timedelta(weeks=LOOKBACK_WEEKS)

    props = await db.properties.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(length=500)
    all_reservations = await _load_reservations(db, since)
    by_prop: Dict[str, List[Dict[str, Any]]] = {}
    for r in all_reservations:
        by_prop.setdefault(r.get("property_id") or "", []).append(r)

    ts = now_iso()
    total_rows = 0
    for p in props:
        pid = p["id"]
        prop_res = by_prop.get(pid, [])
        weeks: List[Dict[str, Any]] = []
        for i in range(LOOKBACK_WEEKS):
            ws = monday - timedelta(weeks=(LOOKBACK_WEEKS - i))
            stats = _slice_by_week(prop_res, ws)
            weeks.append({
                "date_start": ws.isoformat(),
                "date_end": (ws + timedelta(days=6)).isoformat(),
                "week": ws.isocalendar()[1],
                "year": ws.isocalendar()[0],
                "season": suggest_season(ws + timedelta(days=3)),
                **stats,
            })

        # promotional weeks
        for prev, cur in zip(weeks, weeks[1:]):
            if prev["avg_nightly_rate"] and cur["avg_nightly_rate"]:
                drop = (prev["avg_nightly_rate"] - cur["avg_nightly_rate"]) / prev["avg_nightly_rate"]
                cur["was_promotional"] = drop > 0.20
            else:
                cur["was_promotional"] = False
        if weeks:
            weeks[0]["was_promotional"] = False

        elast = _elasticity(weeks)
        confidence = min(1.0, sum(1 for w in weeks if w["booking_count"] > 0) / max(len(weeks), 1))

        await db.rate_correlation.delete_many({"property_id": pid})
        docs = []
        for w in weeks:
            docs.append({
                "id": str(uuid.uuid4()),
                "property_id": pid,
                "property_name": p.get("name"),
                "elasticity_score": elast,
                "confidence": round(confidence, 2),
                "created_at": ts,
                **w,
            })
        if docs:
            await db.rate_correlation.insert_many([d.copy() for d in docs])
        total_rows += len(docs)

    return {"properties": len(props), "weeks_written": total_rows}


async def get_correlation(db, property_id: Optional[str] = None) -> List[Dict[str, Any]]:
    q = {"property_id": property_id} if property_id and property_id != "all" else {}
    cursor = db.rate_correlation.find(q, {"_id": 0}).sort([("date_start", 1)])
    return await cursor.to_list(length=5000)


async def elasticity_summary(db) -> List[Dict[str, Any]]:
    """One row per property: latest elasticity_score, best season, best avg rate."""
    props = await db.properties.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(length=500)
    out = []
    for p in props:
        weeks = await db.rate_correlation.find(
            {"property_id": p["id"]}, {"_id": 0},
        ).sort([("date_start", 1)]).to_list(length=200)
        if not weeks:
            continue
        by_season: Dict[str, List[Dict[str, Any]]] = {}
        for w in weeks:
            by_season.setdefault(w["season"], []).append(w)
        best_season = None
        best_rate = 0.0
        for s, ws in by_season.items():
            rates = [w["avg_nightly_rate"] for w in ws if w["avg_nightly_rate"] > 0]
            if not rates:
                continue
            m = statistics.fmean(rates)
            if m > best_rate:
                best_rate = m
                best_season = s
        out.append({
            "property_id": p["id"],
            "property_name": p["name"],
            "elasticity_score": weeks[-1].get("elasticity_score", 0.0),
            "confidence": weeks[-1].get("confidence", 0.0),
            "best_season": best_season,
            "best_season_avg_rate": round(best_rate, 2),
            "total_weeks_analyzed": len(weeks),
        })
    return out
