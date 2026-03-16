"""
AEGIS — Computer Vision Engine
Runs YOLOv8 (person/intruder + weapon detection) and MediaPipe Pose
(conflict/pose estimation) on incoming frames.

Design:
  • Lazy-loads models on first use (avoids import-time GPU cost).
  • Thread-safe: uses asyncio.Lock for model access.
  • Returns unified Detection objects.
"""

from __future__ import annotations

import asyncio
import time
from collections import deque
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Deque, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image

from app.core.config import settings
from app.core.logging import get_logger
from app.schemas.schemas import BoundingBox, Detection

logger = get_logger(__name__)

# ── Label maps ────────────────────────────────────────────────────────────────
PERSON_LABELS = {"person"}
WEAPON_LABELS = {
    "knife", "gun", "pistol", "rifle", "machete", "weapon",
    "firearm", "handgun", "shotgun", "revolver", "sword", "blade", "dagger",
    "fork",   # included for demo testing with utensils
}
CONFLICT_LABELS = {"fight", "conflict", "aggression"}

# COCO classes that YOLO returns for weapons (approximate — depends on training)
# Removed scissors (76): generates too many false positives in surveillance context
# Added fork (42): enables demo/testing with plastic utensils
COCO_WEAPON_IDS = {42, 43}   # fork=42, knife=43 in COCO


# ── Helpers ───────────────────────────────────────────────────────────────────

def _merge_weapon_detections(
    yolo_dets: List[Detection],
    gemini_dets: List[Detection],
) -> List[Detection]:
    """
    Combine YOLO and Gemini weapon detections.
    If both fire, keep the one with the higher confidence so we don't double-count.
    If only one fires, take it as-is.
    """
    if not yolo_dets and not gemini_dets:
        return []
    if yolo_dets and not gemini_dets:
        return yolo_dets
    if gemini_dets and not yolo_dets:
        return gemini_dets
    # Both fired — keep the highest-confidence detection from each source
    best_yolo   = max(yolo_dets,   key=lambda d: d.confidence)
    best_gemini = max(gemini_dets, key=lambda d: d.confidence)
    # Deduplicate: if they agree, return the higher-conf one; otherwise return both
    if best_gemini.confidence >= best_yolo.confidence:
        return [best_gemini, *[d for d in yolo_dets if d.confidence > 0.5]]
    return [best_yolo, *[d for d in gemini_dets if d.confidence > 0.5]]


# ── Per-camera state ──────────────────────────────────────────────────────────

_DEFAULT_STALE_CAMERA_SECONDS = 300.0


@dataclass
class CameraState:
    """
    Lightweight per-camera bookkeeping.

    frame_idx       — monotonically increasing frame counter for this camera.
    last_seen_ts    — wall-clock time of the last received frame; used to
                      detect stale / disconnected phone cameras and free memory.
    """
    frame_idx: int = 0
    last_seen_ts: float = field(default_factory=time.time)


class CVEngine:
    """Singleton-style async CV engine."""

    _instance: Optional["CVEngine"] = None

    def __init__(self) -> None:
        self._yolo_person = None     # YOLOv8 general (person detection)
        self._yolo_weapon = None     # YOLOv8 weapon-specialised
        self._mp_pose = None         # MediaPipe Pose
        self._lock = asyncio.Lock()
        self._ready = False

        # Per-camera state — one entry per registered camera / phone stream.
        self._camera_states: Dict[str, CameraState] = {}
        # Per-camera lock — serialises concurrent frames from the same source
        # (phones may fire overlapping requests when network is slow).
        self._camera_locks: Dict[str, asyncio.Lock] = {}

    # ── Singleton ─────────────────────────────────────────────────────────────

    @classmethod
    def get_instance(cls) -> "CVEngine":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # ── Lazy loading ──────────────────────────────────────────────────────────

    async def ensure_loaded(self) -> None:
        if self._ready:
            return
        async with self._lock:
            if self._ready:
                return
            await asyncio.get_event_loop().run_in_executor(None, self._load_models)
            self._ready = True

    def _load_models(self) -> None:
        logger.info("Loading CV models …")

        # ── PyTorch 2.6 compatibility ─────────────────────────────────────────
        # torch.load changed default weights_only=True in 2.6 which blocks
        # Ultralytics model loading. Temporarily restore the legacy behaviour
        # for the duration of model loading only.
        import torch as _torch
        _orig_torch_load = _torch.load
        _torch.load = lambda *a, **kw: _orig_torch_load(
            *a, **{**kw, "weights_only": False}
        )

        try:
            # ── YOLOv8 person/general ─────────────────────────────────────────
            try:
                from ultralytics import YOLO  # type: ignore
                self._yolo_person = YOLO(settings.yolo_model_path)
                logger.info("YOLOv8 person model loaded", path=settings.yolo_model_path)
            except Exception as exc:
                logger.warning("YOLOv8 person model failed to load", error=str(exc))

            # ── YOLOv8 weapon ─────────────────────────────────────────────────
            try:
                from ultralytics import YOLO  # type: ignore  # noqa: F811
                if Path(settings.weapon_model_path).exists():
                    self._yolo_weapon = YOLO(settings.weapon_model_path)
                    logger.info("YOLOv8 weapon model loaded", path=settings.weapon_model_path)
                else:
                    logger.warning(
                        "Weapon model not found — weapon detection via general model only",
                        path=settings.weapon_model_path,
                    )
            except Exception as exc:
                logger.warning("YOLOv8 weapon model failed", error=str(exc))
        finally:
            # Always restore the original torch.load
            _torch.load = _orig_torch_load

        # ── MediaPipe Pose ───────────────────────────────────────────────────
        try:
            import mediapipe as mp  # type: ignore
            self._mp_pose = mp.solutions.pose.Pose(
                static_image_mode=True,
                model_complexity=1,
                min_detection_confidence=settings.confidence_threshold,
            )
            logger.info("MediaPipe Pose loaded")
        except Exception as exc:
            logger.warning("MediaPipe Pose failed to load", error=str(exc))

        logger.info("CV engine ready")

    # ── Public inference ──────────────────────────────────────────────────────

    async def infer(
        self,
        image_bytes: bytes,
        camera_id: str = "default",
    ) -> Tuple[List[Detection], float]:
        """
        Run full inference pipeline on raw image bytes.

        Stages (all parallel):
          • YOLO person detection  → intruder labels
          • YOLO weapon detection  → weapon labels (knife/fork from COCO)
          • MediaPipe Pose         → conflict labels
          • Gemini Vision          → weapon labels (guns, rifles, knives, etc.)

        camera_id identifies the source. A per-camera lock serialises
        concurrent frames from the same phone.

        Returns (detections, processing_time_ms).
        """
        from app.services.vision_service import detect_weapons_with_gemini

        await self.ensure_loaded()

        if camera_id not in self._camera_locks:
            self._camera_locks[camera_id] = asyncio.Lock()

        async with self._camera_locks[camera_id]:
            state = self._camera_states.setdefault(camera_id, CameraState())
            state.frame_idx   += 1
            state.last_seen_ts = time.time()

            t0 = time.perf_counter()
            loop = asyncio.get_event_loop()

            logger.info(
                "CV inference started",
                camera_id=camera_id,
                frame_idx=state.frame_idx,
                frame_bytes=len(image_bytes),
            )

            img = await loop.run_in_executor(None, self._decode_image, image_bytes)

            # All four stages run in parallel
            person_dets, yolo_weapon_dets, pose_dets, gemini_weapon_dets = await asyncio.gather(
                loop.run_in_executor(None, self._run_yolo_person, img),
                loop.run_in_executor(None, self._run_yolo_weapon, img),
                loop.run_in_executor(None, self._run_mediapipe_pose, img),
                detect_weapons_with_gemini(image_bytes),
            )

            # Merge YOLO + Gemini weapon detections, deduplicate by keeping highest conf
            weapon_dets = _merge_weapon_detections(yolo_weapon_dets, gemini_weapon_dets)

            detections: List[Detection] = [*person_dets, *weapon_dets, *pose_dets]

            # ── Detailed inference log ────────────────────────────────────────
            elapsed_ms = (time.perf_counter() - t0) * 1000
            logger.info(
                "CV inference complete",
                camera_id=camera_id,
                frame_idx=state.frame_idx,
                elapsed_ms=round(elapsed_ms, 1),
                persons=len(person_dets),
                weapons_yolo=len(yolo_weapon_dets),
                weapons_gemini=len(gemini_weapon_dets),
                weapons_total=len(weapon_dets),
                conflict=len(pose_dets),
                total_detections=len(detections),
                detection_labels=[d.label for d in detections],
                detection_confidences=[round(d.confidence, 3) for d in detections],
            )

            if weapon_dets:
                logger.warning(
                    "WEAPON DETECTED",
                    camera_id=camera_id,
                    frame_idx=state.frame_idx,
                    weapons=[
                        {"label": d.label, "confidence": round(d.confidence, 3)}
                        for d in weapon_dets
                    ],
                    source_yolo=len(yolo_weapon_dets) > 0,
                    source_gemini=len(gemini_weapon_dets) > 0,
                )

            self._cleanup_stale_cameras()
            return detections, elapsed_ms

    # ── Internal model runners ────────────────────────────────────────────────

    def _decode_image(self, image_bytes: bytes) -> np.ndarray:
        img = Image.open(BytesIO(image_bytes)).convert("RGB")
        return np.array(img)

    def _run_yolo_person(self, img: np.ndarray) -> List[Detection]:
        if self._yolo_person is None:
            logger.warning("YOLO person model not loaded — skipping person detection")
            return []
        try:
            results = self._yolo_person(
                img,
                conf=settings.confidence_threshold,
                iou=settings.iou_threshold,
                device=settings.device,
                verbose=False,
            )
            dets: List[Detection] = []
            for r in results:
                for box in r.boxes:
                    cls_id = int(box.cls[0])
                    label = r.names[cls_id]
                    conf = float(box.conf[0])
                    if label.lower() not in ("person",):
                        continue
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    dets.append(
                        Detection(
                            label="intruder",
                            confidence=conf,
                            bounding_box=BoundingBox(
                                x1=x1, y1=y1, x2=x2, y2=y2,
                                width=x2 - x1, height=y2 - y1,
                            ),
                        )
                    )
            if dets:
                logger.info(
                    "YOLO person: detected",
                    count=len(dets),
                    confidences=[round(d.confidence, 3) for d in dets],
                )
            else:
                logger.debug("YOLO person: no persons in frame")
            return dets
        except Exception as exc:
            logger.error("YOLO person inference error", error=str(exc))
            return []

    def _run_yolo_weapon(self, img: np.ndarray) -> List[Detection]:
        using_fallback = self._yolo_weapon is None
        model = self._yolo_weapon or self._yolo_person
        if model is None:
            return []
        # Use the dedicated weapon threshold (default 0.30) which is tuned lower
        # than the general threshold to catch knives/forks at typical demo range.
        # When falling back to the general model, apply a small penalty to reduce
        # false positives from non-weapon COCO classes.
        conf_threshold = settings.weapon_confidence_threshold
        if using_fallback:
            conf_threshold = max(conf_threshold, 0.35)
        try:
            results = model(
                img,
                conf=conf_threshold,
                iou=settings.iou_threshold,
                device=settings.device,
                verbose=False,
            )
            dets: List[Detection] = []
            for r in results:
                for box in r.boxes:
                    cls_id = int(box.cls[0])
                    label = r.names[cls_id].lower()
                    det_conf = float(box.conf[0])
                    matched = label in WEAPON_LABELS or cls_id in COCO_WEAPON_IDS
                    logger.debug(
                        "YOLO weapon candidate",
                        label=label,
                        cls_id=cls_id,
                        confidence=round(det_conf, 3),
                        matched=matched,
                        using_fallback=using_fallback,
                    )
                    if not matched:
                        continue
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    dets.append(
                        Detection(
                            label="weapon",
                            confidence=det_conf,
                            bounding_box=BoundingBox(
                                x1=x1, y1=y1, x2=x2, y2=y2,
                                width=x2 - x1, height=y2 - y1,
                            ),
                        )
                    )
            if dets:
                logger.info(
                    "YOLO weapon: detected",
                    count=len(dets),
                    confidences=[round(d.confidence, 3) for d in dets],
                    using_fallback=using_fallback,
                )
            else:
                logger.debug(
                    "YOLO weapon: nothing matched",
                    using_fallback=using_fallback,
                    conf_threshold=round(conf_threshold, 3),
                )
            return dets
        except Exception as exc:
            logger.error("YOLO weapon inference error", error=str(exc))
            return []

    def _run_mediapipe_pose(self, img: np.ndarray) -> List[Detection]:
        """
        Analyze pose landmarks for genuine conflict/threat indicators.

        Only flags conflict when specific aggressive posture patterns are detected.
        Normal standing, walking, sitting, or arm-waving poses are NOT flagged.
        A meaningful combined score across multiple signals is required.

        Signals (scored cumulatively):
          S1 (0.65) — Both wrists above nose level  (raised fists / hands-up surrender)
          S2 (0.40) — One wrist well above nose     (striking/punching motion)
          S3 (0.45) — Both elbows raised above shoulders + wrists extended
                       (wrestling / grappling stance)
          S4 (0.25) — Extreme horizontal torso lean  (lunge / charging)
          S5 (0.20) — Deep crouch combined with arm activity  (fighting crouch)

        Threshold: combined score ≥ 0.50 required to emit a detection.
        S1 alone triggers; S2 or S3 alone do NOT — a second signal is needed.
        """
        if self._mp_pose is None:
            return []
        try:
            results = self._mp_pose.process(img)
            if not results.pose_landmarks:  # type: ignore[union-attr]
                return []

            lm = results.pose_landmarks.landmark  # type: ignore[union-attr]

            # Require majority of key body landmarks to be reliably visible
            key_indices = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26]
            mean_key_vis = sum(lm[i].visibility for i in key_indices) / len(key_indices)
            if mean_key_vis < 0.55:
                return []

            # In MediaPipe normalised coords: y increases downward,
            # so SMALLER y = HIGHER in the image frame.
            def _y(idx: int) -> float:
                return float(lm[idx].y)

            def _x(idx: int) -> float:
                return float(lm[idx].x)

            def _v(idx: int) -> float:
                return float(lm[idx].visibility)

            nose_y = _y(0)
            l_sh_y, r_sh_y   = _y(11), _y(12)
            l_el_y, r_el_y   = _y(13), _y(14)
            l_wr_y, r_wr_y   = _y(15), _y(16)
            l_hip_y, r_hip_y = _y(23), _y(24)
            l_kn_y, r_kn_y   = _y(25), _y(26)
            l_sh_x, r_sh_x   = _x(11), _x(12)
            l_hip_x, r_hip_x = _x(23), _x(24)

            mid_sh_y  = (l_sh_y  + r_sh_y)  / 2.0
            mid_hip_y = (l_hip_y + r_hip_y) / 2.0
            mid_sh_x  = (l_sh_x  + r_sh_x)  / 2.0
            mid_hip_x = (l_hip_x + r_hip_x) / 2.0

            torso_height = abs(mid_hip_y - mid_sh_y)
            if torso_height < 0.04:
                return []   # Person too small or partial detection

            conflict_score = 0.0

            # ── S1: Both wrists above nose level ─────────────────────────────
            # Catches: raised fists, surrender posture, hands-up threat
            if (l_wr_y < nose_y - 0.02 and _v(15) > 0.65 and
                    r_wr_y < nose_y - 0.02 and _v(16) > 0.65):
                conflict_score += 0.65

            # ── S2: One wrist well above nose (strike / punch) ────────────────
            elif (
                (l_wr_y < nose_y - 0.05 and _v(15) > 0.70) or
                (r_wr_y < nose_y - 0.05 and _v(16) > 0.70)
            ):
                conflict_score += 0.40

            # ── S3: Both elbows above shoulder + wrists extended ──────────────
            # Catches: wrestling stance, grappling, guard position
            both_elbows_above_sh = (
                l_el_y < mid_sh_y and _v(13) > 0.60 and
                r_el_y < mid_sh_y and _v(14) > 0.60
            )
            both_wr_near_sh = (
                l_wr_y < mid_sh_y + torso_height * 0.30 and
                r_wr_y < mid_sh_y + torso_height * 0.30
            )
            if both_elbows_above_sh and both_wr_near_sh:
                conflict_score += 0.45

            # ── S4: Extreme horizontal torso lean (lunge / charge) ────────────
            lateral_offset = abs(mid_hip_x - mid_sh_x)
            if lateral_offset / (torso_height + 1e-8) > 0.50:
                conflict_score += 0.25

            # ── S5: Fighting crouch (deeply bent knees + prior arm activity) ──
            avg_kn_hip_gap = (abs(l_kn_y - l_hip_y) + abs(r_kn_y - r_hip_y)) / 2.0
            crouching = (
                avg_kn_hip_gap < torso_height * 0.50
                and _v(25) > 0.50 and _v(26) > 0.50
            )
            if crouching and conflict_score > 0.0:
                conflict_score += 0.20

            if conflict_score < 0.50:
                return []

            confidence = round(min(conflict_score * 0.80 + mean_key_vis * 0.20, 1.0), 3)
            logger.debug(
                "Conflict posture detected",
                conflict_score=round(conflict_score, 3),
                confidence=confidence,
            )
            return [Detection(label="conflict", confidence=confidence)]
        except Exception as exc:
            logger.error("MediaPipe pose error", error=str(exc))
            return []

    # ── Stale camera cleanup ──────────────────────────────────────────────────

    def _cleanup_stale_cameras(self) -> None:
        """Remove state for cameras that haven't sent a frame recently."""
        max_age = settings.cv_stale_camera_seconds
        now = time.time()
        stale = [cid for cid, s in self._camera_states.items() if now - s.last_seen_ts > max_age]
        for cid in stale:
            self._camera_states.pop(cid, None)
            self._camera_locks.pop(cid, None)
            logger.debug("Stale camera state removed", camera_id=cid)

    @property
    def status(self) -> str:
        if not self._ready:
            return "not_loaded"
        loaded = []
        if self._yolo_person:
            loaded.append("yolo_person")
        if self._yolo_weapon:
            loaded.append("yolo_weapon")
        if self._mp_pose:
            loaded.append("mediapipe_pose")
        return ",".join(loaded) if loaded else "no_models"

    @property
    def active_cameras(self) -> List[str]:
        return list(self._camera_states.keys())


cv_engine = CVEngine.get_instance()
