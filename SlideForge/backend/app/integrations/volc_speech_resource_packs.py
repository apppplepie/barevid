"""豆包语音资源包 / 免费试用余量：ResourcePacksStatus（须火山账号 AK/SK，与 TTS 应用 Token 不同）。"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from volcenginesdkcore.api_client import ApiClient
from volcenginesdkcore.configuration import Configuration
from volcenginesdkcore.rest import ApiException
from volcenginesdkspeechsaasprod.api.speech_saas_prod_api import SPEECHSAASPRODApi
from volcenginesdkspeechsaasprod.models.resource_packs_status_request import (
    ResourcePacksStatusRequest,
)

from app.config import settings

logger = logging.getLogger(__name__)

# 语音合成大模型 2.0 服务标识（文档固定值）
_SPEECH_SYNTH_RESOURCE_ID = "volc.service_type.10029"
_CACHE_TTL_SEC = 120.0
_cache_monotonic: float = 0.0
_cache_display: str = ""


def _harvest_to_nums(h: Any) -> tuple[int, int, str] | None:
    rid = str(getattr(h, "resource_id", None) or "").strip()
    if rid != _SPEECH_SYNTH_RESOURCE_ID:
        return None
    try:
        purchased = int(float(getattr(h, "purchased_amount", 0) or 0))
        usage = int(float(getattr(h, "current_usage", 0) or 0))
    except (TypeError, ValueError):
        return None
    unit = str(getattr(h, "unit", None) or "").strip() or "字"
    return purchased, usage, unit


def _format_response(resp: Any) -> str:
    harvests = getattr(resp, "total_harvests", None) or []
    for h in harvests:
        parsed = _harvest_to_nums(h)
        if not parsed:
            continue
        purchased, usage, unit = parsed
        remaining = max(0, purchased - usage)
        return f"{remaining:,} / {purchased:,} {unit}"
    return ""


def _sync_fetch_display() -> str:
    ak = (settings.volcengine_access_key or "").strip()
    sk = (settings.volcengine_secret_key or "").strip()
    if not ak or not sk:
        return ""

    project = (settings.barevid_volcengine_project_name or "default").strip() or "default"
    conf = Configuration()
    conf.ak = ak
    conf.sk = sk
    api = SPEECHSAASPRODApi(ApiClient(conf))
    req = ResourcePacksStatusRequest(
        project_name=project,
        resource_ids=[_SPEECH_SYNTH_RESOURCE_ID],
        types=["prepaid"],
        page_size=10,
    )
    try:
        resp = api.resource_packs_status(req)
    except ApiException as e:
        logger.warning(
            "豆包 ResourcePacksStatus 失败：HTTP %s %s",
            getattr(e, "status", ""),
            (getattr(e, "reason", None) or str(e))[:300],
        )
        return ""
    except OSError as e:
        logger.warning("豆包 ResourcePacksStatus 网络错误：%s", e)
        return ""

    display = _format_response(resp)
    if not display:
        logger.warning("豆包 ResourcePacksStatus 返回中无 %s 的 TotalHarvests", _SPEECH_SYNTH_RESOURCE_ID)
    return display


async def get_barevid_doubao_trial_display() -> str:
    """供 /api/public/barevid-stats 展示；无 AK/SK 或失败返回空串（由 main 回退静态文案）。"""
    ak = (settings.volcengine_access_key or "").strip()
    sk = (settings.volcengine_secret_key or "").strip()
    if not ak or not sk:
        return ""

    global _cache_monotonic, _cache_display
    now = time.monotonic()
    if _cache_display and (now - _cache_monotonic) < _CACHE_TTL_SEC:
        return _cache_display

    display = await asyncio.to_thread(_sync_fetch_display)
    if display:
        _cache_display = display
        _cache_monotonic = now
        return display
    return _cache_display
