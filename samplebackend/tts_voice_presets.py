"""豆包常用音色（voice_type / V3 speaker），供前端下拉与文档 1257544 对照。

当前仅保留与 seed-tts-2.0 / HTTP V3 兼容的 2.0 音色，避免 BV*_streaming（1.0 / V1 体系）
误混入下拉后触发 55000000 resource/speaker mismatch。
"""

from __future__ import annotations

from app.config import settings

# (value, label)；value 为空串表示使用服务器 .env 的 DOUBAO_TTS_VOICE_TYPE。
# 这里维护的是常用 2.0 音色子集，不追求完整覆盖官方全表。
TTS_VOICE_PRESET_ROWS: list[tuple[str, str]] = [
    ("", "默认（跟随服务器）"),
    ("zh_female_vv_uranus_bigtts", "知性灿灿（IVI 2.0）"),
    ("saturn_zh_female_cancan_tob", "可爱女生（角色扮演 · 2.0）"),
    ("saturn_zh_female_keainvsheng_tob", "调皮公主（角色扮演 · 2.0）"),
    ("saturn_zh_female_tiaopigongzhu_tob", "爽朗少年（角色扮演 · 2.0）"),
    ("saturn_zh_male_shuanglangshaonian_tob", "天才同桌（角色扮演 · 2.0）"),
    ("saturn_zh_male_tiancaitongzhuo_tob", "小何（角色扮演 · 2.0）"),
    ("zh_female_xiaohe_uranus_bigtts", "小何（通用场景 · 2.0）"),
    ("zh_male_m191_uranus_bigtts", "云舟（通用场景 · 2.0）"),
    ("zh_male_taocheng_uranus_bigtts", "小天（通用场景 · 2.0）"),
    ("en_male_tim_uranus_bigtts", "Tim（通用场景 · 2.0）"),
]


def voice_presets_public() -> list[dict[str, str]]:
    return [{"value": v, "label": lab} for v, lab in TTS_VOICE_PRESET_ROWS]


def voice_presets_response() -> dict:
    return {
        "presets": voice_presets_public(),
        "server_default_voice_type": (settings.doubao_tts_voice_type or "").strip(),
    }


def effective_voice_type(stored: str | None) -> str:
    s = (stored or "").strip()
    if s:
        return s
    return (settings.doubao_tts_voice_type or "").strip() or "zh_male_m191_uranus_bigtts"
