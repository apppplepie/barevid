"""项目表 `description` 上的轻量标记（避免为单一字段做迁移）。"""

DECK_MASTER_SRC_MARKER = "__sf_deck_src:"


def deck_master_source_project_id_from_description(desc: str | None) -> int | None:
    """若 description 为「复用母版」占位，返回源项目 id。"""
    if not desc:
        return None
    t = desc.strip()
    if not t.startswith(DECK_MASTER_SRC_MARKER):
        return None
    tail = t[len(DECK_MASTER_SRC_MARKER) :].strip()
    if tail.isdigit():
        return int(tail)
    return None


def format_deck_master_source_description(src_project_id: int) -> str:
    return f"{DECK_MASTER_SRC_MARKER}{int(src_project_id)}"


def clear_deck_master_source_description_if_marker(desc: str | None) -> str | None:
    """克隆等项目复制时去掉母版源标记，避免列表误显示「引用他人母版」。"""
    if deck_master_source_project_id_from_description(desc) is not None:
        return None
    return desc
