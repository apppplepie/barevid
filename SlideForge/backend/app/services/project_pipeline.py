"""项目流水线阶段：文案 / 配音 / 演示页 / 成片（基于 outline/node_contents/workflow 推断）。"""

from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db.models import KIND_STEP, NodeContent, OutlineNode, Project
from app.services.deck import collect_deck_page_node_ids
from app.services import workflow_engine as wf


async def _project_has_step_outline(session: AsyncSession, project_id: int) -> bool:
    stmt = (
        select(func.count(OutlineNode.id))
        .where(OutlineNode.project_id == project_id)
        .where(OutlineNode.node_kind == KIND_STEP)
    )
    n = (await session.exec(stmt)).one()
    return int(n or 0) > 0


async def compute_project_pipeline(
    session: AsyncSession, project: Project
) -> dict[str, bool]:
    """给前端用的布尔阶段：不依赖 projects.* 兼容列。"""
    pid = project.id
    if pid is None:
        return {"outline": False, "audio": False, "deck": False, "video": False}

    st = (project.status or "").strip().lower()
    if st in ("queued", "structuring"):
        outline_done = False
    else:
        outline_done = await _project_has_step_outline(session, pid)

    run = await wf._get_run(session, int(pid))  # type: ignore[attr-defined]
    if run is None or run.id is None:
        audio_done = False
        video_done = False
    else:
        steps = await wf._load_steps_map(session, int(run.id))  # type: ignore[attr-defined]
        ex = await wf._get_export_row(session, int(run.id))  # type: ignore[attr-defined]
        audio_done = (steps.get(wf.STEP_AUDIO).status if steps.get(wf.STEP_AUDIO) else wf.STEP_PENDING) == wf.STEP_SUCCEEDED
        video_done = bool(ex and ex.status == wf.EXPORT_SUCCESS and (ex.output_file_url or "").strip())

    page_ids = await collect_deck_page_node_ids(session, pid)
    deck_done = True
    if page_ids:
        for nid in page_ids:
            r = await session.exec(
                select(NodeContent).where(NodeContent.node_id == nid)
            )
            nc = r.first()
            code = (nc.page_code or "").strip() if nc else ""
            st = (nc.page_deck_status or "").strip() if nc else ""
            if st != "ready" or not code:
                deck_done = False
                break

    return {
        "outline": outline_done,
        "audio": audio_done,
        "deck": deck_done,
        "video": video_done,
    }
