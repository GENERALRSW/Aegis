"""
AEGIS — Seed script for demo / development.
Creates default admin user + sample cameras.

Usage:
    python scripts/seed_db.py
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient

# Load env
from dotenv import load_dotenv
load_dotenv()

import os

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "aegis_db")

DEMO_USERS = [
    {
        "user_id": str(uuid.uuid4()),
        "username": "admin",
        "email": "admin@aegis.ai",
        # Password: Admin@1234
        "hashed_password": "$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW",
        "role": "admin",
        "full_name": "AEGIS Administrator",
        "created_at": datetime.now(timezone.utc),
        "is_active": True,
    },
    {
        "user_id": str(uuid.uuid4()),
        "username": "operator1",
        "email": "operator@aegis.ai",
        # Password: Operator@1234
        "hashed_password": "$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW",
        "role": "operator",
        "full_name": "Security Operator",
        "created_at": datetime.now(timezone.utc),
        "is_active": True,
    },
    {
        "user_id": str(uuid.uuid4()),
        "username": "viewer1",
        "email": "viewer@aegis.ai",
        # Password: Viewer@1234
        "hashed_password": "$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW",
        "role": "viewer",
        "full_name": "Dashboard Viewer",
        "created_at": datetime.now(timezone.utc),
        "is_active": True,
    },
]

DEMO_CAMERAS = [
    {
        "camera_id": "phone-cam-001",
        "name": "Demo Phone Camera (Zone A)",
        "camera_type": "phone",
        "location": "Zone A — Main Entrance",
        "latitude": 17.9970,
        "longitude": -76.7936,
        "status": "active",
        "registered_at": datetime.now(timezone.utc),
        "metadata": {"device": "Android", "resolution": "1080p"},
    },
    {
        "camera_id": "laptop-cam-001",
        "name": "Demo Laptop Webcam (Control Room)",
        "camera_type": "laptop",
        "location": "Control Room",
        "latitude": 17.9972,
        "longitude": -76.7934,
        "status": "active",
        "registered_at": datetime.now(timezone.utc),
        "metadata": {"os": "Windows 11", "resolution": "720p"},
    },
    {
        "camera_id": "usb-cam-001",
        "name": "USB Webcam (Server Room)",
        "camera_type": "usb",
        "location": "Server Room — East Wing",
        "latitude": 17.9968,
        "longitude": -76.7939,
        "status": "active",
        "registered_at": datetime.now(timezone.utc),
        "metadata": {"model": "Logitech C920", "fps": 30},
    },
    {
        "camera_id": "ip-cam-001",
        "name": "IP CCTV (Parking Lot)",
        "camera_type": "ip",
        "location": "Parking Lot — North",
        "latitude": 17.9975,
        "longitude": -76.7940,
        "status": "active",
        "registered_at": datetime.now(timezone.utc),
        "metadata": {"ip": "192.168.1.101", "protocol": "RTSP"},
    },
]


async def seed():
    client = AsyncIOMotorClient(MONGO_URI)
    db = client[MONGO_DB]

    print(f"Connecting to {MONGO_URI}/{MONGO_DB} …")

    # Users
    for user in DEMO_USERS:
        existing = await db["users"].find_one({"email": user["email"]})
        if not existing:
            await db["users"].insert_one(user)
            print(f"  ✓ Created user: {user['email']} ({user['role']})")
        else:
            print(f"  – Skipped existing user: {user['email']}")

    # Cameras
    for cam in DEMO_CAMERAS:
        existing = await db["cameras"].find_one({"camera_id": cam["camera_id"]})
        if not existing:
            await db["cameras"].insert_one(cam)
            print(f"  ✓ Registered camera: {cam['camera_id']} ({cam['camera_type']})")
        else:
            print(f"  – Skipped existing camera: {cam['camera_id']}")

    client.close()
    print("\nSeed complete.")
    print("\nDemo credentials:")
    print("  admin@aegis.ai    / Admin@1234    (admin)")
    print("  operator@aegis.ai / Operator@1234 (operator)")
    print("  viewer@aegis.ai   / Viewer@1234   (viewer)")
    print("\nNote: All demo passwords use the same bcrypt hash placeholder.")
    print("Re-register via POST /api/users/register for proper hashed passwords.")


if __name__ == "__main__":
    asyncio.run(seed())
