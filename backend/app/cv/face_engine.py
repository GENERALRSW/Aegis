"""
AEGIS — Facial recognition engine with region-based policy enforcement.

Uses facenet-pytorch (MTCNN detector + InceptionResnetV1 encoder) so it
runs on the same PyTorch stack as YOLOv8 — no TensorFlow required.

Install:  pip install facenet-pytorch
          pip install opencv-python-headless   (or opencv-python)

If facenet-pytorch is not installed the engine gracefully degrades:
all recognition calls are no-ops and `is_operational` returns False.
"""

from __future__ import annotations

import asyncio
import base64
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# ── Optional facenet-pytorch import ──────────────────────────────────────────

try:
    import cv2  # noqa: F401  (verify it's importable)
    import torch as _torch
    from facenet_pytorch import MTCNN as _MTCNN_cls  # noqa: F401
    from facenet_pytorch import InceptionResnetV1 as _Resnet_cls  # noqa: F401
    _FACENET_AVAILABLE = True
except ImportError:
    _FACENET_AVAILABLE = False
    logger.warning(
        "facenet-pytorch / OpenCV not installed — facial recognition disabled. "
        "Run: pip install facenet-pytorch opencv-python-headless"
    )

# Models are initialised lazily on first use (see _get_models()).
# This avoids loading ~500 MB of weights at worker boot time.
_mtcnn = None
_resnet = None
_models_loaded = False
_models_lock = None  # initialised at runtime


def _get_models():
    """Return (mtcnn, resnet), loading once on first call."""
    global _mtcnn, _resnet, _models_loaded, _models_lock
    if _models_loaded:
        return _mtcnn, _resnet
    if _models_lock is None:
        import threading
        _models_lock = threading.Lock()
    with _models_lock:
        if _models_loaded:
            return _mtcnn, _resnet
        import torch
        from facenet_pytorch import MTCNN, InceptionResnetV1
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        _mtcnn = MTCNN(keep_all=True, device=device, post_process=False)
        _resnet = InceptionResnetV1(pretrained="vggface2").eval().to(device)
        _models_loaded = True
        logger.info("facenet-pytorch models loaded", device=str(device))
    return _mtcnn, _resnet


# ── Engine ────────────────────────────────────────────────────────────────────

class FaceEngine:
    """
    Singleton async face recognition engine.

    Region policy:
      - If `allowed_facial_recognition_regions` is empty → all regions allowed.
      - Otherwise the deployment `system_region` must appear in the allow-list.
      - Admins can override via `admin_set_enabled()` at runtime.
    """

    _instance: Optional["FaceEngine"] = None

    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="face_engine"
        )
        self._runtime_enabled: Optional[bool] = None  # None = defer to config

    @classmethod
    def get_instance(cls) -> "FaceEngine":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # ── Policy helpers ────────────────────────────────────────────────────────

    @property
    def deepface_available(self) -> bool:
        """Kept for API compatibility — reflects facenet-pytorch availability."""
        return _FACENET_AVAILABLE

    @property
    def is_region_allowed(self) -> bool:
        allowed_str = settings.allowed_facial_recognition_regions.strip()
        if not allowed_str:
            return True
        allowed = {r.strip().upper() for r in allowed_str.split(",") if r.strip()}
        return settings.system_region.upper() in allowed

    @property
    def is_enabled(self) -> bool:
        if self._runtime_enabled is not None:
            return self._runtime_enabled
        return settings.facial_recognition_enabled

    @property
    def is_operational(self) -> bool:
        return _FACENET_AVAILABLE and self.is_enabled and self.is_region_allowed

    @property
    def models_loaded(self) -> bool:
        return _models_loaded

    def admin_set_enabled(self, value: bool) -> None:
        if not settings.facial_recognition_admin_override:
            raise PermissionError(
                "Admin override of facial recognition is disabled by policy"
            )
        self._runtime_enabled = value
        logger.info("Facial recognition runtime toggle", enabled=value)

    # ── Synchronous helpers (called via executor) ─────────────────────────────

    @staticmethod
    def _bytes_to_rgb(image_bytes: bytes) -> "np.ndarray":
        nparr = np.frombuffer(image_bytes, np.uint8)
        bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if bgr is None:
            raise ValueError("Could not decode image")
        return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

    @staticmethod
    def _get_embeddings(rgb: "np.ndarray") -> List[List[float]]:
        """Detect faces and return one 512-dim embedding per face."""
        import torch
        from PIL import Image  # type: ignore

        mtcnn, resnet = _get_models()
        pil = Image.fromarray(rgb)
        faces, probs = mtcnn(pil, return_prob=True)
        if faces is None:
            return []

        embeddings: List[List[float]] = []
        for face in faces:
            face_t = face.unsqueeze(0).to(next(resnet.parameters()).device) / 255.0
            with torch.no_grad():
                emb = resnet(face_t)
            embeddings.append(emb[0].cpu().tolist())
        return embeddings

    @staticmethod
    def _cosine_distance(a: List[float], b: List[float]) -> float:
        va = np.array(a, dtype=np.float32)
        vb = np.array(b, dtype=np.float32)
        denom = np.linalg.norm(va) * np.linalg.norm(vb)
        return float(1.0 - np.dot(va, vb) / denom) if denom > 0 else 1.0

    # ── Public async API ──────────────────────────────────────────────────────

    async def encode_face(self, image_b64: str) -> Optional[List[float]]:
        """
        Compute a 512-dim face embedding from a base64 image.
        Returns None when FR is unavailable or no face is detected.
        """
        if not self.is_operational:
            return None

        loop = asyncio.get_event_loop()

        def _run() -> Optional[List[float]]:
            try:
                rgb = self._bytes_to_rgb(base64.b64decode(image_b64))
                embeddings = self._get_embeddings(rgb)
                return embeddings[0] if embeddings else None
            except Exception as exc:
                logger.warning("Face encoding failed", error=str(exc))
                return None

        return await loop.run_in_executor(self._executor, _run)

    async def detect_faces_in_frame(
        self, frame_bytes: bytes
    ) -> List[Dict[str, Any]]:
        """
        Detect all faces in a raw image frame.
        Returns list of {"embedding": [...]} dicts, one per detected face.
        """
        if not self.is_operational:
            return []

        loop = asyncio.get_event_loop()

        def _run() -> List[Dict]:
            try:
                rgb = self._bytes_to_rgb(frame_bytes)
                embeddings = self._get_embeddings(rgb)
                return [{"embedding": emb} for emb in embeddings]
            except Exception as exc:
                logger.debug("Frame face detection failed", error=str(exc))
                return []

        return await loop.run_in_executor(self._executor, _run)

    async def match_face(
        self,
        query_embedding: List[float],
        candidates: List[Dict[str, Any]],
        threshold: Optional[float] = None,
    ) -> Optional[Tuple[str, str, float]]:
        """
        Find closest match in candidates.
        Each candidate needs: person_id, face_encoding, name.
        Returns (person_id, name, confidence) or None.
        """
        if not query_embedding or not candidates:
            return None

        thr = threshold if threshold is not None else settings.face_match_threshold
        best_id = best_name = None
        best_dist = float("inf")

        for c in candidates:
            enc = c.get("face_encoding")
            if not enc:
                continue
            dist = self._cosine_distance(query_embedding, enc)
            if dist < best_dist:
                best_dist = dist
                best_id = c.get("person_id")
                best_name = c.get("name", "Unknown")

        if best_id and best_dist <= thr:
            return (best_id, best_name, round(1.0 - best_dist, 4))
        return None


# Singleton
face_engine = FaceEngine.get_instance()
