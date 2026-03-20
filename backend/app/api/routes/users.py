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

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.core.security import (
    create_access_token,
    create_refresh_token,
    get_current_user,
    hash_password,
    require_admin,
    verify_password,
)
from app.core.config import settings
from app.core.logging import get_logger
from app.db.mongodb import users_col
from app.services.admin_audit import write_admin_audit

logger = get_logger(__name__)
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


_MAX_FAILED_ATTEMPTS = 5   # permanently lock after this many consecutive failures


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Authenticate and receive JWT tokens",
)
async def login(body: UserLoginRequest, request: Request, response: Response) -> TokenResponse:
    col = users_col()
    client_ip = request.client.host if request.client else "unknown"
    user = await col.find_one({"email": body.email})

    # Unknown email — log and reject without revealing whether the account exists
    if not user:
        logger.warning("Failed login attempt — unknown email", email=body.email, ip=client_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # Permanently locked accounts can only be unlocked by an admin
    if user.get("is_locked", False):
        logger.warning("Login attempt on permanently locked account", email=body.email, ip=client_ip)
        raise HTTPException(status_code=403, detail="Account locked. Contact an administrator.")

    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account is deactivated")

    if not verify_password(body.password, user["hashed_password"]):
        new_count = user.get("failed_login_attempts", 0) + 1
        update: Dict[str, Any] = {"failed_login_attempts": new_count}

        if new_count >= _MAX_FAILED_ATTEMPTS:
            # Permanently lock — only an admin can clear is_locked via the user management API
            update["is_locked"] = True
            logger.warning(
                "Account permanently locked after repeated failures",
                email=body.email,
                ip=client_ip,
                attempts=new_count,
            )
        else:
            logger.warning(
                "Failed login attempt",
                email=body.email,
                ip=client_ip,
                attempt=new_count,
                remaining=_MAX_FAILED_ATTEMPTS - new_count,
            )

        await col.update_one({"email": body.email}, {"$set": update})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # Successful login — reset the failure counter
    await col.update_one(
        {"email": body.email},
        {"$set": {"failed_login_attempts": 0}},
    )
    logger.info("Successful login", email=body.email, ip=client_ip)

    access_token = create_access_token(
        subject=user["user_id"],
        role=user["role"],
        extra={"email": user["email"], "username": user["username"]},
    )
    refresh_token = create_refresh_token(subject=user["user_id"])

    # Set the access token as an HttpOnly cookie so JavaScript cannot read it.
    # SameSite=strict blocks cross-origin requests (CSRF protection).
    # Secure ensures the cookie is only sent over HTTPS in production.
    is_prod = settings.is_production
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,                              # JS cannot access this cookie
        secure=is_prod,                             # HTTPS only in production
        samesite="strict",                          # blocks cross-origin requests
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )

    # Do not return the raw token in the body — the cookie is the auth mechanism.
    # expires_in is safe to expose (it's just a duration, not a credential).
    return TokenResponse(
        access_token="",                            # omitted; token lives in cookie
        refresh_token=refresh_token,
        expires_in=settings.access_token_expire_minutes * 60,
    )


@router.post("/logout", summary="Clear the auth cookie and end the session")
async def logout(response: Response) -> dict:
    # Overwrite the cookie with an empty value and zero max-age to delete it.
    response.set_cookie(
        key="access_token",
        value="",
        httponly=True,
        secure=settings.is_production,
        samesite="strict",
        max_age=0,
        path="/",
    )
    return {"detail": "Logged out"}


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


@router.post(
    "/{user_id}/unlock",
    response_model=UserResponse,
    summary="Unlock a permanently locked account (admin only)",
)
async def unlock_account(
    user_id: str,
    request: Request,
    admin: Dict = Depends(require_admin),
) -> UserResponse:
    result = await users_col().find_one_and_update(
        {"user_id": user_id},
        {"$set": {"is_locked": False, "failed_login_attempts": 0}},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=404, detail="User not found")
    await write_admin_audit(
        admin=admin,
        action="unlock_account",
        detail={"target_user_id": user_id},
        request=request,
    )
    return UserResponse(**_serialize_user(result))


@router.put(
    "/{user_id}/role",
    response_model=UserResponse,
    summary="Update user role (admin only)",
)
async def update_role(
    user_id: str,
    role: str,
    request: Request,
    admin: Dict = Depends(require_admin),
) -> UserResponse:
    from app.models.enums import UserRole
    if role not in [r.value for r in UserRole]:
        raise HTTPException(status_code=400, detail=f"Invalid role: {role}")

    # Fetch current role before update so we can log what changed
    existing = await users_col().find_one({"user_id": user_id}, {"role": 1})
    result = await users_col().find_one_and_update(
        {"user_id": user_id},
        {"$set": {"role": role}},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=404, detail="User not found")
    await write_admin_audit(
        admin=admin,
        action="update_user_role",
        detail={
            "target_user_id": user_id,
            "old_role": existing.get("role") if existing else "unknown",
            "new_role": role,
        },
        request=request,
    )
    return UserResponse(**_serialize_user(result))


@router.get(
    "/admin-audit",
    summary="List admin action audit log (admin only)",
)
async def get_admin_audit_log(
    _: Dict = Depends(require_admin),
    limit: int = 100,
    skip: int = 0,
) -> List[Dict]:
    from app.db.mongodb import admin_audit_col
    cursor = admin_audit_col().find({}, {"_id": 0}).sort("timestamp", -1).skip(skip).limit(limit)
    return [doc async for doc in cursor]
