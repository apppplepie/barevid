"""
项目工作流 DAG（入口可并行）：text、deck_master 无依赖；
audio ← text；deck_render ← text + deck_master；export ← text + audio + deck_render。
步骤真相源在 workflow_* 表。
"""

from __future__ import annotations

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db.models import (
    Project,
    WorkflowArtifact,
    WorkflowExportRun,
    WorkflowRun,
    WorkflowStepRun,
    utc_now,
)

STEP_TEXT = "text"
STEP_AUDIO = "audio"
STEP_DECK_MASTER = "deck_master"
STEP_DECK_RENDER = "deck_render"
STEP_KEYS = (STEP_TEXT, STEP_AUDIO, STEP_DECK_MASTER, STEP_DECK_RENDER)

STEP_PENDING = "pending"
STEP_READY = "ready"
STEP_RUNNING = "running"
STEP_SUCCEEDED = "succeeded"
STEP_FAILED = "failed"
STEP_CANCELLED = "cancelled"

# 终态集合（用于判断步骤是否已结束）
_STEP_TERMINAL = {STEP_SUCCEEDED, STEP_FAILED, STEP_CANCELLED}

EXPORT_NOT_EXPORTED = "not_exported"
EXPORT_EXPORTING = "exporting"
EXPORT_SUCCESS = "export_success"
EXPORT_FAILED = "export_failed"

WORKFLOW_DEPENDENCIES: dict[str, tuple[str, ...]] = {
    STEP_TEXT: (),
    STEP_DECK_MASTER: (),
    STEP_AUDIO: (STEP_TEXT,),
    STEP_DECK_RENDER: (STEP_TEXT, STEP_DECK_MASTER),
}

# 某步被取消时，需要同步标为「已取消」的下游步骤（DAG 出边）
STEP_DOWNSTREAM: dict[str, tuple[str, ...]] = {
    STEP_TEXT: (STEP_AUDIO, STEP_DECK_RENDER),
    STEP_DECK_MASTER: (STEP_DECK_RENDER,),
    STEP_AUDIO: (),
    STEP_DECK_RENDER: (),
}

_STEP_NON_TERMINAL = {STEP_PENDING, STEP_READY, STEP_RUNNING}

EXPORT_DEPENDS_ON = (STEP_TEXT, STEP_AUDIO, STEP_DECK_RENDER)


def _clip(msg: str | None, n: int = 1800) -> str | None:
    if msg is None:
        return None
    t = str(msg).strip()
    if len(t) <= n:
        return t
    return t[: n - 3] + "..."


def _step_status(steps: dict[str, WorkflowStepRun], key: str) -> str:
    row = steps.get(key)
    return (row.status if row else STEP_PENDING) or STEP_PENDING


def _compute_overall(
    steps: dict[str, WorkflowStepRun], export_row: WorkflowExportRun
) -> str:
    st = {k: (steps[k].status if k in steps else STEP_PENDING) for k in STEP_KEYS}
    if st[STEP_TEXT] in (STEP_FAILED, STEP_CANCELLED):
        return "failed"
    if all(st[k] == STEP_SUCCEEDED for k in STEP_KEYS):
        if export_row.status == EXPORT_SUCCESS:
            return "success"
        if export_row.status == EXPORT_FAILED:
            return "partial"
        return "running"
    if any(st[k] in (STEP_FAILED, STEP_CANCELLED) for k in STEP_KEYS):
        return "partial"
    if any(st[k] == STEP_RUNNING for k in STEP_KEYS):
        return "running"
    if any(st[k] == STEP_READY for k in STEP_KEYS):
        return "running"
    if st[STEP_TEXT] == STEP_SUCCEEDED or st[STEP_DECK_MASTER] == STEP_SUCCEEDED:
        return "running"
    return "pending"


async def _get_run(session: AsyncSession, project_id: int) -> WorkflowRun | None:
    r = await session.exec(
        select(WorkflowRun).where(WorkflowRun.project_id == project_id)
    )
    return r.first()


async def get_workflow_text_step_status(
    session: AsyncSession, project: Project
) -> str | None:
    """当前 text 步骤在 workflow_step_runs 中的 status；无记录时 None。"""
    if project.id is None:
        return None
    run = await _get_run(session, int(project.id))
    if run is None or run.id is None:
        return None
    steps = await _load_steps_map(session, int(run.id))
    row = steps.get(STEP_TEXT)
    return row.status if row else None


async def _load_steps_map(
    session: AsyncSession, workflow_run_id: int
) -> dict[str, WorkflowStepRun]:
    res = await session.exec(
        select(WorkflowStepRun).where(
            WorkflowStepRun.workflow_run_id == workflow_run_id
        )
    )
    return {row.step_key: row for row in res.all()}


async def _get_export_row(
    session: AsyncSession, workflow_run_id: int
) -> WorkflowExportRun | None:
    r = await session.exec(
        select(WorkflowExportRun).where(
            WorkflowExportRun.workflow_run_id == workflow_run_id
        )
    )
    return r.first()


async def ensure_workflow_for_project(
    session: AsyncSession,
    project: Project,
    *,
    align_from_project: bool = False,
) -> WorkflowRun | None:
    """保证存在 workflow_run；新建时可选择从 projects 列对齐一步。"""
    if project.id is None:
        return None
    pid = int(project.id)
    existing = await _get_run(session, pid)
    if existing:
        return existing
    now = utc_now()
    run = WorkflowRun(
        project_id=pid,
        owner_user_id=int(project.owner_user_id),
        overall_status="pending",
        created_at=now,
        updated_at=now,
        finished_at=None,
    )
    session.add(run)
    await session.flush()
    for key in STEP_KEYS:
        session.add(
            WorkflowStepRun(
                workflow_run_id=int(run.id),
                step_key=key,
                status=STEP_PENDING,
                attempt_no=0,
                updated_at=now,
            )
        )
    session.add(
        WorkflowExportRun(
            workflow_run_id=int(run.id),
            status=EXPORT_NOT_EXPORTED,
            created_at=now,
            updated_at=now,
        )
    )
    await session.flush()
    if align_from_project:
        # 新库不再从 projects.* 对齐；仅计算 overall。
        steps = await _load_steps_map(session, int(run.id))
        ex = await _get_export_row(session, int(run.id))
        if ex:
            run.overall_status = _compute_overall(steps, ex)
        run.updated_at = utc_now()
        session.add(run)
    else:
        steps = await _load_steps_map(session, int(run.id))
        ex = await _get_export_row(session, int(run.id))
        if ex:
            run.overall_status = _compute_overall(steps, ex)
        run.updated_at = utc_now()
        session.add(run)
    return run


async def apply_overall_only(
    session: AsyncSession, run: WorkflowRun
) -> None:
    steps = await _load_steps_map(session, int(run.id))
    ex = await _get_export_row(session, int(run.id))
    if not ex:
        return
    run.overall_status = _compute_overall(steps, ex)
    run.updated_at = utc_now()
    if run.overall_status in ("success", "failed", "partial", "cancelled"):
        run.finished_at = run.finished_at or utc_now()
    session.add(run)


async def set_step(
    session: AsyncSession,
    project: Project,
    step_key: str,
    status: str,
    *,
    error_message: str | None = None,
    output_snapshot: str | None = None,
) -> None:
    run = await ensure_workflow_for_project(session, project, align_from_project=False)
    if run is None or run.id is None:
        return
    steps = await _load_steps_map(session, int(run.id))
    if step_key not in steps:
        return
    row = steps[step_key]
    now = utc_now()
    if status == STEP_READY and row.status != STEP_READY:
        row.ready_at = now
        row.error_message = None
    if status == STEP_RUNNING and row.status != STEP_RUNNING:
        row.attempt_no = int(row.attempt_no or 0) + 1
        row.started_at = now
        row.error_message = None
    if status == STEP_SUCCEEDED:
        row.error_message = None
    if status in (STEP_SUCCEEDED, STEP_FAILED, STEP_CANCELLED):
        row.finished_at = now
    if status == STEP_CANCELLED:
        row.cancelled_at = now
    if error_message is not None and status != STEP_SUCCEEDED:
        row.error_message = _clip(error_message)
    if output_snapshot is not None:
        row.output_snapshot = _clip(output_snapshot, 8000)
    row.status = status
    row.updated_at = now
    session.add(row)
    ex = await _get_export_row(session, int(run.id))
    if ex:
        await apply_overall_only(session, run)


async def cascade_cancel_dependent_steps(
    session: AsyncSession,
    project: Project,
    cancelled_step_key: str,
    *,
    error_message: str = "依赖上游已取消",
) -> None:
    """用户取消某步后，将其 DAG 下游中尚未结束的步骤标为 cancelled。"""
    downstream = STEP_DOWNSTREAM.get(cancelled_step_key)
    if not downstream or project.id is None:
        return
    run = await _get_run(session, int(project.id))
    if run is None or run.id is None:
        return
    steps = await _load_steps_map(session, int(run.id))
    msg = _clip(error_message) or "依赖上游已取消"
    for key in downstream:
        row = steps.get(key)
        if row is None or row.status not in _STEP_NON_TERMINAL:
            continue
        await set_step(session, project, key, STEP_CANCELLED, error_message=msg)


async def set_export_status(
    session: AsyncSession,
    project: Project,
    status: str,
    *,
    output_url: str | None = None,
    error_message: str | None = None,
) -> None:
    run = await ensure_workflow_for_project(session, project, align_from_project=False)
    if run is None or run.id is None:
        return
    ex = await _get_export_row(session, int(run.id))
    if not ex:
        return
    now = utc_now()
    ex.status = status
    ex.updated_at = now
    if status == EXPORT_EXPORTING:
        ex.started_at = now
        ex.error_message = None
    if status == EXPORT_SUCCESS:
        ex.finished_at = now
        ex.error_message = None
        if output_url:
            ex.output_file_url = output_url.strip() or None
    if status == EXPORT_FAILED:
        ex.finished_at = now
        ex.error_message = _clip(error_message)
    session.add(ex)
    _ = project
    await apply_overall_only(session, run)


async def record_export_artifact(
    session: AsyncSession, project_id: int, file_url: str
) -> None:
    u = (file_url or "").strip()
    if not u:
        return
    run = await _get_run(session, project_id)
    if run is None or run.id is None:
        return
    session.add(
        WorkflowArtifact(
            workflow_run_id=int(run.id),
            step_key="export",
            artifact_type="export_mp4",
            file_url=u,
            created_at=utc_now(),
        )
    )


async def notify_deck_master_success_if_pending(
    session: AsyncSession, project_id: int
) -> None:
    """单页生成路径在 ensure_style_base 成功后调用，将母版标为 succeeded。"""
    project = await session.get(Project, project_id)
    if project is None:
        return
    run = await _get_run(session, project_id)
    if run is None or run.id is None:
        return
    steps = await _load_steps_map(session, int(run.id))
    row = steps.get(STEP_DECK_MASTER)
    if row is None or row.status == STEP_SUCCEEDED:
        return
    await set_step(session, project, STEP_DECK_MASTER, STEP_SUCCEEDED)
    # deck_master 成功后：若 text 也已 succeeded，则 deck_render 依赖已满足 → ready
    text_row = steps.get(STEP_TEXT)
    dr_row = steps.get(STEP_DECK_RENDER)
    if (
        text_row
        and text_row.status == STEP_SUCCEEDED
        and dr_row
        and dr_row.status == STEP_PENDING
    ):
        await set_step(session, project, STEP_DECK_RENDER, STEP_READY)


async def after_text_success_parallel_ready(
    session: AsyncSession, project: Project
) -> None:
    """文本成功：audio 依赖已满足 → ready；deck_render 还需 deck_master，按实际判断。"""
    await set_step(session, project, STEP_TEXT, STEP_SUCCEEDED)
    # audio 仅依赖 text，text 已 succeeded → ready
    await set_step(session, project, STEP_AUDIO, STEP_READY)
    # deck_render 依赖 text + deck_master；若 deck_master 也已 succeeded → ready，否则仍 pending
    run = await _get_run(session, int(project.id) if project.id else -1)
    if run and run.id:
        steps = await _load_steps_map(session, int(run.id))
        dm = steps.get(STEP_DECK_MASTER)
        if dm and dm.status == STEP_SUCCEEDED:
            await set_step(session, project, STEP_DECK_RENDER, STEP_READY)
        else:
            await set_step(session, project, STEP_DECK_RENDER, STEP_PENDING)


async def reset_downstream_for_text_retry(
    session: AsyncSession, project: Project
) -> None:
    run = await _get_run(session, int(project.id) if project.id else -1)
    if run is None:
        await ensure_workflow_for_project(session, project, align_from_project=True)
        run = await _get_run(session, int(project.id))
    if run is None or run.id is None:
        return
    steps = await _load_steps_map(session, int(run.id))
    now = utc_now()
    for key in (STEP_AUDIO, STEP_DECK_RENDER):
        if key in steps:
            row = steps[key]
            row.status = STEP_PENDING
            row.error_message = None
            row.started_at = None
            row.ready_at = None
            row.finished_at = None
            row.cancelled_at = None
            row.updated_at = now
            session.add(row)
    ex = await _get_export_row(session, int(run.id))
    if ex:
        ex.status = EXPORT_NOT_EXPORTED
        ex.output_file_url = None
        ex.error_message = None
        ex.started_at = None
        ex.finished_at = None
        ex.updated_at = now
        session.add(ex)
    # 旧版 projects 表上的 *_error / *_result_url 已废弃；状态以 workflow_* 表为准。
    await apply_overall_only(session, run)


async def on_deck_pages_aggregate(
    session: AsyncSession,
    project_id: int,
    deck_done: bool,
    any_failed: bool,
    *,
    failed_message: str | None = None,
    deck_user_cancelled: bool = False,
    deck_generating: bool = False,
) -> None:
    """根据所有 page 的 deck 聚合结果更新 deck_render。"""
    project = await session.get(Project, project_id)
    if project is None:
        return
    run = await _get_run(session, project_id)
    if run is None:
        return
    steps = await _load_steps_map(session, int(run.id))
    if steps.get(STEP_TEXT) and steps[STEP_TEXT].status != STEP_SUCCEEDED:
        return
    if steps.get(STEP_DECK_MASTER) and steps[STEP_DECK_MASTER].status != STEP_SUCCEEDED:
        return
    if any_failed:
        await set_step(
            session,
            project,
            STEP_DECK_RENDER,
            STEP_FAILED,
            error_message=failed_message or "部分演示页生成失败",
        )
    elif deck_done:
        await set_step(session, project, STEP_DECK_RENDER, STEP_SUCCEEDED)
    elif deck_user_cancelled:
        st = steps.get(STEP_DECK_RENDER)
        if st and st.status in (STEP_PENDING, STEP_READY, STEP_RUNNING):
            await set_step(
                session,
                project,
                STEP_DECK_RENDER,
                STEP_CANCELLED,
                error_message=failed_message or "用户取消场景生成",
            )
    elif deck_generating:
        st = steps.get(STEP_DECK_RENDER)
        if st and st.status in (STEP_PENDING, STEP_READY):
            await set_step(session, project, STEP_DECK_RENDER, STEP_RUNNING)


async def workflow_public_dict_async(
    session: AsyncSession, project: Project
) -> dict:
    """API 用：含母版/渲染分步 + 兼容原 demo/export 字段。"""
    from app.services.workflow_state import workflow_public_dict as legacy

    base = legacy(project)
    run = await _get_run(session, int(project.id) if project.id else -1)
    if run is None or run.id is None:
        base["textStatus"] = STEP_PENDING
        base["audioStatus"] = STEP_PENDING
        base["demoStatus"] = STEP_PENDING
        base["deckMasterStatus"] = STEP_PENDING
        base["deckRenderStatus"] = STEP_PENDING
        base["exportStatus"] = STEP_PENDING
        base["exportWorkflowStatus"] = EXPORT_NOT_EXPORTED
        base["overallWorkflowStatus"] = None
        base["workflowRunId"] = None
        return base
    steps = await _load_steps_map(session, int(run.id))
    ex = await _get_export_row(session, int(run.id))
    base["textStatus"] = _step_status(steps, STEP_TEXT)
    base["audioStatus"] = _step_status(steps, STEP_AUDIO)
    base["demoStatus"] = _step_status(steps, STEP_DECK_RENDER)
    base["deckMasterStatus"] = _step_status(steps, STEP_DECK_MASTER)
    base["deckRenderStatus"] = _step_status(steps, STEP_DECK_RENDER)
    base["exportStatus"] = (
        EXPORT_SUCCESS
        if ex and ex.status == EXPORT_SUCCESS
        else EXPORT_FAILED
        if ex and ex.status == EXPORT_FAILED
        else EXPORT_EXPORTING
        if ex and ex.status == EXPORT_EXPORTING
        else STEP_PENDING
    )
    base["exportWorkflowStatus"] = ex.status if ex else EXPORT_NOT_EXPORTED
    base["overallWorkflowStatus"] = run.overall_status
    base["workflowRunId"] = run.id
    base["deckMasterError"] = (
        (steps[STEP_DECK_MASTER].error_message or "").strip()
        if STEP_DECK_MASTER in steps
        else None
    )
    base["deckRenderError"] = (
        (steps[STEP_DECK_RENDER].error_message or "").strip()
        if STEP_DECK_RENDER in steps
        else None
    )
    return base


async def backfill_workflow_for_all_projects(session: AsyncSession) -> None:
    res = await session.exec(select(Project))
    projects = list(res.all())
    for p in projects:
        if p.id is None:
            continue
        existing = await _get_run(session, int(p.id))
        if existing:
            continue
        await ensure_workflow_for_project(session, p, align_from_project=True)
    if projects:
        await session.commit()
