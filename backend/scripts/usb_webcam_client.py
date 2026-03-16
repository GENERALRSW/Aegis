"""
AEGIS — USB Webcam Client (OpenCV)
Captures frames from a local USB webcam and streams them to the backend.

Usage:
    pip install opencv-python httpx
    python scripts/usb_webcam_client.py --url http://localhost:8000 \
        --token <jwt_access_token> --camera-id usb-cam-001 --device 0
"""

from __future__ import annotations

import argparse
import asyncio
import io
import time

import cv2
import httpx
from PIL import Image


async def stream_webcam(
    base_url: str,
    token: str,
    camera_id: str,
    device_index: int = 0,
    fps_target: float = 2.0,
    max_frames: int = 0,          # 0 = unlimited
    confidence_threshold: float = 0.0,
) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    cap = cv2.VideoCapture(device_index)

    if not cap.isOpened():
        print(f"ERROR: Cannot open camera device {device_index}")
        return

    print(f"USB webcam opened (device={device_index})")
    print(f"Streaming to {base_url}/api/cv/detect (camera_id={camera_id})")
    print("Press Ctrl+C to stop.\n")

    interval = 1.0 / fps_target
    frame_count = 0

    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            t0 = time.monotonic()
            ret, frame = cap.read()
            if not ret:
                print("Frame capture failed — retrying …")
                await asyncio.sleep(0.5)
                continue

            # Encode to JPEG
            _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            frame_bytes = buffer.tobytes()

            try:
                resp = await client.post(
                    f"{base_url}/api/cv/detect",
                    headers=headers,
                    files={"frame": ("frame.jpg", frame_bytes, "image/jpeg")},
                    data={"camera_id": camera_id, "source_type": "usb"},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    n_det = len(data.get("detections", []))
                    risk = data.get("risk_score", 0)
                    severity = data.get("severity", "-")
                    print(
                        f"Frame {frame_count+1:04d} | "
                        f"detections={n_det} | "
                        f"risk={risk:.3f} | "
                        f"severity={severity} | "
                        f"ms={data.get('processing_time_ms', 0):.1f}"
                    )
                    if data.get("summary"):
                        print(f"  └─ {data['summary']}")
                else:
                    print(f"Frame {frame_count+1:04d} | HTTP {resp.status_code}")
            except httpx.RequestError as exc:
                print(f"Frame {frame_count+1:04d} | Network error: {exc}")

            frame_count += 1
            if max_frames and frame_count >= max_frames:
                print(f"\nReached max_frames={max_frames}. Stopping.")
                break

            elapsed = time.monotonic() - t0
            sleep_for = max(0.0, interval - elapsed)
            await asyncio.sleep(sleep_for)

    cap.release()
    print("\nWebcam released.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AEGIS USB Webcam Client")
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--token", required=True, help="JWT access token")
    parser.add_argument("--camera-id", default="usb-cam-001")
    parser.add_argument("--device", type=int, default=0, help="OpenCV device index")
    parser.add_argument("--fps", type=float, default=2.0, help="Frames per second to stream")
    parser.add_argument("--max-frames", type=int, default=0, help="0=unlimited")
    args = parser.parse_args()

    asyncio.run(
        stream_webcam(
            base_url=args.url,
            token=args.token,
            camera_id=args.camera_id,
            device_index=args.device,
            fps_target=args.fps,
            max_frames=args.max_frames,
        )
    )
