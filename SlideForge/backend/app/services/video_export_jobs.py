"""视频导出异步任务：MySQL/SQLite 队列表 + worker 领取/回传。"""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import update
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db.models import Project, VideoExportJob, utc_now
from app.services.workflow_state import mark_export_failed, mark_export_success


def _clip(msg: str | None, n: int = 4000) -> str | None:
    if msg is None:
        return None
    t = str(msg).strip()
    if len(t) <= n:
        return t
    return t[: n - 3] + "..."


def video_export_job_public_dict(
    job: VideoExportJob | None,
    *,
    success_output_url: str | None = None,
) -> dict[str, Any] | None:
    """前端轮询用：返回该项目最新一条导出任务（含 queued / running / succeeded / failed）。"""
    if job is None or job.id is None:
        return None
    st = (job.status or "").strip().lower()
    if st not in ("queued", "running", "succeeded", "failed"):
        return None
    wid = (job.worker_id or "").strip() or None
    out: dict[str, Any] = {
        "job_id": int(job.id),
        "status": st,
        "worker_id": wid,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }
    if st == "failed":
        em = (job.error_message or "").strip()
        out["error_message"] = em or None
    if st == "succeeded" and (success_output_url or "").strip():
        out["output_url"] = success_output_url.strip()
    return out


async def find_active_video_export_job(
    session: AsyncSession, project_id: int
) -> VideoExportJob | None:
    stmt = (
        select(VideoExportJob)
        .where(VideoExportJob.project_id == project_id)
        .where(VideoExportJob.status.in_(("queued", "running")))
        .order_by(VideoExportJob.id.desc())
        .limit(1)
    )
    return (await session.exec(stmt)).first()


async def get_latest_video_export_job(
    session: AsyncSession, project_id: int
) -> VideoExportJob | None:
    """该项目 id 最大的一条任务（用于前端展示队列/结果）。"""
    stmt = (
        select(VideoExportJob)
        .where(VideoExportJob.project_id == project_id)
        .order_by(VideoExportJob.id.desc())
        .limit(1)
    )
    return (await session.exec(stmt)).first()


async def list_recent_video_export_jobs(
    session: AsyncSession,
    project_id: int,
    *,
    limit: int = 20,
) -> list[VideoExportJob]:
    n = max(1, min(100, int(limit)))
    stmt = (
        select(VideoExportJob)
        .where(VideoExportJob.project_id == project_id)
        .order_by(VideoExportJob.id.desc())
        .limit(n)
    )
    return (await session.exec(stmt)).all()


async def abort_stale_project_export_jobs(
    session: AsyncSession, project_id: int, message: str
) -> None:
    """将该项目下未完成的导出任务标为失败（强制重导、删文件前调用，避免 worker 仍消费旧任务）。"""
    now = utc_now()
    msg = _clip(message) or "已取消"
    await session.execute(
        update(VideoExportJob)
        .where(VideoExportJob.project_id == project_id)
        .where(VideoExportJob.status.in_(("queued", "running")))
        .values(
            status="failed",
            error_message=msg,
            finished_at=now,
            updated_at=now,
            request_authorization=None,
        )
    )


async def enqueue_video_export_job(
    session: AsyncSession,
    project_id: int,
    width: int,
    height: int,
    authorization_header: str | None,
) -> VideoExportJob:
    now = utc_now()
    job = VideoExportJob(
        project_id=project_id,
        status="queued",
        width=int(width),
        height=int(height),
        request_authorization=(authorization_header or "").strip() or None,
        created_at=now,
        updated_at=now,
    )
    session.add(job)
    await session.flush()
    await session.refresh(job)
    return job


async def recycle_stale_running_video_export_jobs(
    session: AsyncSession,
    *,
    stale_after_seconds: int,
) -> None:
    timeout_seconds = max(60, int(stale_after_seconds))
    now = utc_now()
    cutoff = now - timedelta(seconds=timeout_seconds)
    stale_reason = _clip(
        f"worker stale timeout after {timeout_seconds} seconds; job recycled"
    )
    res = await session.exec(
        select(VideoExportJob)
        .where(VideoExportJob.status == "running")
        .where(
            (VideoExportJob.started_at.is_(None) & (VideoExportJob.updated_at < cutoff))
            | (VideoExportJob.started_at < cutoff)
        )
    )
    stale_jobs = res.all()
    if not stale_jobs:
        return
    for job in stale_jobs:
        project = await session.get(Project, job.project_id)
        if project is not None:
            await mark_export_failed(session, project, stale_reason or "导出超时")
        job.status = "failed"
        job.error_message = stale_reason
        job.finished_at = now
        job.updated_at = now
        job.request_authorization = None
        session.add(job)
    await session.commit()


async def claim_next_video_export_job(
    session: AsyncSession,
    worker_label: str,
    *,
    stale_after_seconds: int = 7200,
) -> VideoExportJob | None:
    """全局 FIFO 领取：不按 worker_id / 队列名过滤。

    ``worker_label`` 仅在成功将任务从 queued 改为 running 时写入 ``VideoExportJob.worker_id``，
    用于排查与统计，**不参与**「哪台 worker 能领哪条任务」的调度。
    """
    await recycle_stale_running_video_export_jobs(
        session,
        stale_after_seconds=stale_after_seconds,
    )
    res = await session.exec(
        select(VideoExportJob)
        .where(VideoExportJob.status == "queued")
        .order_by(VideoExportJob.id.asc())
        .limit(1)
    )
    job = res.first()
    if job is None or job.id is None:
        return None
    wid = int(job.id)
    label = (worker_label or "worker").strip()[:128] or "worker"
    now = utc_now()
    r = await session.execute(
        update(VideoExportJob)
        .where(VideoExportJob.id == wid, VideoExportJob.status == "queued")
        .values(
            status="running",
            worker_id=label,
            started_at=now,
            updated_at=now,
        )
    )
    await session.commit()
    if r.rowcount != 1:
        return None
    return await session.get(VideoExportJob, wid)


async def complete_video_export_job(
    session: AsyncSession,
    job_id: int,
    output_path: Path,
    storage_root: Path,
) -> str | None:
    job = await session.get(VideoExportJob, job_id)
    if job is None:
        raise ValueError("任务不存在")
    await session.refresh(job)
    if job.status != "running":
        # 用户取消等导致任务已非 running：不采纳成片、不写 workflow 成功
        try:
            if output_path.exists():
                output_path.unlink()
        except OSError:
            pass
        return None
    project = await session.get(Project, job.project_id)
    if project is None:
        raise ValueError("项目不存在")

    rel = output_path.resolve().relative_to(storage_root.resolve())
    out_url = f"/media/{rel.as_posix()}"
    await mark_export_success(session, project, out_url)

    now = utc_now()
    job.status = "succeeded"
    job.error_message = None
    job.finished_at = now
    job.updated_at = now
    job.request_authorization = None
    session.add(job)
    project.updated_at = now
    session.add(project)
    await session.commit()
    return out_url


async def fail_video_export_job(
    session: AsyncSession, job_id: int, err: str
) -> None:
    job = await session.get(VideoExportJob, job_id)
    if job is None:
        raise ValueError("任务不存在")
    await session.refresh(job)
    if job.status != "running":
        # 已取消或已结束，幂等忽略 worker 回调
        return
    project = await session.get(Project, job.project_id)
    if project is None:
        raise ValueError("项目不存在")

    detail = _clip(err) or "导出失败"
    await mark_export_failed(session, project, detail)

    now = utc_now()
    job.status = "failed"
    job.error_message = detail
    job.finished_at = now
    job.updated_at = now
    job.request_authorization = None
    session.add(job)
    await session.commit()
