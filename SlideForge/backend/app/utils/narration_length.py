"""口播目标时长（秒）与汉字字数区间的换算，供结构化提示与前端估算共用。"""

from __future__ import annotations

# 中文口播经验区间：约 200～260 字/分钟（自然语速、含轻微停顿）
MIN_CHARS_PER_MINUTE = 200
MAX_CHARS_PER_MINUTE = 260
MID_CHARS_PER_MINUTE = 230

NARRATION_SECONDS_MIN = 10


def narration_seconds_cap() -> int:
    """口播目标时长上限（秒），由环境变量 MAX_TARGET_NARRATION_MINUTES 配置。"""
    from app.config import settings

    m = max(1, int(settings.max_target_narration_minutes))
    return m * 60


def clamp_narration_seconds(seconds: int) -> int:
    cap = narration_seconds_cap()
    return max(NARRATION_SECONDS_MIN, min(cap, int(seconds)))


def char_range_for_seconds(seconds: int) -> tuple[int, int]:
    """返回 (min_chars, max_chars)，含全稿所有 segments[].script 汉字等有效字符量。"""
    s = clamp_narration_seconds(seconds)
    lo = int(s * MIN_CHARS_PER_MINUTE / 60)
    hi = int(s * MAX_CHARS_PER_MINUTE / 60)
    if hi < lo:
        hi = lo
    return lo, hi


def mid_char_estimate(seconds: int) -> int:
    s = clamp_narration_seconds(seconds)
    return int(round(s * MID_CHARS_PER_MINUTE / 60))


def length_instruction_for_ai(seconds: int) -> str:
    """写入 DeepSeek 用户消息的篇幅约束（非硬编码 JSON 形状）。"""
    s = clamp_narration_seconds(seconds)
    lo, hi = char_range_for_seconds(s)
    mid = mid_char_estimate(s)
    return (
        f"【口播篇幅要求】用户期望整段口播体量约 {s} 秒（按自然中文口播估算，非成片精确时长）。"
        f"请将 JSON 内所有 segments[].script 拼接后的总字数控制在约 {lo}～{hi} 字（中位约 {mid} 字）。"
        "为落在该区间：素材偏长时可合并段落、删次要信息、压缩表述；偏短时可适当扩写（衔接、过渡、口语化展开、举例说明），"
        "但不得捏造事实、数据或与素材矛盾的内容。优先避免严重超出上限；明显低于下限时再补足篇幅。"
    )
