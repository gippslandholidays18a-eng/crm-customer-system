"""
Stage 6A — Authentication service.

Self-hosted JWT + bcrypt. Three roles: admin, manager, staff.
Token delivered via Authorization: Bearer header (frontend stores in localStorage)
to keep CORS simple for the Emergent preview domain.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import bcrypt
import jwt
from fastapi import Depends, Header, HTTPException

JWT_ALGORITHM = "HS256"
ACCESS_TTL_HOURS = 12
ROLES = {"admin", "manager", "staff"}


def _secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def issue_token(user: Dict[str, Any]) -> str:
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "role": user["role"],
        "exp": datetime.now(timezone.utc) + timedelta(hours=ACCESS_TTL_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])


def safe_user(u: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in u.items() if k not in {"_id", "password_hash"}}
    return out


async def seed_admin(db) -> None:
    email = os.environ["ADMIN_EMAIL"].strip().lower()
    password = os.environ["ADMIN_PASSWORD"]
    existing = await db.users.find_one({"email": email})
    if existing:
        if not verify_password(password, existing.get("password_hash", "")):
            await db.users.update_one(
                {"email": email},
                {"$set": {"password_hash": hash_password(password), "role": "admin", "active": True}},
            )
        return
    doc = {
        "id": str(uuid.uuid4()),
        "name": "Admin",
        "email": email,
        "password_hash": hash_password(password),
        "role": "admin",
        "assigned_properties": [],
        "active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc.copy())


# Dependencies built dynamically so they can close over `db`
def make_auth_deps(db):
    async def current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(status_code=401, detail="Not authenticated")
        token = authorization[7:].strip()
        try:
            payload = decode_token(token)
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expired")
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = await db.users.find_one({"id": payload.get("sub")})
        if not user or not user.get("active"):
            raise HTTPException(status_code=401, detail="User not found or inactive")
        return safe_user(user)

    def require_role(*roles: str):
        roles_set = set(roles)

        async def _dep(user: Dict[str, Any] = Depends(current_user)) -> Dict[str, Any]:
            if user.get("role") not in roles_set:
                raise HTTPException(status_code=403, detail="Insufficient permissions")
            return user

        return _dep

    return current_user, require_role
