"""
Quick script to register a missing person from a local photo file.
Run: python scripts/register_missing_person.py <photo_path> <name> [description]

Example:
  python scripts/register_missing_person.py C:/Users/rahee/Downloads/john.jpg "John Doe" "Missing since March 2026"
"""
import sys, asyncio, base64, json
import httpx

BASE_URL = "http://localhost:8000"
EMAIL    = "admin@aegis.ai"
PASSWORD = "Admin@1234"


async def main():
    if len(sys.argv) < 3:
        print("Usage: python scripts/register_missing_person.py <photo_path> <name> [description]")
        sys.exit(1)

    photo_path  = sys.argv[1]
    name        = sys.argv[2]
    description = sys.argv[3] if len(sys.argv) > 3 else f"{name} — registered for AEGIS demo"

    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        # Login
        print(f"Logging in as {EMAIL}...")
        r = await client.post("/api/users/login", json={"email": EMAIL, "password": PASSWORD})
        r.raise_for_status()
        token = r.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        print("  Logged in OK")

        # Upload photo
        print(f"Registering '{name}' from {photo_path}...")
        with open(photo_path, "rb") as f:
            photo_bytes = f.read()

        ext = photo_path.rsplit(".", 1)[-1].lower()
        mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")

        r = await client.post(
            "/api/security/missing/upload",
            headers=headers,
            files={"photo": (photo_path.split("/")[-1], photo_bytes, mime)},
            data={"name": name, "description": description, "category": "missing"},
        )

        if r.status_code == 422:
            print(f"\nERROR: {r.json()['detail']}")
            print("The photo must contain a clearly visible face. Try a different photo.")
            sys.exit(1)

        r.raise_for_status()
        person = r.json()
        print(f"\nRegistered successfully!")
        print(f"  person_id:        {person['person_id']}")
        print(f"  name:             {person['name']}")
        print(f"  has_face_encoding: {person['has_face_encoding']}")

        if not person["has_face_encoding"]:
            print("\nWARNING: Face encoding was NOT generated.")
            print("facenet-pytorch may not be loaded yet. Try re-encoding:")
            print(f"  POST /api/security/missing/{person['person_id']}/reencode")
        else:
            print("\nFace encoding stored. Detection is active — show this person's face to any camera feed.")

asyncio.run(main())
