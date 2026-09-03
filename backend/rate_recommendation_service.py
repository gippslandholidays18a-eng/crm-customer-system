"""
Stage 9.5 — Rate recommendation engine.

For each property × date in the next 30 days:
  read forecast_occupancy + pricing_calendar + rate_correlation
  → decision tree (REDUCE / MAINTAIN / INCREASE)
  → suggested_rate (base × adjustment)
  → alert_severity + alert_message
  → dedupe: at most ONE alert per property per day-of-recommendation-batch
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional


REC_REDUCE = "REDUCE_RATE"
REC_MAINTAIN = "MAINTAIN_RATE"
REC_INCREASE = "INCREASE_RATE"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _decide(occ_pct: float, elasticity: float) -> Dict[str, Any]:
    """Return {recommendation, adjustment_pct, alert_severity, reason_key}."""
    if occ_pct < 30:
        # Critical — bigger cut for more elastic properties
        adj = -25 if elasticity <= -1.5 else -15
        return {"recommendation": REC_REDUCE, "adjustment_pct": adj,
                "alert_severity": "critical",
                "reason_key": "critical_low"}
    if occ_pct < 50:
        adj = -15 if elasticity <= -1.5 else -5
        return {"recommendation": REC_REDUCE, "adjustment_pct": adj,
                "alert_severity": "warning",
                "reason_key": "low_opportunity"}
    if occ_pct < 80:
        return {"recommendation": REC_MAINTAIN, "adjustment_pct": 0,
                "alert_severity": "info",
                "reason_key": "healthy"}
    adj = 20 if occ_pct >= 90 else 10
    return {"recommendation": REC_INCREASE, "adjustment_pct": adj,
            "alert_severity": "success",
            "reason_key": "peak_opportunity"}


def _reason(reason_key: str, ctx: Dict[str, Any]) -> str:
    e = ctx.get("elasticity_score", 0.0)
    occ = ctx.get("occupancy_forecast", 0)
    adj = ctx.get("adjustment_pct", 0)
    if reason_key == "critical_low":
        return (f"Low occupancy ahead ({occ}% in 7-day window). Historical elasticity "
                f"{e:+.1f} — dropping rate should lift bookings.")
    if reason_key == "low_opportunity":
        return (f"Below-average occupancy ({occ}%). Room to stimulate demand with a "
                f"{adj}% rate cut without heavy discount.")
    if reason_key == "healthy":
        return f"Occupancy is healthy ({occ}%). Current rate is working; leave it."
    if reason_key == "peak_opportunity":
        return (f"High demand ({occ}%). A +{adj}% rate is historically sustainable at this "
                f"occupancy level.")
    return ""


def _alert(reason_key: str, prop_name: str, occ: float, adj: float,
           suggested: float, date_str: str) -> Optional[Dict[str, Any]]:
    if reason_key in ("critical_low",):
        return {
            "severity": "critical",
            "title": f"Revenue at risk — {prop_name}",
            "message": (f"{prop_name} only {occ}% booked around {date_str}. "
                        f"Consider a {adj}% cut to ${suggested:.0f}/night."),
        }
    if reason_key == "low_opportunity":
        return {
            "severity": "warning",
            "title": f"Rate opportunity — {prop_name}",
            "message": (f"{prop_name} is {occ}% booked around {date_str}. Reduce by "
                        f"{adj}% to ${suggested:.0f}/night."),
        }
    if reason_key == "peak_opportunity":
        return {
            "severity": "success",
            "title": f"Revenue opportunity — {prop_name}",
            "message": (f"{prop_name} is {occ}% booked around {date_str}. Raise "
                        f"+{adj}% to ${suggested:.0f}/night."),
        }
    if reason_key == "healthy":
        return {"severity": "info", "title": "", "message": ""}
    return None


async def refresh_recommendations(
    db, property_id: Optional[str] = None, *, days_ahead: int = 30,
) -> Dict[str, Any]:
    """Rebuild recommendations for one or all properties."""
    props_q = {"id": property_id} if property_id else {}
    props = await db.properties.find(props_q, {"_id": 0, "id": 1, "name": 1}).to_list(length=500)
    ts = now_iso()

    # Preload elasticity per property
    elast_by_prop: Dict[str, float] = {}
    async for row in db.rate_correlation.aggregate([
        {"$group": {"_id": "$property_id", "e": {"$avg": "$elasticity_score"}}},
    ]):
        elast_by_prop[row["_id"]] = float(row["e"] or 0)

    today = datetime.now(timezone.utc).date()
    total_written = 0
    for p in props:
        pid = p["id"]
        elasticity = elast_by_prop.get(pid, 0.0)
        forecast_rows = await db.forecast_occupancy.find(
            {"property_id": pid, "date": {"$gte": today.isoformat(),
                                           "$lte": (today + timedelta(days=days_ahead)).isoformat()}},
            {"_id": 0},
        ).sort([("date", 1)]).to_list(length=days_ahead + 5)
        pricing_rows = await db.pricing_calendar.find(
            {"property_id": pid, "date": {"$gte": today.isoformat(),
                                           "$lte": (today + timedelta(days=days_ahead)).isoformat()}},
            {"_id": 0},
        ).to_list(length=days_ahead + 5)
        pricing_by_date = {r["date"]: r for r in pricing_rows}

        # Preserve dismissed IDs so we don't resurface them after refresh
        existing = await db.rate_recommendations.find(
            {"property_id": pid, "date": {"$gte": today.isoformat()}},
            {"_id": 0, "date": 1, "dismissed": 1, "id": 1, "created_at": 1},
        ).to_list(length=days_ahead + 5)
        dismissed_dates = {r["date"] for r in existing if r.get("dismissed")}

        await db.rate_recommendations.delete_many(
            {"property_id": pid, "date": {"$gte": today.isoformat()}},
        )

        rec_docs: List[Dict[str, Any]] = []
        alerts_seen: set = set()
        for f in forecast_rows:
            d = f["date"]
            occ = float(f["occupancy_pct"])
            price = pricing_by_date.get(d)
            base_rate = float(price.get("base_nightly_rate")) if price else 0.0
            current_rate = float(price.get("final_nightly_rate")) if price else 0.0
            decision = _decide(occ, elasticity)
            adj = decision["adjustment_pct"]
            suggested = round(current_rate * (1 + adj / 100), 2) if current_rate else 0.0
            ctx = {"elasticity_score": elasticity, "occupancy_forecast": occ,
                   "adjustment_pct": adj}
            reasoning = _reason(decision["reason_key"], ctx)
            alert = _alert(decision["reason_key"], p.get("name") or "", occ,
                           adj, suggested, d)
            alert_severity = alert["severity"] if alert else "none"
            alert_message = alert["message"] if alert else ""
            dismissed = d in dismissed_dates
            rec_docs.append({
                "id": str(uuid.uuid4()),
                "property_id": pid,
                "property_name": p.get("name"),
                "date": d,
                "current_rate": current_rate,
                "recommendation": decision["recommendation"],
                "suggested_rate": suggested,
                "adjustment_pct": adj,
                "occupancy_forecast": occ,
                "occupancy_bucket": f["occupancy_bucket"],
                "elasticity_score": elasticity,
                "reasoning": reasoning,
                "confidence": float(f.get("confidence_score") or 0.75),
                "alert_severity": alert_severity,
                "alert_message": alert_message,
                "reason_key": decision["reason_key"],
                "dismissed": dismissed,
                "created_at": ts,
                "updated_at": ts,
            })
            if alert:
                alerts_seen.add(pid)

        if rec_docs:
            await db.rate_recommendations.insert_many([d.copy() for d in rec_docs])
        total_written += len(rec_docs)

    return {"properties": len(props), "recommendations_written": total_written}


async def get_recommendations(
    db, property_id: Optional[str] = None, *, days_ahead: int = 30,
    include_dismissed: bool = False,
) -> List[Dict[str, Any]]:
    today = datetime.now(timezone.utc).date()
    q: Dict[str, Any] = {"date": {"$gte": today.isoformat(),
                                   "$lte": (today + timedelta(days=days_ahead)).isoformat()}}
    if property_id and property_id != "all":
        q["property_id"] = property_id
    if not include_dismissed:
        q["dismissed"] = {"$ne": True}
    cursor = db.rate_recommendations.find(q, {"_id": 0}).sort([
        ("date", 1), ("alert_severity", -1),
    ])
    return await cursor.to_list(length=2000)


async def dismiss(db, rec_id: str) -> Optional[Dict[str, Any]]:
    r = await db.rate_recommendations.find_one_and_update(
        {"id": rec_id}, {"$set": {"dismissed": True, "updated_at": now_iso()}},
        projection={"_id": 0}, return_document=True,
    )
    return r


async def apply_to_pricing(db, rec_id: str, pricing_service) -> Dict[str, Any]:
    """Update pricing_calendar.final_nightly_rate to the suggested rate for that date."""
    rec = await db.rate_recommendations.find_one({"id": rec_id}, {"_id": 0})
    if not rec:
        return {"ok": False, "error": "Recommendation not found"}
    price = await db.pricing_calendar.find_one(
        {"property_id": rec["property_id"], "date": rec["date"]}, {"_id": 0},
    )
    base = float(price.get("base_nightly_rate")) if price else float(rec.get("current_rate") or 0)
    if not base:
        return {"ok": False, "error": "No base rate set"}
    if not rec.get("suggested_rate"):
        return {"ok": False, "error": "No suggested rate to apply"}
    new_mult = round(float(rec["suggested_rate"]) / base, 3)
    prev_notes = (price or {}).get("notes") or ""
    combined_notes = (prev_notes + " (auto: rate rec)").strip()
    await pricing_service.upsert_cell(
        db, rec["property_id"], rec["date"], {
            "base_nightly_rate": base,
            "multiplier": new_mult,
            "notes": combined_notes,
        },
    )
    await db.rate_recommendations.update_one(
        {"id": rec_id},
        {"$set": {"applied_at": now_iso(), "dismissed": True, "updated_at": now_iso()}},
    )
    return {"ok": True, "new_final_rate": round(base * new_mult, 2), "multiplier": new_mult}


def portfolio_summary(recs: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_rec: Dict[str, int] = {}
    critical = warning = success = 0
    for r in recs:
        by_rec[r["recommendation"]] = by_rec.get(r["recommendation"], 0) + 1
        sev = r.get("alert_severity")
        if sev == "critical":
            critical += 1
        elif sev == "warning":
            warning += 1
        elif sev == "success":
            success += 1
    return {
        "total": len(recs),
        "by_recommendation": by_rec,
        "critical": critical,
        "warning": warning,
        "success": success,
    }
