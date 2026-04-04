"""手动流水线：用户确认后的口播分段写回大纲。"""

from __future__ import annotations

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db.models import KIND_PAGE, KIND_STEP, NodeContent, OutlineNode, Project, utc_now
from app.schemas import ManualConfirmOutlinePage

from app.services.workflow_state import reset_export_only


async def apply_manual_outline_confirm(
    session: AsyncSession,
    project: Project,
    pages: list[ManualConfirmOutlinePage],
) -> None:
    """校验并更新 page/step 标题与口播正文；口播变更时清空字级对齐。"""
    pid = int(project.id) if project.id is not None else 0
    if not pages:
        raise ValueError("pages 不能为空")
    now = utc_now()
    for pg in pages:
        page = await session.get(OutlineNode, pg.page_node_id)
        if (
            page is None
            or page.project_id != pid
            or page.node_kind != KIND_PAGE
        ):
            raise ValueError(f"无效的大纲页节点 id={pg.page_node_id}")
        mt = (pg.main_title or "").strip()
        if not mt:
            raise ValueError(f"大标题不能为空（页节点 {pg.page_node_id}）")
        page.title = mt
        page.updated_at = now
        session.add(page)
        for seg in pg.segments:
            step = await session.get(OutlineNode, seg.step_node_id)
            if (
                step is None
                or step.project_id != pid
                or step.node_kind != KIND_STEP
                or step.parent_id != page.id
            ):
                raise ValueError(f"无效的口播段节点 id={seg.step_node_id}")
            res = await session.exec(
                select(NodeContent).where(NodeContent.node_id == step.id)
            )
            nc = res.first()
            if nc is None:
                raise ValueError(f"段落缺少内容记录（节点 {seg.step_node_id}）")
            step.title = (seg.subtitle or "").strip() or "（无小标题）"
            step.updated_at = now
            session.add(step)
            new_script = (seg.narration_text or "").strip()
            new_brief = (seg.narration_brief or "").strip() or None
            old_script = (nc.narration_text or "").strip()
            if new_script != old_script:
                nc.narration_alignment_json = None
            nc.narration_text = new_script
            nc.narration_brief = new_brief
            nc.updated_at = now
            session.add(nc)
    project.updated_at = now
    session.add(project)
    await reset_export_only(session, project)
