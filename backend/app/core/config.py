"""
AEGIS — Central configuration loaded from environment variables.
All settings are validated by Pydantic at startup.
"""

from __future__ import annotations

from functools import lru_cache
from typing import List, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ────────────────────────────────────────────────────────────
    app_name: str = "AEGIS Surveillance Backend"
    app_env: Literal["development", "production"] = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    debug: bool = False

    # ── Security ───────────────────────────────────────────────────────────────
    secret_key: str = Field(..., min_length=32)
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 7
    algorithm: str = "HS256"

    # ── MongoDB ────────────────────────────────────────────────────────────────
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "aegis_db"

    # ── Event Broker ───────────────────────────────────────────────────────────
    broker: Literal["kafka", "rabbitmq"] = "kafka"
    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_topic_detections: str = "detections"
    kafka_topic_alerts: str = "alerts"
    rabbitmq_url: str = "amqp://guest:guest@localhost:5672/"

    # ── Cloudinary ─────────────────────────────────────────────────────────────
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""

    # ── FCM ────────────────────────────────────────────────────────────────────
    fcm_credentials_path: str = "firebase_credentials.json"
    fcm_project_id: str = ""

    # ── LLM ───────────────────────────────────────────────────────────────────
    gemini_api_key: str = ""
    gemini_model: str = "gemini-1.5-flash"
    llm_enabled: bool = True

    # ── Computer Vision ────────────────────────────────────────────────────────
    yolo_model_path: str = "models/yolov8n.pt"
    weapon_model_path: str = "models/weapon_yolov8.pt"
    confidence_threshold: float = 0.45
    # Separate threshold for weapon detection — lower catches knives/forks at demo range
    weapon_confidence_threshold: float = 0.30
    iou_threshold: float = 0.45
    device: str = "cpu"
    # Seconds of inactivity before a phone/camera stream state is freed from memory
    cv_stale_camera_seconds: float = 300.0

    # ── Risk Thresholds ────────────────────────────────────────────────────────
    risk_low_threshold: float = 0.3
    risk_medium_threshold: float = 0.6
    risk_high_threshold: float = 0.8

    # ── Facial Recognition ────────────────────────────────────────────────────
    facial_recognition_enabled: bool = True
    # ISO 3166-1 alpha-2 code for the deployment region (e.g. "US", "GB", "JM")
    system_region: str = "US"
    # Comma-separated list of regions where FR is permitted; empty = all allowed
    allowed_facial_recognition_regions: str = ""
    # Allow admins to override the region policy at runtime
    facial_recognition_admin_override: bool = True
    # facenet-pytorch model variant: "vggface2" or "casia-webface"
    facial_recognition_model: str = "vggface2"
    # Cosine-distance threshold for a positive face match (lower = stricter)
    face_match_threshold: float = 0.40
    # Cosine-distance threshold for gait signature matching
    gait_match_threshold: float = 0.15
    # Security alerts stay local (WebSocket only, not published to Kafka/RabbitMQ)
    security_local_alerts_only: bool = True

    # ── Security Feature Toggles (default on; overridable at runtime by admin) ─
    restricted_persons_enabled: bool = True   # check frames against restraining-order list
    missing_persons_enabled: bool = True      # check frames against missing persons list
    criminal_search_enabled: bool = True      # include criminal-category persons in search
    gait_analysis_enabled: bool = True        # gait signature matching

    # ── CORS ──────────────────────────────────────────────────────────────────
    allowed_origins: str = "http://localhost:3000"

    # ── Rate Limiting ─────────────────────────────────────────────────────────
    rate_limit_per_minute: int = 120

    # ── Logging ───────────────────────────────────────────────────────────────
    log_level: str = "INFO"
    log_file: str = "logs/aegis.log"

    @property
    def cors_origins(self) -> List[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
