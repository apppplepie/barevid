"""
项目级工作流四态：文本 →（配音 ∥ 母版）→ 演示渲染 → 导出 → 下载。
分步下场景渲染（deck_render）须文案 success 且母版 success；兼容字段在 projects.*；
分步真相源见 workflow_engine + workflow_* 表。
"""

from __future__ import annotations

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db.models import Project, utc_now
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
    return (project.text_status or STEP_NOT_STARTED) == STEP_SUCCESS


def manual_outline_blocks_media_steps(project: Project) -> bool:
    """手动流水线且用户尚未确认口播分段。用于配音、场景页等；演示母版与文案并行，不在此列。"""
    if getattr(project, "pipeline_auto_advance", True):
        return False
    return not bool(getattr(project, "manual_outline_confirmed", True))


def manual_demo_requires_audio(project: Project) -> bool:
    """手动流水线下场景生成排在整稿配音之后。"""
    return not getattr(project, "pipeline_auto_advance", True)


def can_start_export(project: Project) -> bool:
    return can_start_audio_or_demo(project) and (
        (project.audio_status or STEP_NOT_STARTED) == STEP_SUCCESS
        and (project.demo_status or STEP_NOT_STARTED) == STEP_SUCCESS
    )


def can_download(project: Project) -> bool:
    return (
        (project.export_status or EXPORT_NOT_STARTED) == EXPORT_SUCCESS
        and bool((project.export_file_url or "").strip())
    )


async def reset_downstream_after_text_retry(
    session: AsyncSession, project: Project
) -> None:
    project.manual_outline_confirmed = False
    session.add(project)
    await wf.reset_downstream_for_text_retry(session, project)


async def reset_export_only(session: AsyncSession, project: Project) -> None:
    await wf.set_export_status(session, project, wf.EXPORT_NOT_EXPORTED)
    project.export_file_url = None
    project.export_error = None
    project.updated_at = utc_now()
    session.add(project)


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
    project.text_error = _clip(err)
    session.add(project)


async def mark_text_success(session: AsyncSession, project: Project) -> None:
    project.text_error = None
    session.add(project)
    await wf.set_step(session, project, wf.STEP_TEXT, wf.STEP_SUCCESS)


async def mark_audio_demo_running_after_text(
    session: AsyncSession, project: Project
) -> None:
    await wf.set_step(session, project, wf.STEP_AUDIO, wf.STEP_RUNNING)
    await wf.set_step(session, project, wf.STEP_DECK_MASTER, wf.STEP_RUNNING)
    await wf.set_step(session, project, wf.STEP_DECK_RENDER, wf.STEP_PENDING)


async def mark_export_running(session: AsyncSession, project: Project) -> None:
    await wf.set_export_status(session, project, wf.EXPORT_EXPORTING)
    project.export_error = None
    session.add(project)


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
    project.export_error = _clip(err)
    session.add(project)


async def infer_workflow_if_legacy_row(session: AsyncSession, project: Project) -> None:
    """旧库无显式工作流列时，用 pipeline + status 推导并写回（幂等）。"""
    from app.services.project_pipeline import compute_project_pipeline

    if project.text_status is not None:
        return
    pl = await compute_project_pipeline(session, project)
    st = (project.status or "").strip().lower()
    ds = (project.deck_status or "idle").strip().lower()

    if pl.get("outline"):
        project.text_status = STEP_SUCCESS
    elif st in ("queued", "structuring"):
        project.text_status = STEP_RUNNING
    elif st == "failed" and not pl.get("outline"):
        project.text_status = STEP_FAILED
    else:
        project.text_status = STEP_NOT_STARTED

    if pl.get("audio"):
        project.audio_status = STEP_SUCCESS
    elif st == "synthesizing":
        project.audio_status = STEP_RUNNING
    elif st == "failed" and pl.get("outline") and not pl.get("audio"):
        project.audio_status = STEP_FAILED
    else:
        project.audio_status = STEP_NOT_STARTED

    if pl.get("deck"):
        project.demo_status = STEP_SUCCESS
    elif ds == "generating":
        project.demo_status = STEP_RUNNING
    elif ds == "failed" and pl.get("outline"):
        project.demo_status = STEP_FAILED
    else:
        project.demo_status = STEP_NOT_STARTED

    if pl.get("video"):
        project.export_status = EXPORT_SUCCESS
        if not project.export_file_url and project.id is not None:
            from app.config import settings
            from app.mediautil import latest_export_media_url

            project.export_file_url = latest_export_media_url(
                int(project.id), settings.storage_root
            )
    elif pl.get("outline") and pl.get("audio") and pl.get("deck"):
        project.export_status = EXPORT_NOT_STARTED
    else:
        project.export_status = EXPORT_NOT_STARTED

    project.updated_at = utc_now()
    session.add(project)


async def backfill_legacy_workflow_columns(session: AsyncSession) -> None:
    res = await session.exec(select(Project))
    rows = list(res.all())
    for p in rows:
        if p.text_status is None:
            await infer_workflow_if_legacy_row(session, p)
    if rows:
        await session.commit()


def workflow_public_dict(project: Project) -> dict:
    """无 AsyncSession 时的兜底（仅 projects 列）。"""
    return {
        "id": project.id,
        "textStatus": project.text_status or STEP_NOT_STARTED,
        "audioStatus": project.audio_status or STEP_NOT_STARTED,
        "demoStatus": project.demo_status or STEP_NOT_STARTED,
        "exportStatus": project.export_status or EXPORT_NOT_STARTED,
        "textError": project.text_error,
        "audioError": project.audio_error,
        "demoError": project.demo_error,
        "exportError": project.export_error,
        "textResultUrl": project.text_result_url,
        "audioResultUrl": project.audio_result_url,
        "demoResultUrl": project.demo_result_url,
        "exportFileUrl": project.export_file_url,
        "createdAt": project.created_at.isoformat() if project.created_at else None,
        "updatedAt": project.updated_at.isoformat() if project.updated_at else None,
    }
