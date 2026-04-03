import asyncio
import logging
import shutil

from sqlalchemy import text, update
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
    VideoExportJob,
    WorkflowArtifact,
    WorkflowExportRun,
    WorkflowRun,
    WorkflowStepRun,
    utc_now,
)
from app.db.engine import async_session_maker
from app.integrations.deepseek import structure_raw_text
from app.integrations.doubao_tts_service import synthesize_to_file
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
logger = logging.getLogger(__name__)


def _clip_pipeline_err(message: object, max_len: int = 1800) -> str:
    text = str(message).strip() or "未知错误"
    if len(text) <= max_len:
        return text
    return text[: max_len - 3].rstrip() + "..."


async def _mark_audio_pipeline_failed(project_id: int, message: object) -> None:
    detail = _clip_pipeline_err(message)
    async with async_session_maker() as session:
        project = await session.get(Project, project_id)
        if project is None:
            return
        await wf_engine.set_step(
            session,
            project,
            wf_engine.STEP_AUDIO,
            wf_engine.STEP_FAILED,
            error_message=detail,
        )
        project.status = "failed"
        project.updated_at = utc_now()
        session.add(project)
        await session.commit()


async def _mark_deck_pipeline_failed(project_id: int, message: object) -> None:
    from app.services.deck import (
        cancel_generating_deck_pages,
        fetch_style_prompt_for_project,
        sync_demo_workflow_from_deck,
    )

    detail = _clip_pipeline_err(message)
    async with async_session_maker() as session:
        project = await session.get(Project, project_id)
        if project is None:
            return
        await cancel_generating_deck_pages(session, project_id, reason=detail)
        style_prompt = await fetch_style_prompt_for_project(session, project)
        if style_prompt:
            await wf_engine.set_step(
                session,
                project,
                wf_engine.STEP_DECK_MASTER,
                wf_engine.STEP_SUCCESS,
            )
            await wf_engine.set_step(
                session,
                project,
                wf_engine.STEP_DECK_RENDER,
                wf_engine.STEP_FAILED,
                error_message=detail,
            )
        else:
            await wf_engine.set_step(
                session,
                project,
                wf_engine.STEP_DECK_MASTER,
                wf_engine.STEP_FAILED,
                error_message=detail,
            )
        project.status = "failed"
        project.updated_at = utc_now()
        session.add(project)
        await sync_demo_workflow_from_deck(session, project_id)
        await session.commit()


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
    project.updated_at = now
    if advance_parallel:
        await wf_engine.after_text_success_parallel_ready(session, project)
    else:
        await mark_text_success(session, project)
    session.add(project)
    await session.commit()


async def clear_project_outline_nodes(session: AsyncSession, project_id: int) -> None:
    """删除大纲与节点内容，保留 projects 行。"""
    sub = select(OutlineNode.id).where(OutlineNode.project_id == project_id)
    await session.exec(delete(NodeContent).where(NodeContent.node_id.in_(sub)))
    await session.execute(
        update(OutlineNode)
        .where(OutlineNode.project_id == project_id)
        .values(parent_id=None)
    )
    await session.exec(delete(OutlineNode).where(OutlineNode.project_id == project_id))


async def run_generate_outline_only(
    session: AsyncSession,
    raw_text: str,
    *,
    project_name: str | None = None,
    owner_user_id: int,
) -> GenerateOutlineResponse:
    """步骤 1：DeepSeek 结构化 + 写入大纲与口播文本，不调用 TTS。成功后项目 status=draft。"""
    now = utc_now()
    project = Project(
        owner_user_id=owner_user_id,
        user_id=owner_user_id,
        is_shared=False,
        name=(project_name or "未命名项目").strip() or "未命名项目",
        description=None,
        input_prompt=raw_text,
        status="structuring",
        aspect_ratio="16:9",
        deck_width=1920,
        deck_height=1080,
        created_at=now,
        updated_at=now,
    )
    session.add(project)
    await session.commit()
    await session.refresh(project)
    style = ProjectStyle(
        origin_project_id=int(project.id),
        style_preset="aurora_glass",
        user_style_hint=None,
        style_prompt_text="",
        style_data_json=None,
        style_base_json="",
        version=1,
        created_at=now,
        updated_at=now,
    )
    session.add(style)
    await session.flush()
    project.style_id = int(style.id)
    session.add(project)
    await session.commit()
    await wf_engine.ensure_workflow_for_project(session, project, align_from_project=True)
    await session.commit()

    try:
        structured = await structure_raw_text(raw_text)
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

    try:
        for nc, step_node, page_node in pairs:
            seq = nc.audio_sequence
            if seq <= 0:
                continue
            script = (nc.narration_text or "").strip()
            if not script:
                continue
            name = f"{seq:03d}.mp3"
            path = base / name
            async with _TTS_SEMAPHORE:
                alignment_json = await synthesize_to_file(script, path)
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

        project.status = "ready"
        project.updated_at = utc_now()
        await wf_engine.set_step(
            session, project, wf_engine.STEP_AUDIO, wf_engine.STEP_SUCCESS
        )
        session.add(project)
        await session.commit()

        return SynthesizeAudioResponse(project_id=project_id, audios=audios)
    except Exception as e:
        async with async_session_maker() as session:
            p = await session.get(Project, project_id)
            if p:
                await wf_engine.set_step(
                    session,
                    p,
                    wf_engine.STEP_AUDIO,
                    wf_engine.STEP_FAILED,
                    error_message=_clip_pipeline_err(e),
                )
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

    async with _TTS_SEMAPHORE:
        alignment_json = await synthesize_to_file(script, path)
    duration_ms = audio_duration_ms(path)
    t = utc_now()
    nc.narration_alignment_json = alignment_json
    nc.duration_ms = duration_ms
    nc.updated_at = t
    session.add(nc)

    project = await session.get(Project, project_id)
    if project:
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
    """文本已成功：配音与演示页并行。"""
    from app.services.deck import (
        collect_deck_page_node_ids_needing_generation,
        fetch_style_prompt_for_project,
        run_generate_deck_all_job,
        sync_demo_workflow_from_deck,
        try_start_page_deck_generation,
    )
    from app.services.outline import load_deck_timeline

    async def _audio_branch() -> None:
        try:
            async with async_session_maker() as session:
                await asyncio.wait_for(
                    run_synthesize_project_audio(session, project_id),
                    timeout=max(60, int(settings.audio_pipeline_timeout_seconds or 600)),
                )
        except asyncio.TimeoutError:
            detail = (
                "音频生成超时：后台任务长时间未完成。"
                "请检查 Docker 容器到豆包 TTS 的网络/配额状态后重试。"
            )
            logger.exception("project %s audio branch timed out", project_id)
            await _mark_audio_pipeline_failed(project_id, detail)
        except Exception as e:
            logger.exception("project %s audio branch crashed", project_id)
            await _mark_audio_pipeline_failed(project_id, e)

    async def _deck_branch() -> None:
        try:
            async with async_session_maker() as session:
                timeline = await load_deck_timeline(session, project_id)
                if not timeline:
                    raise RuntimeError("没有可演示的分段，无法启动演示生成")
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
                        if await fetch_style_prompt_for_project(s2, p):
                            await wf_engine.set_step(
                                s2,
                                p,
                                wf_engine.STEP_DECK_MASTER,
                                wf_engine.STEP_SUCCESS,
                            )
                        p.updated_at = utc_now()
                        s2.add(p)
                        await sync_demo_workflow_from_deck(s2, project_id)
                        await s2.commit()
                return
            await asyncio.wait_for(
                run_generate_deck_all_job(project_id, started),
                timeout=max(120, int(settings.deck_pipeline_timeout_seconds or 900)),
            )
        except asyncio.TimeoutError:
            detail = (
                "演示生成超时：后台任务长时间未完成。"
                "请检查 Docker 容器到 DeepSeek 的网络、代理或限流状态后重试。"
            )
            logger.exception("project %s deck branch timed out", project_id)
            await _mark_deck_pipeline_failed(project_id, detail)
        except Exception as e:
            logger.exception("project %s deck branch crashed", project_id)
            await _mark_deck_pipeline_failed(project_id, e)

    await asyncio.gather(_audio_branch(), _deck_branch())


async def run_text_rebuild_job(project_id: int) -> None:
    """
    清空大纲并重跑结构化 → 并行配音 + 演示。
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
    try:
        async with async_session_maker() as session:
            project = await session.get(Project, project_id)
            if project is None or project.status != "structuring":
                return
            raw = (project.input_prompt or "").strip()
            if not raw:
                raise RuntimeError("项目缺少生成素材")
            structured = await structure_raw_text(
                raw,
                target_narration_seconds=project.target_narration_seconds,
            )

        async with async_session_maker() as session:
            project = await session.get(Project, project_id)
            if project is None or project.status != "structuring":
                return
            assert structured is not None
            await _persist_structured_outline(
                session, project, structured, advance_parallel=True
            )
    except Exception:
        async with async_session_maker() as session:
            p = await session.get(Project, project_id)
            if p:
                await mark_text_failed(session, p, "结构化失败")
                p.status = "failed"
                session.add(p)
                await session.commit()
        return

    await _run_audio_and_deck_parallel(project_id)


async def run_queued_project_pipeline_job(project_id: int) -> None:
    """
    后台：queued → structuring → 结构化入库 → draft →（配音 ∥ 演示页）并行。
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
    try:
        async with async_session_maker() as session:
            project = await session.get(Project, project_id)
            if project is None or project.status != "structuring":
                return
            raw = (project.input_prompt or "").strip()
            if not raw:
                raise RuntimeError("项目缺少生成素材")
            structured = await structure_raw_text(
                raw,
                target_narration_seconds=project.target_narration_seconds,
            )

        async with async_session_maker() as session:
            project = await session.get(Project, project_id)
            if project is None or project.status != "structuring":
                return
            assert structured is not None
            await _persist_structured_outline(
                session, project, structured, advance_parallel=True
            )
    except Exception:
        async with async_session_maker() as session:
            p = await session.get(Project, project_id)
            if p:
                await mark_text_failed(session, p, "结构化失败")
                p.status = "failed"
                session.add(p)
                await session.commit()
        return

    await _run_audio_and_deck_parallel(project_id)


async def run_generate(
    session: AsyncSession,
    raw_text: str,
    *,
    project_name: str | None = None,
    owner_user_id: int,
) -> GenerateResponse:
    """兼容：文案 + 配音一步完成（旧 /api/generate）。"""
    outline = await run_generate_outline_only(
        session,
        raw_text,
        project_name=project_name,
        owner_user_id=owner_user_id,
    )
    synth = await run_synthesize_project_audio(session, outline.project_id)
    return GenerateResponse(
        project_id=outline.project_id,
        structured=outline.structured,
        audios=synth.audios,
    )


async def delete_project_cascade(session: AsyncSession, project_id: int) -> None:
    """删除项目、大纲、内容行；不删除磁盘媒体时由调用方处理。

    project_styles 行保留（不随项目级联删除），便于复用母版或审计；仅断开 origin_project_id 等外键引用。
    """
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

    await session.exec(
        delete(VideoExportJob).where(VideoExportJob.project_id == project_id)
    )
    sub = select(OutlineNode.id).where(OutlineNode.project_id == project_id)
    await session.exec(delete(NodeContent).where(NodeContent.node_id.in_(sub)))
    await session.execute(
        update(OutlineNode)
        .where(OutlineNode.project_id == project_id)
        .values(parent_id=None)
    )
    await session.exec(delete(OutlineNode).where(OutlineNode.project_id == project_id))
    # MySQL 等会校验外键：project_styles.origin_project_id -> projects.id
    # （含克隆共用母版时仍指向源项目）。先断开引用再删项目行。
    # 注意：UPDATE 须用 session.execute；exec() 主要面向 select，误用可能导致 500。
    await session.execute(
        update(ProjectStyle)
        .where(ProjectStyle.origin_project_id == project_id)
        .values(origin_project_id=None)
    )
    # 极老库曾存在 project_styles.project_id -> projects.id（models 已移除该列）。
    try:
        await session.execute(
            text(
                "UPDATE project_styles SET project_id = NULL WHERE project_id = :pid"
            ),
            {"pid": project_id},
        )
    except Exception as e:
        err = str(e).lower()
        if "unknown column" in err and "project_id" in err:
            pass
        elif "doesn't exist" in err or "no such column" in err:
            pass
        else:
            raise
    await session.delete(project)
    await session.commit()
