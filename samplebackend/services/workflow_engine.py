"""
带依赖的项目工作流：text 与 deck_master 互相独立；audio 依赖 text；
deck_render 依赖 text 与 deck_master；export 依赖 text / audio / deck_render。
步骤真相源在 workflow_* 表；projects.text_status 等与前端兼容字段由本模块回写。
"""

from __future__ import annotations

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db.models import (
    Project,
    ProjectStyle,
    WorkflowArtifact,
    WorkflowExportRun,
    WorkflowRun,
    WorkflowStepRun,
    utc_now,
)
from app.services.project_meta import merge_deck_master_source_id

STEP_TEXT = "text"
STEP_AUDIO = "audio"
STEP_DECK_MASTER = "deck_master"
STEP_DECK_RENDER = "deck_render"
STEP_KEYS = (STEP_TEXT, STEP_AUDIO, STEP_DECK_MASTER, STEP_DECK_RENDER)

STEP_PENDING = "pending"
STEP_RUNNING = "running"
STEP_SUCCESS = "success"
STEP_FAILED = "failed"

EXPORT_NOT_EXPORTED = "not_exported"
EXPORT_EXPORTING = "exporting"
EXPORT_SUCCESS = "export_success"
EXPORT_FAILED = "export_failed"

# 与 workflow_state 中项目列一致
PROJ_NOT_STARTED = "not_started"
PROJ_RUNNING = "running"
PROJ_SUCCESS = "success"
PROJ_FAILED = "failed"

WORKFLOW_DEPENDENCIES: dict[str, tuple[str, ...]] = {
    STEP_TEXT: (),
    STEP_AUDIO: (STEP_TEXT,),
    STEP_DECK_MASTER: (),
    STEP_DECK_RENDER: (STEP_DECK_MASTER,),
}

EXPORT_DEPENDS_ON = (STEP_TEXT, STEP_AUDIO, STEP_DECK_RENDER)


def _clip(msg: str | None, n: int = 4000) -> str | None:
    if msg is None:
        return None
    t = str(msg).strip()
    if len(t) <= n:
        return t
    return t[: n - 3] + "..."


def _project_col_to_step(status: str | None) -> str:
    v = (status or PROJ_NOT_STARTED).strip().lower()
    if v == PROJ_NOT_STARTED:
        return STEP_PENDING
    if v in (STEP_RUNNING, STEP_SUCCESS, STEP_FAILED):
        return v
    return STEP_PENDING


def _step_to_project_col(status: str) -> str:
    if status == STEP_PENDING:
        return PROJ_NOT_STARTED
    return status


def _project_export_to_run(status: str | None) -> str:
    v = (status or PROJ_NOT_STARTED).strip().lower()
    if v == PROJ_NOT_STARTED:
        return EXPORT_NOT_EXPORTED
    if v == PROJ_RUNNING:
        return EXPORT_EXPORTING
    if v == PROJ_SUCCESS:
        return EXPORT_SUCCESS
    if v == PROJ_FAILED:
        return EXPORT_FAILED
    return EXPORT_NOT_EXPORTED


def _run_export_to_project_col(status: str) -> str:
    return {
        EXPORT_NOT_EXPORTED: PROJ_NOT_STARTED,
        EXPORT_EXPORTING: PROJ_RUNNING,
        EXPORT_SUCCESS: PROJ_SUCCESS,
        EXPORT_FAILED: PROJ_FAILED,
    }.get(status, PROJ_NOT_STARTED)


def _split_demo_for_mirror(project: Project) -> tuple[str, str]:
    """从 projects.demo_status + deck_status 粗拆母版 / 渲染，供历史数据对齐。"""
    demo = (project.demo_status or PROJ_NOT_STARTED).strip().lower()
    dks = (project.deck_status or "idle").strip().lower()
    if demo == PROJ_SUCCESS:
        return STEP_SUCCESS, STEP_SUCCESS
    if demo == PROJ_FAILED:
        return STEP_FAILED, STEP_FAILED
    if demo == PROJ_RUNNING:
        if dks == "generating":
            return STEP_SUCCESS, STEP_RUNNING
        return STEP_RUNNING, STEP_PENDING
    return STEP_PENDING, STEP_PENDING


def merge_deck_master_status_with_style_storage(
    step_status: str | None, style_ready: bool
) -> str:
    """
    对外 JSON 中的 deckMasterStatus：以 project_styles 中「当前 preset/hint 下有效母版正文」
    判定是否完成；进行中/失败仍以 workflow_step_runs.deck_master 为准。

    - 无有效正文且步骤非 running → pending（避免「步骤已 success 但尚未写入 style_prompt_text」的错位）
    - 生成中步骤为 running、正文仍空 → running
    - 有有效正文 → success（步骤表 pending 时也可与复制母版等场景对齐）
    """
    st = (step_status or STEP_PENDING).strip().lower()
    if st == STEP_FAILED:
        return STEP_FAILED
    if st == STEP_RUNNING:
        return STEP_RUNNING
    if style_ready:
        return STEP_SUCCESS
    return STEP_PENDING


def _aggregate_demo_status(master: str, render: str) -> tuple[str, str | None]:
    """返回 (project.demo_status, demo_error 提示用 key 或 None)。母版/场景页与文案步骤独立。"""
    if master == STEP_FAILED:
        return PROJ_FAILED, "deck_master"
    if render == STEP_FAILED:
        return PROJ_FAILED, "deck_render"
    if master == STEP_RUNNING or render == STEP_RUNNING:
        return PROJ_RUNNING, None
    # 母版已就绪但尚未启动批量场景页：聚合为未开始，避免与「等待用户确认风格再开跑」混淆
    if master == STEP_SUCCESS and render == STEP_PENDING:
        return PROJ_NOT_STARTED, None
    if master == STEP_PENDING and render == STEP_PENDING:
        return PROJ_NOT_STARTED, None
    if master == STEP_SUCCESS and render == STEP_SUCCESS:
        return PROJ_SUCCESS, None
    return PROJ_NOT_STARTED, None


def _compute_overall(
    steps: dict[str, WorkflowStepRun], export_row: WorkflowExportRun
) -> str:
    st = {k: (steps[k].status if k in steps else STEP_PENDING) for k in STEP_KEYS}
    if st[STEP_TEXT] == STEP_FAILED:
        return "failed"
    if all(st[k] == STEP_SUCCESS for k in STEP_KEYS):
        if export_row.status == EXPORT_SUCCESS:
            return "success"
        if export_row.status == EXPORT_FAILED:
            return "partial"
        return "running"
    if any(st[k] == STEP_FAILED for k in STEP_KEYS):
        return "partial"
    if any(st[k] == STEP_RUNNING for k in STEP_KEYS):
        return "running"
    if st[STEP_TEXT] == STEP_SUCCESS:
        return "running"
    if st[STEP_DECK_MASTER] != STEP_PENDING or st[STEP_DECK_RENDER] != STEP_PENDING:
        return "running"
    return "pending"


async def _get_run(session: AsyncSession, project_id: int) -> WorkflowRun | None:
    r = await session.exec(
        select(WorkflowRun).where(WorkflowRun.project_id == project_id)
    )
    return r.first()


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
        await mirror_from_project_columns(session, project, run)
    else:
        steps = await _load_steps_map(session, int(run.id))
        ex = await _get_export_row(session, int(run.id))
        if ex:
            run.overall_status = _compute_overall(steps, ex)
        run.updated_at = utc_now()
        session.add(run)
    return run


async def mirror_from_project_columns(
    session: AsyncSession, project: Project, run: WorkflowRun
) -> None:
    steps = await _load_steps_map(session, int(run.id))
    ex = await _get_export_row(session, int(run.id))
    if not ex:
        return
    for key, col in (
        (STEP_TEXT, project.text_status),
        (STEP_AUDIO, project.audio_status),
    ):
        if key in steps:
            row = steps[key]
            row.status = _project_col_to_step(col)
            row.updated_at = utc_now()
            session.add(row)
    dm, dr = _split_demo_for_mirror(project)
    if STEP_DECK_MASTER in steps:
        steps[STEP_DECK_MASTER].status = dm
        steps[STEP_DECK_MASTER].updated_at = utc_now()
        session.add(steps[STEP_DECK_MASTER])
    if STEP_DECK_RENDER in steps:
        steps[STEP_DECK_RENDER].status = dr
        steps[STEP_DECK_RENDER].updated_at = utc_now()
        session.add(steps[STEP_DECK_RENDER])
    ex.status = _project_export_to_run(project.export_status)
    ex.output_file_url = (project.export_file_url or "").strip() or None
    ex.updated_at = utc_now()
    session.add(ex)
    run.overall_status = _compute_overall(steps, ex)
    run.updated_at = utc_now()
    session.add(run)


async def apply_denormalized_project_fields(
    session: AsyncSession, project: Project, run: WorkflowRun
) -> None:
    """根据 step 行回写 projects 上兼容字段与 overall。"""
    steps = await _load_steps_map(session, int(run.id))
    ex = await _get_export_row(session, int(run.id))
    if not ex:
        return
    project.text_status = _step_to_project_col(steps[STEP_TEXT].status)
    if steps[STEP_TEXT].status == STEP_SUCCESS:
        project.text_error = None
    elif steps[STEP_TEXT].status == STEP_FAILED and steps[STEP_TEXT].error_message:
        project.text_error = (steps[STEP_TEXT].error_message or "")[:4000]
    project.audio_status = _step_to_project_col(steps[STEP_AUDIO].status)
    if steps[STEP_AUDIO].status == STEP_SUCCESS:
        project.audio_error = None
    elif steps[STEP_AUDIO].status == STEP_FAILED and steps[STEP_AUDIO].error_message:
        project.audio_error = (steps[STEP_AUDIO].error_message or "")[:4000]
    agg, err_key = _aggregate_demo_status(
        steps[STEP_DECK_MASTER].status,
        steps[STEP_DECK_RENDER].status,
    )
    project.demo_status = agg
    if agg == PROJ_FAILED:
        em = None
        if err_key == "deck_master":
            em = steps[STEP_DECK_MASTER].error_message
        elif err_key == "deck_render":
            em = steps[STEP_DECK_RENDER].error_message
        if em:
            project.demo_error = em[:4000]
    elif agg == PROJ_SUCCESS:
        project.demo_error = None
    project.export_status = _run_export_to_project_col(ex.status)
    if ex.status == EXPORT_SUCCESS:
        project.export_file_url = ex.output_file_url
    elif ex.status == EXPORT_NOT_EXPORTED:
        project.export_file_url = None
    run.overall_status = _compute_overall(steps, ex)
    run.updated_at = utc_now()
    if run.overall_status in ("success", "failed", "partial"):
        run.finished_at = run.finished_at or utc_now()
    session.add(run)
    session.add(project)


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
    if status == STEP_RUNNING and row.status != STEP_RUNNING:
        row.attempt_no = int(row.attempt_no or 0) + 1
        row.started_at = now
        row.error_message = None
    if status == STEP_SUCCESS:
        row.error_message = None
    if status in (STEP_SUCCESS, STEP_FAILED):
        row.finished_at = now
    if error_message is not None and status != STEP_SUCCESS:
        row.error_message = _clip(error_message)
    if output_snapshot is not None:
        row.output_snapshot = _clip(output_snapshot, 8000)
    row.status = status
    row.updated_at = now
    session.add(row)
    if status == STEP_FAILED:
        project.pipeline_auto_advance = False
        session.add(project)
    ex = await _get_export_row(session, int(run.id))
    if ex:
        await apply_denormalized_project_fields(session, project, run)


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
        project.pipeline_auto_advance = False
        session.add(project)
    session.add(ex)
    await apply_denormalized_project_fields(session, project, run)


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
    """单页生成路径在 ensure_style_base 成功后调用，将母版标为 success。"""
    project = await session.get(Project, project_id)
    if project is None:
        return
    run = await _get_run(session, project_id)
    if run is None or run.id is None:
        return
    steps = await _load_steps_map(session, int(run.id))
    row = steps.get(STEP_DECK_MASTER)
    if row is None or row.status == STEP_SUCCESS:
        return
    await set_step(session, project, STEP_DECK_MASTER, STEP_SUCCESS)


async def after_text_success_parallel_ready(
    session: AsyncSession, project: Project
) -> None:
    """文本成功：启动配音；母版由与结构化并行的任务写 SUCCESS，或由本处收尾（复用母版时）。"""
    from app.db.models import ProjectStyle
    from app.services.deck import deck_style_ready_from_storage

    await set_step(session, project, STEP_TEXT, STEP_SUCCESS)
    await set_step(session, project, STEP_AUDIO, STEP_RUNNING)
    await set_step(session, project, STEP_DECK_RENDER, STEP_PENDING)
    if project.id is None:
        return
    pid = int(project.id)
    run = await _get_run(session, pid)
    if run is None or run.id is None:
        return
    steps = await _load_steps_map(session, int(run.id))
    dm = steps.get(STEP_DECK_MASTER)
    if dm is None or dm.status != STEP_RUNNING:
        return
    st_res = await session.exec(select(ProjectStyle).where(ProjectStyle.project_id == pid))
    row = st_res.first()
    ready, _, _ = deck_style_ready_from_storage(project, row)
    if ready:
        await notify_deck_master_success_if_pending(session, pid)


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
            row.finished_at = None
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
    project.audio_error = None
    project.demo_error = None
    project.export_error = None
    project.audio_result_url = None
    project.demo_result_url = None
    project.export_file_url = None
    await apply_denormalized_project_fields(session, project, run)


async def on_deck_pages_aggregate(
    session: AsyncSession,
    project_id: int,
    deck_done: bool,
    any_failed: bool,
    *,
    failed_message: str | None = None,
) -> None:
    """根据所有 page 的 deck 聚合结果更新 deck_render。"""
    project = await session.get(Project, project_id)
    if project is None:
        return
    run = await _get_run(session, project_id)
    if run is None:
        return
    steps = await _load_steps_map(session, int(run.id))
    if steps.get(STEP_DECK_MASTER) and steps[STEP_DECK_MASTER].status != STEP_SUCCESS:
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
        await set_step(session, project, STEP_DECK_RENDER, STEP_SUCCESS)
    else:
        await session.refresh(project)
        ds = (project.deck_status or "idle").strip().lower()
        st = steps.get(STEP_DECK_RENDER)
        if st is None:
            return
        # 母版更新后旧页已失效但库中仍可能为 success，须退回 pending，避免「场景页」误显示完成。
        if st.status == STEP_SUCCESS:
            await set_step(session, project, STEP_DECK_RENDER, STEP_PENDING)
        elif ds == "generating":
            # 确有页面在生成时才标 running；避免「全 idle」时误从 pending 抬成 running。
            if st.status in (STEP_PENDING, STEP_FAILED):
                await set_step(session, project, STEP_DECK_RENDER, STEP_RUNNING)
        elif st.status == STEP_RUNNING:
            await set_step(session, project, STEP_DECK_RENDER, STEP_PENDING)


async def workflow_public_dict_async(
    session: AsyncSession,
    project: Project,
    *,
    style_row: ProjectStyle | None = None,
) -> dict:
    """API 用：含母版/渲染分步 + 兼容原 demo/export 字段。"""
    from app.services.deck import deck_style_ready_from_storage
    from app.services.workflow_state import workflow_public_dict as legacy

    base = legacy(project)
    run = await _get_run(session, int(project.id) if project.id else -1)
    if run is None or run.id is None:
        base["deckMasterStatus"] = _project_col_to_step(project.demo_status)
        base["deckRenderStatus"] = _project_col_to_step(project.demo_status)
        base["overallWorkflowStatus"] = None
        base["workflowRunId"] = None
        return base
    steps = await _load_steps_map(session, int(run.id))
    ex = await _get_export_row(session, int(run.id))
    dm_step = steps.get(STEP_DECK_MASTER)
    dm_raw = dm_step.status if dm_step else STEP_PENDING
    row = style_row
    if row is None and project.id is not None:
        st_res = await session.exec(
            select(ProjectStyle).where(ProjectStyle.project_id == int(project.id))
        )
        row = st_res.first()
    style_ready, _, _ = deck_style_ready_from_storage(project, row)
    merged_dm = merge_deck_master_status_with_style_storage(dm_raw, style_ready)
    base["deckMasterStatus"] = merged_dm
    dr_step = steps.get(STEP_DECK_RENDER)
    base["deckRenderStatus"] = dr_step.status if dr_step else STEP_PENDING
    base["exportWorkflowStatus"] = ex.status if ex else EXPORT_NOT_EXPORTED
    base["overallWorkflowStatus"] = run.overall_status
    base["workflowRunId"] = run.id
    base["deckMasterError"] = (
        (steps[STEP_DECK_MASTER].error_message or "").strip()
        if merged_dm == STEP_FAILED and STEP_DECK_MASTER in steps
        else None
    )
    base["deckRenderError"] = (
        (steps[STEP_DECK_RENDER].error_message or "").strip()
        if STEP_DECK_RENDER in steps
        else None
    )
    return base


async def _reset_step_row_to_pending(
    session: AsyncSession,
    steps: dict[str, WorkflowStepRun],
    step_key: str,
) -> None:
    row = steps.get(step_key)
    if row is None:
        return
    now = utc_now()
    row.status = STEP_PENDING
    row.error_message = None
    row.started_at = None
    row.finished_at = None
    row.updated_at = now
    session.add(row)


async def _reset_export_row_to_pending(
    session: AsyncSession, workflow_run_id: int
) -> None:
    ex = await _get_export_row(session, workflow_run_id)
    if not ex:
        return
    now = utc_now()
    ex.status = EXPORT_NOT_EXPORTED
    ex.output_file_url = None
    ex.error_message = None
    ex.started_at = None
    ex.finished_at = None
    ex.updated_at = now
    session.add(ex)


async def user_reopen_success_step(
    session: AsyncSession,
    project: Project,
    ui_step: str,
) -> None:
    """
    将指定步骤及其下游全部回退为未开始（pending），并清空导出与相关成品字段。
    强制 pipeline_auto_advance=False，便于手动表单继续。
    """
    key = (ui_step or "").strip().lower()
    allowed = {"text", "audio", "pages", "deck_master", "deck_render", "export"}
    if key not in allowed:
        raise ValueError(f"不支持的步骤：{ui_step}")

    run = await ensure_workflow_for_project(session, project, align_from_project=False)
    if run is None or run.id is None:
        raise ValueError("工作流未初始化")
    steps = await _load_steps_map(session, int(run.id))
    ex = await _get_export_row(session, int(run.id))
    if STEP_TEXT not in steps or STEP_AUDIO not in steps:
        raise ValueError("工作流步骤不完整")

    if key == "export":
        if ex is None:
            raise ValueError("导出步骤不存在，无法回退")
        keys_to_reset: list[str] = []
    elif key == "text":
        if steps[STEP_TEXT].status == STEP_PENDING:
            raise ValueError("文案步骤当前未开始，无需回退")
        # 母版与文案独立：回退文案不重置 deck_master
        keys_to_reset = [STEP_TEXT, STEP_AUDIO, STEP_DECK_RENDER]
    elif key == "audio":
        if steps[STEP_AUDIO].status == STEP_PENDING:
            raise ValueError("配音步骤当前未开始，无需回退")
        # 与前端 WorkflowPanel.collectRevertImpactIds 一致：audio 下游仅 export（母版/场景页与文案并行，不随配音回退）
        keys_to_reset = [STEP_AUDIO]
    elif key == "deck_master":
        if steps[STEP_DECK_MASTER].status == STEP_PENDING:
            raise ValueError("母版步骤当前未开始，无需回退")
        keys_to_reset = [STEP_DECK_MASTER, STEP_DECK_RENDER]
    elif key == "deck_render":
        if steps[STEP_DECK_RENDER].status == STEP_PENDING:
            raise ValueError("场景页步骤当前未开始，无需回退")
        keys_to_reset = [STEP_DECK_RENDER]
    else:
        # pages：合并「场景」里程碑，任一子步已执行即可回退
        if (
            steps[STEP_DECK_MASTER].status == STEP_PENDING
            and steps[STEP_DECK_RENDER].status == STEP_PENDING
        ):
            raise ValueError("场景步骤当前未开始，无需回退")
        keys_to_reset = [STEP_DECK_MASTER, STEP_DECK_RENDER]

    project.pipeline_auto_advance = False
    if key == "text":
        project.manual_outline_confirmed = False

    for sk in keys_to_reset:
        await _reset_step_row_to_pending(session, steps, sk)

    if key != "export" or ex is not None:
        await _reset_export_row_to_pending(session, int(run.id))
        project.export_error = None
        project.export_file_url = None
        project.video_exported_at = None

    if STEP_TEXT in keys_to_reset:
        project.text_error = None
    if STEP_AUDIO in keys_to_reset:
        project.audio_error = None
        project.audio_result_url = None
    if STEP_DECK_MASTER in keys_to_reset or STEP_DECK_RENDER in keys_to_reset:
        project.demo_error = None
        project.demo_result_url = None

    # 回退母版或合并「场景」回退后，清除 description 中的复用来源，便于在本项目重新生成母版
    if key in ("deck_master", "pages"):
        project.description = merge_deck_master_source_id(project.description, None)

    project.updated_at = utc_now()
    session.add(project)
    await apply_denormalized_project_fields(session, project, run)

    # 清空各页演示产物；否则 GET 项目时 sync_demo_workflow_from_deck 见页仍 ready 会再次把 deck_render 标成 success。
    if STEP_DECK_RENDER in keys_to_reset:
        from app.services.deck import reset_all_page_decks_for_reopen

        await reset_all_page_decks_for_reopen(session, int(project.id))

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
