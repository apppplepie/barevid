"""手动流水线：口播分段确认、大纲节点批量更新。"""

from __future__ import annotations

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db.models import KIND_PAGE, KIND_STEP, NodeContent, OutlineNode, Project, utc_now
from app.schemas import ManualOutlinePageEdit
from app.services.workflow_state import reset_export_only


async def apply_manual_outline_edits(
    session: AsyncSession,
    project: Project,
    pages: list[ManualOutlinePageEdit],
) -> None:
    """校验节点属于本项目后写入标题与口播正文/摘要，并标记用户已确认分段。"""
    if project.id is None:
        raise ValueError("项目未持久化")
    pid = int(project.id)
    now = utc_now()
    for p in pages:
        page = await session.get(OutlineNode, p.page_node_id)
        if (
            page is None
            or int(page.project_id) != pid
            or (page.node_kind or "") != KIND_PAGE
        ):
            raise ValueError(f"无效的大页节点 id：{p.page_node_id}")
        mt = (p.main_title or "").strip()
        if mt:
            page.title = mt
        page.updated_at = now
        session.add(page)

        for seg in p.segments:
            step = await session.get(OutlineNode, seg.step_node_id)
            if (
                step is None
                or int(step.project_id) != pid
                or (step.node_kind or "") != KIND_STEP
                or int(step.parent_id or 0) != int(page.id or 0)
            ):
                raise ValueError(f"无效的小节节点 id：{seg.step_node_id}")
            st = (seg.subtitle or "").strip()
            if st:
                step.title = st
            step.updated_at = now
            session.add(step)

            res = await session.exec(
                select(NodeContent).where(NodeContent.node_id == int(step.id))
            )
            nc = res.first()
            if nc is None:
                raise ValueError(f"小节缺少内容行：{seg.step_node_id}")
            nc.narration_text = seg.narration_text or ""
            if seg.narration_brief is not None:
                nb = (seg.narration_brief or "").strip()
                nc.narration_brief = nb or None
            nc.updated_at = now
            session.add(nc)

    project.manual_outline_confirmed = True
    project.video_source_updated_at = now
    project.video_exported_at = None
    await reset_export_only(session, project)
    project.updated_at = now
    session.add(project)
