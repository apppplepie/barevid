import asyncio
import shutil

from sqlalchemy import update
from sqlalchemy.orm import aliased
from sqlmodel import delete, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import settings
from app.db.models import (
    KIND_PAGE,
    KIND_STEP,
    NodeContent,
    OutlineNode,
    Project,
    ProjectStyle,
    WorkflowArtifact,
    WorkflowExportRun,
    WorkflowRun,
    WorkflowStepRun,
    utc_now,
)
from app.db.engine import async_session_maker
from app.integrations.deepseek import structure_raw_text
from app.integrations.doubao_tts_service import synthesize_to_file
from app.tts_voice_presets import effective_voice_type
from app.mediautil import audio_duration_ms, resolve_slide_audio_url
from app.schemas import (
    AudioPart,
    GenerateOutlineResponse,
    GenerateResponse,
    StructuredPodcast,
    SynthesizeAudioResponse,
)
from app.services import workflow_engine as wf_engine
from app.services.workflow_state import (
    STEP_FAILED,
    STEP_RUNNING,
    STEP_SUCCESS,
    mark_text_failed,
    mark_text_running,
    mark_text_success,
    reset_downstream_after_text_retry,
    reset_export_only,
)

_TTS_SEMAPHORE = asyncio.Semaphore(settings.tts_concurrency_limit)


def _text_structure_mode(project: Project) -> str:
    m = (getattr(project, "text_structure_mode", None) or "polish").strip().lower()
    return "verbatim_split" if m == "verbatim_split" else "polish"


def _flatten_segments(structured: StructuredPodcast) -> list[tuple[str, str, str]]:
    """(main_title, subtitle, script) in play order。"""
    rows: list[tuple[str, str, str]] = []
    for section in structured.items:
        for seg in section.segments:
            rows.append((section.main_title, seg.subtitle, seg.script))
    return rows


async def _persist_structured_outline(
    session: AsyncSession,
    project: Project,
    structured: StructuredPodcast,
    *,
    advance_parallel: bool = False,
) -> None:
    """将结构化结果写入 outline_nodes / node_contents，并把项目标为 draft。"""
    if project.id is None:
        raise RuntimeError("项目未持久化")
    flat = _flatten_segments(structured)
    if not flat:
        raise RuntimeError("结构化结果为空，无法生成大纲")

    base = settings.storage_root / "projects" / str(project.id) / "audio"
    base.mkdir(parents=True, exist_ok=True)

    audio_idx = 0

    for sec_order, section in enumerate(structured.items):
        sec_title = (section.main_title or "").strip() or "（未标注大标题）"
        sec_node = OutlineNode(
            project_id=project.id,
            parent_id=None,
            sort_order=sec_order,
            title=sec_title,
            node_kind=KIND_PAGE,
            subtree_has_content=False,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        session.add(sec_node)
        await session.commit()
        await session.refresh(sec_node)

        for seg_order, seg in enumerate(section.segments, start=1):
            audio_idx += 1
            seg_title = (seg.subtitle or "").strip() or "（无小标题）"
            seg_node = OutlineNode(
                project_id=project.id,
                parent_id=sec_node.id,
                sort_order=seg_order,
                title=seg_title,
                node_kind=KIND_STEP,
                subtree_has_content=True,
                created_at=utc_now(),
                updated_at=utc_now(),
            )
            session.add(seg_node)
            await session.commit()
            await session.refresh(seg_node)

            t = utc_now()
            nc = NodeContent(
                node_id=seg_node.id,
                narration_text=seg.script,
                narration_brief=(seg.brief or "").strip() or None,
                duration_ms=None,
                narration_alignment_json=None,
                audio_sequence=audio_idx,
                audio_asset_id=None,
                image_asset_id=None,
                background_asset_id=None,
                created_at=t,
                updated_at=t,
            )
            session.add(nc)
            sec_node.subtree_has_content = True
            sec_node.updated_at = t
            session.add(sec_node)
            await session.commit()

    project.status = "draft"
    now = utc_now()
    project.video_source_updated_at = now
    project.video_exported_at = None
    project.updated_at = now
    if advance_parallel:
        await wf_engine.after_text_success_parallel_ready(session, project)
    else:
        await mark_text_success(session, project)
    if getattr(project, "pipeline_auto_advance", True):
        project.manual_outline_confirmed = True
    else:
        project.manual_outline_confirmed = False
    session.add(project)
    await session.commit()


async def clear_project_outline_nodes(session: AsyncSession, project_id: int) -> None:
    """删除大纲与节点内容，保留 projects 行。"""
    sub = select(OutlineNode.id).where(OutlineNode.project_id == project_id)
    await session.exec(delete(NodeContent).where(NodeContent.node_id.in_(sub)))
    await session.exec(delete(OutlineNode).where(OutlineNode.project_id == project_id))


async def run_generate_outline_only(
    session: AsyncSession,
    raw_text: str,
    *,
    project_name: str | None = None,
    owner_user_id: int,
    narration_target_seconds: int | None = None,
) -> GenerateOutlineResponse:
    """步骤 1：DeepSeek 结构化 + 写入大纲与口播文本，不调用 TTS。成功后项目 status=draft。"""
    now = utc_now()
    project = Project(
        owner_user_id=owner_user_id,
        user_id=owner_user_id,
        is_shared=False,
        name=(project_name or "未命名项目").strip() or "未命名项目",
        description=None,
        narration_target_seconds=narration_target_seconds,
        input_prompt=raw_text,
        status="structuring",
        text_status="running",
        audio_status="not_started",
        demo_status="not_started",
        export_status="not_started",
        created_at=now,
        updated_at=now,
    )
    session.add(project)
    await session.commit()
    await session.refresh(project)
    session.add(
        ProjectStyle(
            project_id=int(project.id),
            style_preset="none",
            user_style_hint=None,
            style_prompt_text="",
            style_data_json=None,
            style_base_json="",
            version=1,
            created_at=now,
            updated_at=now,
        )
    )
    await session.commit()
    await wf_engine.ensure_workflow_for_project(session, project, align_from_project=True)
    await session.commit()

    try:
        structured = await structure_raw_text(
            raw_text,
            narration_target_seconds=narration_target_seconds,
            structure_mode=_text_structure_mode(project),
        )
        await _persist_structured_outline(session, project, structured)
        return GenerateOutlineResponse(
            project_id=project.id,
            structured=structured,
        )
    except Exception:
        async with async_session_maker() as session:
            p = await session.get(Project, project.id)
            if p:
                await mark_text_failed(session, p, "结构化失败")
                p.status = "failed"
                session.add(p)
                await session.commit()
        raise


async def run_synthesize_project_audio(
    session: AsyncSession,
    project_id: int,
) -> SynthesizeAudioResponse:
    """步骤 2：按已有 step 口播文本调用豆包 TTS。成功后 status=ready。"""
    class _AudioReopenCancelled(Exception):
        """音频步骤被回退/取消后，主动停止本次合成任务。"""

    async def _audio_step_still_running() -> bool:
        prj = await session.get(Project, project_id)
        if prj is None:
            return False
        run = await wf_engine._get_run(session, project_id)
        if run is None or run.id is None:
            return (prj.audio_status or "").strip().lower() == "running"
        steps_map = await wf_engine._load_steps_map(session, int(run.id))
        row = steps_map.get(wf_engine.STEP_AUDIO)
        return row is not None and row.status == wf_engine.STEP_RUNNING

    project = await session.get(Project, project_id)
    if project is None:
        raise RuntimeError("项目不存在")

    page = aliased(OutlineNode)
    stmt = (
        select(NodeContent, OutlineNode, page)
        .join(OutlineNode, NodeContent.node_id == OutlineNode.id)
        .join(page, OutlineNode.parent_id == page.id)
        .where(OutlineNode.project_id == project_id)
        .where(OutlineNode.node_kind == KIND_STEP)
        .order_by(NodeContent.audio_sequence)
    )
    res = await session.exec(stmt)
    pairs = list(res.all())
    if not pairs:
        raise RuntimeError("没有可配音的段落，请先完成「生成文案」")

    now = utc_now()
    project.status = "synthesizing"
    project.video_source_updated_at = now
    project.video_exported_at = None
    project.audio_error = None
    await reset_export_only(session, project)
    await wf_engine.set_step(
        session, project, wf_engine.STEP_AUDIO, wf_engine.STEP_RUNNING
    )
    project.updated_at = now
    session.add(project)
    await session.commit()

    base = settings.storage_root / "projects" / str(project_id) / "audio"
    if base.is_dir():
        shutil.rmtree(base, ignore_errors=False)
    base.mkdir(parents=True, exist_ok=True)
    audios: list[AudioPart] = []

    vt = effective_voice_type(project.tts_voice_type)

    try:
        for nc, step_node, page_node in pairs:
            if not await _audio_step_still_running():
                raise _AudioReopenCancelled()
            seq = nc.audio_sequence
            if seq <= 0:
                continue
            script = (nc.narration_text or "").strip()
            if not script:
                continue
            name = f"{seq:03d}.mp3"
            path = base / name
            async with _TTS_SEMAPHORE:
                alignment_json = await synthesize_to_file(script, path, voice_type=vt)
            if not await _audio_step_still_running():
                raise _AudioReopenCancelled()
            duration_ms = audio_duration_ms(path)
            t = utc_now()
            nc.narration_alignment_json = alignment_json
            nc.duration_ms = duration_ms
            nc.updated_at = t
            session.add(nc)
            await session.commit()

            audios.append(
                AudioPart(
                    index=seq,
                    filename=name,
                    url=resolve_slide_audio_url(
                        project_id, seq, settings.storage_root
                    ),
                    subtitle=step_node.title,
                    main_title=page_node.title,
                )
            )

        if not await _audio_step_still_running():
            raise _AudioReopenCancelled()
        project.status = "ready"
        project.audio_error = None
        if audios:
            project.audio_result_url = audios[0].url
        project.updated_at = utc_now()
        await wf_engine.set_step(
            session, project, wf_engine.STEP_AUDIO, wf_engine.STEP_SUCCESS
        )
        session.add(project)
        await session.commit()

        return SynthesizeAudioResponse(project_id=project_id, audios=audios)
    except _AudioReopenCancelled:
        # 回退流程已将状态重置为 pending；此处静默结束，不再覆盖为 success/failed。
        return SynthesizeAudioResponse(project_id=project_id, audios=[])
    except Exception as e:
        async with async_session_maker() as session:
            p = await session.get(Project, project_id)
            if p:
                await wf_engine.set_step(
                    session,
                    p,
                    wf_engine.STEP_AUDIO,
                    wf_engine.STEP_FAILED,
                    error_message=str(e)[:4000],
                )
                p.audio_error = str(e)[:4000]
                p.status = "failed"
                p.updated_at = utc_now()
                session.add(p)
                await session.commit()
        raise


async def run_resynthesize_single_step_audio(
    session: AsyncSession,
    project_id: int,
    step_node_id: int,
    *,
    override_text: str | None = None,
) -> dict:
    """对单个 step 调用豆包 TTS，覆盖对应序号的 mp3；可选 override_text 仅合成该小段文案。"""
    node = await session.get(OutlineNode, step_node_id)
    if node is None or node.project_id != project_id:
        raise RuntimeError("段落节点不存在")
    if node.node_kind != KIND_STEP:
        raise RuntimeError("仅支持对口播 step 重新配音，停顿段请改时长或改结构")

    res = await session.exec(select(NodeContent).where(NodeContent.node_id == node.id))
    nc = res.first()
    if nc is None:
        raise RuntimeError("段落缺少内容记录")

    seq = nc.audio_sequence
    if seq <= 0:
        raise RuntimeError("该段落未分配音频序号，无法单独配音")

    if override_text is not None and override_text.strip():
        script = override_text.strip()
    else:
        script = (nc.narration_text or "").strip()
    if not script:
        raise RuntimeError("口播文本为空，请先完成文案或在请求体中传入 text")

    base = settings.storage_root / "projects" / str(project_id) / "audio"
    base.mkdir(parents=True, exist_ok=True)
    name = f"{seq:03d}.mp3"
    path = base / name

    proj = await session.get(Project, project_id)
    vt = effective_voice_type(proj.tts_voice_type if proj else None)

    async with _TTS_SEMAPHORE:
        alignment_json = await synthesize_to_file(script, path, voice_type=vt)
    duration_ms = audio_duration_ms(path)
    t = utc_now()
    nc.narration_alignment_json = alignment_json
    nc.duration_ms = duration_ms
    nc.updated_at = t
    session.add(nc)

    project = await session.get(Project, project_id)
    if project:
        project.video_source_updated_at = t
        project.video_exported_at = None
        await reset_export_only(session, project)
        project.updated_at = t
        session.add(project)

    await session.commit()

    return {
        "step_node_id": step_node_id,
        "duration_ms": duration_ms,
        "audio_url": resolve_slide_audio_url(project_id, seq, settings.storage_root),
        "reused_existing": False,
    }


async def _run_audio_and_deck_parallel(project_id: int) -> None:
    """
    文本已成功且 `projects.pipeline_auto_advance` 为真时：整稿配音与批量场景页并行启动。

    手动流水线（`pipeline_auto_advance=False`）不得在此函数内启动场景大页；须用户在工程内完成「演示母版」后，
    再通过 `POST .../workflow/demo/run` 或 `generate-deck-all` 显式确认批量生成。
    """
    from app.services.deck import (
        collect_deck_page_node_ids_needing_generation,
        run_generate_deck_all_job,
        try_start_page_deck_generation,
    )
    from app.services.outline import load_deck_timeline

    async def _audio_branch() -> None:
        try:
            async with async_session_maker() as session:
                await run_synthesize_project_audio(session, project_id)
        except Exception:
            pass

    async def _deck_branch() -> None:
        try:
            async with async_session_maker() as session:
                project = await session.get(Project, project_id)
                if project is None or not bool(
                    getattr(project, "pipeline_auto_advance", True)
                ):
                    return
                timeline = await load_deck_timeline(session, project_id)
                if not timeline:
                    p = await session.get(Project, project_id)
                    if p:
                        p.demo_status = STEP_FAILED
                        p.demo_error = "没有可演示的分段"
                        p.updated_at = utc_now()
                        session.add(p)
                        await session.commit()
                    return
                page_ids = await collect_deck_page_node_ids_needing_generation(
                    session, project_id
                )
                started: list[int] = []
                for nid in page_ids:
                    st = await try_start_page_deck_generation(session, project_id, nid)
                    if st == "ok":
                        started.append(nid)
                await session.commit()
            if not started:
                async with async_session_maker() as s2:
                    p = await s2.get(Project, project_id)
                    if p:
                        p.demo_status = STEP_FAILED
                        p.demo_error = "没有可启动的演示页"
                        p.updated_at = utc_now()
                        session.add(p)
                        await s2.commit()
                return
            await run_generate_deck_all_job(project_id, started)
        except Exception:
            pass

    await asyncio.gather(_audio_branch(), _deck_branch())


async def _run_deck_master_while_text_structuring(project_id: int) -> None:
    """
    与文案结构化并行：推进演示母版（project_styles 风格正文）。
    - 自行设计：与结构化同时跑 ensure_style_base，完成后标母版成功。
    - 复用母版：库中已有可用 style_prompt 时仅标母版进行中，等文案成功后再标成功，
      避免「未打开工程母版已绿」的错位感。
    """
    from app.services.deck import deck_style_ready_from_storage, ensure_style_base

    try:
        ready_at_start = False
        async with async_session_maker() as session:
            project = await session.get(Project, project_id)
            if project is None or not bool(
                getattr(project, "pipeline_auto_advance", True)
            ):
                return
            st = (project.status or "").strip().lower()
            if st != "structuring":
                return
            st_res = await session.exec(
                select(ProjectStyle).where(ProjectStyle.project_id == project_id)
            )
            row = st_res.first()
            ready_at_start, _, _ = deck_style_ready_from_storage(project, row)
            await wf_engine.ensure_workflow_for_project(
                session, project, align_from_project=False
            )
            await wf_engine.set_step(
                session,
                project,
                wf_engine.STEP_DECK_MASTER,
                wf_engine.STEP_RUNNING,
            )
            await session.commit()

        if not ready_at_start:
            try:
                await ensure_style_base(project_id)
            except Exception as e:
                msg = (str(e).strip() or "演示风格母版生成失败")[:1800]
                async with async_session_maker() as session:
                    project = await session.get(Project, project_id)
                    if project is None:
                        return
                    await wf_engine.set_step(
                        session,
                        project,
                        wf_engine.STEP_DECK_MASTER,
                        wf_engine.STEP_FAILED,
                        error_message=msg,
                    )
                    await session.commit()
                return

            async with async_session_maker() as session:
                project = await session.get(Project, project_id)
                if project is None:
                    return
                await wf_engine.notify_deck_master_success_if_pending(
                    session, project_id
                )
                await session.commit()
    except Exception:
        async with async_session_maker() as session:
            project = await session.get(Project, project_id)
            if project is None:
                return
            await wf_engine.set_step(
                session,
                project,
                wf_engine.STEP_DECK_MASTER,
                wf_engine.STEP_FAILED,
                error_message="演示风格母版任务异常",
            )
            await session.commit()


async def run_text_rebuild_job(project_id: int) -> None:
    """
    清空大纲并重跑结构化；若 pipeline_auto_advance 则继续并行配音 + 演示。
    由 POST .../workflow/text/run 触发。
    """
    async with async_session_maker() as session:
        project = await session.get(Project, project_id)
        if project is None:
            return
        await reset_downstream_after_text_retry(session, project)
        await clear_project_outline_nodes(session, project_id)
        await mark_text_running(session, project)
        project.status = "structuring"
        project.updated_at = utc_now()
        session.add(project)
        await session.commit()

    structured: StructuredPodcast | None = None
    text_exc: Exception | None = None

    async def _text_branch() -> None:
        nonlocal structured, text_exc
        try:
            async with async_session_maker() as session:
                project = await session.get(Project, project_id)
                if project is None or project.status != "structuring":
                    return
                raw = (project.input_prompt or "").strip()
                if not raw:
                    raise RuntimeError("项目缺少生成素材")
                nts = project.narration_target_seconds
                structured = await structure_raw_text(
                    raw,
                    narration_target_seconds=nts,
                    structure_mode=_text_structure_mode(project),
                )

            async with async_session_maker() as session:
                project = await session.get(Project, project_id)
                if project is None or project.status != "structuring":
                    return
                assert structured is not None
                advance = bool(getattr(project, "pipeline_auto_advance", True))
                await _persist_structured_outline(
                    session, project, structured, advance_parallel=advance
                )
        except Exception as e:
            text_exc = e

    await asyncio.gather(
        _text_branch(),
        _run_deck_master_while_text_structuring(project_id),
    )

    if text_exc is not None:
        async with async_session_maker() as session:
            p = await session.get(Project, project_id)
            if p:
                await mark_text_failed(session, p, "结构化失败")
                p.status = "failed"
                session.add(p)
                await session.commit()
        return

    if structured is None:
        return

    async with async_session_maker() as session:
        p = await session.get(Project, project_id)
        run_parallel = p is not None and bool(
            getattr(p, "pipeline_auto_advance", True)
        )
    if run_parallel:
        await _run_audio_and_deck_parallel(project_id)


async def run_queued_project_pipeline_job(project_id: int) -> None:
    """
    后台：queued → structuring →（文案结构化 ∥ 演示母版风格）并行 → 入库 draft
    →（配音 ∥ 演示页）并行。
    与 POST /api/projects 配对；若项目已被删或状态不是 queued 则直接返回。
    """
    async with async_session_maker() as session:
        now = utc_now()
        claim = await session.exec(
            update(Project)
            .where(Project.id == project_id, Project.status == "queued")
            .values(status="structuring", updated_at=now)
        )
        if claim.rowcount == 0:
            return
        project = await session.get(Project, project_id)
        if project is None:
            return
        await mark_text_running(session, project)
        project.status = "structuring"
        project.updated_at = now
        session.add(project)
        await session.commit()

    structured: StructuredPodcast | None = None
    text_exc: Exception | None = None

    async def _text_branch() -> None:
        nonlocal structured, text_exc
        try:
            async with async_session_maker() as session:
                project = await session.get(Project, project_id)
                if project is None or project.status != "structuring":
                    return
                raw = (project.input_prompt or "").strip()
                if not raw:
                    raise RuntimeError("项目缺少生成素材")
                nts = project.narration_target_seconds
                structured = await structure_raw_text(
                    raw,
                    narration_target_seconds=nts,
                    structure_mode=_text_structure_mode(project),
                )

            async with async_session_maker() as session:
                project = await session.get(Project, project_id)
                if project is None or project.status != "structuring":
                    return
                assert structured is not None
                advance = bool(getattr(project, "pipeline_auto_advance", True))
                await _persist_structured_outline(
                    session, project, structured, advance_parallel=advance
                )
        except Exception as e:
            text_exc = e

    await asyncio.gather(
        _text_branch(),
        _run_deck_master_while_text_structuring(project_id),
    )

    if text_exc is not None:
        async with async_session_maker() as session:
            p = await session.get(Project, project_id)
            if p:
                await mark_text_failed(session, p, "结构化失败")
                p.status = "failed"
                session.add(p)
                await session.commit()
        return

    if structured is None:
        return

    async with async_session_maker() as session:
        p = await session.get(Project, project_id)
        run_parallel = p is not None and bool(
            getattr(p, "pipeline_auto_advance", True)
        )
    if run_parallel:
        await _run_audio_and_deck_parallel(project_id)


async def run_generate(
    session: AsyncSession,
    raw_text: str,
    *,
    project_name: str | None = None,
    owner_user_id: int,
    narration_target_seconds: int | None = None,
) -> GenerateResponse:
    """兼容：文案 + 配音一步完成（旧 /api/generate）。"""
    outline = await run_generate_outline_only(
        session,
        raw_text,
        project_name=project_name,
        owner_user_id=owner_user_id,
        narration_target_seconds=narration_target_seconds,
    )
    synth = await run_synthesize_project_audio(session, outline.project_id)
    return GenerateResponse(
        project_id=outline.project_id,
        structured=outline.structured,
        audios=synth.audios,
    )


async def delete_project_cascade(session: AsyncSession, project_id: int) -> None:
    """删除项目、大纲、内容行；不删除磁盘媒体时由调用方处理。"""
    project = await session.get(Project, project_id)
    if project is None:
        raise RuntimeError("项目不存在")

    wr_res = await session.exec(
        select(WorkflowRun).where(WorkflowRun.project_id == project_id)
    )
    wf_run = wr_res.first()
    if wf_run is not None and wf_run.id is not None:
        wid = int(wf_run.id)
        await session.exec(
            delete(WorkflowArtifact).where(WorkflowArtifact.workflow_run_id == wid)
        )
        await session.exec(
            delete(WorkflowExportRun).where(WorkflowExportRun.workflow_run_id == wid)
        )
        await session.exec(
            delete(WorkflowStepRun).where(WorkflowStepRun.workflow_run_id == wid)
        )
        await session.exec(delete(WorkflowRun).where(WorkflowRun.id == wid))

    sub = select(OutlineNode.id).where(OutlineNode.project_id == project_id)
    await session.exec(delete(NodeContent).where(NodeContent.node_id.in_(sub)))
    await session.exec(delete(OutlineNode).where(OutlineNode.project_id == project_id))
    await session.exec(
        delete(ProjectStyle).where(ProjectStyle.project_id == project_id)
    )
    await session.delete(project)
    await session.commit()
