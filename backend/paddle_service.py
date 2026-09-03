"""
Stage 8 — Paddle & Pedal Paynesville bookings.

Simple CRUD collection linking each activity booking to a guest + property.
Manual entry for now (no upstream vendor API); the shape supports being
piped in later if Paddle Paynesville exposes one.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional


ACTIVITY_TYPES = {"Paddle", "Pedal"}
STATUSES = {"confirmed", "completed", "cancelled"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_booking(
    *,
    guest_name: str,
    activity_type: str,
    booking_date: str,
    booking_time: str,
    duration_hours: float,
    total_price: float,
    guest_email: Optional[str] = None,
    guest_id: Optional[str] = None,
    property_id: Optional[str] = None,
    property_name: Optional[str] = None,
    notes: Optional[str] = None,
    status: str = "confirmed",
) -> Dict[str, Any]:
    ts = now_iso()
    return {
        "id": str(uuid.uuid4()),
        "booking_id": str(uuid.uuid4()),
        "guest_id": guest_id,
        "guest_name": (guest_name or "").strip(),
        "guest_email": (guest_email or "").strip().lower(),
        "property_id": property_id,
        "property_name": property_name,
        "activity_type": activity_type if activity_type in ACTIVITY_TYPES else "Paddle",
        "booking_date": booking_date,
        "booking_time": booking_time or "09:00",
        "duration_hours": float(duration_hours or 1),
        "total_price": float(total_price or 0),
        "status": status if status in STATUSES else "confirmed",
        "notes": notes or "",
        "created_at": ts,
        "updated_at": ts,
    }
