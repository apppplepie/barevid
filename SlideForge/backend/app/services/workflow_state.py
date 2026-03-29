"""
项目级工作流四态：文本 →（配音 ∥ 母版）→ 演示渲染 → 导出 → 下载。
分步真相源见 workflow_engine + workflow_* 表。
"""

from __future__ import annotations

from sqlmodel.ext.asyncio.session import AsyncSession

from app.db.models import Project
from app.services import workflow_engine as wf

STEP_NOT_STARTED = "not_started"
STEP_RUNNING = "running"
STEP_SUCCESS = "success"
STEP_FAILED = "failed"

EXPORT_NOT_STARTED = "not_started"
EXPORT_RUNNING = "running"
EXPORT_SUCCESS = "success"
EXPORT_FAILED = "failed"


def _clip(msg: str | None, n: int = 4000) -> str | None:
    if msg is None:
        return None
    t = str(msg).strip()
    if len(t) <= n:
        return t
    return t[: n - 3] + "..."


def can_start_audio_or_demo(project: Project) -> bool:
    # projects 表不再存 text_status；仅作为兼容占位。
    _ = project
    return True


def can_start_export(project: Project) -> bool:
    _ = project
    return True


def can_download(project: Project) -> bool:
    _ = project
    return True


async def reset_downstream_after_text_retry(
    session: AsyncSession, project: Project
) -> None:
    await wf.reset_downstream_for_text_retry(session, project)


async def reset_export_only(session: AsyncSession, project: Project) -> None:
    await wf.set_export_status(session, project, wf.EXPORT_NOT_EXPORTED)
    # projects 表不再存导出字段；仅维护 workflow 表即可。


async def mark_text_running(session: AsyncSession, project: Project) -> None:
    await wf.set_step(session, project, wf.STEP_TEXT, wf.STEP_RUNNING)


async def mark_text_failed(session: AsyncSession, project: Project, err: str) -> None:
    await wf.set_step(
        session,
        project,
        wf.STEP_TEXT,
        wf.STEP_FAILED,
        error_message=_clip(err) or "失败",
    )


async def mark_text_success(session: AsyncSession, project: Project) -> None:
    await wf.set_step(session, project, wf.STEP_TEXT, wf.STEP_SUCCESS)


async def mark_audio_demo_running_after_text(
    session: AsyncSession, project: Project
) -> None:
    await wf.set_step(session, project, wf.STEP_AUDIO, wf.STEP_RUNNING)
    await wf.set_step(session, project, wf.STEP_DECK_MASTER, wf.STEP_RUNNING)
    await wf.set_step(session, project, wf.STEP_DECK_RENDER, wf.STEP_PENDING)


async def mark_export_running(session: AsyncSession, project: Project) -> None:
    await wf.set_export_status(session, project, wf.EXPORT_EXPORTING)


async def mark_export_success(
    session: AsyncSession, project: Project, file_url: str
) -> None:
    url = (file_url or "").strip() or None
    await wf.set_export_status(
        session, project, wf.EXPORT_SUCCESS, output_url=url or None
    )
    if project.id is not None:
        await wf.record_export_artifact(session, int(project.id), url or "")


async def mark_export_failed(session: AsyncSession, project: Project, err: str) -> None:
    await wf.set_export_status(
        session,
        project,
        wf.EXPORT_FAILED,
        error_message=_clip(err) or "导出失败",
    )


async def infer_workflow_if_legacy_row(session: AsyncSession, project: Project) -> None:
    """MySQL 新库：projects 不再存兼容工作流列；不做推导回写。"""
    _ = (session, project)
    return


async def backfill_legacy_workflow_columns(session: AsyncSession) -> None:
    # MySQL 新库：不再回填 projects.* 兼容列。
    _ = session
    return


def workflow_public_dict(project: Project) -> dict:
    """无 AsyncSession 时的兜底：仅返回占位，真实状态应走 workflow_public_dict_async。"""
    _ = project
    return {"id": project.id}
