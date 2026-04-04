"""项目表 `description` 上的轻量标记（避免为单一字段做迁移）。"""

import json

DECK_MASTER_SRC_MARKER = "__sf_deck_src:"
PROJECT_META_MARKER = "__sfmeta:"

DEFAULT_INTRO_STYLE_ID = 1


def _normalize_positive_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, str):
        t = value.strip()
        if t.isdigit():
            n = int(t)
            return n if n > 0 else None
    return None


def _parse_project_meta_description(desc: str | None) -> dict[str, object]:
    if not desc:
        return {}
    t = desc.strip()
    if not t:
        return {}
    if t.startswith(PROJECT_META_MARKER):
        tail = t[len(PROJECT_META_MARKER) :].strip()
        if not tail:
            return {}
        try:
            data = json.loads(tail)
        except json.JSONDecodeError:
            return {}
        return data if isinstance(data, dict) else {}
    if t.startswith(DECK_MASTER_SRC_MARKER):
        tail = t[len(DECK_MASTER_SRC_MARKER) :].strip()
        if tail.isdigit():
            return {"deck_master_source_project_id": int(tail)}
    return {}


def deck_master_source_project_id_from_description(desc: str | None) -> int | None:
    """若 description 带项目元数据，返回复用母版的源项目 id。"""
    meta = _parse_project_meta_description(desc)
    return _normalize_positive_int(meta.get("deck_master_source_project_id"))


def include_intro_from_description(desc: str | None) -> bool:
    meta = _parse_project_meta_description(desc)
    return bool(meta.get("include_intro"))


def include_outro_from_description(desc: str | None) -> bool:
    meta = _parse_project_meta_description(desc)
    return bool(meta.get("include_outro"))


def intro_style_id_from_description(desc: str | None) -> int:
    """片头样式 id，来自 __sfmeta；缺省为 1（与前端 INTRO_STYLES 对齐）。"""
    meta = _parse_project_meta_description(desc)
    raw = meta.get("intro_style_id")
    if isinstance(raw, bool):
        return DEFAULT_INTRO_STYLE_ID
    if isinstance(raw, int) and not isinstance(raw, bool) and raw >= 1:
        return raw
    if isinstance(raw, str) and raw.strip().isdigit():
        n = int(raw.strip())
        return n if n >= 1 else DEFAULT_INTRO_STYLE_ID
    return DEFAULT_INTRO_STYLE_ID


def format_project_meta_description(
    *,
    deck_master_source_project_id: int | None = None,
    include_intro: bool = False,
    include_outro: bool = False,
    intro_style_id: int | None = None,
) -> str | None:
    meta: dict[str, object] = {}
    src = _normalize_positive_int(deck_master_source_project_id)
    if src is not None:
        meta["deck_master_source_project_id"] = src
    if include_intro:
        meta["include_intro"] = True
        sid = _normalize_positive_int(intro_style_id)
        meta["intro_style_id"] = (
            int(sid) if sid is not None else DEFAULT_INTRO_STYLE_ID
        )
    if include_outro:
        meta["include_outro"] = True
    if not meta:
        return None
    return f"{PROJECT_META_MARKER}{json.dumps(meta, ensure_ascii=True, separators=(',', ':'))}"


def format_deck_master_source_description(src_project_id: int) -> str:
    return (
        format_project_meta_description(deck_master_source_project_id=src_project_id)
        or f"{DECK_MASTER_SRC_MARKER}{int(src_project_id)}"
    )


def merge_deck_master_source_id(desc: str | None, src_id: int | None) -> str | None:
    """更新 description 中的 deck_master_source_project_id，保留其它 __sfmeta 字段。自由文本 description 不修改。"""
    raw = desc
    t = (raw or "").strip()
    if not t:
        if src_id is None:
            return raw
        return format_project_meta_description(deck_master_source_project_id=int(src_id))
    if not (t.startswith(PROJECT_META_MARKER) or t.startswith(DECK_MASTER_SRC_MARKER)):
        return raw
    meta = _parse_project_meta_description(desc)
    if src_id is None:
        meta.pop("deck_master_source_project_id", None)
    else:
        meta["deck_master_source_project_id"] = int(src_id)
    inc_intro = bool(meta.get("include_intro"))
    inc_outro = bool(meta.get("include_outro"))
    sid: int | None = None
    if inc_intro:
        raw_intro = meta.get("intro_style_id")
        if isinstance(raw_intro, int) and not isinstance(raw_intro, bool) and raw_intro >= 1:
            sid = raw_intro
        elif isinstance(raw_intro, str) and raw_intro.strip().isdigit():
            n = int(raw_intro.strip())
            sid = n if n >= 1 else None
    return format_project_meta_description(
        deck_master_source_project_id=_normalize_positive_int(
            meta.get("deck_master_source_project_id")
        ),
        include_intro=inc_intro,
        include_outro=inc_outro,
        intro_style_id=sid,
    )


def clear_deck_master_source_description_if_marker(desc: str | None) -> str | None:
    """克隆等项目复制时去掉母版源标记，避免列表误显示「引用他人母版」。"""
    if not desc:
        return desc
    t = desc.strip()
    if not t:
        return None
    if t.startswith(DECK_MASTER_SRC_MARKER):
        return None
    if not t.startswith(PROJECT_META_MARKER):
        return desc
    return format_project_meta_description(
        include_intro=include_intro_from_description(t),
        include_outro=include_outro_from_description(t),
        intro_style_id=(
            intro_style_id_from_description(t)
            if include_intro_from_description(t)
            else None
        ),
    )
