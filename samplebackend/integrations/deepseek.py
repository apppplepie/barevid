import asyncio
import json
import logging
import re
from pathlib import Path
from typing import Any, Literal

from openai import (
    APIConnectionError,
    APIStatusError,
    AsyncOpenAI,
    AuthenticationError,
    BadRequestError,
    RateLimitError,
)
from pydantic import ValidationError

from app.config import settings
from app.schemas import StructuredPodcast
from app.utils.narration_length import length_instruction_for_ai

logger = logging.getLogger(__name__)

JSON_REPAIR_SYSTEM = """你是 JSON 修复器。
给你一段模型输出文本（可能带 ```json / ```html 代码块、转义错误、截断前后噪声）。
你的任务：
1. 只输出一个合法 JSON 对象；
2. 不要 Markdown，不要解释，不要代码围栏（禁止输出 ```）；
3. 尽量保持原字段与原字符串内容，不要改写业务含义；
4. 对 JSON 字符串值：内部双引号必须 \\"，反斜杠必须 \\\\，换行必须 \\n，不得出现「引号未闭合就换行」；
5. 若文本中有多余前后内容，仅保留 JSON 对象本体；
6. 若 pages_html[].html 已截断导致引号无法闭合，可删去无法修复的尾部、合法闭合 JSON 字符串并补全 ]}，优先保证整段可 json.loads（页面可略短于原文）。"""


STRUCTURE_SYSTEM = """你是文案编辑。用户会粘贴杂乱素材，你要去掉emoji/情绪符号，整理成「大标题 + 小标题」两层结构，口吻像单人播客（自然、有节奏、口语化，避免书面报告腔）。
硬性要求：
1. 只输出一个 JSON 对象，不要 Markdown，不要代码围栏，不要解释。
2. JSON Schema 形状严格如下：
{
  "items": [
    {
      "main_title": "string",
      "segments": [
        { "subtitle": "string", "script": "string", "brief": "string" }
      ]
    }
  ]
}
3. 每个 segments[].script 是一段完整口播，供语音合成使用，可含语气词但不要用舞台说明括号。
4. 每个 segments[].brief 是该段提炼版：总长建议 50~900 字，保留代码、数据、观点等关键信息。
5. 大标题 2～5 个为宜；每个大标题下小标题 1～6 个为宜（如果没有明显的并列关系做1个即可）；总量视输入信息量而定。
6. 若用户消息中另有「口播篇幅/字数」要求，可围绕素材适当扩写或缩写以落在给定区间；扩写时不捏造事实与数据。"""


STRUCTURE_SYSTEM_VERBATIM = """你是文本结构助手。用户会提供一段已定稿的原文（可能很长、可能含代码或列表）。
硬性要求：
1. 只输出一个 JSON 对象，不要 Markdown，不要代码围栏，不要解释。
2. JSON Schema 形状严格如下：
{
  "items": [
    {
      "main_title": "string",
      "segments": [
        { "subtitle": "string", "script": "string", "brief": "string" }
      ]
    }
  ]
}
3. **禁止改写、润色、删减或扩写用户的字句**：每个 segments[].script 必须是从用户原文中**连续截取**的片段，字符级与原文对应部分一致（仅允许因 JSON 转义产生的 \\n 等）。
4. 你的任务是：按语义与自然段落边界把原文**切块**归入合适的大标题、小标题；subtitle 与 main_title 由你拟短名，但要与该片内容对应。不要按任何目标时长或总字数去压缩或拉长原文。
5. 每个 segments[].brief 为该段的精炼概括，可提炼要点，但不要替代 script。
6. 须覆盖用户原文的全部内容：按顺序拼接所有 segments[].script 应还原整篇原文（中间无遗漏、无多余）。
7. 大标题 1～8 个；每标题下 1～12 个小段，视原文长度而定。"""


DECK_STYLE_PRESET_ORDER: list[str] = [
    "aurora_glass",
    "minimal_tech",
    "dark_neon",
    "editorial_luxury",
    "futuristic_hud",
]

DECK_STYLE_PRESETS: dict[str, dict[str, str]] = {
    "none": {
        "label": "未选预设",
        "style_name": "",
        "detail_for_prompt": "",
    },
    "aurora_glass": {
        "label": "Aurora Glass（极光玻璃 · 默认）",
        "style_name": "Aurora Glass",
        "detail_for_prompt": (
            "关键词：渐变光、玻璃态、模糊、柔和光晕、漂浮元素。\n"
            "适合：科技、AI 产品、叙事感强。"
        ),
    },
    "minimal_tech": {
        "label": "Minimal Tech（极简科技）",
        "style_name": "Minimal Tech",
        "detail_for_prompt": (
            "关键词：逻辑清晰，分层明确，装饰简洁。优先使用浅色背景，深色文字，\n"
            "适合：严肃产品、高端工具。"
        ),
    },
    "dark_neon": {
        "label": "Dark Neon（暗黑霓虹）",
        "style_name": "Dark Neon",
        "detail_for_prompt": (
            "关键词：黑底、霓虹光、发光边框、对比强烈。\n"
            "适合：黑客风、游戏感、强视觉冲击。"
        ),
    },
    "editorial_luxury": {
        "label": "Editorial Luxury（杂志高级感）",
        "style_name": "Editorial Luxury",
        "detail_for_prompt": (
            "关键词：杂志风、对比留白、精致分栏。\n"
            "适合：故事、叙事类内容。"
        ),
    },
    "futuristic_hud": {
        "label": "Futuristic HUD（未来 UI / 控制面板）",
        "style_name": "Futuristic HUD",
        "detail_for_prompt": (
            "关键词：HUD、线框、数据面板、扫描线、科技 UI。\n"
            "适合：系统演示、数据展示。"
        ),
    },
}


def list_deck_style_presets() -> list[dict[str, str]]:
    return [
        {"id": pid, "label": DECK_STYLE_PRESETS[pid]["label"]}
        for pid in DECK_STYLE_PRESET_ORDER
    ]


def resolve_deck_style_preset(preset_id: str) -> dict[str, str]:
    key = (preset_id or "").strip()
    meta = DECK_STYLE_PRESETS.get(key)
    if not meta:
        raise RuntimeError(
            "未知风格预设 "
            f"{preset_id!r}，可选：{', '.join(sorted(DECK_STYLE_PRESETS.keys()))}"
        )
    return meta


# 生成 deck 时注入 system：分辨率与项目 deck_page_size / 导出尺寸一致；以下为画布与版式约束（非 _PAGE_SIZE_META 字段）
_DECK_CANVAS_BLOCK: dict[str, str] = {
    "16:9": "16:9 横屏（1920×1080）。桌面/主机端 UI。",
    "4:3": "4:3 横屏（1024×768）。桌面 UI。",
    "9:16": (
        "9:16 竖屏（1080×1920）。手机网页/App：单列纵向流；单行≤8 字，超出换行；每段≤3 行。"
        "标题≥36px，正文≥30px。卡片/组件宽≤屏宽 92%，左右边距≥4%。按钮高度≥80px。"
    ),
    "1:1": "1:1 方屏（1080×1080）。方形画幅内居中布局。",
}


def format_deck_canvas_block_for_generation(page_size: str | None) -> str:
    key = (page_size or "").strip() or "16:9"
    return _DECK_CANVAS_BLOCK.get(key, _DECK_CANVAS_BLOCK["16:9"])


async def _await_with_timeout(
    awaitable: Any,
    *,
    timeout_seconds: int,
    scene: str,
) -> Any:
    timeout = max(30, int(timeout_seconds or 0))
    try:
        return await asyncio.wait_for(awaitable, timeout=timeout)
    except asyncio.TimeoutError as e:
        raise RuntimeError(
            f"{scene}超时（>{timeout}s），请检查 Docker 容器到模型服务的网络/代理配置，"
            "或稍后重试。"
        ) from e


STYLE_PROMPT_MASTER_SYSTEM = """你是UIUE美术设计师。根据下列信息写一段纯文本的「统一视觉风格说明」。

项目标题（必填，唯一必须依据的输入）：
{project_title}
风格类型（选填，未提供时可为空）：
{style_name}
风格说明（选填，未提供时可为空）：
{style_detail}
用户补充（选填，未提供时可为空）：
{user_hint}
当风格类型、风格说明或用户补充为空、为「（无）」或未提供时，不要强行套用不存在的约束；主要依据项目标题与随后拼接的「页面画布与比例」自行确定统一、可执行的视觉风格。
要求（必须遵守）：
1. 只输出一段连续正文，不要用 Markdown 标题/列表/代码块；不要输出 JSON。
2. 写清主色/辅色/强调色、背景（纯色/渐变/光效）、字体层级、组件质感（圆角/阴影等）、动效（进入/微动）、装饰元素；若项目标题有明确主题，视觉气质需与之协调（仍遵守下方字号与禁止项）。
3. 确认字体字号，标题必须大于36px，正文必须大于30px，禁止整体过小字号。
4. 禁止 emoji 与情绪符号。
5. 篇幅控制在 100～400 字，避免空话。
"""


def _strip_markdown_json_fence(text: str) -> str:
    t = (text or "").strip()
    if not t.startswith("```"):
        return t
    t = re.sub(r"^```(?:json)?\s*", "", t, count=1)
    t = re.sub(r"\s*```\s*$", "", t).strip()
    return t


def _fim_prefix_from_model_output(content: str) -> str | None:
    """取从首个 `{` 起的截断 JSON 前缀，供 FIM 续写 html 与收尾。"""
    t = _strip_markdown_json_fence(content)
    start = t.find("{")
    if start < 0:
        return None
    return t[start:].strip()


async def _coerce_pages_html_dict(
    content: str,
    *,
    client: AsyncOpenAI,
    scene: str,
) -> dict[str, Any]:
    data = await _extract_json_object_with_repair(
        content=content,
        client=client,
        scene=scene,
    )
    if not isinstance(data, dict):
        raise RuntimeError("DeepSeek 返回 JSON 必须是对象。")
    if "pages_html" not in data:
        raise RuntimeError("DeepSeek 返回 JSON 缺少 pages_html。")
    if not isinstance(data["pages_html"], list):
        raise RuntimeError("pages_html 必须是数组。")
    return data


async def deepseek_fim_fill(*, prefix: str, suffix: str) -> str:
    """DeepSeek Beta FIM：`completions.create(prompt=..., suffix=...)`。"""
    if not settings.deepseek_api_key:
        raise RuntimeError("未配置 DEEPSEEK_API_KEY")
    beta_url = (settings.deepseek_beta_base_url or "").strip().rstrip("/")
    # 兼容用户误把 v1 基础地址填到 beta 上的情况
    if beta_url.endswith("/beta/v1"):
        beta_url = beta_url[: -len("/v1")]
    elif beta_url.endswith("/v1") and "/beta" not in beta_url:
        beta_url = beta_url[: -len("/v1")] + "/beta"
    if not beta_url:
        raise RuntimeError("未配置 deepseek_beta_base_url")
    if not (prefix or "").strip():
        raise RuntimeError("FIM prompt 不能为空（prefix 为空）")
    max_tok = int(settings.deepseek_fim_max_tokens)
    max_tok = max(256, min(4096, max_tok))
    client = AsyncOpenAI(
        api_key=settings.deepseek_api_key,
        base_url=beta_url,
    )
    try:
        completion = await _await_with_timeout(
            client.completions.create(
                model=settings.deepseek_model,
                prompt=prefix,
                suffix=suffix,
                max_tokens=max_tok,
                temperature=0.7,
            ),
            timeout_seconds=settings.deepseek_request_timeout_seconds,
            scene="DeepSeek FIM",
        )
    except AuthenticationError as e:
        raise RuntimeError(
            "DeepSeek FIM 鉴权失败：DEEPSEEK_API_KEY 无效或 beta 网关不可用。"
        ) from e
    except RateLimitError as e:
        raise RuntimeError("DeepSeek FIM 触发限流，请稍后重试。") from e
    except BadRequestError as e:
        raise RuntimeError(f"DeepSeek FIM 请求参数错误：{e}") from e
    except APIConnectionError as e:
        raise RuntimeError("无法连接 DeepSeek FIM，请检查网络或 beta base_url。") from e
    except APIStatusError as e:
        raise RuntimeError(f"DeepSeek FIM 服务异常：HTTP {e.status_code}") from e
    choices = completion.choices
    if not choices:
        raise RuntimeError("DeepSeek FIM 返回空 choices")
    return choices[0].text or ""


def _clip_for_error(s: str, max_len: int = 1200) -> str:
    t = (s or "").strip().replace("\r\n", "\n")
    if len(t) <= max_len:
        return t
    half = max_len // 2
    return t[:half] + "\n…(省略)…\n" + t[-half:]


def _derive_brief(script: str, max_chars: int = 90) -> str:
    t = " ".join((script or "").split())
    if not t:
        return ""
    # 取首句作为兜底提炼，避免模型偶发缺字段
    for sep in ("。", "！", "？", ".", "!", "?", "\n"):
        pos = t.find(sep)
        if 0 < pos < max_chars:
            return t[: pos + 1].strip()
    if len(t) <= max_chars:
        return t
    return t[: max_chars - 3].rstrip() + "..."


def _extract_json_object(text: str) -> dict:
    original = text
    text = text.strip()
    fence = re.match(r"^```(?:json)?\s*([\s\S]*?)\s*```$", text)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            inner = text[start : end + 1]
            try:
                return json.loads(inner)
            except json.JSONDecodeError as e2:
                raise RuntimeError(
                    "DeepSeek 返回内容不是合法 JSON（尝试截取首尾大括号内仍失败："
                    f"{e2.msg}）。模型原文节选：{_clip_for_error(original)!r}"
                ) from e2
        raise RuntimeError(
            f"DeepSeek 返回内容不是合法 JSON（{e.msg}，约位置 {e.pos}）。"
            f"模型原文节选：{_clip_for_error(original)!r}"
        ) from e



def _scan_json_string(s: str, start: int) -> tuple[str, int]:
    """扫描 JSON 字符串（从引号开始），返回 (value, end_index_exclusive)。"""
    if start >= len(s) or s[start] != '"':
        raise RuntimeError("JSON string 起始位置无引号")
    i = start + 1
    out: list[str] = []
    while i < len(s):
        ch = s[i]
        if ch == '"':
            return "".join(out), i + 1
        if ch == "\\":
            if i + 1 >= len(s):
                break
            nxt = s[i + 1]
            if nxt in ('"', "\\", "/", "b", "f", "n", "r", "t"):
                out.append("\\" + nxt)
                i += 2
                continue
            if nxt == "u" and i + 5 < len(s):
                out.append(s[i : i + 6])
                i += 6
                continue
        out.append(ch)
        i += 1
    raise RuntimeError("JSON string 未闭合")


def _extract_pages_html_fallback(content: str) -> dict[str, Any]:
    """尽力从非严格 JSON 中抽取 pages_html。"""
    t = _strip_markdown_json_fence(content)
    items: list[dict[str, str]] = []
    i = 0
    while True:
        k = t.find('"main_title"', i)
        if k < 0:
            break
        colon = t.find(":", k)
        if colon < 0:
            break
        q = t.find('"', colon)
        if q < 0:
            break
        try:
            main_title, end_q = _scan_json_string(t, q)
        except RuntimeError:
            break
        h = t.find('"html"', end_q)
        if h < 0:
            break
        colon_h = t.find(":", h)
        if colon_h < 0:
            break
        qh = t.find('"', colon_h)
        if qh < 0:
            break
        try:
            html, end_h = _scan_json_string(t, qh)
        except RuntimeError:
            break
        items.append({"main_title": main_title, "html": html})
        i = end_h
    if items:
        return {"pages_html": items}
    raise RuntimeError("无法从返回内容中抽取 pages_html")


async def _extract_json_object_with_repair(
    *,
    content: str,
    client: AsyncOpenAI,
    scene: str,
) -> dict:
    """先本地解析，失败后调用一次模型进行 JSON 修复。"""
    try:
        return _extract_json_object(content)
    except RuntimeError as first_err:
        logger.warning("%s 初次 JSON 解析失败，准备调用修复模型：%s", scene, first_err)
        try:
            repair_completion = await _await_with_timeout(
                client.chat.completions.create(
                    model=settings.deepseek_model,
                    messages=[
                        {"role": "system", "content": JSON_REPAIR_SYSTEM},
                        {
                            "role": "user",
                            "content": (
                                f"场景：{scene}\n"
                                "请把下面文本修复为合法 JSON 对象：\n\n"
                                f"{content}"
                            ),
                        },
                    ],
                    temperature=0.0,
                ),
                timeout_seconds=settings.deepseek_request_timeout_seconds,
                scene=f"{scene} JSON 修复",
            )
        except Exception as repair_call_err:
            raise RuntimeError(
                f"{first_err}；且 JSON 修复重试调用失败：{repair_call_err}"
            ) from repair_call_err

        repaired = repair_completion.choices[0].message.content or ""
        if not repaired.strip():
            raise RuntimeError(f"{first_err}；且 JSON 修复重试返回空内容")
        try:
            return _extract_json_object(repaired)
        except RuntimeError as second_err:
            raise RuntimeError(
                f"{first_err}；JSON 修复重试后仍失败：{second_err}"
            ) from second_err


async def structure_raw_text(
    raw_text: str,
    *,
    narration_target_seconds: int | None = None,
    structure_mode: str = "polish",
) -> StructuredPodcast:
    if not settings.deepseek_api_key:
        raise RuntimeError("未配置 DEEPSEEK_API_KEY")

    client = AsyncOpenAI(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
    )
    mode = (structure_mode or "polish").strip().lower()
    verbatim = mode == "verbatim_split"
    # 保留原文模式：不向模型传递目标秒数/换算字数（避免诱导删改原文以「达标」）
    if verbatim:
        narration_target_seconds = None
    user_messages: list[dict[str, str]] = [{"role": "user", "content": raw_text}]
    if narration_target_seconds is not None:
        user_messages.append(
            {
                "role": "user",
                "content": length_instruction_for_ai(narration_target_seconds),
            }
        )
    system_prompt = STRUCTURE_SYSTEM_VERBATIM if verbatim else STRUCTURE_SYSTEM
    temp = 0.25 if verbatim else 0.6
    try:
        completion = await _await_with_timeout(
            client.chat.completions.create(
                model=settings.deepseek_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    *user_messages,
                ],
                temperature=temp,
            ),
            timeout_seconds=settings.deepseek_request_timeout_seconds,
            scene="DeepSeek 文本结构化",
        )
    except AuthenticationError as e:
        raise RuntimeError(
            "DeepSeek 鉴权失败：DEEPSEEK_API_KEY 无效或已过期。"
        ) from e
    except RateLimitError as e:
        raise RuntimeError("DeepSeek 触发限流，请稍后重试。") from e
    except BadRequestError as e:
        raise RuntimeError(f"DeepSeek 请求参数错误：{e}") from e
    except APIConnectionError as e:
        raise RuntimeError("无法连接 DeepSeek，请检查网络或 base_url。") from e
    except APIStatusError as e:
        raise RuntimeError(f"DeepSeek 服务异常：HTTP {e.status_code}") from e
    content = completion.choices[0].message.content
    if not content:
        raise RuntimeError("DeepSeek 返回空内容")

    data = await _extract_json_object_with_repair(
        content=content,
        client=client,
        scene="播客结构化（items/segments）",
    )
    # 兼容旧响应：若 brief 缺失/为空，使用 script 自动派生
    if isinstance(data, dict):
        items = data.get("items")
        if isinstance(items, list):
            for item in items:
                if not isinstance(item, dict):
                    continue
                segs = item.get("segments")
                if not isinstance(segs, list):
                    continue
                for seg in segs:
                    if not isinstance(seg, dict):
                        continue
                    brief = str(seg.get("brief") or "").strip()
                    if brief:
                        continue
                    seg["brief"] = _derive_brief(str(seg.get("script") or ""))
    try:
        return StructuredPodcast.model_validate(data)
    except ValidationError as e:
        raise RuntimeError(f"DeepSeek 返回 JSON 结构不符合预期：{e}") from e

IMAGE_RULE = """图片规则（必须遵守）：
非必要不插图，仅在“信息需要视觉承载”时使用图片（如：产品外观、真实环境）；纯概念/数据/逻辑内容禁止使用图片。
图片要大小合适，不要太小。
优先使用稳定来源（如 unsplash、picsum、pexels）。禁止使用占位说明或无效链接。
一页允许1-2张图，但是每张图必须在同一位置叠加 3 张图片作为冗余（多层叠图）层级用 z-index 区分，顶部为主图，其余为备用图，防止图片失效。
图片需适配容器（object-fit: cover），不得溢出容器！！！"""

IMAGE_SEMANTIC = (
    "避免无关装饰图。"
)

# 放映页：视觉与交互规范（不含 API 输出 JSON 形状，便于按场景拼接）
DECK_CORE_VISUAL_SYSTEM = (
    """你是视觉优先的前端工程师：你在交付**全屏滚动着陆页**（full viewport、整屏 snap 滚动），用完整 HTML/CSS 实现。
输出：现代、克制但有层次的全屏分屏页面（N 个 section）。
核心交互（必须实现语义）
* 页面为“分屏滚动”（fullpage / snap scroll）
* 各 section 必须支持：
  * 鼠标滚轮切换
  * 右侧小圆点导航（dot navigation）
* 所有 section 需天然适配“整屏切换”（优先 CSS scroll-snap + 锚点；避免大段内联 JS）
文本规则（硬性）
* 禁止 emoji / 情绪符号
* 页面文本必须是“展示文案”，非口语/解说
* 字号下限（不可协商）：凡面向用户阅读的展示文字（标题、副标题、列表项、按钮/标签、高亮关键词、引用等），在 CSS 中须显式 font-size，且数值须 **严格大于 30px**（例如至少 38px）；禁止依赖默认 body 字号、禁止用 rem/em 间接导致折算后 ≤30px。代码块内等宽字体可略小，但代码块外的说明文字仍须 >30px。自检：在样式中搜索 font-size，任一展示文本若 ≤30px 即视为不合格输出。
表现力规则（必须）
用“视觉”替代情绪表达：
* 图标（SVG）
* 几何装饰（渐变 / 光晕 / 模糊）
* 动画（fade / slide / glow / float）
* 数据表达（对比 / 数字强化）
* 排版（大标题 / 关键词高亮）
每个 section：
* 视觉元素丰富，不要纯文字块
* 尽量填满屏幕，不要留白，并且视觉元素尽量居中，排布平衡
* 代码框和文字不要溢出父容器（宁可换行）
* 适当引入网页icon和图形元素
从 brief 提炼：
必须：
* 短标题（3~10字）
* 关键词 <span> 高亮
* 列表 / 模块化结构
禁止：
* 滚动提示词
* 页码
* emoji
* 情绪符号
* 小字号（含 ≤30px 的展示文字；见上文“字号下限”）
* 大段 <p>
* 口语句
* 冗长解释
subtitle：
* 视觉副标题（可优化）
pause：
* 仅作留白过渡（轻视觉，无文本堆积）
输入：
* main_title
* section_count（N）
* steps
输出：
* 恰好 N 个 section
* 每个 section：
  * data-key="section-0"...连续编号
  * 高度 100vh
  * 无滚动条
  * 居中或明确结构
必须严格遵循：
* 配色 / 背景 / 字体气质
* 组件质感 / 动画语言 / 装饰风格
* 展示文字字号：全局与逐元素样式均须满足 >30px（与上文一致，不可省略）
禁止整体风格偏离

"""
    + IMAGE_RULE
    + "\n"
    + IMAGE_SEMANTIC
)

# 多页一次生成：后端解析 pages_html
DECK_OUTPUT_SPEC_PAGES_HTML = """

====================
输出形态（硬性，违反则后端无法解析）
====================
* 只输出一个 JSON 对象；禁止 Markdown 代码围栏（含 ```json / ```html）与任何说明性前后缀文字。
* 顶层键必须是 pages_html（数组）；每项含 main_title、html 字符串。
* html 作为 JSON 字符串：内部 " 必须写成 \\"，\\ 写成 \\\\，换行写成 \\n；禁止在字符串未闭合前插入真实换行。
* 为降低转义错误：HTML 属性优先用单引号；<script> 内 JS 字符串优先单引号，避免在脚本里写裸双引号。
* 右侧圆点导航尽量用 CSS scroll-snap + <a href="#section-N"> 实现；若必须写 JS，保持脚本短小、少嵌套引号。
* 单页 html 建议 ≤4500 字符（硬上限 7000）；单 section：400~900 字符；精简 CSS，避免冗余。

形状严格如下（示意，输出时不要抄空字符串占位，应填真实内容）：
{{
  "pages_html": [
    {{ "main_title": "", "html": "" }}
  ]
}}"""

# 单页 AI 编辑草稿：顶层 main_title + html（与 pages_html 流程分离）
DECK_OUTPUT_SPEC_SINGLE_PAGE_EDIT = """

====================
输出形态（单页编辑，硬性，违反则后端无法解析）
====================
* 只输出一个 JSON 对象；禁止 markdown 围栏与说明文字。
* 顶层只能有两个字符串字段：main_title、html；禁止 pages_html 键，不要把 HTML 包进数组或嵌套对象。
* html 作为 JSON 字符串：内部 " 必须写成 \\"，\\ 写成 \\\\，换行写成 \\n；禁止在字符串未闭合前插入真实换行。
* HTML 属性优先单引号；<script> 内 JS 字符串优先单引号。
* 单页 html 建议 ≤4500 字符（硬上限 7000）；按用户 instruction 修改 current_page_json_text 中的页面，保持可渲染完整。"""

# 历史兼容：完整 deck 系统段 = 视觉 + 多页 JSON 形状（等同旧 DECK_CORE_SYSTEM + 原拼接顺序由 build_* 负责）
DECK_CORE_SYSTEM = DECK_CORE_VISUAL_SYSTEM + DECK_OUTPUT_SPEC_PAGES_HTML



_STYLE_BASE_TOP_KEYS = (
    "theme_name",
    "layout_system",
    "background_system",
    "color_palette",
    "typography",
    "component_style",
    "animation_style",
    "decorations",
)

_COLOR_PALETTE_KEYS = (
    "primary",
    "secondary",
    "accent",
    "background",
    "surface",
    "text_primary",
    "text_secondary",
    "border",
)

_DEFAULT_COLOR_PALETTE: dict[str, str] = {
    "primary": "#6306f1",
    "secondary": "#8b5cf6",
    "accent": "#22d3ee",
    "background": "#0b0b0f",
    "surface": "#16161f",
    "text_primary": "#f4f4f5",
    "text_secondary": "#a1a1aa",
    "border": "#27272a",
}

_LAYOUT_SYSTEM_KEYS = ("mode", "screen_rule", "content_arrangement")


def _style_base_coerce_top_level_background(sb: dict[str, Any]) -> None:
    """模型常把背景写成顶层 background；规范要求 background_system 对象。"""
    stray = sb.pop("background", None)
    if "background_system" not in sb:
        if isinstance(stray, dict):
            sb["background_system"] = stray
        elif isinstance(stray, str) and stray.strip():
            sb["background_system"] = {
                "base_style": stray.strip(),
                "effect": "",
                "consistency_rule": "",
            }


def _normalize_layout_system_obj(ls: Any) -> dict[str, str]:
    if isinstance(ls, str) and ls.strip():
        ls = {
            "mode": "",
            "screen_rule": ls.strip(),
            "content_arrangement": "",
        }
    if not isinstance(ls, dict):
        ls = {}
    out: dict[str, str] = {}
    for k in _LAYOUT_SYSTEM_KEYS:
        out[k] = _style_base_nonempty_str(ls.get(k), "") or ""
    return out


def _normalize_background_system_obj(bs: Any) -> dict[str, str]:
    if isinstance(bs, str) and bs.strip():
        bs = {
            "base_style": bs.strip(),
            "effect": "",
            "consistency_rule": "",
        }
    if not isinstance(bs, dict):
        bs = {}
    base = _style_base_nonempty_str(bs.get("base_style"), "")
    if not base:
        base = (
            _style_base_nonempty_str(bs.get("background"), "")
            or _style_base_nonempty_str(bs.get("type"), "")
        )
    return {
        "base_style": base or "",
        "effect": _style_base_nonempty_str(bs.get("effect"), "") or "",
        "consistency_rule": _style_base_nonempty_str(bs.get("consistency_rule"), "")
        or "",
    }


def _style_base_nonempty_str(v: Any, default: str = "") -> str:
    if isinstance(v, str) and v.strip():
        return v.strip()
    if v is not None and not isinstance(v, (dict, list)):
        t = str(v).strip()
        if t:
            return t
    return default


def validate_style_base_obj(sb: Any) -> dict[str, Any]:
    """历史 JSON 母版形状校验；新流程已改用纯文本 style_prompt_text。"""
    if not isinstance(sb, dict):
        raise RuntimeError("style_base 必须是 JSON 对象")
    _style_base_coerce_top_level_background(sb)
    for k in _STYLE_BASE_TOP_KEYS:
        if k not in sb:
            raise RuntimeError(f"style_base 缺少字段 {k!r}")

    tn = _style_base_nonempty_str(sb.get("theme_name"), "未命名主题")
    sb["theme_name"] = tn or "未命名主题"

    sb["layout_system"] = _normalize_layout_system_obj(sb.get("layout_system"))
    sb["background_system"] = _normalize_background_system_obj(
        sb.get("background_system")
    )

    cp = sb["color_palette"]
    if isinstance(cp, list):
        strs = [str(x).strip() for x in cp if isinstance(x, str) and str(x).strip()]
        if not strs:
            raise RuntimeError(
                "style_base.color_palette 须为含八色键的对象；旧式数组须为非空字符串列表"
            )
        sb["color_palette"] = {
            key: strs[i % len(strs)] for i, key in enumerate(_COLOR_PALETTE_KEYS)
        }
        cp = sb["color_palette"]

    if not isinstance(cp, dict):
        raise RuntimeError(
            "style_base.color_palette 必须为对象，且含 primary、background 等色键"
        )

    fixed_palette: dict[str, str] = {}
    for ck in _COLOR_PALETTE_KEYS:
        raw = cp.get(ck)
        val = _style_base_nonempty_str(raw, "")
        if not val:
            val = _DEFAULT_COLOR_PALETTE[ck]
        fixed_palette[ck] = val
    sb["color_palette"] = fixed_palette

    for sub_key, label in (
        ("typography", "style_base.typography"),
        ("component_style", "style_base.component_style"),
        ("animation_style", "style_base.animation_style"),
    ):
        sub = sb[sub_key]
        if not isinstance(sub, dict):
            raise RuntimeError(f"{label} 必须为对象")

    dec = sb["decorations"]
    if not isinstance(dec, str):
        sb["decorations"] = _style_base_nonempty_str(dec, "（无）") or "（无）"
    if "style_summary" not in sb:
        sb["style_summary"] = ""
    elif not isinstance(sb["style_summary"], str):
        sb["style_summary"] = str(sb["style_summary"] or "")

    return sb


DeckGenerationOutputSpec = Literal["pages_html", "none"]


def build_deck_system_for_generation(
    *,
    style_prompt_text: str,
    page_size: str | None,
    output_spec: DeckGenerationOutputSpec = "pages_html",
) -> str:
    """拼接放映页 system：视觉规范 + 可选 JSON 输出形状 + 画布 + 项目风格。

    output_spec:
    - pages_html：多页一次生成，要求模型输出顶层 pages_html 数组（供 generate_deck_pages_html）。
    - none：仅视觉/画布/风格，由调用方再拼 DECK_OUTPUT_SPEC_SINGLE_PAGE_EDIT 等专用输出规范。
    """
    canvas = format_deck_canvas_block_for_generation(page_size)
    body = (style_prompt_text or "").strip()
    core = DECK_CORE_VISUAL_SYSTEM
    if output_spec == "pages_html":
        core += DECK_OUTPUT_SPEC_PAGES_HTML
    return (
        core
        + "\n\n====================\n【页面画布与比例】（必须严格遵守）\n====================\n"
        + canvas
        + "\n\n====================\n【统一视觉风格】\n====================\n"
        + (
            body
            if body
            else "（无额外风格说明，按上文视觉与交互规范中的默认高端展示风即可）"
        )
        + "\n"
    )


def _parse_style_prompt_plain_text(content: str) -> str:
    t = _strip_markdown_json_fence(content or "").strip()
    if not t:
        raise RuntimeError("风格母版返回空内容")
    if t.startswith("{") and '"style_prompt_text"' in t:
        try:
            data = json.loads(t)
            if isinstance(data, dict):
                inner = data.get("style_prompt_text")
                if isinstance(inner, str) and inner.strip():
                    return inner.strip()
        except json.JSONDecodeError:
            pass
    if len(t) > 6000:
        t = t[:6000].rstrip() + "…"
    return t


async def generate_style_prompt_text(
    *,
    preset_id: str,
    user_hint: str | None,
    project_title: str | None = None,
) -> str:
    """调用 DeepSeek 一次，返回纯文本风格母版（不含屏幕比例）。"""
    if not settings.deepseek_api_key:
        raise RuntimeError("未配置 DEEPSEEK_API_KEY")

    meta = resolve_deck_style_preset(preset_id)
    hint = (user_hint or "").strip()
    title = (project_title or "").strip()
    style_name = (meta.get("style_name") or "").strip() or "（无）"
    style_detail = (meta.get("detail_for_prompt") or "").strip() or "（无）"
    system = (
        STYLE_PROMPT_MASTER_SYSTEM.replace(
            "{project_title}", title if title else "（无）"
        )
        .replace("{style_name}", style_name)
        .replace("{style_detail}", style_detail)
        .replace("{user_hint}", hint if hint else "（无）")
    )
    client = AsyncOpenAI(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
    )
    try:
        completion = await _await_with_timeout(
            client.chat.completions.create(
                model=settings.deepseek_model,
                messages=[
                    {"role": "system", "content": system},
                    {
                        "role": "user",
                        "content": "请按 system 要求只输出一段纯文本风格说明，不要其它内容。",
                    },
                ],
                temperature=0.55,
            ),
            timeout_seconds=settings.deepseek_style_timeout_seconds,
            scene="DeepSeek 风格母版生成",
        )
    except AuthenticationError as e:
        raise RuntimeError(
            "DeepSeek 鉴权失败：DEEPSEEK_API_KEY 无效或已过期。"
        ) from e
    except RateLimitError as e:
        raise RuntimeError("DeepSeek 触发限流，请稍后重试。") from e
    except BadRequestError as e:
        raise RuntimeError(f"DeepSeek 请求参数错误：{e}") from e
    except APIConnectionError as e:
        raise RuntimeError("无法连接 DeepSeek，请检查网络或 base_url。") from e
    except APIStatusError as e:
        raise RuntimeError(f"DeepSeek 服务异常：HTTP {e.status_code}") from e
    raw = completion.choices[0].message.content
    return _parse_style_prompt_plain_text(raw or "")


async def generate_deck_pages_html(
    *,
    user_payload_json: str,
    style_prompt_text: str,
    page_size: str | None = None,
    fim_dump: tuple[Path, str] | None = None,
) -> dict:
    """调用 DeepSeek，仅返回 pages_html；比例来自 page_size，风格来自 style_prompt_text。"""
    if not settings.deepseek_api_key:
        raise RuntimeError("未配置 DEEPSEEK_API_KEY")

    system = build_deck_system_for_generation(
        style_prompt_text=style_prompt_text,
        page_size=page_size,
        output_spec="pages_html",
    )
    client = AsyncOpenAI(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
    )
    deck_max = int(settings.deepseek_deck_max_tokens or 0)
    create_kwargs: dict[str, Any] = {
        "model": settings.deepseek_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_payload_json},
        ],
        "temperature": 0.65,
    }
    if deck_max > 0:
        create_kwargs["max_tokens"] = deck_max
    try:
        completion = await _await_with_timeout(
            client.chat.completions.create(**create_kwargs),
            timeout_seconds=settings.deepseek_deck_timeout_seconds,
            scene="DeepSeek 演示页生成",
        )
    except AuthenticationError as e:
        raise RuntimeError(
            "DeepSeek 鉴权失败：DEEPSEEK_API_KEY 无效或已过期。"
        ) from e
    except RateLimitError as e:
        raise RuntimeError("DeepSeek 触发限流，请稍后重试。") from e
    except BadRequestError as e:
        raise RuntimeError(f"DeepSeek 请求参数错误：{e}") from e
    except APIConnectionError as e:
        raise RuntimeError("无法连接 DeepSeek，请检查网络或 base_url。") from e
    except APIStatusError as e:
        raise RuntimeError(f"DeepSeek 服务异常：HTTP {e.status_code}") from e
    content = completion.choices[0].message.content
    if not content:
        raise RuntimeError("DeepSeek 返回空内容")

    try:
        return await _coerce_pages_html_dict(
            content,
            client=client,
            scene="放映页 HTML 生成（pages_html）",
        )
    except RuntimeError as first_err:
        # 兜底：从非严格 JSON 中尝试抽取 pages_html
        try:
            return _extract_pages_html_fallback(content)
        except RuntimeError:
            pass
        if not fim_dump:
            raise
        dump_dir, stem = fim_dump
        dump_dir.mkdir(parents=True, exist_ok=True)
        round1_path = dump_dir / f"{stem}_round1_chat.txt"
        round1_path.write_text(content, encoding="utf-8")
        if not settings.deepseek_fim_enabled or not settings.deepseek_beta_base_url.strip():
            raise RuntimeError(
                f"{first_err}；已保存原文：{round1_path}（FIM 已关闭或未配置 beta 网关）"
            ) from first_err
        prefix = _fim_prefix_from_model_output(content)
        if prefix is None:
            raise RuntimeError(
                f"{first_err}；无法进行 FIM（未找到 JSON 起始）。原文已保存：{round1_path}"
            ) from first_err
        suffix = '"}]}'
        try:
            middle = await deepseek_fim_fill(prefix=prefix, suffix=suffix)
        except Exception as fim_exc:
            raise RuntimeError(
                f"{first_err}；FIM 调用失败：{fim_exc}。原文已保存：{round1_path}"
            ) from fim_exc
        merged = prefix + middle + suffix
        merged_path = dump_dir / f"{stem}_round2_fim_merged.txt"
        merged_path.write_text(merged, encoding="utf-8")
        try:
            return await _coerce_pages_html_dict(
                merged,
                client=client,
                scene="放映页 HTML 生成（FIM 合并后）",
            )
        except RuntimeError as second_err:
            try:
                return _extract_pages_html_fallback(merged)
            except RuntimeError:
                pass
            raise RuntimeError(
                f"{first_err}；FIM 合并后仍无法解析：{second_err}。"
                f"已保存：{round1_path.name}、{merged_path.name}"
            ) from second_err


async def generate_contextual_page_draft(
    *,
    current_json_text: str,
    instruction: str,
    style_prompt_text: str,
    page_size: str | None = None,
) -> dict[str, Any]:
    """基于当前页 JSON 与用户要求，返回单页草稿 JSON（不落库）。"""
    if not settings.deepseek_api_key:
        raise RuntimeError("未配置 DEEPSEEK_API_KEY")
    system = (
        build_deck_system_for_generation(
            style_prompt_text=style_prompt_text,
            page_size=page_size,
            output_spec="none",
        )
        + DECK_OUTPUT_SPEC_SINGLE_PAGE_EDIT
        + "\n\n任务：单页定向编辑。读取 user JSON 中的 instruction 与 current_page_json_text（含当前 html），"
        + "按要求修改后只输出更新后的 JSON（main_title、html），不要其它说明。"
    )
    user_payload = json.dumps(
        {
            "task": "edit_single_page",
            "instruction": instruction.strip(),
            "current_page_json_text": current_json_text.strip(),
        },
        ensure_ascii=False,
    )
    client = AsyncOpenAI(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
    )
    try:
        completion = await _await_with_timeout(
            client.chat.completions.create(
                model=settings.deepseek_model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_payload},
                ],
                temperature=0.5,
            ),
            timeout_seconds=settings.deepseek_request_timeout_seconds,
            scene="DeepSeek 单页草稿",
        )
    except AuthenticationError as e:
        raise RuntimeError("DeepSeek 鉴权失败：DEEPSEEK_API_KEY 无效或已过期。") from e
    except RateLimitError as e:
        raise RuntimeError("DeepSeek 触发限流，请稍后重试。") from e
    except BadRequestError as e:
        raise RuntimeError(f"DeepSeek 请求参数错误：{e}") from e
    except APIConnectionError as e:
        raise RuntimeError("无法连接 DeepSeek，请检查网络或 base_url。") from e
    except APIStatusError as e:
        raise RuntimeError(f"DeepSeek 服务异常：HTTP {e.status_code}") from e
    content = completion.choices[0].message.content
    if not content:
        raise RuntimeError("DeepSeek 返回空内容")
    data = await _extract_json_object_with_repair(
        content=content,
        client=client,
        scene="上下文单页草稿生成",
    )
    # 兼容模型仍按整册规则输出 pages_html（仅一项）的情况
    if not str(data.get("html", "")).strip():
        ph = data.get("pages_html")
        if isinstance(ph, list) and ph:
            first = ph[0]
            if isinstance(first, dict) and str(first.get("html", "")).strip():
                data = {
                    "main_title": first.get("main_title", data.get("main_title", "")),
                    "html": first.get("html", ""),
                }
    main_title = str(data.get("main_title", "")).strip()
    html = str(data.get("html", "")).strip()
    if not html:
        raise RuntimeError("AI 草稿缺少 html")
    return {"main_title": main_title, "html": html}