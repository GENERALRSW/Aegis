"""
AEGIS — User authentication and management.
POST /api/users/login
POST /api/users/register
GET  /api/users/me
GET  /api/users          (admin only)
PUT  /api/users/{user_id}/role (admin only)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import (
    create_access_token,
    create_refresh_token,
    get_current_user,
    hash_password,
    require_admin,
    verify_password,
)
from app.core.config import settings
from app.db.mongodb import users_col
from app.schemas.schemas import (
    TokenResponse,
    UserCreateRequest,
    UserLoginRequest,
    UserResponse,
)

router = APIRouter(prefix="/api/users", tags=["users"])


def _serialize_user(doc: Dict) -> Dict:
    doc["user_id"] = str(doc.get("user_id", doc.get("_id", "")))
    doc.pop("_id", None)
    doc.pop("hashed_password", None)
    return doc


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user account",
)
async def register_user(body: UserCreateRequest) -> UserResponse:
    col = users_col()
    existing = await col.find_one({"email": body.email})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    existing_un = await col.find_one({"username": body.username})
    if existing_un:
        raise HTTPException(status_code=409, detail="Username already taken")

    doc: Dict[str, Any] = {
        "user_id": str(uuid.uuid4()),
        "username": body.username,
        "email": body.email,
        "hashed_password": hash_password(body.password),
        "role": body.role.value,
        "full_name": body.full_name,
        "created_at": datetime.now(timezone.utc),
        "is_active": True,
    }
    await col.insert_one(doc)
    return UserResponse(**_serialize_user(doc))


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Authenticate and receive JWT tokens",
)
async def login(body: UserLoginRequest) -> TokenResponse:
    col = users_col()
    user = await col.find_one({"email": body.email})
    if not user or not verify_password(body.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account is deactivated")

    access_token = create_access_token(
        subject=user["user_id"],
        role=user["role"],
        extra={"email": user["email"], "username": user["username"]},
    )
    refresh_token = create_refresh_token(subject=user["user_id"])

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.access_token_expire_minutes * 60,
    )


@router.get(
    "/me",
    response_model=UserResponse,
    summary="Get current authenticated user",
)
async def get_me(user: Dict = Depends(get_current_user)) -> UserResponse:
    doc = await users_col().find_one({"user_id": user["sub"]})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")
    return UserResponse(**_serialize_user(doc))


@router.get(
    "",
    response_model=List[UserResponse],
    summary="List all users (admin only)",
)
async def list_users(_: Dict = Depends(require_admin)) -> List[UserResponse]:
    cursor = users_col().find({}).sort("created_at", -1)
    users = []
    async for doc in cursor:
        users.append(UserResponse(**_serialize_user(doc)))
    return users


@router.put(
    "/{user_id}/role",
    response_model=UserResponse,
    summary="Update user role (admin only)",
)
async def update_role(
    user_id: str,
    role: str,
    _: Dict = Depends(require_admin),
) -> UserResponse:
    from app.models.enums import UserRole
    if role not in [r.value for r in UserRole]:
        raise HTTPException(status_code=400, detail=f"Invalid role: {role}")

    result = await users_col().find_one_and_update(
        {"user_id": user_id},
        {"$set": {"role": role}},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=404, detail="User not found")
    return UserResponse(**_serialize_user(result))
