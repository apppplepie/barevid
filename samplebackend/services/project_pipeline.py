"""项目流水线阶段：文案 / 配音 / 演示页 / 成片（入库字段 + 可计算布尔）。"""

from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db.models import KIND_STEP, NodeContent, OutlineNode, Project
from app.services.deck import collect_deck_page_node_ids


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
    """与主流程 status / 大纲 / 演示页 / video_exported_at 对齐。"""
    pid = project.id
    if pid is None:
        return {"outline": False, "audio": False, "deck": False, "video": False}

    st = (project.status or "").strip().lower()
    if st in ("queued", "structuring"):
        outline_done = False
    else:
        outline_done = await _project_has_step_outline(session, pid)

    # 音频完成应由 audio_status 判定；project.status 可能因演示失败被置为 failed。
    audio_done = (project.audio_status or "").strip().lower() == "success"

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

    video_done = False
    if project.video_exported_at is not None:
        # 兼容历史数据：video_source_updated_at 为空时不应退回 updated_at（会被无关编辑刷新，导致误判“需重导”）
        source_updated_at = (
            project.video_source_updated_at or project.created_at or project.updated_at
        )
        video_done = project.video_exported_at >= source_updated_at

    return {
        "outline": outline_done,
        "audio": audio_done,
        "deck": deck_done,
        "video": video_done,
    }
