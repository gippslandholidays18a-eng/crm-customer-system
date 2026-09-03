"""
Stage 8 — Guest Inbox service.

Centralised store of guest communications (emails, review echoes, form
submissions). One document per message; a conversation is a set of messages
sharing a `thread_id`. AI drafting is intentionally stubbed for now (returns a
"coming soon" marker) — the frontend renders a manual reply flow. Actual
send uses Resend (same integration Stage 4.5 already relies on).
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import resend


SENTIMENTS = {"positive", "neutral", "negative"}
SOURCES = {"email", "review", "form_submission"}
STATUSES = {"New", "AI Draft Ready", "Replied", "Archived"}

AI_COMING_SOON_MARKER = (
    "AI drafting is coming soon. Write your reply below and it will be sent to the guest."
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_message(
    *,
    source: str,
    from_guest_email: str,
    from_guest_name: str,
    subject: str,
    body: str,
    property_id: Optional[str] = None,
    property_name: Optional[str] = None,
    related_reservation_id: Optional[str] = None,
    sentiment: str = "neutral",
    urgent: bool = False,
    thread_id: Optional[str] = None,
    attachments: Optional[List[str]] = None,
    read: bool = False,
    status: str = "New",
    direction: str = "inbound",
) -> Dict[str, Any]:
    ts = now_iso()
    return {
        "id": str(uuid.uuid4()),
        "message_id": str(uuid.uuid4()),
        "source": source if source in SOURCES else "email",
        "from_guest_email": (from_guest_email or "").strip().lower(),
        "from_guest_name": (from_guest_name or "").strip(),
        "property_id": property_id,
        "property_name": property_name,
        "related_reservation_id": related_reservation_id,
        "subject": (subject or "").strip() or "(no subject)",
        "body": body or "",
        "attachments": attachments or [],
        "sentiment": sentiment if sentiment in SENTIMENTS else "neutral",
        "urgent": bool(urgent) or (sentiment == "negative"),
        "read": bool(read),
        "archived": False,
        "thread_id": thread_id or str(uuid.uuid4()),
        "ai_draft_ready": False,
        "ai_draft_body": "",
        "status": status if status in STATUSES else "New",
        "direction": direction,  # inbound|outbound
        "received_at": ts,
        "created_at": ts,
        "updated_at": ts,
    }


async def list_inbox(
    db,
    *,
    status: Optional[str] = None,
    sentiment: Optional[str] = None,
    property_id: Optional[str] = None,
    days: Optional[int] = None,
    q: Optional[str] = None,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    query: Dict[str, Any] = {"direction": "inbound"}
    if status and status != "All":
        if status == "Archived":
            query["archived"] = True
        else:
            query["status"] = status
            query["archived"] = False
    else:
        query["archived"] = {"$ne": True}
    if sentiment and sentiment != "All":
        if sentiment.lower() == "urgent":
            query["urgent"] = True
        else:
            query["sentiment"] = sentiment.lower()
    if property_id and property_id != "all":
        query["property_id"] = property_id
    if days:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        query["received_at"] = {"$gte": cutoff}
    if q and len(q.strip()) >= 3:
        rx = {"$regex": q.strip(), "$options": "i"}
        query["$or"] = [{"body": rx}, {"subject": rx},
                        {"from_guest_name": rx}, {"from_guest_email": rx},
                        {"property_name": rx}]

    cursor = db.inbox_messages.find(query, {"_id": 0}).sort("received_at", -1).limit(limit)
    return await cursor.to_list(length=limit)


async def get_thread(db, thread_id: str) -> List[Dict[str, Any]]:
    cursor = db.inbox_messages.find({"thread_id": thread_id}, {"_id": 0}).sort("created_at", 1)
    return await cursor.to_list(length=500)


async def mark_read(db, message_id: str, read: bool = True) -> Optional[Dict[str, Any]]:
    ts = now_iso()
    result = await db.inbox_messages.find_one_and_update(
        {"$or": [{"id": message_id}, {"message_id": message_id}]},
        {"$set": {"read": read, "updated_at": ts}},
        projection={"_id": 0},
        return_document=True,
    )
    return result


async def archive_message(db, message_id: str, archived: bool = True) -> Optional[Dict[str, Any]]:
    ts = now_iso()
    new_status = "Archived" if archived else "New"
    result = await db.inbox_messages.find_one_and_update(
        {"$or": [{"id": message_id}, {"message_id": message_id}]},
        {"$set": {"archived": archived, "status": new_status, "updated_at": ts}},
        projection={"_id": 0},
        return_document=True,
    )
    return result


async def draft_reply_stub(db, message_id: str) -> Optional[Dict[str, Any]]:
    """AI drafting placeholder — sets ai_draft_ready False and returns marker."""
    ts = now_iso()
    result = await db.inbox_messages.find_one_and_update(
        {"$or": [{"id": message_id}, {"message_id": message_id}]},
        {"$set": {
            "ai_draft_ready": False,
            "ai_draft_body": AI_COMING_SOON_MARKER,
            "updated_at": ts,
        }},
        projection={"_id": 0},
        return_document=True,
    )
    return result


async def send_reply(
    db,
    message_id: str,
    reply_body: str,
    reply_from: Dict[str, Any],
) -> Dict[str, Any]:
    """Send a reply via Resend, log outbound message in the same thread."""
    if not (reply_body or "").strip():
        return {"ok": False, "error": "Reply body is empty"}

    original = await db.inbox_messages.find_one(
        {"$or": [{"id": message_id}, {"message_id": message_id}]}, {"_id": 0},
    )
    if not original:
        return {"ok": False, "error": "Original message not found"}

    api_key = os.environ.get("RESEND_API_KEY")
    sender_name = os.environ.get("SENDER_NAME", "Gippsland Holidays")
    sender_email = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
    to_email = original.get("from_guest_email") or ""
    if not to_email:
        return {"ok": False, "error": "Original message has no guest email"}

    subject = original.get("subject") or "(no subject)"
    if not subject.lower().startswith("re:"):
        subject = f"Re: {subject}"

    resend_id: Optional[str] = None
    error: Optional[str] = None
    if not api_key:
        error = "RESEND_API_KEY not configured"
    else:
        resend.api_key = api_key
        params = {
            "from": f"{sender_name} <{sender_email}>",
            "to": [to_email],
            "subject": subject,
            "text": reply_body,
        }
        try:
            resp = await asyncio.to_thread(resend.Emails.send, params)
            resend_id = resp.get("id") if isinstance(resp, dict) else None
        except Exception as e:  # noqa: BLE001
            error = str(e)

    ts = now_iso()

    # Persist outbound message on the same thread
    outbound = build_message(
        source="email",
        from_guest_email=to_email,  # thread pivot key
        from_guest_name=original.get("from_guest_name") or "",
        subject=subject,
        body=reply_body,
        property_id=original.get("property_id"),
        property_name=original.get("property_name"),
        related_reservation_id=original.get("related_reservation_id"),
        sentiment="neutral",
        thread_id=original.get("thread_id"),
        status="Replied",
        direction="outbound",
        read=True,
    )
    outbound["sent_by_user_id"] = reply_from.get("id")
    outbound["sent_by_user_name"] = reply_from.get("name")
    outbound["resend_id"] = resend_id
    outbound["send_error"] = error
    await db.inbox_messages.insert_one(outbound.copy())

    # Mark original replied
    await db.inbox_messages.update_one(
        {"$or": [{"id": message_id}, {"message_id": message_id}]},
        {"$set": {"status": "Replied", "read": True, "updated_at": ts}},
    )

    if error:
        return {"ok": False, "error": error, "message": outbound}
    return {"ok": True, "message": outbound, "resend_id": resend_id}


def summarize_thread(msg: Dict[str, Any]) -> Dict[str, Any]:
    body = msg.get("body") or ""
    return {
        **msg,
        "preview": (body[:100] + ("…" if len(body) > 100 else "")),
    }
