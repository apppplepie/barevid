"""豆包语音合成：默认火山引擎 openspeech HTTP V3 单向流式，可选 HTTP V1 非流式。"""

import base64
import json
import os
import uuid
from pathlib import Path
from typing import Any

import httpx

from app.config import settings

_DOUBAO_TTS_V1_URL = "https://openspeech.bytedance.com/api/v1/tts"
_DOUBAO_TTS_V3_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"


def _doubao_httpx_timeout() -> httpx.Timeout:
    """流式 TTS 两包之间可能间隔较长，read 须足够大，否则会 httpx.ReadTimeout。"""
    read_s = max(60.0, float(settings.doubao_tts_http_timeout_seconds or 600.0))
    return httpx.Timeout(connect=30.0, read=read_s, write=120.0, pool=30.0)


def resolve_tts_voice_type(stored: str | None) -> str:
    """项目覆盖音色优先，否则使用环境默认。"""
    t = (stored or "").strip()
    if t:
        return t
    return (settings.doubao_tts_voice_type or "").strip() or "zh_male_m191_uranus_bigtts"


def _atomic_write_bytes(out_path: Path, raw: bytes) -> None:
    """
    先写临时文件，再原子替换，避免并发读取到半写入音频。
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_name(f".{out_path.name}.{uuid.uuid4().hex}.tmp")
    try:
        tmp.write_bytes(raw)
        # Windows 上 replace 目标存在时也能覆盖；同目录下为原子替换。
        os.replace(tmp, out_path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def _normalize_addition(raw: Any) -> Any:
    if isinstance(raw, str) and raw.strip():
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw
    return raw


def _ensure_addition_frontend_json_string(addition: Any) -> Any:
    """入库前将 addition.frontend 统一为 JSON 字符串，与 V3 路径一致，便于前端/导出解析。"""
    if not isinstance(addition, dict):
        return addition
    out = dict(addition)
    fe = out.get("frontend")
    if isinstance(fe, dict):
        out["frontend"] = json.dumps(fe, ensure_ascii=False)
    return out


def _canonicalize_alignment_object(obj: dict[str, Any]) -> dict[str, Any]:
    """
    将多种口播对齐 JSON 形态统一为 {source, reqid?, addition}；
    addition 为 dict 且 frontend 为内嵌 words 的 JSON 字符串。
    支持：addition 为字符串、顶层 words[]、顶层 frontend。
    """
    out = {k: v for k, v in obj.items() if k != "ingest_json_cache"}
    add = out.get("addition")
    if isinstance(add, str) and add.strip():
        try:
            parsed = json.loads(add)
            out["addition"] = parsed
            add = parsed
        except json.JSONDecodeError:
            pass

    if not isinstance(out.get("addition"), dict):
        words = out.get("words")
        if isinstance(words, list) and len(words) > 0:
            inner = json.dumps({"words": words}, ensure_ascii=False)
            src = str(out.get("source") or "").strip() or "inferred_flat_words"
            rid = out.get("reqid")
            base = {k: v for k, v in out.items() if k not in ("words", "frontend")}
            out = {
                "source": src,
                **({"reqid": rid} if rid is not None else {}),
                "addition": {"frontend": inner},
                **{
                    k: v
                    for k, v in base.items()
                    if k not in ("source", "reqid", "addition")
                },
            }
        elif "frontend" in out:
            fe = out.get("frontend")
            src = str(out.get("source") or "").strip() or "inferred_frontend_root"
            rid = out.get("reqid")
            base = {k: v for k, v in out.items() if k not in ("frontend", "words")}
            out = {
                "source": src,
                **({"reqid": rid} if rid is not None else {}),
                "addition": {"frontend": fe},
                **{k: v for k, v in base.items() if k not in ("source", "reqid", "addition")},
            }

    add_d = out.get("addition")
    if isinstance(add_d, dict):
        out["addition"] = _ensure_addition_frontend_json_string(add_d)
    return out


def canonicalize_stored_narration_alignment_json(text: str | None) -> str | None:
    """
    入库前规范化 narration_alignment_json；无法解析为 JSON 时原样返回（仍写入「缓存」列）。
    若规范化改变了结构，附带 ingest_json_cache 保留原始文本（体积上限约 200KB）。
    """
    if text is None:
        return None
    if not isinstance(text, str) or not text.strip():
        return None
    raw_stripped = text.strip()
    try:
        obj = json.loads(raw_stripped)
    except json.JSONDecodeError:
        return raw_stripped
    if not isinstance(obj, dict):
        return raw_stripped
    obj_clean = {k: v for k, v in obj.items() if k != "ingest_json_cache"}
    fixed = _canonicalize_alignment_object(obj_clean)
    try:
        stable_before = json.dumps(obj_clean, ensure_ascii=False, sort_keys=True)
        stable_after = json.dumps(fixed, ensure_ascii=False, sort_keys=True)
        if (
            stable_before != stable_after
            and len(raw_stripped) <= 200_000
            and "ingest_json_cache" not in fixed
        ):
            fixed = dict(fixed)
            fixed["ingest_json_cache"] = raw_stripped
    except (TypeError, ValueError):
        pass
    return json.dumps(fixed, ensure_ascii=False)


def _alignment_json_from_response(payload: dict[str, Any], source: str) -> str:
    norm = _normalize_addition(payload.get("addition"))
    pack: dict[str, Any] = {
        "source": source,
        "reqid": payload.get("reqid"),
        "addition": _ensure_addition_frontend_json_string(norm),
    }
    dumped = json.dumps(pack, ensure_ascii=False)
    return canonicalize_stored_narration_alignment_json(dumped) or dumped


def _speed_ratio_to_v3_speech_rate(speed_ratio: float) -> int:
    """V3 speech_rate：-50~100，0 为原速；对应 V1 speed_ratio 约 0.5~2.0。"""
    r = int(round(100.0 * (float(speed_ratio) - 1.0)))
    return max(-50, min(100, r))


def _v3_resource_uses_subtitle(resource_id: str) -> bool:
    rid = (resource_id or "").lower()
    return "tts-2.0" in rid or "icl-2.0" in rid


def _merge_v3_sentence_words(sentences: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """拼成与 V1 addition.frontend.words 一致字段（毫秒）。"""
    out: list[dict[str, Any]] = []
    for sentence in sentences:
        words = sentence.get("words")
        if not isinstance(words, list):
            continue
        for item in words:
            if not isinstance(item, dict):
                continue
            st = item.get("startTime", item.get("start_time"))
            en = item.get("endTime", item.get("end_time"))
            word = item.get("word", "")
            try:
                st_ms = int(round(float(st) * 1000.0))
                en_ms = int(round(float(en) * 1000.0))
            except (TypeError, ValueError):
                continue
            out.append(
                {"start_time": st_ms, "end_time": en_ms, "word": str(word)}
            )
    return out


def _http_error_detail_quota_hint(detail: str) -> str:
    low = detail.lower()
    if "quota" in low or "text_words" in low:
        return (
            " 若为 quota / text_words 类提示，表示该语音应用下文本合成额度已用尽（含体验/终身字数包等），"
            "需在火山控制台查看用量与资源包或开通后付费；"
            "仅换音色或接口版本通常不能绕过同一应用的配额。"
        )
    return ""


async def _synthesize_v1_to_file(text: str, out_path: Path, voice_type: str) -> str | None:
    app_id = (settings.doubao_tts_app_id or "").strip()
    token = (settings.doubao_tts_access_token or "").strip()
    if not app_id or not token:
        raise RuntimeError(
            "未配置豆包语音：请在 .env 中设置 DOUBAO_TTS_APP_ID 与 "
            "DOUBAO_TTS_ACCESS_TOKEN（控制台语音应用获取，见火山文档）。"
        )

    want_ts = settings.doubao_tts_with_timestamp
    req_block: dict[str, Any] = {
        "reqid": str(uuid.uuid4()),
        "text": text,
        "operation": "query",
    }
    if want_ts:
        req_block["with_timestamp"] = 1

    body = {
        "app": {
            "appid": app_id,
            "token": token,
            "cluster": settings.doubao_tts_cluster,
        },
        "user": {"uid": settings.doubao_tts_uid},
        "audio": {
            "voice_type": voice_type,
            "encoding": "mp3",
            "speed_ratio": settings.doubao_tts_speed_ratio,
        },
        "request": req_block,
    }

    headers = {
        "Authorization": f"Bearer;{token}",
        "Content-Type": "application/json",
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)

    async with httpx.AsyncClient(timeout=_doubao_httpx_timeout(), trust_env=False) as client:
        r = await client.post(_DOUBAO_TTS_V1_URL, json=body, headers=headers)
        if r.status_code >= 400:
            detail = (r.text or "").strip()
            if len(detail) > 500:
                detail = detail[:500] + "…"
            raise RuntimeError(
                f"豆包 TTS HTTP {r.status_code}：{detail or r.reason_phrase}。"
                + _http_error_detail_quota_hint(detail)
                + "否则请核对 .env 中 DOUBAO_TTS_APP_ID / DOUBAO_TTS_ACCESS_TOKEN 与控制台语音应用一致且未过期，"
                "cluster 一般为 volcano_tts；详见 README 与文档 1257584。"
            )
        payload = r.json()

    code = payload.get("code")
    if code != 3000:
        msg = payload.get("message", "unknown")
        raise RuntimeError(f"豆包语音合成失败: code={code}, message={msg}")

    data_b64 = payload.get("data")
    if not data_b64:
        raise RuntimeError("豆包语音合成返回无音频数据")

    raw = base64.b64decode(data_b64)
    if not raw:
        raise RuntimeError("豆包语音合成返回空音频内容")
    _atomic_write_bytes(out_path, raw)

    if want_ts:
        return _alignment_json_from_response(payload, "doubao_tts_http_v1")
    return None


async def _synthesize_v3_to_file(text: str, out_path: Path, voice_type: str) -> str | None:
    """
    HTTP V3 单向流式 Chunked，文档：https://www.volcengine.com/docs/6561/1598757
    """
    app_id = (settings.doubao_tts_app_id or "").strip()
    token = (settings.doubao_tts_access_token or "").strip()
    resource_id = (settings.doubao_tts_resource_id or "").strip()
    if not app_id or not token:
        raise RuntimeError(
            "未配置豆包语音：请在 .env 中设置 DOUBAO_TTS_APP_ID 与 "
            "DOUBAO_TTS_ACCESS_TOKEN（控制台语音应用获取，见火山文档）。"
        )
    if not resource_id:
        raise RuntimeError(
            "V3 合成需在 .env 中设置 DOUBAO_TTS_RESOURCE_ID（如 TTS2.0：seed-tts-2.0），"
            "见文档 1598757。"
        )

    want_ts = settings.doubao_tts_with_timestamp
    req_id = str(uuid.uuid4())

    audio_params: dict[str, Any] = {
        "format": "mp3",
        "sample_rate": 24000,
        "speech_rate": _speed_ratio_to_v3_speech_rate(settings.doubao_tts_speed_ratio),
    }
    if want_ts:
        if _v3_resource_uses_subtitle(resource_id):
            audio_params["enable_subtitle"] = True
        else:
            audio_params["enable_timestamp"] = True

    body: dict[str, Any] = {
        "user": {"uid": settings.doubao_tts_uid},
        "req_params": {
            "text": text,
            "speaker": voice_type,
            "audio_params": audio_params,
        },
    }

    headers = {
        "X-Api-App-Id": app_id,
        "X-Api-Access-Key": token,
        "X-Api-Resource-Id": resource_id,
        "X-Api-Request-Id": req_id,
        "Content-Type": "application/json",
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    audio_buf = bytearray()
    sentence_events: list[dict[str, Any]] = []
    decode = json.JSONDecoder()

    def _consume_v3_obj(obj: dict[str, Any]) -> None:
        c = obj.get("code")
        if c is not None and c not in (0, 20000000):
            msg = str(obj.get("message") or "unknown")
            hint = ""
            low = msg.lower()
            if c == 55000000 or "mismatch" in low or "resource" in low:
                hint = (
                    "（X-Api-Resource-Id 与 speaker 版本不一致："
                    "seed-tts-2.0 仅配「豆包语音合成模型2.0」音色，如 zh_*_uranus_bigtts；"
                    "若坚持用 1.0 音色请设 DOUBAO_TTS_RESOURCE_ID=seed-tts-1.0 或改用 V1："
                    "DOUBAO_TTS_USE_V3=false。音色表见文档 1257544。）"
                )
            raise RuntimeError(f"豆包 TTS V3 失败: code={c}, message={msg}{hint}")

        data = obj.get("data")
        if isinstance(data, str) and data:
            try:
                audio_buf.extend(base64.b64decode(data))
            except Exception as e:
                raise RuntimeError(f"豆包 TTS V3 音频 base64 解码失败: {e}") from e

        sentence = obj.get("sentence")
        if isinstance(sentence, dict):
            sentence_events.append(sentence)

    async with httpx.AsyncClient(timeout=_doubao_httpx_timeout(), trust_env=False) as client:
        async with client.stream(
            "POST",
            _DOUBAO_TTS_V3_URL,
            headers=headers,
            json=body,
        ) as r:
            if r.status_code >= 400:
                detail = (await r.aread()).decode("utf-8", errors="replace").strip()
                if len(detail) > 500:
                    detail = detail[:500] + "…"
                raise RuntimeError(
                    f"豆包 TTS V3 HTTP {r.status_code}：{detail or r.reason_phrase}。"
                    + _http_error_detail_quota_hint(detail)
                    + "请核对 X-Api-App-Id / X-Api-Access-Key / X-Api-Resource-Id 与控制台一致，"
                    "resource 与音色版本需匹配（如 2.0 音色用 seed-tts-2.0）；文档 1598757。"
                )

            buf = ""
            async for chunk in r.aiter_text():
                buf += chunk
                while True:
                    s = buf.lstrip()
                    if not s:
                        buf = ""
                        break
                    if s.startswith("data:"):
                        s = s[5:].lstrip()
                    try:
                        obj, end = decode.raw_decode(s)
                    except json.JSONDecodeError:
                        buf = s
                        break
                    buf = s[end:].lstrip()
                    if isinstance(obj, dict):
                        _consume_v3_obj(obj)

    if not audio_buf:
        raise RuntimeError("豆包 TTS V3 未收到音频数据")

    raw = bytes(audio_buf)
    if not raw:
        raise RuntimeError("豆包 TTS V3 返回空音频内容")
    _atomic_write_bytes(out_path, raw)

    if not want_ts:
        return None

    words = _merge_v3_sentence_words(sentence_events)
    if not words:
        return None

    inner = json.dumps({"words": words}, ensure_ascii=False)
    addition = {"frontend": inner}
    pack = {
        "source": "doubao_tts_http_v3",
        "reqid": req_id,
        "addition": addition,
    }
    dumped = json.dumps(pack, ensure_ascii=False)
    return canonicalize_stored_narration_alignment_json(dumped) or dumped


async def synthesize_to_file(
    text: str,
    out_path: Path,
    *,
    voice_override: str | None = None,
) -> str | None:
    """
    写入音频文件；若开启 doubao_tts_with_timestamp，返回可入库的 JSON 字符串。
    V1：addition 来自接口原文；V3：拼成与前端一致的 addition.frontend.words（毫秒）。
    """
    voice = resolve_tts_voice_type(voice_override)
    if settings.doubao_tts_use_v3:
        raw = await _synthesize_v3_to_file(text, out_path, voice)
    else:
        raw = await _synthesize_v1_to_file(text, out_path, voice)
    return canonicalize_stored_narration_alignment_json(raw)
