"""
Stage 8 — RoomMaster webhook processor.

Receives inbound reservation events from RoomMaster PMS, validates the payload,
matches the property, and upserts into the existing `reservations` collection
using `reservation_id` as the unique key. Also logs every webhook to
`roommaster_webhook_logs` (regardless of outcome) so operators can debug
delivery from the app itself.

Additive only — same collection, same reservation_id key as Stage 1 CSV
imports, so downstream analytics/scoring/segmentation work unchanged.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple


ALLOWED_EVENTS = {"Reservation Initialization", "Reservation Update"}
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _split_name(full: str) -> Tuple[str, str]:
    parts = (full or "").strip().split(maxsplit=1)
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], parts[1]


def _classify_source(raw: str) -> str:
    """Cheap classifier aligned with Stage 1 taxonomy."""
    r = (raw or "").strip().lower()
    if not r:
        return "Unknown"
    if "booking" in r:
        return "Booking.com"
    if "airbnb" in r:
        return "Airbnb"
    if "expedia" in r:
        return "Expedia"
    if "stayz" in r or "vrbo" in r:
        return "Stayz/VRBO"
    if r in {"direct", "phone", "email", "website"} or "direct" in r:
        return "Direct"
    return "Other"


def validate_payload(payload: Dict[str, Any]) -> Optional[str]:
    """Return an error string if invalid, else None."""
    if not isinstance(payload, dict):
        return "Payload must be a JSON object"

    event = payload.get("event_type")
    if event not in ALLOWED_EVENTS:
        return f"Unsupported event_type '{event}'"

    for field in ("reservation_id", "property_name", "guest_name", "guest_email",
                  "check_in", "check_out", "booking_source", "total_value", "status"):
        if payload.get(field) in (None, ""):
            return f"Missing required field '{field}'"

    email = str(payload.get("guest_email"))
    if not EMAIL_RE.match(email):
        return f"Invalid guest_email '{email}'"

    ci, co = str(payload.get("check_in")), str(payload.get("check_out"))
    try:
        d1 = datetime.fromisoformat(ci).date()
        d2 = datetime.fromisoformat(co).date()
    except Exception:
        return "check_in/check_out must be YYYY-MM-DD"
    if not (d1 < d2):
        return "check_in must be earlier than check_out"

    try:
        float(payload.get("total_value"))
    except Exception:
        return "total_value must be numeric"

    return None


async def process_webhook(db, payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validate → resolve property → upsert reservation → write webhook log.
    Returns { ok, status, reservation_id, action, message }.
    Never raises — callers translate to HTTP status.
    """
    ts = now_iso()
    event = payload.get("event_type") if isinstance(payload, dict) else None
    rid_raw = payload.get("reservation_id") if isinstance(payload, dict) else None

    err = validate_payload(payload)
    if err:
        await db.roommaster_webhook_logs.insert_one({
            "id": str(uuid.uuid4()),
            "received_at": ts,
            "event_type": event,
            "reservation_id": rid_raw,
            "status": "rejected",
            "reason": err,
            "payload": payload if isinstance(payload, dict) else {"raw": str(payload)},
        })
        return {"ok": False, "status": "rejected", "reason": err}

    rid = str(payload["reservation_id"]).strip()
    property_name = str(payload["property_name"]).strip()

    prop = await db.properties.find_one({"name": property_name}, {"_id": 0, "id": 1, "name": 1})
    if not prop:
        reason = f"Property '{property_name}' not found — reservation skipped"
        await db.roommaster_webhook_logs.insert_one({
            "id": str(uuid.uuid4()),
            "received_at": ts,
            "event_type": event,
            "reservation_id": rid,
            "status": "skipped",
            "reason": reason,
            "payload": payload,
        })
        return {"ok": False, "status": "skipped", "reason": reason}

    first, last = _split_name(str(payload.get("guest_name", "")))
    raw_source = str(payload.get("booking_source", ""))
    status = str(payload.get("status", "")).lower()
    is_cancelled = status == "cancelled"

    doc = {
        "reservation_id": rid,
        "property_id": prop["id"],
        "property_name": property_name,
        "guest_name": str(payload.get("guest_name", "")).strip(),
        "guest_first_name": first,
        "guest_last_name": last,
        "guest_email": str(payload.get("guest_email", "")).strip().lower(),
        "guest_phone": str(payload.get("guest_phone", "")).strip(),
        "checkin_date": str(payload.get("check_in")),
        "check_in_date": str(payload.get("check_in")),
        "checkout_date": str(payload.get("check_out")),
        "check_out_date": str(payload.get("check_out")),
        "raw_booking_source": raw_source,
        "booking_source": raw_source,
        "classified_source": _classify_source(raw_source),
        "booking_value": float(payload.get("total_value") or 0.0),
        "ota_commission": float(payload.get("ota_commission") or 0.0),
        "status": status,
        "is_cancelled": is_cancelled,
        "manually_overridden": False,
        "updated_at": ts,
    }

    # nights
    try:
        d1 = datetime.fromisoformat(doc["checkin_date"]).date()
        d2 = datetime.fromisoformat(doc["checkout_date"]).date()
        doc["nights"] = (d2 - d1).days
    except Exception:
        doc["nights"] = None

    existing = await db.reservations.find_one({"reservation_id": rid}, {"_id": 0, "id": 1, "received_at": 1})
    if existing:
        # Preserve original id + received_at
        doc["id"] = existing.get("id") or str(uuid.uuid4())
        doc["received_at"] = existing.get("received_at") or ts
        await db.reservations.update_one({"reservation_id": rid}, {"$set": doc})
        action = "updated"
    else:
        doc["id"] = str(uuid.uuid4())
        doc["received_at"] = ts
        doc["imported_at"] = ts
        await db.reservations.insert_one(doc.copy())
        action = "created"

    await db.roommaster_webhook_logs.insert_one({
        "id": str(uuid.uuid4()),
        "received_at": ts,
        "event_type": event,
        "reservation_id": rid,
        "status": "received",
        "action": action,
        "reason": None,
        "payload": payload,
    })

    return {"ok": True, "status": "received", "reservation_id": rid, "action": action}
