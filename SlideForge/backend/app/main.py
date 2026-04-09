import asyncio
import json
import os
import re
import shutil
import time
import uuid
from contextlib import asynccontextmanager
from urllib.parse import urlparse
from pathlib import Path

from typing import Annotated

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    HTTPException,
    Header,
    Query,
    UploadFile,
)
from fastapi.responses import JSONResponse
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, or_, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth import (
    create_session_token,
    delete_session_token,
    get_current_user,
    hash_password,
    verify_export_worker_key,
    verify_password,
)
from app.config import settings
from app.mediautil import (
    delete_project_export_files,
    latest_export_media_url,
    resolve_slide_audio_url,
)
from app.db.engine import async_session_maker, get_session, init_db
from app.db.models import (
    KIND_PAGE,
    KIND_STEP,
    NodeContent,
    OutlineNode,
    Project,
    ProjectStyle,
    User,
    VideoExportJob,
    utc_now,
)
from app.integrations.deepseek import (
    DEFAULT_DECK_STYLE_PRESET,
    generate_contextual_page_draft,
    get_barevid_deepseek_balance_display,
    list_deck_style_presets,
    resolve_deck_style_preset,
)
from app.integrations.volc_speech_resource_packs import get_barevid_doubao_trial_display
from app.integrations.doubao_tts_service import resolve_tts_voice_type
from app.schemas import (
    BarevidPublicStatsResponse,
    AuthResponse,
    ContextualAIDraftApplyRequest,
    ContextualAIDraftRequest,
    CopyDeckStyleFromRequest,
    DeckStylePatch,
    DeckStylePromptTextPatch,
    ExportVideoRequest,
    ExportVideoResponse,
    GenerateOutlineResponse,
    GenerateRequest,
    GenerateResponse,
    LoginRequest,
    ManualConfirmOutlineRequest,
    NarrationTextPatch,
    PipelineStages,
    ProjectCloneRequest,
    ProjectCreate,
    ProjectPatch,
    WorkflowStepActionBody,
    RegisterRequest,
    ResynthesizeStepAudioRequest,
    SynthesizeAudioResponse,
    VideoExportWorkersStatus,
    WorkerVideoExportFailBody,
    WorkerVideoExportJobPayload,
)
from app.services.deck import (
    cancel_generating_deck_pages,
    collect_deck_page_node_ids,
    collect_deck_page_node_ids_needing_generation,
    compute_project_deck_status,
    deck_style_ready_from_storage,
    ensure_style_base,
    fetch_style_prompt_for_project,
    get_project_style,
    get_or_create_project_style,
    invalidate_all_page_decks_after_master_change,
    resolve_project_page_size,
    run_generate_deck_all_job,
    run_generate_deck_page_job,
    sync_demo_workflow_from_deck,
    try_cancel_page_deck_generation,
    try_start_page_deck_generation,
)
from app.services.manual_outline import apply_manual_outline_confirm
from app.services.outline import (
    build_play_manifest,
    load_deck_timeline,
    load_outline_tree,
    load_playlist_rows,
    parse_stored_json_object,
)
from app.services.pipeline import (
    delete_project_cascade,
    run_generate,
    run_generate_outline_only,
    run_queued_project_pipeline_job,
    run_resynthesize_single_step_audio,
    run_synthesize_project_audio,
    run_text_rebuild_job,
)
from app.services.export_worker_registry import (
    export_worker_alive_count,
    record_export_worker_heartbeat,
    register_barevid_stats_waiter,
    unregister_barevid_stats_waiter,
)
from app.services.video_export_jobs import (
    abort_stale_project_export_jobs,
    claim_next_video_export_job,
    complete_video_export_job,
    enqueue_video_export_job,
    fail_video_export_job,
    find_active_video_export_job,
    get_latest_video_export_job,
    list_recent_video_export_jobs,
    video_export_job_public_dict,
)
from app.services.workflow_controls import (
    cancel_running_workflow_step,
    reopen_success_workflow_step,
)
from app.services.project_clone import clone_project_deep
# 片头/片尾恢复时：增加 format_project_meta_description 与 include_* / intro_style_id_from_description
from app.services.project_meta import (
    deck_master_source_project_id_from_description,
    format_deck_master_source_description,
    merge_deck_master_source_id,
)
from app.utils.narration_length import clamp_narration_seconds, mid_char_estimate
from app.tts_voice_presets import list_tts_voice_presets
from app.services.project_pipeline import compute_project_pipeline
from app.services.workflow_engine import (
    get_workflow_text_step_status,
    notify_deck_master_success_if_pending,
    set_step as wf_set_step,
    STEP_DECK_MASTER as WF_STEP_DECK_MASTER,
    STEP_RUNNING as WF_STEP_RUNNING,
    STEP_SUCCEEDED as WF_STEP_SUCCEEDED,
    workflow_public_dict_async,
)
from app.services.workflow_state import (
    mark_export_failed,
    mark_export_running,
    mark_export_success,
    reset_export_only,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.storage_root.mkdir(parents=True, exist_ok=True)
    await init_db()
    yield


app = FastAPI(title="SlideForge API", version="0.1.0", lifespan=lifespan)
DECK_PAGE_SIZE_OPTIONS = {"16:9", "4:3", "9:16", "1:1"}


def _is_mysql_deadlock(err: OperationalError) -> bool:
    msg = str(err).lower()
    if "deadlock found when trying to get lock" in msg:
        return True
    if "lock wait timeout exceeded" in msg:
        return True
    code = None
    orig = getattr(err, "orig", None)
    if orig is not None:
        try:
            args = getattr(orig, "args", None) or ()
            if args:
                code = int(args[0])
        except Exception:
            code = None
    return code in (1205, 1213)


@app.exception_handler(OperationalError)
async def operational_error_handler(_request, exc: OperationalError):
    # 并发场景下 MySQL 可能短暂死锁；返回可重试错误，避免前端直接抛白屏。
    if _is_mysql_deadlock(exc):
        return JSONResponse(
            status_code=503,
            content={"detail": "数据库并发冲突（死锁/锁等待超时），请稍后重试。"},
        )
    raise exc

def _cors_allow_origins() -> list[str]:
    base = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:9080",
        "http://127.0.0.1:9080",
    ]
    extra = (settings.cors_extra_origins or "").strip()
    if not extra:
        return base
    for part in extra.split(","):
        u = part.strip()
        if u and u not in base:
            base.append(u)
    return base


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_allow_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# StaticFiles 要求目录在 import 时存在；否则 uvicorn 启动即报错。
settings.storage_root.mkdir(parents=True, exist_ok=True)

app.mount(
    "/media",
    StaticFiles(directory=str(settings.storage_root)),
    name="media",
)


async def _get_accessible_project(
    session: AsyncSession, project_id: int, user_id: int
) -> Project:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在")
    if project.owner_user_id != user_id and not project.is_shared:
        raise HTTPException(
            status_code=403,
            detail="无权访问该项目（需项目所有者或已开启共享）。",
        )
    return project


def _can_manage_project(project: Project, user_id: int) -> bool:
    """仅项目拥有者可改库、跑流水线；他人仅可只读访问已云共享项目。"""
    return project.owner_user_id == user_id


def _can_delete_project(project: Project, user_id: int) -> bool:
    return project.owner_user_id == user_id


_DEFAULT_PAGE_SIZE = "16:9"


_EXPORT_SIZE_BY_PAGE: dict[str, tuple[int, int]] = {
    "16:9": (1920, 1080),
    "4:3": (1024, 768),
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
}


def _even_px(n: int) -> int:
    n = max(2, int(n))
    return n if n % 2 == 0 else n - 1


def _resolve_export_video_size(
    page_size: str | None, req_width: int | None, req_height: int | None
) -> tuple[int, int]:
    base_w, base_h = _EXPORT_SIZE_BY_PAGE.get(
        (page_size or "").strip(), _EXPORT_SIZE_BY_PAGE["16:9"]
    )
    w = int(req_width) if req_width and req_width > 0 else None
    h = int(req_height) if req_height and req_height > 0 else None
    if w is not None and h is not None:
        h2 = round(w * base_h / float(base_w))
        return _even_px(w), _even_px(h2)
    if w is not None:
        h2 = round(w * base_h / float(base_w))
        return _even_px(w), _even_px(h2)
    if h is not None:
        w2 = round(h * base_w / float(base_h))
        return _even_px(w2), _even_px(h)
    return _even_px(base_w), _even_px(base_h)


def _safe_export_basename(project_name: str | None) -> str:
    raw = (project_name or "").strip() or "project"
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1F]+', "_", raw)
    safe = re.sub(r"\s+", " ", safe).strip(" .")
    return safe or "project"


def _export_media_base_url() -> str:
    raw = (settings.export_public_base_url or "").strip()
    if raw:
        return raw.rstrip("/")
    p = urlparse((settings.export_api_url or "").strip())
    if p.scheme and p.netloc:
        return f"{p.scheme}://{p.netloc}".rstrip("/")
    return ""


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True}


@app.get("/api/video-export-workers/status", response_model=VideoExportWorkersStatus)
async def video_export_workers_status() -> VideoExportWorkersStatus:
    n = await export_worker_alive_count()
    return VideoExportWorkersStatus(alive=n)


@app.get("/api/projects/{project_id}/video-export-jobs")
async def project_video_export_jobs(
    project_id: int,
    limit: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="仅项目拥有者可查看导出任务详情")
    rows = await list_recent_video_export_jobs(session, project_id, limit=limit)
    items = []
    for r in rows:
        items.append(
            {
                "job_id": int(r.id) if r.id is not None else None,
                "status": (r.status or "").strip().lower(),
                "worker_id": (r.worker_id or "").strip() or None,
                "width": int(r.width or 0),
                "height": int(r.height or 0),
                "error_message": (r.error_message or "").strip() or None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "finished_at": r.finished_at.isoformat() if r.finished_at else None,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                "has_request_authorization": bool(
                    (r.request_authorization or "").strip()
                ),
            }
        )
    return {"project_id": int(project_id), "count": len(items), "items": items}


async def _build_barevid_public_stats(session: AsyncSession) -> BarevidPublicStatsResponse:
    """宣传页统计快照（与长轮询 / 即时 GET 共用）。"""
    users_n = (await session.exec(select(func.count(User.id)))).one()
    projects_n = (await session.exec(select(func.count(Project.id)))).one()
    workers_n = await export_worker_alive_count()
    api_ds = await get_barevid_deepseek_balance_display()
    fallback = (settings.barevid_deepseek_balance_display or "").strip()
    ds = api_ds if api_ds else fallback
    api_db = await get_barevid_doubao_trial_display()
    db_fallback = (settings.barevid_doubao_trial_display or "").strip()
    db = api_db if api_db else db_fallback
    return BarevidPublicStatsResponse(
        deepseek_balance_display=ds,
        doubao_trial_display=db,
        workers_online=workers_n,
        user_count=int(users_n or 0),
        project_count=int(projects_n or 0),
    )


@app.get("/api/public/barevid-stats", response_model=BarevidPublicStatsResponse)
async def barevid_public_stats(
    session: AsyncSession = Depends(get_session),
) -> BarevidPublicStatsResponse:
    """宣传页即时快照（DeepSeek/豆包展示字段见 BarevidPublicStatsResponse）。"""
    return await _build_barevid_public_stats(session)


@app.get("/api/public/barevid-stats/wait", response_model=BarevidPublicStatsResponse)
async def barevid_public_stats_wait(
    session: AsyncSession = Depends(get_session),
    timeout: int = Query(
        55,
        ge=10,
        le=180,
        description="最长阻塞秒数；默认 55 以避开常见 nginx proxy_read_timeout 60s。期间若有 worker 心跳则提前返回",
    ),
) -> BarevidPublicStatsResponse:
    """长轮询：有导出 worker 心跳时立刻返回最新统计；否则最多阻塞 timeout 秒再返回（仍会刷新在线数，含 180s 过期清理）。"""
    ev = asyncio.Event()
    await register_barevid_stats_waiter(ev)
    try:
        await asyncio.wait_for(ev.wait(), timeout=float(timeout))
    except asyncio.TimeoutError:
        pass
    finally:
        ev.clear()
        await unregister_barevid_stats_waiter(ev)
    return await _build_barevid_public_stats(session)


@app.post("/api/auth/register", response_model=AuthResponse)
async def register(
    body: RegisterRequest,
    session: AsyncSession = Depends(get_session),
) -> AuthResponse:
    username = body.username.strip().lower()
    if not username:
        raise HTTPException(status_code=400, detail="用户名不能为空")
    if username in ("dev", "legacy"):
        raise HTTPException(status_code=400, detail="该用户名为系统保留")
    exists = await session.exec(
        select(User).where(func.lower(User.username) == username)
    )
    if exists.first() is not None:
        raise HTTPException(status_code=409, detail="用户名已存在")
    now = utc_now()
    user = User(
        username=username,
        password_hash=hash_password(body.password),
        created_at=now,
        updated_at=now,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    token = await create_session_token(session, int(user.id))
    return AuthResponse(token=token, user_id=int(user.id), username=user.username)


@app.post("/api/auth/login", response_model=AuthResponse)
async def login(
    body: LoginRequest,
    session: AsyncSession = Depends(get_session),
) -> AuthResponse:
    username = body.username.strip().lower()
    res = await session.exec(
        select(User).where(func.lower(User.username) == username)
    )
    user = res.first()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if user.username != username:
        user.username = username
        session.add(user)
        await session.commit()
        await session.refresh(user)
    token = await create_session_token(session, int(user.id))
    return AuthResponse(token=token, user_id=int(user.id), username=user.username)


@app.post("/api/auth/logout")
async def logout(
    me: User = Depends(get_current_user),
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _ = me
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if token:
        await delete_session_token(session, token)
    return {"ok": True}


@app.get("/api/auth/me")
async def me(user: User = Depends(get_current_user)) -> dict:
    return {"id": user.id, "username": user.username.lower()}


@app.get("/api/deck-style-presets")
async def deck_style_presets() -> dict:
    return {"items": list_deck_style_presets()}


@app.get("/api/tts/voice-presets")
async def tts_voice_presets() -> dict:
    return {"presets": list_tts_voice_presets()}


@app.get("/api/narration-length-estimate")
async def narration_length_estimate(seconds: int) -> dict:
    """按目标口播秒数估算中位汉字量（与结构化篇幅提示同一换算）。"""
    s = clamp_narration_seconds(seconds)
    return {
        "seconds": s,
        "mid_chars": mid_char_estimate(s),
    }


@app.get("/api/projects")
async def list_projects(
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    res = await session.exec(
        select(Project)
        .where(or_(Project.owner_user_id == me.id, Project.is_shared.is_(True)))
        .order_by(Project.id.desc())
    )
    projects = res.all()
    owner_ids = sorted(
        {int(p.owner_user_id) for p in projects if p.owner_user_id is not None}
    )
    username_by_uid: dict[int, str] = {}
    if owner_ids:
        ures = await session.exec(select(User).where(User.id.in_(owner_ids)))
        for u in ures.all():
            if u.id is not None:
                username_by_uid[int(u.id)] = (u.username or "").strip().lower()
    items: list[dict] = []
    for p in projects:
        pl = await compute_project_pipeline(session, p)
        vj = (
            await get_latest_video_export_job(session, int(p.id))
            if p.id is not None
            else None
        )
        vj_out_url = None
        if vj is not None and (vj.status or "").strip().lower() == "succeeded":
            vj_out_url = latest_export_media_url(int(p.id), settings.storage_root)
        st = await get_project_style(session, p)
        preset = (
            (st.style_preset if st else DEFAULT_DECK_STYLE_PRESET)
            or DEFAULT_DECK_STYLE_PRESET
        ).strip() or DEFAULT_DECK_STYLE_PRESET
        page_size = resolve_project_page_size(p)
        deck_status = await compute_project_deck_status(session, int(p.id)) if p.id is not None else "idle"
        oid = int(p.owner_user_id) if p.owner_user_id is not None else 0
        items.append(
            {
                "id": p.id,
                "name": p.name,
                "owner_user_id": p.owner_user_id,
                "owner_username": username_by_uid.get(oid, ""),
                "is_shared": bool(p.is_shared),
                "status": p.status,
                "deck_status": deck_status,
                "deck_style_preset": preset,
                "deck_page_size": page_size,
                "created_at": p.created_at.isoformat(),
                "updated_at": p.updated_at.isoformat(),
                "latest_export_url": latest_export_media_url(
                    p.id, settings.storage_root
                ),
                "pipeline": pl,
                "workflow": await workflow_public_dict_async(session, p),
                "video_export_job": video_export_job_public_dict(
                    vj, success_output_url=vj_out_url
                ),
                "video_exported_at": None,
                "deck_master_source_project_id": (
                    int(st.origin_project_id)
                    if st and st.origin_project_id is not None
                    else deck_master_source_project_id_from_description(p.description)
                ),
                "pipeline_auto_advance": bool(
                    getattr(p, "pipeline_auto_advance", True)
                ),
                "text_structure_mode": (
                    getattr(p, "text_structure_mode", None) or "polish"
                ),
                # 片头/片尾（暂不下发；库内 __sfmeta 仍可由 project_meta 解析）
                # "include_intro": include_intro_from_description(p.description),
                # "intro_style_id": intro_style_id_from_description(p.description),
                # "include_outro": include_outro_from_description(p.description),
            }
        )
    return {"items": items}


@app.post("/api/projects")
async def create_project(
    body: ProjectCreate,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    """立即创建项目：自动模式为 queued 并由后台跑全流程；手动模式为 draft，由用户在工程内触发各步。"""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="项目名称不能为空")
    raw = body.raw_text.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="raw_text 不能为空")

    target_sec = body.target_narration_seconds
    if target_sec is not None:
        if target_sec < 10 or target_sec > 1800:
            raise HTTPException(
                status_code=400,
                detail="target_narration_seconds 应在 10～1800 之间",
            )

    tsm_store: str | None = None
    if body.text_structure_mode is not None:
        v = str(body.text_structure_mode).strip().lower()
        if v not in ("polish", "verbatim_split"):
            raise HTTPException(
                status_code=400,
                detail="text_structure_mode 须为 polish 或 verbatim_split",
            )
        if v == "verbatim_split":
            tsm_store = "verbatim_split"

    # if body.include_intro and body.intro_style_id is not None:
    #     if int(body.intro_style_id) < 1:
    #         raise HTTPException(status_code=400, detail="intro_style_id 须 >= 1")

    page_size = _DEFAULT_PAGE_SIZE
    if body.deck_page_size is not None:
        ps = body.deck_page_size.strip()
        if ps not in DECK_PAGE_SIZE_OPTIONS:
            raise HTTPException(
                status_code=400,
                detail="deck_page_size 非法，可选：16:9, 4:3, 9:16, 1:1",
            )
        page_size = ps

    copy_master_pid = body.copy_deck_master_from_project_id
    src_style_row: ProjectStyle | None = None
    if copy_master_pid is not None:
        src_project = await _get_accessible_project(
            session, int(copy_master_pid), int(me.id)
        )
        src_style_row = await get_project_style(session, src_project)
        ready, _, _ = deck_style_ready_from_storage(src_project, src_style_row)
        if not ready:
            raise HTTPException(
                status_code=400,
                detail="源项目还没有可用的演示风格母版，请换项目或留空以自动生成",
            )

    preset = (body.deck_style_preset or DEFAULT_DECK_STYLE_PRESET).strip() or DEFAULT_DECK_STYLE_PRESET
    if copy_master_pid is None:
        try:
            resolve_deck_style_preset(preset)
        except RuntimeError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
    else:
        assert src_style_row is not None
        preset = (
            (src_style_row.style_preset or DEFAULT_DECK_STYLE_PRESET).strip()
            or DEFAULT_DECK_STYLE_PRESET
        )
        try:
            resolve_deck_style_preset(preset)
        except RuntimeError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    now = utc_now()
    # 片头/片尾：恢复时改用 format_project_meta_description(..., include_intro=...)
    # intro_sid = int(body.intro_style_id) if body.include_intro and body.intro_style_id is not None else None
    # desc = format_project_meta_description(
    #     deck_master_source_project_id=int(copy_master_pid) if copy_master_pid is not None else None,
    #     include_intro=bool(body.include_intro),
    #     include_outro=bool(body.include_outro),
    #     intro_style_id=intro_sid,
    # )
    desc = (
        format_deck_master_source_description(int(copy_master_pid))
        if copy_master_pid is not None
        else None
    )
    default_w, default_h = _EXPORT_SIZE_BY_PAGE.get(page_size, _EXPORT_SIZE_BY_PAGE[_DEFAULT_PAGE_SIZE])
    auto_run = bool(body.pipeline_auto_advance)
    tts_vt = (body.tts_voice_type or "").strip() or None
    project = Project(
        owner_user_id=int(me.id),
        user_id=int(me.id),
        is_shared=False,
        name=name,
        description=desc,
        input_prompt=raw,
        status="queued" if auto_run else "draft",
        aspect_ratio=page_size,
        deck_width=default_w,
        deck_height=default_h,
        target_narration_seconds=target_sec,
        text_structure_mode=tsm_store,
        pipeline_auto_advance=auto_run,
        tts_voice_type=tts_vt,
        created_at=now,
        updated_at=now,
    )
    session.add(project)
    await session.commit()
    await session.refresh(project)
    assert project.id is not None
    if copy_master_pid is not None and src_style_row is not None:
        project.style_id = int(src_style_row.id)
        project.updated_at = now
        session.add(project)
    else:
        uh = (body.deck_style_user_hint or "").strip() or None
        own_style = ProjectStyle(
            origin_project_id=int(project.id),
            style_preset=preset,
            user_style_hint=uh,
            style_prompt_text="",
            style_data_json=None,
            style_base_json="",
            version=1,
            created_at=now,
            updated_at=now,
        )
        session.add(own_style)
        await session.flush()
        project.style_id = int(own_style.id)
        project.updated_at = now
        session.add(project)
    await session.commit()
    from app.services import workflow_engine as _wf

    await _wf.ensure_workflow_for_project(session, project, align_from_project=False)
    await session.commit()
    if auto_run:
        background_tasks.add_task(
            run_queued_project_pipeline_job,
            project.id,
            deck_beta_visual=bool(body.deck_beta_visual),
        )
    return {"project_id": project.id}


@app.post("/api/projects/{project_id}/clone")
async def clone_project_endpoint(
    project_id: int,
    body: ProjectCloneRequest | None = None,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    """完整复制项目（表数据 + storage/projects 下文件），不归队流水线。"""
    src = await _get_accessible_project(session, project_id, int(me.id))
    req = body or ProjectCloneRequest()
    raw_name = (req.name or "").strip()
    new_name = raw_name or f"{(src.name or '').strip() or '未命名项目'}复制版"
    try:
        new_id = await clone_project_deep(
            session,
            source_project_id=project_id,
            new_owner_user_id=int(me.id),
            new_name=new_name,
            storage_root=settings.storage_root,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"复制媒体文件失败：{e}") from e
    return {"project_id": new_id}


@app.get("/api/projects/{project_id}/play-manifest")
async def get_play_manifest(
    project_id: int,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    """
    放映脚本（不入库）：pages 含 html；每步含 section_index，前端按当前步显示对应 section-*，无动作脚本。
    """
    project = await _get_accessible_project(session, project_id, int(me.id))

    return await build_play_manifest(
        session,
        project_id,
        project.name,
        settings.storage_root,
    )


@app.patch("/api/projects/{project_id}")
async def patch_project(
    project_id: int,
    body: ProjectPatch,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(
            status_code=400,
            detail="请提供要修改的字段",
        )
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    if "name" in updates:
        name = str(updates["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="项目名称不能为空")
        project.name = name
    if "is_shared" in updates:
        project.is_shared = bool(updates["is_shared"])
    if "input_prompt" in updates:
        project.input_prompt = str(updates["input_prompt"] or "").strip()
    if "tts_voice_type" in updates:
        raw_v = updates["tts_voice_type"]
        if raw_v is None or (isinstance(raw_v, str) and not raw_v.strip()):
            project.tts_voice_type = None
        else:
            project.tts_voice_type = str(raw_v).strip()[:200]
    if "text_structure_mode" in updates:
        tsm = updates["text_structure_mode"]
        if tsm is None or (isinstance(tsm, str) and not str(tsm).strip()):
            project.text_structure_mode = None
        else:
            v = str(tsm).strip().lower()
            if v not in ("polish", "verbatim_split"):
                raise HTTPException(
                    status_code=400,
                    detail="text_structure_mode 须为 polish 或 verbatim_split",
                )
            project.text_structure_mode = None if v == "polish" else "verbatim_split"
    project.updated_at = utc_now()
    session.add(project)
    await session.commit()
    return {"ok": True, "name": project.name, "is_shared": bool(project.is_shared)}


def _normalize_workflow_step_key(step: str) -> str:
    s = (step or "").strip().lower()
    if s == "pages":
        return "deck_render"
    return s


@app.post("/api/projects/{project_id}/workflow/step/cancel-running")
async def workflow_step_cancel_running(
    project_id: int,
    body: WorkflowStepActionBody,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    if project.id is None:
        raise HTTPException(status_code=400, detail="项目无效")
    key = _normalize_workflow_step_key(body.step)
    try:
        await cancel_running_workflow_step(session, project, key)
        await session.commit()
    except ValueError as e:
        await session.rollback()
        raise HTTPException(status_code=400, detail=str(e)) from e
    await session.refresh(project)
    return {
        "ok": True,
        "pipeline_auto_advance": bool(
            getattr(project, "pipeline_auto_advance", True)
        ),
    }


@app.post("/api/projects/{project_id}/workflow/step/reopen-success")
async def workflow_step_reopen_success(
    project_id: int,
    body: WorkflowStepActionBody,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    if project.id is None:
        raise HTTPException(status_code=400, detail="项目无效")
    key = _normalize_workflow_step_key(body.step)
    try:
        await reopen_success_workflow_step(session, project, key)
        await session.commit()
    except ValueError as e:
        await session.rollback()
        raise HTTPException(status_code=400, detail=str(e)) from e
    await session.refresh(project)
    return {
        "ok": True,
        "pipeline_auto_advance": bool(
            getattr(project, "pipeline_auto_advance", True)
        ),
    }


@app.delete("/api/projects/{project_id}")
async def delete_project(
    project_id: int,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_delete_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="仅项目拥有者可删除")
    try:
        await delete_project_cascade(session, project_id)
    except RuntimeError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except IntegrityError as e:
        await session.rollback()
        orig = getattr(e, "orig", None)
        hint = str(orig) if orig is not None else str(e)
        raise HTTPException(
            status_code=409,
            detail=f"删除失败（数据库外键/约束）：{hint}",
        ) from e
    media_dir = settings.storage_root / "projects" / str(project_id)
    if media_dir.is_dir():
        try:
            shutil.rmtree(media_dir)
        except OSError as e:
            raise HTTPException(
                status_code=500,
                detail=f"项目记录已删除，但媒体目录清理失败：{e}",
            ) from e
    return {"ok": True}


@app.get("/api/projects/{project_id}")
async def get_project(
    project_id: int,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    project = await _get_accessible_project(session, project_id, int(me.id))
    await sync_demo_workflow_from_deck(session, project_id)
    await session.commit()
    await session.refresh(project)
    playlist = await load_playlist_rows(session, project_id)
    outline = await load_outline_tree(session, project_id)
    st_row = await get_project_style(session, project)
    if st_row is None:
        st_row = await get_or_create_project_style(session, project_id)
    preset = (st_row.style_preset or DEFAULT_DECK_STYLE_PRESET).strip() or DEFAULT_DECK_STYLE_PRESET
    deck_style_ready, deck_style_theme_name, deck_style_version = (
        deck_style_ready_from_storage(project, st_row)
    )
    export_url = latest_export_media_url(project_id, settings.storage_root)
    pl = await compute_project_pipeline(session, project)
    deck_status = await compute_project_deck_status(session, project_id)
    deck_error = None
    if deck_status == "failed":
        # 失败时返回首条错误（来自 page_deck_error）
        from app.services.deck import _first_failed_page_deck_error  # type: ignore
        deck_error = await _first_failed_page_deck_error(session, project_id)
    latest_ex_job = await get_latest_video_export_job(session, project_id)
    ex_job_out_url = None
    if latest_ex_job is not None and (latest_ex_job.status or "").strip().lower() == "succeeded":
        ex_job_out_url = latest_export_media_url(project_id, settings.storage_root)
    return {
        "latest_export_url": export_url,
        "video_export_job": video_export_job_public_dict(
            latest_ex_job, success_output_url=ex_job_out_url
        ),
        "workflow": await workflow_public_dict_async(session, project),
        "pipeline": pl,
        "video_exported_at": None,
        "project": {
            "id": project.id,
            "name": project.name,
            "owner_user_id": project.owner_user_id,
            "is_shared": bool(project.is_shared),
            "description": project.description,
            "deck_master_source_project_id": (
                int(st_row.origin_project_id)
                if st_row and st_row.origin_project_id is not None
                else deck_master_source_project_id_from_description(project.description)
            ),
            "input_prompt": project.input_prompt,
            "target_narration_seconds": project.target_narration_seconds,
            "text_structure_mode": (getattr(project, "text_structure_mode", None) or "polish"),
            "pipeline_auto_advance": bool(getattr(project, "pipeline_auto_advance", True)),
            "tts_voice_type": (project.tts_voice_type or "").strip() or None,
            "tts_voice_effective": resolve_tts_voice_type(project.tts_voice_type),
            # "include_intro": include_intro_from_description(project.description),
            # "intro_style_id": intro_style_id_from_description(project.description),
            # "include_outro": include_outro_from_description(project.description),
            "status": project.status,
            "deck_status": deck_status,
            "deck_error": deck_error,
            "deck_style_preset": preset,
            "deck_style_user_hint": st_row.user_style_hint or "",
            "deck_style_prompt_text": st_row.style_prompt_text or "",
            "deck_page_size": resolve_project_page_size(project),
            "deck_style_ready": deck_style_ready,
            "deck_style_version": deck_style_version,
            "deck_style_theme_name": deck_style_theme_name,
            "created_at": project.created_at.isoformat(),
            "updated_at": project.updated_at.isoformat(),
        },
        "slides": [
            {
                "id": s.node_id,
                "sequence_no": s.audio_sequence,
                "main_title": s.page_title,
                "title": s.title,
                "narration_text": s.narration_text,
                "narration_alignment": parse_stored_json_object(
                    s.narration_alignment_json
                ),
                "duration_ms": s.duration_ms,
                "audio_url": resolve_slide_audio_url(
                    project_id, s.audio_sequence, settings.storage_root
                ),
                "audio_asset_id": s.audio_asset_id,
                "image_asset_id": s.image_asset_id,
                "background_asset_id": s.background_asset_id,
                "created_at": s.created_at.isoformat(),
                "updated_at": s.updated_at.isoformat(),
            }
            for s in playlist
        ],
        "outline": outline,
    }


@app.post(
    "/api/projects/{project_id}/export-video",
    response_model=ExportVideoResponse,
)
async def export_video(
    project_id: int,
    body: ExportVideoRequest,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
    authorization: Annotated[str | None, Header()] = None,
) -> ExportVideoResponse:
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="仅项目拥有者可导出视频")
    pl = await compute_project_pipeline(session, project)
    pl_ok = bool(
        pl.get("outline") and pl.get("audio") and pl.get("deck")
    )
    if not pl_ok:
        raise HTTPException(status_code=409, detail="请先完成全部前置步骤后再导出")
    page_size = resolve_project_page_size(project)
    export_width, export_height = _resolve_export_video_size(
        page_size, body.width, body.height
    )

    latest_url = latest_export_media_url(project_id, settings.storage_root)
    # 仅当流水线认定「成片有效」且用户未要求重导时才短路下载；避免磁盘上残留 mp4 但导出态已失效时误返回 download
    if latest_url and not body.force_reexport and bool(pl.get("video")):
        await mark_export_success(session, project, latest_url)
        await session.commit()
        pl = await compute_project_pipeline(session, project)
        return ExportVideoResponse(
            output_url=latest_url,
            action="download",
            pipeline=PipelineStages(**pl),
            video_exported_at=None,
            export_job_id=None,
        )

    if not (settings.export_worker_token or "").strip():
        raise HTTPException(
            status_code=503,
            detail="未配置 EXPORT_WORKER_TOKEN，无法入队视频导出（请启动 worker 并与此密钥一致）",
        )
    auth_hdr = (authorization or "").strip()
    if not auth_hdr or not auth_hdr.lower().startswith("bearer "):
        raise HTTPException(
            status_code=401,
            detail="导出需要有效的 Authorization: Bearer …（供 worker 拉取放映清单）",
        )

    if body.force_reexport:
        await abort_stale_project_export_jobs(
            session, project_id, "已取消：用户发起重新导出"
        )
        delete_project_export_files(settings.storage_root, project_id)
        await reset_export_only(session, project)
        await session.commit()
        await session.refresh(project)
        pl = await compute_project_pipeline(session, project)
        latest_url = latest_export_media_url(project_id, settings.storage_root)

    active = await find_active_video_export_job(session, project_id)
    if active is not None and active.id is not None:
        pl = await compute_project_pipeline(session, project)
        return ExportVideoResponse(
            output_url=latest_url or "",
            action="queued",
            pipeline=PipelineStages(**pl),
            video_exported_at=None,
            export_job_id=int(active.id),
        )
    await mark_export_running(session, project)
    session.add(project)
    job = await enqueue_video_export_job(
        session,
        project_id,
        export_width,
        export_height,
        auth_hdr,
    )
    await session.commit()
    pl = await compute_project_pipeline(session, project)
    return ExportVideoResponse(
        output_url=latest_url or "",
        action="queued",
        pipeline=PipelineStages(**pl),
        video_exported_at=None,
        export_job_id=int(job.id) if job.id is not None else None,
    )


@app.post("/internal/worker/heartbeat")
async def worker_heartbeat(
    worker_id: str | None = None,
    _: None = Depends(verify_export_worker_key),
) -> dict:
    await record_export_worker_heartbeat(worker_id)
    return {"ok": True}


@app.get(
    "/internal/worker/video-export/jobs/next",
    response_model=WorkerVideoExportJobPayload | None,
)
async def worker_claim_next_video_export(
    worker_id: str | None = None,
    _: None = Depends(verify_export_worker_key),
    session: AsyncSession = Depends(get_session),
) -> WorkerVideoExportJobPayload | None:
    label = (worker_id or "").strip() or "worker"
    job = await claim_next_video_export_job(
        session,
        label,
        stale_after_seconds=settings.export_job_running_timeout_seconds,
    )
    if job is None:
        return None
    project = await session.get(Project, job.project_id)
    if project is None:
        return None
    auth = (job.request_authorization or "").strip()
    if not auth:
        await fail_video_export_job(session, int(job.id), "任务缺少 Authorization，已丢弃")
        return None
    forced = (settings.export_play_origin or "").strip()
    frontend = forced or settings.export_frontend_url.strip()
    media_base = _export_media_base_url()
    if not media_base:
        await fail_video_export_job(
            session,
            int(job.id),
            "服务器未配置可访问的媒体根（EXPORT_PUBLIC_BASE_URL 或 EXPORT_API_URL）",
        )
        return None
    assert job.id is not None
    # --- 片头/片尾：恢复时取消注释，并在 config 中恢复 export_*_duration_ms ---
    # desc = project.description or ""
    intro_ms = 0
    outro_ms = 0
    intro_sid: int | None = None
    # if include_intro_from_description(desc) and int(
    #     settings.export_intro_duration_ms or 0
    # ) > 0:
    #     intro_ms = int(settings.export_intro_duration_ms)
    #     intro_sid = intro_style_id_from_description(desc)
    # if include_outro_from_description(desc) and int(
    #     settings.export_outro_duration_ms or 0
    # ) > 0:
    #     outro_ms = int(settings.export_outro_duration_ms)
    return WorkerVideoExportJobPayload(
        job_id=int(job.id),
        project_id=int(job.project_id),
        project_name=(project.name or "").strip() or "project",
        width=int(job.width),
        height=int(job.height),
        frontend_url=frontend,
        api_url=(settings.export_api_url or "").strip(),
        media_base_url=media_base,
        authorization=auth,
        export_intro_ms=intro_ms,
        export_outro_ms=outro_ms,
        intro_style_id=intro_sid,
    )


async def _drain_upload_file(file: UploadFile, *, chunk_size: int = 1024 * 1024) -> None:
    """丢弃请求体，避免取消后 worker 仍上传时连接异常。"""
    try:
        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                break
    finally:
        await file.close()


@app.post("/internal/worker/video-export/jobs/{job_id}/complete")
async def worker_complete_video_export(
    job_id: int,
    file: UploadFile = File(...),
    _: None = Depends(verify_export_worker_key),
    session: AsyncSession = Depends(get_session),
) -> dict:
    job = await session.get(VideoExportJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    await session.refresh(job)
    if job.status != "running":
        await _drain_upload_file(file)
        return {"ok": True, "discarded": True}
    project = await session.get(Project, job.project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在")
    ts = time.strftime("%Y%m%d-%H%M%S")
    salt = f"{int(time.time() * 1000) % 1000:03d}-{uuid.uuid4().hex[:6]}"
    output_path = (
        settings.storage_root
        / "projects"
        / str(job.project_id)
        / "exports"
        / f"{ts}-{salt}"
        / f"{_safe_export_basename(project.name)}.mp4"
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    max_bytes = max(32, int(settings.export_upload_max_bytes))
    written = 0
    chunk_size = 1024 * 1024
    try:
        with output_path.open("wb") as fh:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"上传文件过大，当前限制为 {max_bytes // (1024 * 1024)} MiB",
                    )
                fh.write(chunk)
    except Exception:
        try:
            if output_path.exists():
                output_path.unlink()
        except OSError:
            pass
        raise
    finally:
        await file.close()
    if written < 32:
        raise HTTPException(status_code=400, detail="上传文件过小或为空")
    try:
        out_url = await complete_video_export_job(
            session, job_id, output_path, settings.storage_root
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if out_url is None:
        return {"ok": True, "discarded": True}
    return {"ok": True, "output_url": out_url}


@app.post("/internal/worker/video-export/jobs/{job_id}/fail")
async def worker_fail_video_export(
    job_id: int,
    body: WorkerVideoExportFailBody,
    _: None = Depends(verify_export_worker_key),
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        await fail_video_export_job(session, job_id, body.error)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True}


@app.get("/api/projects/{project_id}/workflow")
async def get_project_workflow(
    project_id: int,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    project = await _get_accessible_project(session, project_id, int(me.id))
    await sync_demo_workflow_from_deck(session, project_id)
    await session.commit()
    await session.refresh(project)
    return await workflow_public_dict_async(session, project)


@app.get("/api/workflows/{project_id}")
async def get_workflow_alias(
    project_id: int,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    project = await _get_accessible_project(session, project_id, int(me.id))
    await sync_demo_workflow_from_deck(session, project_id)
    await session.commit()
    await session.refresh(project)
    return await workflow_public_dict_async(session, project)


@app.post("/api/projects/{project_id}/workflow/text/run")
async def workflow_run_text(
    project_id: int,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    # 仅自动流水线：queued 表示后台 run_queued_project_pipeline_job 将接管
    if project.status == "queued" and bool(
        getattr(project, "pipeline_auto_advance", True)
    ):
        raise HTTPException(status_code=409, detail="文本正在生成中")
    if project.status == "structuring":
        text_st = await get_workflow_text_step_status(session, project)
        if text_st == WF_STEP_RUNNING:
            raise HTTPException(status_code=409, detail="文本正在生成中")
        # 取消文本后未回落、或后台异常退出导致 projects.status 陈旧
        project.status = (
            "ready" if text_st == WF_STEP_SUCCEEDED else "draft"
        )
        project.updated_at = utc_now()
        session.add(project)
        await session.commit()
        await session.refresh(project)
    background_tasks.add_task(run_text_rebuild_job, project_id)
    return {"ok": True, "queued": True}


@app.post("/api/projects/{project_id}/manual/confirm-outline")
async def manual_confirm_outline(
    project_id: int,
    body: ManualConfirmOutlineRequest,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    """手动流水线：将用户编辑后的口播分段写回 outline / node_contents。"""
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    try:
        await apply_manual_outline_confirm(session, project, body.pages)
        await session.commit()
    except ValueError as e:
        await session.rollback()
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True}


@app.post("/api/projects/{project_id}/workflow/deck_master/run")
async def workflow_run_deck_master(
    project_id: int,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    """生成/刷新演示风格母版，并同步 workflow_step_runs.deck_master。"""
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    try:
        await wf_set_step(session, project, WF_STEP_DECK_MASTER, WF_STEP_RUNNING)
        await session.commit()
        await ensure_style_base(project_id)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    await invalidate_all_page_decks_after_master_change(session, project_id)
    await session.commit()
    await session.refresh(project)
    async with async_session_maker() as wf_session:
        await notify_deck_master_success_if_pending(wf_session, project_id)
        await sync_demo_workflow_from_deck(wf_session, project_id)
        await wf_session.commit()
    row = await get_project_style(session, project)
    ready, theme, ver = deck_style_ready_from_storage(project, row)
    return {
        "ok": True,
        "deck_style_ready": ready,
        "deck_style_version": ver or 1,
        "deck_style_theme_name": theme,
        "deck_style_prompt_text": (row.style_prompt_text or "") if row else "",
    }


@app.post(
    "/api/projects/{project_id}/workflow/audio/run",
    response_model=SynthesizeAudioResponse,
)
async def workflow_run_audio(
    project_id: int,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> SynthesizeAudioResponse:
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    pl = await compute_project_pipeline(session, project)
    if not pl.get("outline"):
        raise HTTPException(status_code=409, detail="请先完成文本结构化")
    if project.status == "synthesizing":
        raise HTTPException(status_code=409, detail="配音进行中")
    try:
        return await run_synthesize_project_audio(session, project_id)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"配音过程异常：{e}",
        ) from e


@app.post("/api/projects/{project_id}/workflow/demo/run")
async def workflow_run_demo(
    project_id: int,
    background_tasks: BackgroundTasks,
    beta_visual: Annotated[bool, Query()] = False,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    pl = await compute_project_pipeline(session, project)
    if not pl.get("outline"):
        raise HTTPException(status_code=409, detail="请先完成文本结构化")
    wf = await workflow_public_dict_async(session, project)
    if (wf.get("deckMasterStatus") or "").strip().lower() != "succeeded":
        raise HTTPException(status_code=409, detail="请先完成演示母版")
    if (await compute_project_deck_status(session, project_id)) == "generating":
        raise HTTPException(status_code=409, detail="演示生成中")
    timeline = await load_deck_timeline(session, project_id)
    if not timeline:
        raise HTTPException(status_code=400, detail="没有可演示的分段")
    all_page_ids = await collect_deck_page_node_ids(session, project_id)
    if not all_page_ids:
        raise HTTPException(
            status_code=400,
            detail="没有可生成演示的大页（每页下需至少有 step 或 pause）",
        )
    page_ids = await collect_deck_page_node_ids_needing_generation(session, project_id)
    if not page_ids:
        raise HTTPException(
            status_code=409,
            detail="所有演示页均已生成成功，无需重新生成。",
        )
    started: list[int] = []
    for nid in page_ids:
        st = await try_start_page_deck_generation(session, project_id, nid)
        if st == "ok":
            started.append(nid)
    if not started:
        raise HTTPException(
            status_code=409,
            detail="没有可启动的页面（可能均在生成中）",
        )
    background_tasks.add_task(
        run_generate_deck_all_job, project_id, started, beta_visual=beta_visual
    )
    return {"started_page_node_ids": started, "count": len(started)}


@app.post(
    "/api/projects/{project_id}/workflow/export/run",
    response_model=ExportVideoResponse,
)
async def workflow_run_export(
    project_id: int,
    body: ExportVideoRequest,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
    authorization: Annotated[str | None, Header()] = None,
) -> ExportVideoResponse:
    return await export_video(
        project_id, body, session, me, authorization
    )


@app.get("/api/projects/{project_id}/workflow/export/download")
async def workflow_export_download(
    project_id: int,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> RedirectResponse:
    project = await _get_accessible_project(session, project_id, int(me.id))
    pl = await compute_project_pipeline(session, project)
    url = latest_export_media_url(project_id, settings.storage_root)
    if pl.get("video") and url:
        return RedirectResponse(url=url, status_code=302)
    raise HTTPException(status_code=404, detail="暂无可下载的导出文件")


@app.get("/api/projects/{project_id}/outline-nodes/{node_id}/deck-preview")
async def get_deck_page_preview(
    project_id: int,
    node_id: int,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    """单页演示 HTML 预览用（不入放映）。"""
    project = await _get_accessible_project(session, project_id, int(me.id))
    node = await session.get(OutlineNode, node_id)
    if (
        node is None
        or node.project_id != project_id
        or node.node_kind != KIND_PAGE
    ):
        raise HTTPException(status_code=404, detail="页面节点不存在")
    res = await session.exec(select(NodeContent).where(NodeContent.node_id == node.id))
    nc = res.first()
    title = (node.title or "").strip() or "（未命名页）"
    return {
        "title": title,
        "html": (nc.page_code or "").strip() if nc else "",
        "page_deck_status": (nc.page_deck_status if nc else None) or "idle",
        "page_deck_error": nc.page_deck_error if nc else None,
    }


@app.post("/api/projects/{project_id}/outline-nodes/{node_id}/generate-deck-page")
async def generate_deck_page(
    project_id: int,
    node_id: int,
    background_tasks: BackgroundTasks,
    beta_visual: Annotated[bool, Query()] = False,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    """按页调用 DeepSeek 生成该页 HTML，写入对应 NodeContent.page_code。"""
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    timeline = await load_deck_timeline(session, project_id)
    if not timeline:
        raise HTTPException(status_code=400, detail="没有可演示的分段")

    started = await try_start_page_deck_generation(session, project_id, node_id)
    if started == "not_found":
        raise HTTPException(status_code=404, detail="页面节点不存在")
    if started == "conflict":
        raise HTTPException(status_code=409, detail="该页演示正在生成中，请稍候")

    background_tasks.add_task(
        run_generate_deck_page_job,
        project_id,
        node_id,
        beta_visual=beta_visual,
    )
    return {"page_deck_status": "generating", "page_node_id": node_id}


@app.post("/api/projects/{project_id}/outline-nodes/{node_id}/contextual-ai/draft")
async def generate_contextual_ai_draft(
    project_id: int,
    node_id: int,
    body: ContextualAIDraftRequest,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    node = await session.get(OutlineNode, node_id)
    if node is None or node.project_id != project_id or node.node_kind != KIND_PAGE:
        raise HTTPException(status_code=404, detail="页面节点不存在")
    res = await session.exec(select(NodeContent).where(NodeContent.node_id == node.id))
    nc = res.first()
    current_html = (nc.page_code or "").strip() if nc else ""
    current_json_text = (body.current_json or "").strip()
    if not current_json_text:
        current_json_text = json.dumps(
            {
                "main_title": (node.title or "").strip() or "（未命名页）",
                "html": current_html,
            },
            ensure_ascii=False,
        )
    style_prompt = await fetch_style_prompt_for_project(session, project)
    try:
        draft = await generate_contextual_page_draft(
            current_json_text=current_json_text,
            instruction=body.instruction,
            style_prompt_text=style_prompt,
            page_size=_DEFAULT_PAGE_SIZE,
        )
    except RuntimeError as e:
        # 将 AI 侧可预期失败（鉴权/限流/解析失败等）转为可读错误，避免前端只看到 500。
        raise HTTPException(status_code=502, detail=str(e)) from e
    main_title = (str(draft.get("main_title", "")).strip() or (node.title or "").strip() or "（未命名页）")
    html = str(draft.get("html", "")).strip()
    if not html:
        raise HTTPException(status_code=500, detail="AI 返回草稿缺少 html")
    return {
        "draft_json": {"main_title": main_title, "html": html},
        "main_title": main_title,
        "draft_html": html,
        "page_node_id": node_id,
    }


@app.post("/api/projects/{project_id}/outline-nodes/{node_id}/contextual-ai/apply")
async def apply_contextual_ai_draft(
    project_id: int,
    node_id: int,
    body: ContextualAIDraftApplyRequest,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    node = await session.get(OutlineNode, node_id)
    if node is None or node.project_id != project_id or node.node_kind != KIND_PAGE:
        raise HTTPException(status_code=404, detail="页面节点不存在")
    draft = body.draft_json or {}
    main_title = (
        str(draft.get("main_title", "")).strip()
        or (node.title or "").strip()
        or "（未命名页）"
    )
    html = str(draft.get("html", "")).strip()
    if not html:
        raise HTTPException(status_code=400, detail="draft_json.html 不能为空")
    res = await session.exec(select(NodeContent).where(NodeContent.node_id == node.id))
    nc = res.first()
    now = utc_now()
    if nc is None:
        nc = NodeContent(
            node_id=node.id,
            page_code=html,
            narration_text="",
            duration_ms=None,
            audio_sequence=0,
            audio_asset_id=None,
            image_asset_id=None,
            background_asset_id=None,
            page_deck_status="ready",
            page_deck_error=None,
            created_at=now,
            updated_at=now,
        )
    else:
        nc.page_code = html
        nc.page_deck_status = "ready"
        nc.page_deck_error = None
        nc.updated_at = now
    session.add(nc)
    project.updated_at = now
    session.add(project)
    await reset_export_only(session, project)
    await sync_demo_workflow_from_deck(session, project_id)
    await session.commit()
    return {"ok": True, "page_node_id": node_id}


@app.post("/api/projects/{project_id}/outline-nodes/{node_id}/cancel-deck-page")
async def cancel_deck_page(
    project_id: int,
    node_id: int,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    st = await try_cancel_page_deck_generation(
        session,
        project_id,
        node_id,
        reason="用户手动取消该页场景生成",
    )
    if st == "not_found":
        raise HTTPException(status_code=404, detail="页面节点不存在")
    if st == "noop":
        return {"ok": True, "cancelled": False, "reason": "当前页面不在生成中"}
    await sync_demo_workflow_from_deck(session, project_id)
    await session.commit()
    return {"ok": True, "cancelled": True, "page_node_id": node_id}


@app.post("/api/projects/{project_id}/cancel-deck-all")
async def cancel_deck_all_pages(
    project_id: int,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    cancelled_ids = await cancel_generating_deck_pages(
        session,
        project_id,
        reason="用户手动取消全部场景生成",
        user_cancelled=True,
    )
    await sync_demo_workflow_from_deck(session, project_id)
    await session.commit()
    return {
        "ok": True,
        "cancelled_count": len(cancelled_ids),
        "cancelled_page_node_ids": cancelled_ids,
    }


@app.patch("/api/projects/{project_id}/deck-style")
async def patch_project_deck_style(
    project_id: int,
    body: DeckStylePatch,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    # 区分「未传字段」与「显式传 null」：清空提示词须传 deck_style_user_hint: null，
    # 否则旧 user_style_hint 会保留并继续参与母版生成。
    provided = body.model_fields_set
    if not provided.intersection({"deck_style_preset", "deck_style_user_hint"}):
        raise HTTPException(
            status_code=400,
            detail="至少提供 deck_style_preset / deck_style_user_hint 之一",
        )
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    st = await get_or_create_project_style(session, project_id, for_update=True)
    if "deck_style_preset" in provided:
        preset_raw = body.deck_style_preset
        preset = (
            (preset_raw.strip() if isinstance(preset_raw, str) else "")
            or DEFAULT_DECK_STYLE_PRESET
        )
        try:
            resolve_deck_style_preset(preset)
        except RuntimeError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        st.style_preset = preset
    if "deck_style_user_hint" in provided:
        hint_raw = body.deck_style_user_hint
        if hint_raw is None:
            st.user_style_hint = None
        else:
            st.user_style_hint = str(hint_raw).strip() or None
    now = utc_now()
    st.style_data_json = None
    st.style_base_json = ""
    st.style_prompt_text = ""
    st.version = int(st.version or 1) + 1
    st.updated_at = now
    session.add(st)
    await reset_export_only(session, project)
    if provided.intersection({"deck_style_preset", "deck_style_user_hint"}):
        nd = merge_deck_master_source_id(project.description, None)
        if nd != project.description:
            project.description = nd
    project.updated_at = now
    session.add(project)
    await invalidate_all_page_decks_after_master_change(session, project_id)
    await session.commit()
    return {"ok": True}


@app.post("/api/projects/{project_id}/copy-deck-style-from")
async def copy_deck_style_from_project(
    project_id: int,
    body: CopyDeckStyleFromRequest,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    """将另一项目已就绪的演示母版（project_styles）挂到当前项目。"""
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    src = await _get_accessible_project(session, body.source_project_id, int(me.id))
    src_style_row = await get_project_style(session, src)
    if src_style_row is None:
        raise HTTPException(status_code=400, detail="源项目没有演示样式记录")
    ready, _, _ = deck_style_ready_from_storage(src, src_style_row)
    if not ready:
        raise HTTPException(
            status_code=400,
            detail="源项目还没有可用的演示风格母版，请换项目或先生成母版",
        )
    now = utc_now()
    project.style_id = int(src_style_row.id)
    src_pid = int(body.source_project_id)
    nd = merge_deck_master_source_id(project.description, src_pid)
    project.description = nd if nd is not None else format_deck_master_source_description(
        src_pid
    )
    project.updated_at = now
    session.add(project)
    await reset_export_only(session, project)
    await invalidate_all_page_decks_after_master_change(session, project_id)
    await session.commit()
    async with async_session_maker() as wf_session:
        await notify_deck_master_success_if_pending(wf_session, project_id)
        await sync_demo_workflow_from_deck(wf_session, project_id)
        await wf_session.commit()
    return {"ok": True}


@app.patch("/api/projects/{project_id}/deck-style-prompt-text")
async def patch_project_deck_style_prompt_text(
    project_id: int,
    body: DeckStylePromptTextPatch,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    """更新当前项目关联的 style_prompt_text（不改母版 JSON，供后续演示生成参考）。"""
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    st = await get_or_create_project_style(session, project_id, for_update=True)
    now = utc_now()
    st.style_prompt_text = body.deck_style_prompt_text or ""
    st.updated_at = now
    session.add(st)
    project.updated_at = now
    session.add(project)
    await reset_export_only(session, project)
    await session.commit()
    return {"ok": True}


@app.post("/api/projects/{project_id}/generate-deck-style")
async def generate_project_deck_style(
    project_id: int,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    """仅生成/刷新演示风格母版（写入 project_styles），不生成页面 HTML。"""
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    try:
        await wf_set_step(session, project, WF_STEP_DECK_MASTER, WF_STEP_RUNNING)
        await session.commit()
        await ensure_style_base(project_id)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    await invalidate_all_page_decks_after_master_change(session, project_id)
    await session.commit()
    await session.refresh(project)
    # 独立「刷新母版」接口只写 project_styles，须同步 workflow_step_runs.deck_master，
    # 否则顶栏仍显示母版失败（分步 UI 以 workflow 为准）。
    async with async_session_maker() as wf_session:
        await notify_deck_master_success_if_pending(wf_session, project_id)
        await sync_demo_workflow_from_deck(wf_session, project_id)
        await wf_session.commit()
    row = await get_project_style(session, project)
    ready, theme, ver = deck_style_ready_from_storage(project, row)
    return {
        "ok": True,
        "deck_style_ready": ready,
        "deck_style_version": ver or 1,
        "deck_style_theme_name": theme,
        "deck_style_prompt_text": (row.style_prompt_text or "") if row else "",
    }


@app.post("/api/projects/{project_id}/generate-deck-all")
async def generate_deck_all_pages(
    project_id: int,
    background_tasks: BackgroundTasks,
    beta_visual: Annotated[bool, Query()] = False,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    timeline = await load_deck_timeline(session, project_id)
    if not timeline:
        raise HTTPException(status_code=400, detail="没有可演示的分段")
    all_page_ids = await collect_deck_page_node_ids(session, project_id)
    if not all_page_ids:
        raise HTTPException(
            status_code=400,
            detail="没有可生成演示的大页（每页下需至少有 step 或 pause）",
        )
    page_ids = await collect_deck_page_node_ids_needing_generation(session, project_id)
    if not page_ids:
        raise HTTPException(
            status_code=409,
            detail="所有演示页均已生成成功，无需重新生成。",
        )
    started: list[int] = []
    for nid in page_ids:
        st = await try_start_page_deck_generation(session, project_id, nid)
        if st == "ok":
            started.append(nid)
    if not started:
        raise HTTPException(
            status_code=409,
            detail="没有可启动的页面（可能均在生成中）",
        )
    background_tasks.add_task(
        run_generate_deck_all_job, project_id, started, beta_visual=beta_visual
    )
    return {"started_page_node_ids": started, "count": len(started)}


@app.post("/api/generate-outline", response_model=GenerateOutlineResponse)
async def generate_outline(
    body: GenerateRequest,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> GenerateOutlineResponse:
    try:
        return await run_generate_outline_only(
            session,
            body.raw_text,
            project_name=body.name,
            owner_user_id=int(me.id),
        )
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"生成文案异常：{e}",
        ) from e


@app.post(
    "/api/projects/{project_id}/synthesize-audio",
    response_model=SynthesizeAudioResponse,
)
async def synthesize_audio(
    project_id: int,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> SynthesizeAudioResponse:
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    try:
        return await run_synthesize_project_audio(session, project_id)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"配音过程异常：{e}",
        ) from e


@app.patch("/api/projects/{project_id}/outline-nodes/{node_id}/narration-text")
async def patch_outline_node_narration_text(
    project_id: int,
    node_id: int,
    body: NarrationTextPatch,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    """更新单个口播 step 的 narration_text；旧时间轴与当前 mp3 可能失效，需重新配音。"""
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    node = await session.get(OutlineNode, node_id)
    if node is None or node.project_id != project_id:
        raise HTTPException(status_code=404, detail="段落节点不存在")
    if node.node_kind != KIND_STEP:
        raise HTTPException(
            status_code=400,
            detail="仅支持编辑口播 step 的正文",
        )
    res = await session.exec(select(NodeContent).where(NodeContent.node_id == node.id))
    nc = res.first()
    if nc is None:
        raise HTTPException(status_code=404, detail="段落缺少内容记录")
    t = utc_now()
    nc.narration_text = body.narration_text or ""
    if not body.preserve_alignment:
        nc.narration_alignment_json = None
    nc.updated_at = t
    session.add(nc)
    project.updated_at = t
    session.add(project)
    await reset_export_only(session, project)
    await session.commit()
    return {
        "step_node_id": node_id,
        "narration_text": nc.narration_text,
    }


@app.post("/api/projects/{project_id}/outline-nodes/{node_id}/resynthesize-audio")
async def resynthesize_step_audio(
    project_id: int,
    node_id: int,
    body: ResynthesizeStepAudioRequest = ResynthesizeStepAudioRequest(),
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    """对单个口播 step 调用豆包 TTS；默认使用该段已存口播全文，可选 body.text 覆盖合成文案。"""
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    override = body.text
    try:
        return await run_resynthesize_single_step_audio(
            session, project_id, node_id, override_text=override
        )
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"单段配音异常：{e}",
        ) from e


@app.post("/api/generate", response_model=GenerateResponse)
async def generate(
    body: GenerateRequest,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> GenerateResponse:
    try:
        return await run_generate(
            session,
            body.raw_text,
            project_name=body.name,
            owner_user_id=int(me.id),
        )
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"生成过程异常：{e}",
        ) from e
