"""大纲树（outline_nodes）与内容（node_contents）；播放用 JSON 在 API 层动态拼装。"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy.orm import aliased
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db.models import (
    KIND_PAGE,
    KIND_PAUSE,
    KIND_STEP,
    NodeContent,
    OutlineNode,
    Project,
)
from app.mediautil import audio_duration_ms, resolve_slide_audio_path, resolve_slide_audio_url

# pause 节点未配置时长时，与前端默认空拍一致（毫秒）
DEFAULT_PAUSE_DURATION_MS = 500


def parse_stored_json_object(raw: str | None) -> Any | None:
    """将 DB 中的 JSON 文本解析为对象；失败或空则返回 None。"""
    if raw is None or not str(raw).strip():
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


@dataclass(frozen=True)
class PlaylistRow:
    """仅含可 TTS 的 step（有 NodeContent），用于详情列表 / 兼容字段 slides。"""

    step_index: int
    node_id: int
    audio_sequence: int
    page_title: str
    title: str
    narration_text: str
    narration_alignment_json: str | None
    duration_ms: int | None
    audio_asset_id: int | None
    image_asset_id: int | None
    background_asset_id: int | None
    created_at: Any
    updated_at: Any


@dataclass(frozen=True)
class DeckTimelineRow:
    """整轨时间轴一行（含 pause），与放映 manifest 的 timeline_index 一致。"""

    timeline_index: int
    node_id: int
    page_title: str
    kind: str
    title: str
    script_excerpt: str


async def _load_nodes_and_contents(
    session: AsyncSession, project_id: int
) -> tuple[list[OutlineNode], dict[int | None, list[OutlineNode]], dict[int, NodeContent]]:
    res = await session.exec(
        select(OutlineNode).where(OutlineNode.project_id == project_id)
    )
    nodes = list(res.all())
    ids = [n.id for n in nodes if n.id is not None]
    contents: list[NodeContent] = []
    if ids:
        res_c = await session.exec(
            select(NodeContent).where(NodeContent.node_id.in_(ids))
        )
        contents = list(res_c.all())
    content_by_node = {c.node_id: c for c in contents}
    children_by_parent: dict[int | None, list[OutlineNode]] = {}
    for n in nodes:
        children_by_parent.setdefault(n.parent_id, []).append(n)
    return nodes, children_by_parent, content_by_node


async def load_playlist_rows(
    session: AsyncSession, project_id: int
) -> list[PlaylistRow]:
    """有口播的 step，按 audio_sequence；父节点须为 page。"""
    parent = aliased(OutlineNode)
    stmt = (
        select(OutlineNode, NodeContent, parent)
        .join(NodeContent, NodeContent.node_id == OutlineNode.id)
        .join(parent, OutlineNode.parent_id == parent.id)
        .where(OutlineNode.project_id == project_id)
        .where(OutlineNode.node_kind == KIND_STEP)
        .where(parent.node_kind == KIND_PAGE)
        .order_by(NodeContent.audio_sequence)
    )
    res = await session.exec(stmt)
    rows = res.all()
    out: list[PlaylistRow] = []
    for i, (node, content, par) in enumerate(rows):
        out.append(
            PlaylistRow(
                step_index=i,
                node_id=node.id,
                audio_sequence=content.audio_sequence,
                page_title=(par.title or "").strip() or "（未命名页）",
                title=(node.title or "").strip() or "（无小标题）",
                narration_text=content.narration_text or "",
                narration_alignment_json=content.narration_alignment_json,
                duration_ms=content.duration_ms,
                audio_asset_id=content.audio_asset_id,
                image_asset_id=content.image_asset_id,
                background_asset_id=content.background_asset_id,
                created_at=node.created_at,
                updated_at=node.updated_at,
            )
        )
    return out


async def load_deck_timeline(
    session: AsyncSession, project_id: int
) -> list[DeckTimelineRow]:
    """
    按 page 顺序 + 每页下 step/pause 的 sort_order，生成全局 timeline_index。
    """
    _, children_by_parent, content_by_node = await _load_nodes_and_contents(
        session, project_id
    )
    roots = sorted(
        children_by_parent.get(None, []),
        key=lambda n: n.sort_order,
    )
    pages = [r for r in roots if r.node_kind == KIND_PAGE]
    out: list[DeckTimelineRow] = []
    ti = 0
    for page in pages:
        ptitle = (page.title or "").strip() or "（未命名页）"
        kids = sorted(
            children_by_parent.get(page.id, []),
            key=lambda n: n.sort_order,
        )
        for ch in kids:
            if ch.node_kind == KIND_STEP:
                nc = content_by_node.get(ch.id)
                excerpt = ((nc.narration_brief or nc.narration_text) if nc else "") or ""
                out.append(
                    DeckTimelineRow(
                        timeline_index=ti,
                        node_id=ch.id,
                        page_title=ptitle,
                        kind=KIND_STEP,
                        title=(ch.title or "").strip() or "（无小标题）",
                        script_excerpt=excerpt,
                    )
                )
                ti += 1
            elif ch.node_kind == KIND_PAUSE:
                out.append(
                    DeckTimelineRow(
                        timeline_index=ti,
                        node_id=ch.id,
                        page_title=ptitle,
                        kind=KIND_PAUSE,
                        title=(ch.title or "").strip(),
                        script_excerpt="",
                    )
                )
                ti += 1
    return out


async def build_play_manifest(
    session: AsyncSession,
    project_id: int,
    project_title: str,
    storage_root: Path,
) -> dict[str, Any]:
    """运行时拼装播放脚本：每步含 section_index（页内板块下标），HTML 页由前端按索引切换 section-*。"""
    project = await session.get(Project, project_id)
    from app.services.deck import resolve_project_page_size

    deck_page_size = resolve_project_page_size(project)

    _, children_by_parent, content_by_node = await _load_nodes_and_contents(
        session, project_id
    )
    roots = sorted(
        children_by_parent.get(None, []),
        key=lambda n: n.sort_order,
    )
    pages_nodes = [r for r in roots if r.node_kind == KIND_PAGE]

    timeline_index = 0
    start_ms = 0
    pages_out: list[dict[str, Any]] = []

    for page in pages_nodes:
        page_nc = content_by_node.get(page.id) if page.id is not None else None
        page_html = (page_nc.page_code or "").strip() if page_nc else ""
        steps_out: list[dict[str, Any]] = []
        kids = sorted(
            children_by_parent.get(page.id, []),
            key=lambda n: n.sort_order,
        )
        section_index = 0
        for ch in kids:
            if ch.node_kind == KIND_STEP:
                nc = content_by_node.get(ch.id)
                dur = int(nc.duration_ms or 0) if nc else 0
                audio_seq = nc.audio_sequence if nc else 0
                audio_url = (
                    resolve_slide_audio_url(project_id, audio_seq, storage_root)
                    if nc
                    else ""
                )
                path = (
                    resolve_slide_audio_path(project_id, audio_seq, storage_root)
                    if nc and audio_seq
                    else None
                )
                if path is not None:
                    try:
                        disk_ms = audio_duration_ms(path)
                        if disk_ms > 0:
                            dur = disk_ms
                    except RuntimeError:
                        pass
                narration = (nc.narration_text or "") if nc else ""
                brief = ((nc.narration_brief or "").strip() if nc else "") or None
                align_raw = (
                    (nc.narration_alignment_json or "").strip() if nc else ""
                )
                stitle = (ch.title or "").strip() or "（无小标题）"
                steps_out.append(
                    {
                        "step_id": ch.id,
                        "timeline_index": timeline_index,
                        "section_index": section_index,
                        "kind": KIND_STEP,
                        "title": stitle,
                        "narration_text": narration,
                        "narration_brief": brief,
                        "narration_alignment": parse_stored_json_object(
                            align_raw or None
                        ),
                        "audio_url": audio_url,
                        "duration_ms": dur,
                        "start_ms": start_ms,
                    }
                )
                section_index += 1
                start_ms += dur
                timeline_index += 1

            elif ch.node_kind == KIND_PAUSE:
                pause_dur = DEFAULT_PAUSE_DURATION_MS
                steps_out.append(
                    {
                        "step_id": ch.id,
                        "timeline_index": timeline_index,
                        "section_index": section_index,
                        "kind": KIND_PAUSE,
                        "title": (ch.title or "").strip(),
                        "narration_text": "",
                        "audio_url": "",
                        "duration_ms": pause_dur,
                        "start_ms": start_ms,
                    }
                )
                section_index += 1
                start_ms += pause_dur
                timeline_index += 1

        pds = (
            (page_nc.page_deck_status or "").strip().lower()
            if page_nc
            else ""
        )
        if not page_nc:
            deck_state = "idle"
        elif pds == "generating":
            deck_state = "generating"
        elif pds == "failed":
            deck_state = "failed"
        elif pds == "ready" and page_html:
            deck_state = "ready"
        elif page_html:
            deck_state = "ready"
        else:
            deck_state = "idle"

        pages_out.append(
            {
                "page_id": page.id,
                "title": (page.title or "").strip() or "（未命名页）",
                "html": page_html,
                "page_deck_status": deck_state,
                "page_deck_error": (
                    (page_nc.page_deck_error or "").strip()[:2000]
                    if page_nc and page_nc.page_deck_error
                    else None
                ),
                "steps": steps_out,
            }
        )

    return {
        "project_id": project_id,
        "title": project_title,
        "deck_page_size": deck_page_size,
        "pages": pages_out,
    }


def _node_to_api_dict(
    node: OutlineNode,
    children_by_parent: dict[int | None, list[OutlineNode]],
    content_by_node: dict[int, NodeContent],
) -> dict[str, Any]:
    raw_children = children_by_parent.get(node.id, [])
    children = [
        _node_to_api_dict(ch, children_by_parent, content_by_node)
        for ch in sorted(raw_children, key=lambda n: n.sort_order)
    ]
    nc = (
        content_by_node.get(node.id)
        if node.node_kind in (KIND_PAGE, KIND_STEP)
        else None
    )
    content_payload = None
    if nc is not None:
        if node.node_kind == KIND_PAGE:
            content_payload = {
                "page_code": nc.page_code,
                "page_deck_status": nc.page_deck_status,
                "page_deck_error": nc.page_deck_error,
                "created_at": nc.created_at.isoformat(),
                "updated_at": nc.updated_at.isoformat(),
            }
        else:
            content_payload = {
                "narration_text": nc.narration_text,
                "narration_brief": nc.narration_brief,
                "duration_ms": nc.duration_ms,
                "narration_alignment": parse_stored_json_object(
                    nc.narration_alignment_json
                ),
                "audio_sequence": nc.audio_sequence,
                "audio_asset_id": nc.audio_asset_id,
                "image_asset_id": nc.image_asset_id,
                "background_asset_id": nc.background_asset_id,
                "created_at": nc.created_at.isoformat(),
                "updated_at": nc.updated_at.isoformat(),
            }
    return {
        "id": node.id,
        "parent_id": node.parent_id,
        "sort_order": node.sort_order,
        "title": node.title,
        "node_kind": node.node_kind,
        "subtree_has_content": node.subtree_has_content,
        "created_at": node.created_at.isoformat(),
        "updated_at": node.updated_at.isoformat(),
        "content": content_payload,
        "children": children,
    }


async def load_outline_tree(session: AsyncSession, project_id: int) -> list[dict[str, Any]]:
    _, children_by_parent, content_by_node = await _load_nodes_and_contents(
        session, project_id
    )
    roots = sorted(
        children_by_parent.get(None, []),
        key=lambda n: n.sort_order,
    )
    return [_node_to_api_dict(r, children_by_parent, content_by_node) for r in roots]
