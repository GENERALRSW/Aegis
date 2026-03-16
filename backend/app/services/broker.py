"""
AEGIS — Event broker abstraction (Kafka / RabbitMQ).
Provides a unified publish() interface regardless of backend.
Consumers for the dashboard WebSocket are also wired here.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Coroutine, Dict, Optional

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# ── In-memory fallback queue (used when broker is unavailable) ───────────────
_local_subscribers: list[Callable] = []


class BrokerClient:
    """Abstract base — concrete impls below."""

    async def connect(self) -> None: ...
    async def disconnect(self) -> None: ...
    async def publish(self, topic: str, message: Dict[str, Any]) -> None: ...


# ── Kafka ─────────────────────────────────────────────────────────────────────

class KafkaBroker(BrokerClient):
    def __init__(self) -> None:
        self._producer = None

    async def connect(self) -> None:
        try:
            from aiokafka import AIOKafkaProducer  # type: ignore
            self._producer = AIOKafkaProducer(
                bootstrap_servers=settings.kafka_bootstrap_servers,
                value_serializer=lambda v: json.dumps(v).encode(),
            )
            await self._producer.start()
            logger.info("Kafka producer connected", servers=settings.kafka_bootstrap_servers)
        except Exception as exc:
            logger.warning("Kafka unavailable — falling back to local bus", error=str(exc))
            self._producer = None

    async def disconnect(self) -> None:
        if self._producer:
            await self._producer.stop()

    async def publish(self, topic: str, message: Dict[str, Any]) -> None:
        if self._producer:
            try:
                await self._producer.send_and_wait(topic, message)
                return
            except Exception as exc:
                logger.error("Kafka publish failed", topic=topic, error=str(exc))
        # Fallback — notify local subscribers (WebSocket manager)
        await _local_publish(topic, message)


# ── RabbitMQ ──────────────────────────────────────────────────────────────────

class RabbitMQBroker(BrokerClient):
    def __init__(self) -> None:
        self._connection = None
        self._channel = None

    async def connect(self) -> None:
        try:
            import aio_pika  # type: ignore
            self._connection = await aio_pika.connect_robust(settings.rabbitmq_url)
            self._channel = await self._connection.channel()
            logger.info("RabbitMQ connected", url=settings.rabbitmq_url)
        except Exception as exc:
            logger.warning("RabbitMQ unavailable — falling back to local bus", error=str(exc))
            self._connection = None

    async def disconnect(self) -> None:
        if self._connection:
            await self._connection.close()

    async def publish(self, topic: str, message: Dict[str, Any]) -> None:
        if self._channel:
            try:
                import aio_pika  # type: ignore
                queue = await self._channel.declare_queue(topic, durable=True)
                await self._channel.default_exchange.publish(
                    aio_pika.Message(json.dumps(message).encode()),
                    routing_key=queue.name,
                )
                return
            except Exception as exc:
                logger.error("RabbitMQ publish failed", topic=topic, error=str(exc))
        await _local_publish(topic, message)


# ── Local pub/sub fallback ────────────────────────────────────────────────────

async def _local_publish(topic: str, message: Dict[str, Any]) -> None:
    payload = {"topic": topic, **message}
    for cb in list(_local_subscribers):
        try:
            await cb(payload)
        except Exception:
            pass


def subscribe_local(callback: Callable) -> None:
    _local_subscribers.append(callback)


def unsubscribe_local(callback: Callable) -> None:
    try:
        _local_subscribers.remove(callback)
    except ValueError:
        pass


# ── Singleton factory ─────────────────────────────────────────────────────────

_broker: Optional[BrokerClient] = None


async def get_broker() -> BrokerClient:
    global _broker
    if _broker is None:
        if settings.broker == "rabbitmq":
            _broker = RabbitMQBroker()
        else:
            _broker = KafkaBroker()
        await _broker.connect()
    return _broker


async def shutdown_broker() -> None:
    global _broker
    if _broker:
        await _broker.disconnect()
        _broker = None


async def publish_detection(event_data: Dict[str, Any]) -> None:
    broker = await get_broker()
    await broker.publish(settings.kafka_topic_detections, event_data)


async def publish_alert(alert_data: Dict[str, Any]) -> None:
    broker = await get_broker()
    await broker.publish(settings.kafka_topic_alerts, alert_data)
