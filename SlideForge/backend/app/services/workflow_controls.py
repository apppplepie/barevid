"""用户在工作流面板中「取消运行中步骤」「回退已完成步骤」的服务端实现。"""

from __future__ import annotations

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db.models import Project, WorkflowExportRun, WorkflowStepRun, utc_now
from app.services import workflow_engine as wf
from app.services.deck import cancel_generating_deck_pages
from app.services.pipeline import clear_project_outline_nodes
from app.services.workflow_state import reset_export_only

_EXPORT = "export"


async def _steps_map(session: AsyncSession, workflow_run_id: int) -> dict[str, WorkflowStepRun]:
    res = await session.exec(
        select(WorkflowStepRun).where(WorkflowStepRun.workflow_run_id == workflow_run_id)
    )
    return {row.step_key: row for row in res.all()}


async def _export_row(session: AsyncSession, workflow_run_id: int) -> WorkflowExportRun | None:
    r = await session.exec(
        select(WorkflowExportRun).where(
            WorkflowExportRun.workflow_run_id == workflow_run_id
        )
    )
    return r.first()


async def _invalidate_export_after_pipeline_step_cancel(
    session: AsyncSession, project: Project, wid: int
) -> None:
    """取消核心步骤后导出结果不再可信，回到未导出。"""
    ex = await _export_row(session, wid)
    if ex is None or ex.status == wf.EXPORT_NOT_EXPORTED:
        return
    await reset_export_only(session, project)
    await wf.set_export_status(session, project, wf.EXPORT_NOT_EXPORTED)


async def cancel_running_workflow_step(
    session: AsyncSession, project: Project, step_key: str
) -> None:
    """将当前「运行中」的步骤标为 cancelled，并级联取消 DAG 下游；导出回到未导出。"""
    run = await wf.ensure_workflow_for_project(session, project, align_from_project=False)
    if run is None or run.id is None:
        return
    wid = int(run.id)

    if step_key == _EXPORT:
        ex = await _export_row(session, wid)
        if ex and ex.status == wf.EXPORT_EXPORTING:
            await wf.set_export_status(
                session, project, wf.EXPORT_FAILED, error_message="用户取消"
            )
        return

    steps = await _steps_map(session, wid)
    row = steps.get(step_key)
    if row is None:
        return
    if row.status != wf.STEP_RUNNING:
        raise ValueError("该步骤当前不在运行中，无法取消")

    pid = int(project.id) if project.id is not None else None
    if pid is not None and step_key in (wf.STEP_TEXT, wf.STEP_DECK_RENDER):
        await cancel_generating_deck_pages(
            session,
            pid,
            user_cancelled=True,
            reason=(
                "用户取消场景生成"
                if step_key == wf.STEP_DECK_RENDER
                else "用户取消文本步骤，已停止场景生成"
            ),
        )

    await wf.set_step(
        session, project, step_key, wf.STEP_CANCELLED, error_message="用户取消"
    )
    await wf.cascade_cancel_dependent_steps(session, project, step_key)
    await _invalidate_export_after_pipeline_step_cancel(session, project, wid)

    # projects.status 仍被若干 API 用作闸门；取消后必须与 workflow 一致，避免 409 卡死
    if step_key == wf.STEP_TEXT:
        project.status = "draft"
    elif step_key == wf.STEP_AUDIO:
        steps_after = await _steps_map(session, wid)
        tr = steps_after.get(wf.STEP_TEXT)
        project.status = (
            "ready"
            if tr is not None and tr.status == wf.STEP_SUCCEEDED
            else "draft"
        )
    project.updated_at = utc_now()
    session.add(project)


async def reopen_success_workflow_step(
    session: AsyncSession, project: Project, step_key: str
) -> None:
    """将某步及下游恢复为未开始（pending），并清理导出状态。"""
    run = await wf.ensure_workflow_for_project(session, project, align_from_project=False)
    if run is None or run.id is None:
        return
    wid = int(run.id)

    if step_key == _EXPORT:
        await reset_export_only(session, project)
        await wf.set_export_status(session, project, wf.EXPORT_NOT_EXPORTED)
        project.updated_at = utc_now()
        session.add(project)
        return

    if step_key == wf.STEP_TEXT:
        if project.id is None:
            return
        await clear_project_outline_nodes(session, int(project.id))
        await wf.set_step(session, project, wf.STEP_TEXT, wf.STEP_PENDING)
        await wf.reset_downstream_for_text_retry(session, project)
        project.status = "draft"
        project.updated_at = utc_now()
        session.add(project)
        return

    if step_key == wf.STEP_AUDIO:
        await wf.set_step(session, project, wf.STEP_AUDIO, wf.STEP_PENDING)
        await wf.set_step(session, project, wf.STEP_DECK_RENDER, wf.STEP_PENDING)
        await reset_export_only(session, project)
        await wf.set_export_status(session, project, wf.EXPORT_NOT_EXPORTED)
        project.updated_at = utc_now()
        session.add(project)
        return

    if step_key == wf.STEP_DECK_MASTER:
        await wf.set_step(session, project, wf.STEP_DECK_MASTER, wf.STEP_PENDING)
        await wf.set_step(session, project, wf.STEP_DECK_RENDER, wf.STEP_PENDING)
        await reset_export_only(session, project)
        await wf.set_export_status(session, project, wf.EXPORT_NOT_EXPORTED)
        project.updated_at = utc_now()
        session.add(project)
        return

    if step_key == wf.STEP_DECK_RENDER:
        await wf.set_step(session, project, wf.STEP_DECK_RENDER, wf.STEP_PENDING)
        await reset_export_only(session, project)
        await wf.set_export_status(session, project, wf.EXPORT_NOT_EXPORTED)
        project.updated_at = utc_now()
        session.add(project)
        return

    raise ValueError(f"不支持的步骤：{step_key}")
