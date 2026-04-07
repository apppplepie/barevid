"""视频导出 worker 内存心跳：无数据库，单 API 进程内有效。"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from app.db.models import utc_now

_log = logging.getLogger(__name__)

# 超过该时间未心跳则视为离线（建议 ≥ 2× 心跳间隔）
_STALE_SECONDS = 180
_MAX_LABEL = 128

_lock = asyncio.Lock()
_last_seen: dict[str, datetime] = {}

# 宣传页长轮询：worker 心跳时唤醒，避免固定 5min 轮询与 180s 过期不对齐
_stats_wait_events: list[asyncio.Event] = []
_stats_wait_lock = asyncio.Lock()


async def register_barevid_stats_waiter(ev: asyncio.Event) -> None:
    async with _stats_wait_lock:
        _stats_wait_events.append(ev)


async def unregister_barevid_stats_waiter(ev: asyncio.Event) -> None:
    async with _stats_wait_lock:
        try:
            _stats_wait_events.remove(ev)
        except ValueError:
            pass


async def notify_barevid_stats_waiters() -> None:
    async with _stats_wait_lock:
        for ev in _stats_wait_events:
            ev.set()


async def record_export_worker_heartbeat(worker_id: str | None) -> None:
    label = (worker_id or "").strip()[:_MAX_LABEL] or "worker"
    now = utc_now()
    async with _lock:
        _last_seen[label] = now
        alive = len(_last_seen)
    _log.info("export worker heartbeat ok worker_id=%r alive=%d", label, alive)
    await notify_barevid_stats_waiters()


async def export_worker_alive_count() -> int:
    now = utc_now()
    cutoff = now - timedelta(seconds=_STALE_SECONDS)
    async with _lock:
        stale = [k for k, t in _last_seen.items() if t < cutoff]
        for k in stale:
            del _last_seen[k]
        return len(_last_seen)
