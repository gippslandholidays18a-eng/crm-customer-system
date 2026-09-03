"""Stage 7 — Team noticeboard announcements."""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

PRIORITIES = ["Normal", "Urgent"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_announcement(*, title: str, body: str, priority: str,
                       posted_by: str, posted_by_name: str) -> Dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "title": title.strip(),
        "body": body.strip(),
        "priority": priority if priority in PRIORITIES else "Normal",
        "posted_by": posted_by,
        "posted_by_name": posted_by_name,
        "posted_at": now_iso(),
        "dismissed_by": [],
    }


def sort_announcements(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Urgent first (newest), then Normal (newest)."""
    urgent = [a for a in items if a.get("priority") == "Urgent"]
    normal = [a for a in items if a.get("priority") != "Urgent"]
    urgent.sort(key=lambda a: a.get("posted_at", ""), reverse=True)
    normal.sort(key=lambda a: a.get("posted_at", ""), reverse=True)
    return urgent + normal
