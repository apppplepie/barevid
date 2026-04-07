"""视频导出 worker 内存心跳：无数据库，单 API 进程内有效。"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

from app.db.models import utc_now

# 超过该时间未心跳则视为离线（建议 ≥ 2× 心跳间隔）
_STALE_SECONDS = 180
_MAX_LABEL = 128

_lock = asyncio.Lock()
_last_seen: dict[str, datetime] = {}


async def record_export_worker_heartbeat(worker_id: str | None) -> None:
    label = (worker_id or "").strip()[:_MAX_LABEL] or "worker"
    now = utc_now()
    async with _lock:
        _last_seen[label] = now


async def export_worker_alive_count() -> int:
    now = utc_now()
    cutoff = now - timedelta(seconds=_STALE_SECONDS)
    async with _lock:
        stale = [k for k, t in _last_seen.items() if t < cutoff]
        for k in stale:
            del _last_seen[k]
        return len(_last_seen)
