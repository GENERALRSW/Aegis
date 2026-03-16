"""
AEGIS — Gait signature extraction from MediaPipe pose landmarks.

Produces a compact, normalized feature vector from a single pose frame.
The signature captures body proportions, joint angles, and symmetry —
features that are relatively stable across clothing and camera angle changes.

For multi-frame gait sequences (future work), temporal stride features
can be stacked on top of per-frame descriptors.
"""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

GAIT_SIGNATURE_DIM = 32

# MediaPipe landmark indices
_NOSE = 0
_L_SHOULDER, _R_SHOULDER = 11, 12
_L_ELBOW, _R_ELBOW = 13, 14
_L_WRIST, _R_WRIST = 15, 16
_L_HIP, _R_HIP = 23, 24
_L_KNEE, _R_KNEE = 25, 26
_L_ANKLE, _R_ANKLE = 27, 28


def _angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Angle (radians) at vertex b formed by rays b→a and b→c."""
    ba, bc = a - b, c - b
    cos = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-8)
    return float(np.arccos(np.clip(cos, -1.0, 1.0)))


class GaitAnalyzer:
    """
    Extracts and matches 32-dim gait signatures from MediaPipe landmarks
    or raw image frames (runs MediaPipe internally if given bytes).
    """

    _instance: Optional["GaitAnalyzer"] = None

    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="gait_analyzer"
        )

    @classmethod
    def get_instance(cls) -> "GaitAnalyzer":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # ── Signature extraction ──────────────────────────────────────────────────

    def extract_from_landmarks(self, landmarks: Any) -> Optional[List[float]]:
        """
        Compute gait signature from a MediaPipe NormalizedLandmarkList.
        Returns a 32-dim unit-normalised float list, or None on failure.
        """
        try:
            lm = landmarks.landmark

            def pt(idx: int) -> np.ndarray:
                return np.array([lm[idx].x, lm[idx].y, lm[idx].z], dtype=np.float32)

            nose         = pt(_NOSE)
            l_sh, r_sh   = pt(_L_SHOULDER), pt(_R_SHOULDER)
            l_el, r_el   = pt(_L_ELBOW),    pt(_R_ELBOW)
            l_wr, r_wr   = pt(_L_WRIST),    pt(_R_WRIST)
            l_hip, r_hip = pt(_L_HIP),      pt(_R_HIP)
            l_kn, r_kn   = pt(_L_KNEE),     pt(_R_KNEE)
            l_an, r_an   = pt(_L_ANKLE),    pt(_R_ANKLE)

            mid_sh  = (l_sh + r_sh) / 2
            mid_hip = (l_hip + r_hip) / 2

            sh_width  = float(np.linalg.norm(l_sh - r_sh))
            hip_width = float(np.linalg.norm(l_hip - r_hip))
            torso_h   = float(np.linalg.norm(mid_sh - mid_hip))
            leg_l     = float(np.linalg.norm(l_hip - l_kn) + np.linalg.norm(l_kn - l_an))
            leg_r     = float(np.linalg.norm(r_hip - r_kn) + np.linalg.norm(r_kn - r_an))
            foot_sp   = float(np.linalg.norm(l_an - r_an))
            eps       = torso_h + 1e-8

            l_kn_ang  = _angle(l_hip,  l_kn,  l_an)
            r_kn_ang  = _angle(r_hip,  r_kn,  r_an)
            l_hip_ang = _angle(l_sh,   l_hip, l_kn)
            r_hip_ang = _angle(r_sh,   r_hip, r_kn)
            l_el_ang  = _angle(l_sh,   l_el,  l_wr)
            r_el_ang  = _angle(r_sh,   r_el,  r_wr)

            vertical   = np.array([0.0, -1.0, 0.0], dtype=np.float32)
            torso_lean = _angle(mid_sh + vertical, mid_sh, mid_hip)

            features: List[float] = [
                # Body proportions (6)
                sh_width  / (hip_width + 1e-8),
                torso_h   / (leg_l + 1e-8),
                torso_h   / (leg_r + 1e-8),
                leg_l     / (leg_r + 1e-8),
                hip_width / (sh_width + 1e-8),
                foot_sp   / (hip_width + 1e-8),

                # Joint angles (6)
                l_kn_ang, r_kn_ang,
                l_hip_ang, r_hip_ang,
                l_el_ang, r_el_ang,

                # Symmetry (3)
                abs(l_kn_ang  - r_kn_ang),
                abs(l_hip_ang - r_hip_ang),
                abs(l_el_ang  - r_el_ang),

                # Torso lean (1)
                torso_lean,

                # Wrist heights relative to hip centre (2)
                float((mid_hip[1] - l_wr[1]) / eps),
                float((mid_hip[1] - r_wr[1]) / eps),

                # Key joint positions relative to hip centre (14)
                *((l_hip - mid_hip).tolist()),   # 3
                *((r_hip - mid_hip).tolist()),   # 3
                *((l_kn  - mid_hip).tolist()),   # 3
                *((r_kn  - mid_hip).tolist()),   # 3
                float((nose - mid_hip)[1] / eps), # 1 (head height)
            ]

            arr = np.array(features[:GAIT_SIGNATURE_DIM], dtype=np.float32)
            norm = float(np.linalg.norm(arr))
            if norm > 0:
                arr /= norm
            return arr.tolist()

        except Exception as exc:
            logger.debug("Gait signature extraction failed", error=str(exc))
            return None

    async def extract_from_frame(self, frame_bytes: bytes) -> Optional[List[float]]:
        """
        Run MediaPipe Pose on raw image bytes and return the gait signature.
        Useful when only the frame is available (not pre-computed landmarks).
        """
        loop = asyncio.get_event_loop()

        def _run() -> Optional[List[float]]:
            try:
                import mediapipe as mp  # type: ignore
                import cv2
                import numpy as np

                mp_pose = mp.solutions.pose
                nparr = np.frombuffer(frame_bytes, np.uint8)
                img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                if img is None:
                    return None
                rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

                with mp_pose.Pose(
                    static_image_mode=True,
                    model_complexity=1,
                    min_detection_confidence=0.5,
                ) as pose:
                    result = pose.process(rgb)
                    if result.pose_landmarks:
                        return self.extract_from_landmarks(result.pose_landmarks)
            except Exception as exc:
                logger.debug("Frame gait extraction failed", error=str(exc))
            return None

        return await loop.run_in_executor(self._executor, _run)

    # ── Matching ──────────────────────────────────────────────────────────────

    def match(
        self,
        query_sig: List[float],
        candidates: List[Dict[str, Any]],
        threshold: Optional[float] = None,
    ) -> Optional[Tuple[str, str, float]]:
        """
        Cosine similarity match against a list of candidate gait signatures.
        Each candidate: {person_id, name, gait_signature}.
        Returns (person_id, name, confidence) or None.
        """
        if not query_sig or not candidates:
            return None

        thr = threshold if threshold is not None else settings.gait_match_threshold
        qa = np.array(query_sig, dtype=np.float32)
        best_id = best_name = None
        best_dist = float("inf")

        for c in candidates:
            sig = c.get("gait_signature")
            if not sig:
                continue
            ca = np.array(sig, dtype=np.float32)
            dist = float(1.0 - np.dot(qa, ca))  # both unit-normalised
            if dist < best_dist:
                best_dist = dist
                best_id = c.get("person_id")
                best_name = c.get("name", "Unknown")

        if best_id and best_dist <= thr:
            return (best_id, best_name, round(1.0 - best_dist, 4))
        return None


# Singleton
gait_analyzer = GaitAnalyzer.get_instance()
