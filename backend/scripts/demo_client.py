"""
AEGIS — Demo Client Script
Simulates three concurrent camera sources streaming frames to the backend.
Requires: pip install httpx pillow numpy

Usage:
    python scripts/demo_client.py --url http://localhost:8000 --email operator@aegis.ai --password YourPass
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import random
import time
from typing import Optional

import httpx
import numpy as np
from PIL import Image, ImageDraw


# ── Helpers ───────────────────────────────────────────────────────────────────

def make_synthetic_frame(label: str = "test", width: int = 640, height: int = 480) -> bytes:
    """Generate a synthetic JPEG frame with text (simulates a real camera frame)."""
    color = {
        "phone": (30, 60, 90),
        "laptop": (20, 80, 50),
        "usb": (80, 30, 60),
    }.get(label, (50, 50, 50))

    img = Image.new("RGB", (width, height), color=color)
    draw = ImageDraw.Draw(img)
    draw.text((20, 20), f"AEGIS Demo — {label.upper()} source", fill=(255, 255, 255))
    draw.text((20, 50), f"ts={time.time():.3f}", fill=(200, 200, 200))

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


async def authenticate(client: httpx.AsyncClient, base_url: str, email: str, password: str) -> str:
    resp = await client.post(f"{base_url}/api/users/login", json={"email": email, "password": password})
    resp.raise_for_status()
    token = resp.json()["access_token"]
    print(f"[AUTH] Logged in as {email}")
    return token


async def stream_camera(
    base_url: str,
    token: str,
    camera_id: str,
    source_type: str,
    interval: float = 2.0,
    total: int = 10,
) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=30) as client:
        for i in range(total):
            frame_bytes = make_synthetic_frame(source_type)
            try:
                resp = await client.post(
                    f"{base_url}/api/cv/detect",
                    headers=headers,
                    files={"frame": ("frame.jpg", frame_bytes, "image/jpeg")},
                    data={"camera_id": camera_id, "source_type": source_type},
                )
                data = resp.json()
                print(
                    f"[{source_type.upper()}:{camera_id}] "
                    f"frame={i+1}/{total} "
                    f"detections={len(data.get('detections', []))} "
                    f"risk={data.get('risk_score', 0):.3f} "
                    f"severity={data.get('severity', 'none')} "
                    f"ms={data.get('processing_time_ms', 0):.1f}"
                )
            except Exception as exc:
                print(f"[{source_type}:{camera_id}] ERROR: {exc}")

            await asyncio.sleep(interval)


async def main(base_url: str, email: str, password: str) -> None:
    async with httpx.AsyncClient(timeout=15) as auth_client:
        token = await authenticate(auth_client, base_url, email, password)

    cameras = [
        ("phone-cam-001", "phone", 1.5),
        ("laptop-cam-001", "laptop", 2.0),
        ("usb-cam-001", "usb", 2.5),
    ]

    print(f"\nStarting {len(cameras)} concurrent camera streams …\n")

    await asyncio.gather(*[
        stream_camera(base_url, token, cam_id, src, interval, total=8)
        for cam_id, src, interval in cameras
    ])

    print("\nDemo stream complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AEGIS Demo Client")
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--email", default="operator@aegis.ai")
    parser.add_argument("--password", default="Operator@1234")
    args = parser.parse_args()

    asyncio.run(main(args.url, args.email, args.password))
