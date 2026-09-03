"""
Stage 8 — Notifications service.

Simple bell-in-header notification centre. Auto-expires after 24h. Emits on:
  - inbox_message: any new inbound inbox message with read=false
  - urgent_message: sentiment=negative or urgent=true
  - overdue_task: daily 08:00 sweep of tasks with due_date < today AND status != completed
  - turnover: daily 08:00 sweep of reservations with same-day checkout+checkin
  - quote_reply: placeholder for Stage 9 (never fires until quotes exist)

Cleanup job at 02:00 daily removes expired records.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional


TYPES = {"inbox_message", "urgent_message", "overdue_task", "turnover", "quote_reply"}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now_utc().isoformat()


def build_notification(
    *,
    type_: str,
    title: str,
    message: str,
    target_url: str,
    ttl_hours: int = 24,
) -> Dict[str, Any]:
    n = now_utc()
    return {
        "id": str(uuid.uuid4()),
        "type": type_ if type_ in TYPES else "inbox_message",
        "title": title,
        "message": message,
        "target_url": target_url,
        "read": False,
        "created_at": n.isoformat(),
        "expires_at": (n + timedelta(hours=ttl_hours)).isoformat(),
    }


async def create(db, **kwargs) -> Dict[str, Any]:
    doc = build_notification(**kwargs)
    await db.notifications.insert_one(doc.copy())
    return doc


async def list_recent(db, *, only_unread: bool = False, limit: int = 20) -> List[Dict[str, Any]]:
    now = now_iso()
    q: Dict[str, Any] = {"expires_at": {"$gte": now}}
    if only_unread:
        q["read"] = False
    cursor = db.notifications.find(q, {"_id": 0}).sort("created_at", -1).limit(limit)
    return await cursor.to_list(length=limit)


async def unread_count(db) -> int:
    now = now_iso()
    return await db.notifications.count_documents({"read": False, "expires_at": {"$gte": now}})


async def mark_read(db, nid: str) -> Optional[Dict[str, Any]]:
    return await db.notifications.find_one_and_update(
        {"id": nid}, {"$set": {"read": True}},
        projection={"_id": 0}, return_document=True,
    )


async def mark_all_read(db) -> int:
    r = await db.notifications.update_many({"read": False}, {"$set": {"read": True}})
    return r.modified_count


async def cleanup_expired(db) -> int:
    now = now_iso()
    r = await db.notifications.delete_many({"expires_at": {"$lt": now}})
    return r.deleted_count


# ---- Scheduled jobs (called from APScheduler) --------------------------------

async def check_overdue_tasks(db) -> Optional[Dict[str, Any]]:
    today = now_utc().date().isoformat()
    q = {"due_date": {"$lt": today}, "status": {"$nin": ["completed", "cancelled", "archived"]}}
    count = await db.tasks.count_documents(q)
    if count <= 0:
        return None
    return await create(
        db,
        type_="overdue_task",
        title="Overdue maintenance",
        message=f"{count} task{'s' if count != 1 else ''} past their due date",
        target_url="/tasks?overdue=1",
    )


async def check_turnovers(db) -> Optional[Dict[str, Any]]:
    today = now_utc().date().isoformat()
    checkouts = await db.reservations.find(
        {"$or": [{"checkout_date": today}, {"check_out_date": today}]},
        {"_id": 0, "property_name": 1},
    ).to_list(length=200)
    checkins = await db.reservations.find(
        {"$or": [{"checkin_date": today}, {"check_in_date": today}]},
        {"_id": 0, "property_name": 1},
    ).to_list(length=200)
    checkout_props = {r.get("property_name") for r in checkouts if r.get("property_name")}
    checkin_props = {r.get("property_name") for r in checkins if r.get("property_name")}
    overlap = checkout_props & checkin_props
    if not overlap:
        return None
    props = ", ".join(sorted(overlap)[:8])
    return await create(
        db,
        type_="turnover",
        title="Same-day turnovers today",
        message=f"{len(overlap)} propert{'ies' if len(overlap) != 1 else 'y'}: {props}",
        target_url="/dashboard/command-centre",
    )


async def emit_inbox_notification(db, message: Dict[str, Any]) -> None:
    """Called synchronously after inbox message insert."""
    guest = message.get("from_guest_name") or message.get("from_guest_email") or "guest"
    subject = (message.get("subject") or "(no subject)")[:80]
    if message.get("urgent") or message.get("sentiment") == "negative":
        await create(
            db,
            type_="urgent_message",
            title=f"Urgent message from {guest}",
            message=subject,
            target_url="/inbox",
        )
    else:
        await create(
            db,
            type_="inbox_message",
            title=f"New message from {guest}",
            message=subject,
            target_url="/inbox",
        )
