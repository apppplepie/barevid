"""与前端 `ttsVoicePresets.ts` 对齐的音色列表，供 GET /api/tts/voice-presets 使用。"""

TTS_VOICE_PRESETS: list[dict[str, str]] = [
    {"value": "", "label": "默认（跟随服务器）"},
    {"value": "zh_female_vv_uranus_bigtts", "label": "知性灿灿（IVI 2.0）"},
    {"value": "saturn_zh_female_cancan_tob", "label": "灿灿（角色扮演 · 2.0）"},
    {"value": "saturn_zh_female_keainvsheng_tob", "label": "可爱女生（角色扮演 · 2.0）"},
    {"value": "saturn_zh_female_tiaopigongzhu_tob", "label": "调皮公主（角色扮演 · 2.0）"},
    {"value": "saturn_zh_male_shuanglangshaonian_tob", "label": "爽朗少年（角色扮演 · 2.0）"},
    {"value": "saturn_zh_male_tiancaitongzhuo_tob", "label": "天才同桌（角色扮演 · 2.0）"},
    {"value": "zh_female_xiaohe_uranus_bigtts", "label": "小何（通用场景 · 2.0）"},
    {"value": "zh_male_m191_uranus_bigtts", "label": "云舟（通用场景 · 2.0）"},
    {"value": "zh_male_taocheng_uranus_bigtts", "label": "小天（通用场景 · 2.0）"},
]


def list_tts_voice_presets() -> list[dict[str, str]]:
    return list(TTS_VOICE_PRESETS)
