import asyncio
import json
import textwrap
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import or_, update
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import settings
from app.db.engine import async_session_maker
from app.db.models import (
    KIND_PAGE,
    NodeContent,
    OutlineNode,
    Project,
    ProjectStyle,
    WorkflowRun,
    WorkflowStepRun,
    utc_now,
)
from app.integrations.deepseek import (
    DEFAULT_DECK_STYLE_PRESET,
    generate_deck_pages_html,
    generate_style_prompt_text,
)
from app.services.outline import (
    DeckTimelineRow,
    _load_nodes_and_contents,
    load_deck_timeline,
)
from app.services import workflow_engine as wf_engine
from app.services.workflow_state import (
    STEP_FAILED,
    STEP_RUNNING,
    STEP_SUCCEEDED,
    reset_export_only,
)

_style_base_locks: dict[int, asyncio.Lock] = {}
_DECK_PAGE_SEMAPHORE = asyncio.Semaphore(settings.deck_page_concurrency_limit)


async def _project_status_after_user_cancelled_deck(
    session: AsyncSession, project: Project
) -> None:
    """用户取消场景生成后：文本+配音已成功则保持可操作 ready，否则 draft（不标整项目 failed）。"""
    if project.id is None:
        project.status = "draft"
        return
    run = (
        await session.exec(
            select(WorkflowRun).where(WorkflowRun.project_id == int(project.id))
        )
    ).first()
    if run is None or run.id is None:
        project.status = "draft"
        return
    res = await session.exec(
        select(WorkflowStepRun).where(
            WorkflowStepRun.workflow_run_id == int(run.id)
        )
    )
    sm = {r.step_key: r for r in res.all()}
    tr = sm.get(wf_engine.STEP_TEXT)
    ar = sm.get(wf_engine.STEP_AUDIO)
    if (
        tr is not None
        and tr.status == wf_engine.STEP_SUCCEEDED
        and ar is not None
        and ar.status == wf_engine.STEP_SUCCEEDED
    ):
        project.status = "ready"
    else:
        project.status = "draft"
_PAGE_SIZE_META: dict[str, dict[str, str]] = {
    "16:9": {"label": "16:9 横屏（1920x1080）", "width": "1920", "height": "1080"},
    "4:3": {"label": "4:3 横屏（1024x768）", "width": "1024", "height": "768"},
    "9:16": {"label": "9:16 竖屏（1080x1920）", "width": "1080", "height": "1920"},
    "1:1": {"label": "1:1 方形（1080x1080）", "width": "1080", "height": "1080"},
}


def _style_lock(project_id: int) -> asyncio.Lock:
    if project_id not in _style_base_locks:
        _style_base_locks[project_id] = asyncio.Lock()
    return _style_base_locks[project_id]


def _norm_deck_hint(h: str | None) -> str:
    return (h or "").strip()


def _clip_deck_err(message: object, max_len: int = 1800) -> str:
    """入库/接口展示用：避免异常串把库撑爆或刷屏。"""
    t = str(message).strip() or "未知错误"
    if len(t) <= max_len:
        return t
    return t[: max_len - 3].rstrip() + "..."


def _resolve_page_size(page_size: str | None) -> dict[str, str]:
    key = (page_size or "").strip()
    return _PAGE_SIZE_META.get(key) or _PAGE_SIZE_META["16:9"]


def resolve_project_page_size(project: Project | None) -> str:
    key = ((project.aspect_ratio or "").strip() if project else "") or "16:9"
    return key if key in _PAGE_SIZE_META else "16:9"


def _as_utc_aware(dt: datetime) -> datetime:
    """兼容 SQLite 历史数据中的 naive datetime。"""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _style_storage_blob(row: ProjectStyle | None) -> str | None:
    if row is None:
        return None
    s = (row.style_data_json or "").strip()
    if s:
        return s
    s = (row.style_base_json or "").strip()
    return s or None


def _style_prompt_from_base(style_base: dict[str, Any]) -> str:
    ss = style_base.get("style_summary")
    if isinstance(ss, str) and ss.strip():
        return ss.strip()
    tn = style_base.get("theme_name")
    if isinstance(tn, str) and tn.strip():
        return tn.strip()
    return ""


def _project_style_keys(
    project: Project, style_row: ProjectStyle | None
) -> tuple[str, str, str]:
    if style_row is not None:
        preset = (style_row.style_preset or DEFAULT_DECK_STYLE_PRESET).strip() or DEFAULT_DECK_STYLE_PRESET
        hint = _norm_deck_hint(style_row.user_style_hint)
    else:
        preset = DEFAULT_DECK_STYLE_PRESET
        hint = ""
    page_key = resolve_project_page_size(project)
    return preset, hint, page_key


async def get_project_style(
    session: AsyncSession, project: Project | int
) -> ProjectStyle | None:
    proj = project if isinstance(project, Project) else await session.get(Project, project)
    if proj is None:
        return None
    if proj.style_id is not None:
        row = await session.get(ProjectStyle, int(proj.style_id))
        if row is not None:
            return row
    if proj.id is None:
        return None
    res = await session.exec(
        select(ProjectStyle).where(ProjectStyle.origin_project_id == int(proj.id))
    )
    row = res.first()
    if row is not None and row.id is not None:
        proj.style_id = int(row.id)
        proj.updated_at = utc_now()
        session.add(proj)
        await session.commit()
        await session.refresh(proj)
    return row


async def get_or_create_project_style(
    session: AsyncSession, project_id: int, *, for_update: bool = False
) -> ProjectStyle:
    project = await session.get(Project, project_id)
    if project is None:
        raise RuntimeError("项目不存在")
    row = await get_project_style(session, project)
    if row is not None and (not for_update or int(row.origin_project_id or 0) == int(project_id)):
        return row

    now = utc_now()
    if row is not None and for_update:
        row = ProjectStyle(
            origin_project_id=project_id,
            style_preset=(row.style_preset or DEFAULT_DECK_STYLE_PRESET).strip()
            or DEFAULT_DECK_STYLE_PRESET,
            user_style_hint=row.user_style_hint,
            style_prompt_text=row.style_prompt_text or "",
            style_data_json=row.style_data_json,
            style_base_json=row.style_base_json or "",
            version=int(row.version or 1),
            created_at=now,
            updated_at=now,
        )
        session.add(row)
        await session.flush()
        project.style_id = int(row.id)
        project.updated_at = now
        session.add(project)
        await session.commit()
        await session.refresh(row)
        return row

    row = ProjectStyle(
        origin_project_id=project_id,
        style_preset=DEFAULT_DECK_STYLE_PRESET,
        user_style_hint=None,
        style_prompt_text="",
        style_data_json=None,
        style_base_json="",
        version=1,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.flush()
    project.style_id = int(row.id)
    project.updated_at = now
    session.add(project)
    await session.commit()
    await session.refresh(row)
    return row


def _style_config_matches_row(
    row: ProjectStyle, preset: str, hint: str
) -> bool:
    rp = (row.style_preset or DEFAULT_DECK_STYLE_PRESET).strip() or DEFAULT_DECK_STYLE_PRESET
    rh = _norm_deck_hint(row.user_style_hint)
    return rp == preset and rh == hint


def _legacy_envelope_preset_hint_match(
    cache: dict[str, Any], preset: str, hint: str
) -> bool:
    if not isinstance(cache, dict):
        return False
    c_hint = _norm_deck_hint(
        cache.get("user_hint") if cache.get("user_hint") is not None else ""
    )
    return cache.get("preset") == preset and c_hint == hint


def _style_base_from_envelope(cache: dict[str, Any]) -> dict[str, Any] | None:
    sb = cache.get("style_base")
    return sb if isinstance(sb, dict) else None


def _theme_label_from_prompt(prompt: str) -> str | None:
    for line in (prompt or "").splitlines():
        s = line.strip()
        if s:
            return s[:80] if len(s) > 80 else s
    return None


def _effective_style_prompt(
    project: Project, row: ProjectStyle | None
) -> str | None:
    """当前 preset/hint 下可用的风格正文（含旧版 JSON 母版推导，不写库）。"""
    if row is None:
        return None
    preset, hint, _ = _project_style_keys(project, row)
    pt = (row.style_prompt_text or "").strip()
    if pt and _style_config_matches_row(row, preset, hint):
        return pt
    raw = _style_storage_blob(row)
    if not raw:
        return None
    try:
        cache = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(cache, dict) or not _legacy_envelope_preset_hint_match(
        cache, preset, hint
    ):
        return None
    sb = _style_base_from_envelope(cache)
    if not sb:
        return None
    legacy = _style_prompt_from_base(sb)
    return legacy.strip() or None


def deck_style_ready_from_storage(
    project: Project,
    style_row: ProjectStyle | None,
) -> tuple[bool, str | None, int | None]:
    """是否已有当前 preset/hint 下可用的风格母版正文。"""
    version = style_row.version if style_row else None
    prompt = _effective_style_prompt(project, style_row)
    if not prompt:
        return False, None, version
    name = _theme_label_from_prompt(prompt)
    return True, name, version


async def _persist_style_prompt_success(
    session: AsyncSession,
    project_id: int,
    *,
    style_preset: str,
    user_style_hint: str,
    style_prompt_text: str,
) -> ProjectStyle:
    """仅在母版生成成功时写入；清空扩展 JSON 列。"""
    now = utc_now()
    text = (style_prompt_text or "").strip()
    row = await get_or_create_project_style(session, project_id, for_update=True)
    row.style_preset = style_preset
    row.user_style_hint = user_style_hint or None
    row.style_prompt_text = text
    row.style_data_json = None
    row.style_base_json = ""
    row.version = int(row.version or 1) + 1
    row.updated_at = now
    session.add(row)
    return row


async def fetch_style_prompt_for_project(
    session: AsyncSession,
    project: Project,
) -> str | None:
    """读取当前项目可用的风格正文。"""
    if project.id is None:
        return None
    row = await get_project_style(session, project)
    return _effective_style_prompt(project, row)


async def ensure_style_base(project_id: int) -> str:
    """
    生成或复用纯文本风格母版；仅成功时写入 project_styles。
    失败时不提交对母版正文的更新（无 flush 空行：仅在成功时 upsert）。
    """
    async with _style_lock(project_id):
        async with async_session_maker() as session:
            project = await session.get(Project, project_id)
            if project is None:
                raise RuntimeError("项目不存在")
            row = await get_project_style(session, project)
            preset, hint, _ = _project_style_keys(project, row)

            cached = _effective_style_prompt(project, row)
            if cached:
                return cached

            try:
                prompt_text = await generate_style_prompt_text(
                    preset_id=preset,
                    user_hint=hint or None,
                    project_title=(project.name or "").strip() or None,
                )
            except Exception as e:
                raise RuntimeError(
                    "风格母版生成失败："
                    + _clip_deck_err(e, max_len=1600)
                ) from e

            if not (prompt_text or "").strip():
                raise RuntimeError("风格母版生成失败：模型返回空风格说明")

            await _persist_style_prompt_success(
                session,
                project_id,
                style_preset=preset,
                user_style_hint=hint,
                style_prompt_text=prompt_text,
            )
            project.updated_at = utc_now()
            session.add(project)
            await session.commit()
            return prompt_text.strip()


def deck_page_node_ids_from_loaded_tree(
    children_by_parent: dict[int | None, list[OutlineNode]],
) -> list[int]:
    """有大纲子节点（step/pause）的 page 节点 id，顺序与大纲一致（与 collect_deck_page_node_ids 同规则）。"""
    roots = sorted(
        children_by_parent.get(None, []),
        key=lambda n: n.sort_order,
    )
    out: list[int] = []
    for node in roots:
        if node.node_kind != KIND_PAGE or node.id is None:
            continue
        kids = children_by_parent.get(node.id, [])
        if not kids:
            continue
        out.append(int(node.id))
    return out


async def collect_deck_page_node_ids(session: AsyncSession, project_id: int) -> list[int]:
    """有大纲子节点（step/pause）的 page 节点 id，顺序与大纲一致。"""
    _, children_by_parent, _ = await _load_nodes_and_contents(session, project_id)
    return deck_page_node_ids_from_loaded_tree(children_by_parent)


def deck_page_is_complete(nc: NodeContent) -> bool:
    """与 compute_project_pipeline 单页判定一致：ready 且含非空 page_code 即视为已生成。"""
    st = (nc.page_deck_status or "").strip().lower()
    code = (nc.page_code or "").strip()
    return st == "ready" and bool(code)


async def collect_deck_page_node_ids_needing_generation(
    session: AsyncSession, project_id: int
) -> list[int]:
    """
    仅包含尚未成功生成演示 HTML 的页（failed / idle / 未开始等）。
    已成功页（ready + 非空 page_code）不加入，用于「场景重新生成」时只跑失败或未完成的页。
    """
    out: list[int] = []
    for nid in await collect_deck_page_node_ids(session, project_id):
        node = await session.get(OutlineNode, nid)
        if node is None or node.project_id != project_id:
            continue
        nc = await _get_or_create_page_node_content(session, node)
        if deck_page_is_complete(nc):
            continue
        out.append(nid)
    return out


async def invalidate_all_page_decks_after_master_change(
    session: AsyncSession, project_id: int
) -> None:
    """
    母版或全局演示风格变更后，既有页面 HTML 与新母版不一致；
    清空各页演示产物，使 deck 步骤需重做，并失效导出状态。
    """
    nodes, children_by_parent, content_by_node = await _load_nodes_and_contents(
        session, project_id
    )
    page_ids = deck_page_node_ids_from_loaded_tree(children_by_parent)
    nodes_by_id = {int(n.id): n for n in nodes if n.id is not None}
    now = utc_now()
    for nid in page_ids:
        node = nodes_by_id.get(nid)
        if node is None:
            continue
        nc = content_by_node.get(nid)
        if nc is None:
            nc = await _get_or_create_page_node_content(session, node)
            content_by_node[nid] = nc
        pst = (nc.page_deck_status or "").strip().lower()
        if pst == "generating":
            nc.page_deck_status = "failed"
            nc.page_deck_error = "母版已更新，请重新生成演示页"
        else:
            nc.page_deck_error = None
        nc.page_code = None
        if pst != "generating":
            nc.page_deck_status = "idle"
        nc.updated_at = now
        session.add(nc)
    project = await session.get(Project, project_id)
    if project is not None:
        project.updated_at = now
        await reset_export_only(session, project)
        session.add(project)


async def _first_failed_page_deck_error(
    session: AsyncSession, project_id: int
) -> str | None:
    """任一 page 节点 failed 时的首条 page_deck_error（用于项目级汇总）。"""
    _, children_by_parent, content_by_node = await _load_nodes_and_contents(
        session, project_id
    )
    for nid in deck_page_node_ids_from_loaded_tree(children_by_parent):
        nc = content_by_node.get(nid)
        if nc is None:
            continue
        st = (nc.page_deck_status or "").strip().lower()
        if st == "failed":
            t = (nc.page_deck_error or "").strip()
            if t:
                return _clip_deck_err(t, max_len=2000)
    return None


async def compute_project_deck_status(
    session: AsyncSession, project_id: int
) -> str:
    """聚合 page 节点的 deck 状态，返回 idle/generating/failed/ready。"""
    _, children_by_parent, content_by_node = await _load_nodes_and_contents(
        session, project_id
    )
    page_ids = deck_page_node_ids_from_loaded_tree(children_by_parent)
    if not page_ids:
        return "idle"
    states: list[str] = []
    all_ready = True
    now = utc_now()
    timeout_s = max(60, int(settings.deck_page_generating_timeout_seconds or 600))
    for nid in page_ids:
        nc = content_by_node.get(nid)
        st = (nc.page_deck_status or "").strip().lower() if nc else ""
        if st == "generating" and nc is not None and nc.updated_at is not None:
            elapsed_s = (
                _as_utc_aware(now) - _as_utc_aware(nc.updated_at)
            ).total_seconds()
            if elapsed_s >= timeout_s:
                nc.page_deck_status = "failed"
                nc.page_deck_error = (
                    f"页面生成超时（>{timeout_s}s）：请重试；若频繁出现可检查模型接口连通性/限流。"
                )
                nc.updated_at = now
                session.add(nc)
                st = "failed"
        code = (nc.page_code or "").strip() if nc else ""
        states.append(st)
        if st != "ready" or not code:
            all_ready = False

    if any(st == "generating" for st in states):
        return "generating"
    if any(st == "failed" for st in states):
        return "failed"
    if any(st == "cancelled" for st in states):
        return "cancelled"
    if all_ready:
        return "ready"
    return "idle"


async def sync_demo_workflow_from_deck(session: AsyncSession, project_id: int) -> None:
    """聚合 deck 页状态并回写 deck_render step；必要时更新 projects.status。"""
    from app.services import workflow_engine as wf
    from app.services.project_pipeline import compute_project_pipeline

    project = await session.get(Project, project_id)
    if project is None:
        return
    pl = await compute_project_pipeline(session, project)
    deck_done = bool(pl.get("deck"))
    ds = await compute_project_deck_status(session, project_id)
    deck_generating = ds == "generating"
    any_failed = ds == "failed"
    deck_user_cancelled = ds == "cancelled"
    failed_msg: str | None = None
    if any_failed:
        aggregated = await _first_failed_page_deck_error(session, project_id) or ""
        failed_msg = (aggregated or "演示页生成失败")[:4000]

    wf_run_row = (
        await session.exec(
            select(WorkflowRun).where(WorkflowRun.project_id == project_id)
        )
    ).first()
    if wf_run_row is not None:
        await wf.on_deck_pages_aggregate(
            session,
            project_id,
            deck_done,
            any_failed,
            failed_message=failed_msg,
            deck_user_cancelled=deck_user_cancelled,
            deck_generating=deck_generating,
        )
        # projects.status 仅作 UI 辅助：失败则置 failed；成功则置 ready。
        if any_failed:
            project.status = "failed"
        elif deck_user_cancelled:
            await _project_status_after_user_cancelled_deck(session, project)
        elif deck_done:
            # 若文本/配音/演示均完成，则置 ready（以 workflow 为准）
            run = await wf._get_run(session, project_id)  # type: ignore[attr-defined]
            if run is not None and run.id is not None:
                steps = await wf._load_steps_map(session, int(run.id))  # type: ignore[attr-defined]
                ok = (
                    (steps.get(wf.STEP_TEXT).status if steps.get(wf.STEP_TEXT) else wf.STEP_PENDING)
                    == wf.STEP_SUCCEEDED
                    and (steps.get(wf.STEP_AUDIO).status if steps.get(wf.STEP_AUDIO) else wf.STEP_PENDING)
                    == wf.STEP_SUCCEEDED
                    and (steps.get(wf.STEP_DECK_RENDER).status if steps.get(wf.STEP_DECK_RENDER) else wf.STEP_PENDING)
                    == wf.STEP_SUCCEEDED
                )
                if ok:
                    project.status = "ready"
        project.updated_at = utc_now()
        session.add(project)
        return


def _build_pages_payload(rows: list[DeckTimelineRow]) -> dict:
    """按 page 分组；每页 section_count = 子节点数（与后端切换板块数一致）。"""
    def _clip_narration(s: str, max_chars: int = 220) -> str:
        t = " ".join((s or "").split())
        if len(t) <= max_chars:
            return t
        return t[: max_chars - 3].rstrip() + "..."

    pages: list[dict] = []
    current_page: str | None = None
    current_steps: list[dict] = []
    for r in rows:
        if current_page != r.page_title:
            if current_steps:
                pages.append(
                    {
                        "main_title": current_page,
                        "section_count": len(current_steps),
                        "steps": current_steps,
                    }
                )
            current_page = r.page_title
            current_steps = []
        current_steps.append(
            {
                "section_index": len(current_steps),
                "subtitle": r.title,
                "kind": r.kind,
                # 只保留提炼事实所需的摘要，降低请求体大小，减少长回包风险
                "narration_text": _clip_narration((r.script_excerpt or "").strip()),
            }
        )
    if current_steps and current_page is not None:
        pages.append(
            {
                "main_title": current_page,
                "section_count": len(current_steps),
                "steps": current_steps,
            }
        )
    n = len(rows)
    return {"pages": pages, "step_count": n}


def _normalize_pages_html(raw: Any, expected_titles: list[str]) -> list[dict[str, str]]:
    """按输入大标题顺序校验 AI 返回的 pages_html，每项含 main_title、html。"""
    if not isinstance(raw, list):
        raise RuntimeError("pages_html 必须是数组")
    by_mt: dict[str, str] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        mt = str(item.get("main_title", "")).strip()
        html = item.get("html")
        if not mt or html is None:
            continue
        hs = str(html).strip()
        if hs:
            by_mt[mt] = hs
    out: list[dict[str, str]] = []
    for title in expected_titles:
        h = by_mt.get(title)
        if not h:
            raise RuntimeError(
                f"pages_html 缺少与大标题一致的项或未填 html：{title!r}"
            )
        out.append({"main_title": title, "html": h})
    return out


def _merge_page_into_deck_json(
    existing: str | None, main_title: str, html: str
) -> str:
    try:
        data = json.loads(existing) if existing else {"pages_html": []}
    except json.JSONDecodeError:
        data = {"pages_html": []}
    arr = data.get("pages_html")
    if not isinstance(arr, list):
        arr = []
    rest = [
        x
        for x in arr
        if not (isinstance(x, dict) and str(x.get("main_title", "")).strip() == main_title)
    ]
    rest.append({"main_title": main_title, "html": html})
    data["pages_html"] = rest
    return json.dumps(data, ensure_ascii=False)


async def _get_or_create_page_node_content(
    session: AsyncSession, page_node: OutlineNode
) -> NodeContent:
    assert page_node.id is not None
    res = await session.exec(
        select(NodeContent).where(NodeContent.node_id == page_node.id)
    )
    nc = res.first()
    if nc:
        return nc
    now = utc_now()
    nc = NodeContent(
        node_id=page_node.id,
        page_code=None,
        narration_text="",
        duration_ms=None,
        audio_sequence=0,
        audio_asset_id=None,
        image_asset_id=None,
        background_asset_id=None,
        page_deck_status=None,
        page_deck_error=None,
        created_at=now,
        updated_at=now,
    )
    session.add(nc)
    await session.flush()
    return nc


async def _apply_single_page_failure(
    session: AsyncSession, page_node: OutlineNode, message: str
) -> None:
    now = utc_now()
    nc = await _get_or_create_page_node_content(session, page_node)
    nc.page_deck_status = "failed"
    nc.page_deck_error = message
    nc.updated_at = now
    session.add(nc)


async def _apply_single_page_success(
    session: AsyncSession,
    project: Project,
    page_node: OutlineNode,
    main_title: str,
    html: str,
) -> None:
    now = utc_now()
    nc = await _get_or_create_page_node_content(session, page_node)
    nc.page_code = html
    nc.page_deck_status = "ready"
    nc.page_deck_error = None
    nc.updated_at = now
    session.add(nc)
    project.updated_at = now
    session.add(project)


async def try_start_page_deck_generation(
    session: AsyncSession, project_id: int, page_node_id: int
) -> str:
    """返回 ok | not_found | conflict"""
    node = await session.get(OutlineNode, page_node_id)
    if node is None or node.project_id != project_id or node.node_kind != KIND_PAGE:
        return "not_found"
    now = utc_now()
    nc = await _get_or_create_page_node_content(session, node)
    updated = await session.exec(
        update(NodeContent)
        .where(NodeContent.id == nc.id)
        .where(
            or_(
                NodeContent.page_deck_status.is_(None),
                NodeContent.page_deck_status != "generating",
            )
        )
        .values(
            page_deck_status="generating",
            page_deck_error=None,
            updated_at=now,
        )
    )
    if updated.rowcount == 0:
        return "conflict"
    project = await session.get(Project, project_id)
    if project is not None:
        # 演示页重生成后旧成片不再有效；与前端「重新生成」语义一致，以工作流状态为准而非仅看磁盘文件
        await reset_export_only(session, project)
        project.updated_at = now
        session.add(project)
    await session.commit()
    return "ok"


async def try_cancel_page_deck_generation(
    session: AsyncSession,
    project_id: int,
    page_node_id: int,
    *,
    reason: str = "用户手动取消该页场景生成",
) -> str:
    """返回 ok | not_found | noop。仅 generating 可取消。"""
    node = await session.get(OutlineNode, page_node_id)
    if node is None or node.project_id != project_id or node.node_kind != KIND_PAGE:
        return "not_found"
    now = utc_now()
    nc = await _get_or_create_page_node_content(session, node)
    if (nc.page_deck_status or "").strip().lower() != "generating":
        return "noop"
    nc.page_deck_status = "cancelled"
    nc.page_deck_error = (reason or "用户手动取消该页场景生成").strip()[:1800]
    nc.updated_at = now
    session.add(nc)
    project = await session.get(Project, project_id)
    if project is not None:
        msg = (reason or "用户手动取消该页场景生成").strip()[:1800]
        project.updated_at = now
        session.add(project)
        await wf_engine.set_step(
            session,
            project,
            wf_engine.STEP_DECK_RENDER,
            wf_engine.STEP_CANCELLED,
            error_message=msg,
        )
        await _project_status_after_user_cancelled_deck(session, project)
        session.add(project)
    return "ok"


async def cancel_generating_deck_pages(
    session: AsyncSession,
    project_id: int,
    *,
    reason: str = "用户手动取消批量场景生成",
    user_cancelled: bool = False,
) -> list[int]:
    """取消项目下所有 generating 页面，返回已取消的 page node ids。

    user_cancelled=True 时页面标为 cancelled、工作流为 cancelled；否则为系统中止/失败路径，标 failed。
    """
    page_ids = await collect_deck_page_node_ids(session, project_id)
    now = utc_now()
    out: list[int] = []
    page_terminal = "cancelled" if user_cancelled else "failed"
    default_reason = (
        "用户手动取消批量场景生成"
        if user_cancelled
        else "用户手动取消批量生成（已标记失败）"
    )
    for nid in page_ids:
        node = await session.get(OutlineNode, nid)
        if node is None or node.project_id != project_id:
            continue
        nc = await _get_or_create_page_node_content(session, node)
        if (nc.page_deck_status or "").strip().lower() != "generating":
            continue
        nc.page_deck_status = page_terminal
        nc.page_deck_error = (reason or default_reason).strip()[:1800]
        nc.updated_at = now
        session.add(nc)
        out.append(nid)
    if out:
        project = await session.get(Project, project_id)
        if project is not None:
            msg = (reason or default_reason).strip()[:1800]
            project.updated_at = now
            session.add(project)
            if user_cancelled:
                await wf_engine.set_step(
                    session,
                    project,
                    wf_engine.STEP_DECK_RENDER,
                    wf_engine.STEP_CANCELLED,
                    error_message=msg,
                )
                await _project_status_after_user_cancelled_deck(session, project)
            else:
                project.status = "failed"
                await wf_engine.set_step(
                    session,
                    project,
                    wf_engine.STEP_DECK_RENDER,
                    wf_engine.STEP_FAILED,
                    error_message=msg,
                )
            session.add(project)
    return out


async def run_generate_deck_page_job(
    project_id: int,
    page_node_id: int,
    *,
    skip_style_ensure: bool = False,
) -> None:
    ptitle: str | None = None
    page_size_meta = _PAGE_SIZE_META["16:9"]
    sub: list[DeckTimelineRow] = []
    async with async_session_maker() as session:
        project = await session.get(Project, project_id)
        node = await session.get(OutlineNode, page_node_id)
        if project is None or node is None:
            return
        if node.project_id != project_id or node.node_kind != KIND_PAGE:
            return
        page_size_meta = _resolve_page_size(resolve_project_page_size(project))
        ptitle = (node.title or "").strip() or "（未命名页）"
        rows = await load_deck_timeline(session, project_id)
        sub = [r for r in rows if r.page_title == ptitle]
        if not sub:
            await _apply_single_page_failure(
                session, node, "该页没有可演示的 step/pause 分段"
            )
            await sync_demo_workflow_from_deck(session, project_id)
            project.updated_at = utc_now()
            session.add(project)
            await session.commit()
            return

    assert ptitle is not None

    if not skip_style_ensure:
        try:
            await ensure_style_base(project_id)
        except Exception as e:
            detail = _clip_deck_err(e)
            async with async_session_maker() as session:
                node = await session.get(OutlineNode, page_node_id)
                if node and node.project_id == project_id:
                    await _apply_single_page_failure(session, node, detail)
                    await sync_demo_workflow_from_deck(session, project_id)
                    pr = await session.get(Project, project_id)
                    if pr:
                        await wf_engine.set_step(
                            session,
                            pr,
                            wf_engine.STEP_DECK_MASTER,
                            wf_engine.STEP_FAILED,
                            error_message=detail,
                        )
                        pr.updated_at = utc_now()
                        session.add(pr)
                    await session.commit()
            return

    async with async_session_maker() as session:
        await wf_engine.notify_deck_master_success_if_pending(session, project_id)
        await session.commit()

    style_prompt: str | None = None
    page_size_key: str | None = None
    async with async_session_maker() as session:
        pr = await session.get(Project, project_id)
        if pr:
            style_prompt = await fetch_style_prompt_for_project(session, pr)
            page_size_key = resolve_project_page_size(pr)
    if not style_prompt:
        miss = "缺少风格母版：请先成功生成演示风格母版后再生成页面"
        async with async_session_maker() as session:
            node = await session.get(OutlineNode, page_node_id)
            if node and node.project_id == project_id:
                await _apply_single_page_failure(session, node, miss)
                await sync_demo_workflow_from_deck(session, project_id)
                pr = await session.get(Project, project_id)
                if pr:
                    pr.updated_at = utc_now()
                    session.add(pr)
                await session.commit()
        return

    payload = _build_pages_payload(sub)
    if len(payload["pages"]) != 1:
        async with async_session_maker() as session:
            node = await session.get(OutlineNode, page_node_id)
            if node and node.project_id == project_id:
                await _apply_single_page_failure(
                    session, node, "内部分组异常：单页负载页数不为 1"
                )
                await sync_demo_workflow_from_deck(session, project_id)
                pr = await session.get(Project, project_id)
                if pr:
                    pr.updated_at = utc_now()
                    session.add(pr)
                await session.commit()
        return

    payload_json = json.dumps(payload, ensure_ascii=False)
    user_block = textwrap.dedent(
        f"""请根据下列数据生成 pages_html（见 system 说明）。本次 **仅一页**，pages_html 必须只含一项。
        该页 section_count 即板块个数，HTML 中必须有 data-key="section-0" … section-{{N-1}}。
        输入说明：narration_text 为该段**口播原文**，仅供你抽取事实与要点；**不得**作为页面大段正文逐字粘贴。
        目标画布：{page_size_meta["label"]}，按该比例组织版式与留白（可用视口单位实现，不必写死像素）。
        为避免响应过长，请输出“紧凑版本”：
        - 单页 html 建议控制在 4500 字符以内，最大不超过 7000 字符；
        - 减少重复渐变定义、避免过多内联 SVG 路径；
        - 优先复用少量 CSS 类，不要堆叠冗长样式。
        {payload_json}"""
    )

    dump_dir = settings.storage_root / "projects" / str(project_id) / "deck_raw"
    stem = f"page_{page_node_id}_{int(utc_now().timestamp())}"

    try:
        async with _DECK_PAGE_SEMAPHORE:
            data = await generate_deck_pages_html(
                user_payload_json=user_block,
                style_prompt_text=style_prompt,
                page_size=page_size_key,
                fim_dump=(dump_dir, stem),
            )
            normalized = _normalize_pages_html(data["pages_html"], [ptitle])
            html = normalized[0]["html"]
    except Exception as e:
        page_err = _clip_deck_err(e)
        async with async_session_maker() as session:
            node = await session.get(OutlineNode, page_node_id)
            if node and node.project_id == project_id:
                await _apply_single_page_failure(session, node, page_err)
                await sync_demo_workflow_from_deck(session, project_id)
                pr = await session.get(Project, project_id)
                if pr:
                    pr.updated_at = utc_now()
                    session.add(pr)
                await session.commit()
        return

    async with async_session_maker() as session:
        project = await session.get(Project, project_id)
        node = await session.get(OutlineNode, page_node_id)
        if project is None or node is None:
            return
        if node.project_id != project_id:
            return
        nc = await _get_or_create_page_node_content(session, node)
        if (nc.page_deck_status or "").strip().lower() != "generating":
            await sync_demo_workflow_from_deck(session, project_id)
            await session.commit()
            return
        await _apply_single_page_success(session, project, node, ptitle, html)
        await sync_demo_workflow_from_deck(session, project_id)
        await session.commit()


async def run_generate_deck_all_job(project_id: int, page_node_ids: list[int]) -> None:
    """已在外层将各页标为 generating；先确保 style_base，再并行生成各页 HTML。"""
    if not page_node_ids:
        return
    async with async_session_maker() as session:
        pr0 = await session.get(Project, project_id)
        if pr0:
            await wf_engine.set_step(
                session,
                pr0,
                wf_engine.STEP_DECK_MASTER,
                wf_engine.STEP_RUNNING,
            )
        await session.commit()
    try:
        await ensure_style_base(project_id)
    except Exception as e:
        detail = _clip_deck_err(e)
        async with async_session_maker() as session:
            prf = await session.get(Project, project_id)
            if prf:
                await wf_engine.set_step(
                    session,
                    prf,
                    wf_engine.STEP_DECK_MASTER,
                    wf_engine.STEP_FAILED,
                    error_message=detail,
                )
                prf.updated_at = utc_now()
                session.add(prf)
            for nid in page_node_ids:
                node = await session.get(OutlineNode, nid)
                if node and node.project_id == project_id:
                    await _apply_single_page_failure(session, node, detail)
            await sync_demo_workflow_from_deck(session, project_id)
            await session.commit()
        return

    async with async_session_maker() as session:
        pr_ok = await session.get(Project, project_id)
        if pr_ok:
            await wf_engine.set_step(
                session,
                pr_ok,
                wf_engine.STEP_DECK_MASTER,
                wf_engine.STEP_SUCCEEDED,
            )
            await wf_engine.set_step(
                session,
                pr_ok,
                wf_engine.STEP_DECK_RENDER,
                wf_engine.STEP_RUNNING,
            )
        await session.commit()

    await asyncio.gather(
        *[
            run_generate_deck_page_job(project_id, nid, skip_style_ensure=True)
            for nid in page_node_ids
        ]
    )
    async with async_session_maker() as session:
        await sync_demo_workflow_from_deck(session, project_id)
        await session.commit()
