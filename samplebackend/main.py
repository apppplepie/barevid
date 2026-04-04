import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from typing import Annotated

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Header, Query
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, or_, text
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth import (
    create_session_token,
    delete_session_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.config import settings
from app.mediautil import latest_export_media_url, resolve_slide_audio_url
from app.db.engine import async_session_maker, get_session, init_db
from app.db.models import (
    KIND_PAGE,
    KIND_STEP,
    NodeContent,
    OutlineNode,
    Project,
    ProjectStyle,
    User,
    utc_now,
)
from app.integrations.deepseek import (
    generate_contextual_page_draft,
    list_deck_style_presets,
    resolve_deck_style_preset,
)
from app.schemas import (
    CopyDeckStyleFromRequest,
    DeckStylePatch,
    DeckStylePromptTextPatch,
    ExportVideoRequest,
    ExportVideoResponse,
    GenerateOutlineResponse,
    LoginRequest,
    GenerateRequest,
    GenerateResponse,
    ManualConfirmOutlineRequest,
    PipelineStages,
    WorkflowStepControlRequest,
    ProjectCloneRequest,
    ProjectCreate,
    ProjectPatch,
    RegisterRequest,
    ResynthesizeStepAudioRequest,
    NarrationTextPatch,
    SynthesizeAudioResponse,
    AuthResponse,
    ContextualAIDraftApplyRequest,
    ContextualAIDraftRequest,
)
from app.services.deck import (
    cancel_generating_deck_pages,
    collect_deck_page_node_ids,
    collect_deck_page_node_ids_needing_generation,
    deck_style_ready_from_storage,
    ensure_style_base,
    fetch_style_prompt_for_project,
    get_or_create_project_style,
    invalidate_all_page_decks_after_master_change,
    run_generate_deck_all_job,
    run_generate_deck_page_job,
    refresh_project_deck_status,
    sync_demo_workflow_from_deck,
    try_cancel_page_deck_generation,
    try_start_page_deck_generation,
)
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
from app.services.project_clone import clone_project_deep
from app.utils.narration_length import (
    char_range_for_seconds,
    clamp_narration_seconds,
    mid_char_estimate,
)
from app.services.project_meta import (
    deck_master_source_project_id_from_description,
    format_project_meta_description,
    include_intro_from_description,
    include_outro_from_description,
    intro_style_id_from_description,
    merge_deck_master_source_id,
)
from app.services.manual_workflow import apply_manual_outline_edits
from app.services.project_pipeline import compute_project_pipeline
from app.tts_voice_presets import effective_voice_type, voice_presets_response
from app.services.workflow_engine import (
    notify_deck_master_success_if_pending,
    user_reopen_success_step,
    workflow_public_dict_async,
)
from app.services.workflow_state import (
    STEP_SUCCESS,
    can_download,
    can_start_audio_or_demo,
    can_start_export,
    manual_demo_requires_audio,
    manual_outline_blocks_media_steps,
    mark_export_failed,
    mark_export_running,
    mark_text_failed,
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
            detail="无权访问该项目（需项目所有者或已开启共享）；若使用开发令牌 legacy，请与创建项目时登录的账号一致。",
        )
    return project


def _can_manage_project(project: Project, user_id: int) -> bool:
    """仅项目拥有者可改库、跑流水线；他人仅可只读访问已云共享项目。"""
    return project.owner_user_id == user_id


async def _require_deck_master_success_for_batch_scene(
    session: AsyncSession, project: Project
) -> None:
    """
    存在分步工作流且含 deck_master 行时：生成场景页（批量或单页）前须演示母版就绪。

    与 ``workflow_public_dict_async`` 中 ``merge_deck_master_status_with_style_storage`` 对齐：
    步骤表可能仍为 pending，但 ``project_styles`` 已有有效母版正文时视为可生成场景页，
    并调用 ``notify_deck_master_success_if_pending`` 将步骤行同步为 success。
    文案须已 success 由各路由在调用本函数前通过 ``can_start_audio_or_demo`` 校验。
    """
    from app.services import workflow_engine as wf

    if project.id is None:
        return
    run = await wf._get_run(session, int(project.id))
    if run is None or run.id is None:
        return
    steps = await wf._load_steps_map(session, int(run.id))
    row = steps.get(wf.STEP_DECK_MASTER)
    if row is None:
        return
    if row.status == wf.STEP_SUCCESS:
        return
    if row.status == wf.STEP_RUNNING:
        raise HTTPException(
            status_code=409,
            detail="演示母版生成中，请稍候后再生成场景页",
        )
    if row.status == wf.STEP_FAILED:
        raise HTTPException(
            status_code=409,
            detail="请先在「演示母版」步骤完成母版后再生成场景页",
        )
    if row.status == wf.STEP_PENDING:
        st_res = await session.exec(
            select(ProjectStyle).where(ProjectStyle.project_id == int(project.id))
        )
        style_row = st_res.first()
        ready, _, _ = deck_style_ready_from_storage(project, style_row)
        if ready:
            await notify_deck_master_success_if_pending(session, int(project.id))
            return
    raise HTTPException(
        status_code=409,
        detail="请先在「演示母版」步骤完成母版后再生成场景页",
    )


async def _demo_batch_generation_busy(
    session: AsyncSession, project: Project
) -> bool:
    """是否存在进行中的批量场景页生成（用于拒绝重复启动）。

    分步工作流下「母版已成功、场景页未开始」时 ``project.demo_status`` 为未开始，
    与真实生成无关；此时 ``deck_status`` 通常不是 ``generating``。不得仅凭 ``demo_status`` 判忙。
    """
    from app.services import workflow_engine as wf

    if (project.deck_status or "").strip().lower() == "generating":
        return True
    if project.id is None:
        return (project.demo_status or "").strip().lower() == "running"
    run = await wf._get_run(session, int(project.id))
    if run is not None and run.id is not None:
        return False
    return (project.demo_status or "").strip().lower() == "running"


def _can_delete_project(project: Project, user_id: int) -> bool:
    return project.owner_user_id == user_id


def _merge_page_html_into_deck_json(
    existing_deck_json: str | None, main_title: str, html: str
) -> str:
    try:
        data = json.loads(existing_deck_json) if existing_deck_json else {"pages_html": []}
    except json.JSONDecodeError:
        data = {"pages_html": []}
    arr = data.get("pages_html")
    if not isinstance(arr, list):
        arr = []
    kept = [
        x
        for x in arr
        if not (
            isinstance(x, dict)
            and str(x.get("main_title", "")).strip() == (main_title or "").strip()
        )
    ]
    kept.append({"main_title": (main_title or "").strip(), "html": html})
    data["pages_html"] = kept
    return json.dumps(data, ensure_ascii=False)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


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
        return _even_px(w), _even_px(h)
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


def _export_subprocess_detail(exc: subprocess.CalledProcessError) -> str:
    text = (exc.stderr or exc.stdout or "").strip()
    if "ERR_CONNECTION_REFUSED" in text:
        return (
            "录屏无法打开放映页（连接被拒绝）。可任选其一："
            "① 在 neoncast-ai 目录执行 npm run dev；"
            "② 另开终端执行 npm run dev:play（专用放映/录屏，默认 5174），并在 backend/.env 设置 "
            "EXPORT_PLAY_ORIGIN=http://127.0.0.1:5174；"
            "③ 在导出 JSON 中传 frontend_url；"
            "④ 设置 EXPORT_FRONTEND_URL。"
        )
    if "Traceback (most recent call last):" in text:
        idx = text.rfind("Traceback (most recent call last):")
        tail = text[idx:]
        if len(tail) > 4500:
            tail = tail[:4500] + "\n…(已截断)"
        return tail
    if len(text) > 3500:
        return text[-3500:]
    return text or str(exc)


def _export_video_sync(
    project_id: int,
    project_name: str | None,
    project_description: str | None,
    width: int | None,
    height: int | None,
    frontend_url: str | None,
    authorization: str | None,
) -> Path:
    script_path = _repo_root() / "scripts" / "export_video.py"
    if not script_path.is_file():
        raise RuntimeError(f"export_video.py not found: {script_path}")

    ts = time.strftime("%Y%m%d-%H%M%S")
    salt = f"{int(time.time() * 1000) % 1000:03d}-{uuid.uuid4().hex[:6]}"
    output_path = (
        settings.storage_root
        / "projects"
        / str(project_id)
        / "exports"
        / f"{ts}-{salt}"
        / f"{_safe_export_basename(project_name)}.mp4"
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)

    forced = (settings.export_play_origin or "").strip()
    resolved_frontend = forced or (frontend_url or "").strip() or settings.export_frontend_url
    cmd = [
        sys.executable,
        str(script_path),
        "--project-id",
        str(project_id),
        "--output",
        str(output_path),
        "--frontend-url",
        resolved_frontend,
        "--api-url",
        settings.export_api_url,
    ]
    if width:
        cmd += ["--width", str(width)]
    if height:
        cmd += ["--height", str(height)]

    cmd += ["--storage-root", str(settings.storage_root.resolve())]

    env = os.environ.copy()
    auth = (authorization or "").strip()
    if auth:
        env["SLIDEFORGE_EXPORT_AUTHORIZATION"] = auth
    # 显式写入 0，避免子进程继承 shell 里残留的 SLIDEFORGE_EXPORT_* 导致片头/字幕错位
    if include_intro_from_description(project_description) and int(
        settings.export_intro_duration_ms or 0
    ) > 0:
        env["SLIDEFORGE_EXPORT_INTRO_MS"] = str(int(settings.export_intro_duration_ms))
    else:
        env["SLIDEFORGE_EXPORT_INTRO_MS"] = "0"
    if include_outro_from_description(project_description) and int(
        settings.export_outro_duration_ms or 0
    ) > 0:
        env["SLIDEFORGE_EXPORT_OUTRO_MS"] = str(int(settings.export_outro_duration_ms))
    else:
        env["SLIDEFORGE_EXPORT_OUTRO_MS"] = "0"

    subprocess.run(cmd, check=True, capture_output=True, text=True, env=env)
    return output_path


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True}


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


@app.get("/api/narration-length-estimate")
async def narration_length_estimate(
    seconds: int = Query(..., ge=1, le=3600, description="目标口播秒数（10～3600 内有效）"),
) -> dict:
    """按自然中文口播粗算全稿 script 字数区间，与结构化提示一致。"""
    s = clamp_narration_seconds(seconds)
    lo, hi = char_range_for_seconds(s)
    return {
        "seconds": s,
        "min_chars": lo,
        "max_chars": hi,
        "mid_chars": mid_char_estimate(s),
    }


@app.get("/api/tts/voice-presets")
async def get_tts_voice_presets(
    _me: User = Depends(get_current_user),
) -> dict:
    """豆包语音合成常用音色列表与当前服务器默认 voice_type（需登录）。"""
    return voice_presets_response()


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
    pids = [int(x.id) for x in projects if x.id is not None]
    style_by_pid: dict[int, ProjectStyle] = {}
    if pids:
        st_res = await session.exec(
            select(ProjectStyle).where(ProjectStyle.project_id.in_(pids))
        )
        for st in st_res.all():
            style_by_pid[int(st.project_id)] = st
    items: list[dict] = []
    for p in projects:
        pl = await compute_project_pipeline(session, p)
        st = style_by_pid.get(int(p.id)) if p.id is not None else None
        preset = (
            (st.style_preset if st else "none") or "none"
        ).strip() or "none"
        page_size = (p.deck_page_size or "16:9").strip() or "16:9"
        oid = int(p.owner_user_id) if p.owner_user_id is not None else 0
        items.append(
            {
                "id": p.id,
                "name": p.name,
                "owner_user_id": p.owner_user_id,
                "owner_username": username_by_uid.get(oid, ""),
                "is_shared": bool(p.is_shared),
                "status": p.status,
                "deck_status": p.deck_status or "idle",
                "deck_style_preset": preset,
                "deck_page_size": page_size,
                "created_at": p.created_at.isoformat(),
                "updated_at": p.updated_at.isoformat(),
                "latest_export_url": latest_export_media_url(
                    p.id, settings.storage_root
                ),
                "pipeline": pl,
                "workflow": await workflow_public_dict_async(
                    session, p, style_row=st
                ),
                "video_exported_at": p.video_exported_at.isoformat()
                if p.video_exported_at
                else None,
                "deck_master_source_project_id": deck_master_source_project_id_from_description(
                    p.description
                ),
                "include_intro": include_intro_from_description(p.description),
                "intro_style_id": intro_style_id_from_description(p.description),
                "include_outro": include_outro_from_description(p.description),
                "narration_target_seconds": p.narration_target_seconds,
                "pipeline_auto_advance": bool(
                    getattr(p, "pipeline_auto_advance", True)
                ),
                "text_structure_mode": (getattr(p, "text_structure_mode", None) or "polish"),
                "manual_outline_confirmed": bool(
                    getattr(p, "manual_outline_confirmed", True)
                ),
                "input_prompt": p.input_prompt,
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
    """创建项目：自动模式入队跑结构化→配音→演示；手动模式为 pending_text，需用户在工程内点「文本结构化」启动。"""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="项目名称不能为空")
    raw = body.raw_text.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="raw_text 不能为空")

    page_size = "16:9"
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
        st_res = await session.exec(
            select(ProjectStyle).where(ProjectStyle.project_id == int(copy_master_pid))
        )
        src_style_row = st_res.first()
        ready, _, _ = deck_style_ready_from_storage(src_project, src_style_row)
        if not ready:
            raise HTTPException(
                status_code=400,
                detail="源项目还没有可用的演示风格母版，请换项目或留空以自动生成",
            )

    preset = (body.deck_style_preset or "none").strip() or "none"
    if copy_master_pid is None:
        try:
            resolve_deck_style_preset(preset)
        except RuntimeError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
    else:
        assert src_style_row is not None
        preset = (src_style_row.style_preset or "none").strip() or "none"
        try:
            resolve_deck_style_preset(preset)
        except RuntimeError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    now = utc_now()
    intro_sid: int | None = None
    if body.include_intro:
        intro_sid = int(body.intro_style_id) if body.intro_style_id is not None else 1
    desc = format_project_meta_description(
        deck_master_source_project_id=(
            int(copy_master_pid) if copy_master_pid is not None else None
        ),
        include_intro=bool(body.include_intro),
        include_outro=bool(body.include_outro),
        intro_style_id=intro_sid,
    )
    tts_vt_raw = body.tts_voice_type
    tts_stored = None
    if tts_vt_raw is not None:
        tts_st = (tts_vt_raw or "").strip()
        if len(tts_st) > 128:
            raise HTTPException(status_code=400, detail="音色标识过长")
        tts_stored = tts_st or None
    auto_pipeline = bool(body.pipeline_auto_advance)
    project = Project(
        owner_user_id=int(me.id),
        user_id=int(me.id),
        is_shared=False,
        name=name,
        description=desc,
        input_prompt=raw,
        narration_target_seconds=body.narration_target_seconds,
        tts_voice_type=tts_stored,
        pipeline_auto_advance=auto_pipeline,
        status="queued" if auto_pipeline else "pending_text",
        text_status="running" if auto_pipeline else "not_started",
        audio_status="not_started",
        demo_status="not_started",
        export_status="not_started",
        deck_page_size=page_size,
        created_at=now,
        updated_at=now,
    )
    session.add(project)
    await session.commit()
    await session.refresh(project)
    assert project.id is not None
    if copy_master_pid is not None and src_style_row is not None:
        session.add(
            ProjectStyle(
                project_id=int(project.id),
                style_preset=(src_style_row.style_preset or "none").strip()
                or "none",
                user_style_hint=src_style_row.user_style_hint,
                style_prompt_text=src_style_row.style_prompt_text or "",
                style_data_json=src_style_row.style_data_json,
                style_base_json=src_style_row.style_base_json or "",
                version=int(src_style_row.version or 1),
                created_at=now,
                updated_at=now,
            )
        )
    else:
        hint_raw = body.deck_style_user_hint
        hint_val = (
            hint_raw.strip()
            if isinstance(hint_raw, str) and hint_raw.strip()
            else None
        )
        session.add(
            ProjectStyle(
                project_id=int(project.id),
                style_preset=preset,
                user_style_hint=hint_val,
                style_prompt_text="",
                style_data_json=None,
                style_base_json="",
                version=1,
                created_at=now,
                updated_at=now,
            )
        )
    # 与 project_styles 同步；供 db 迁移从 projects 回填时读到正确预设（避免 NULL 误写成默认）
    await session.execute(
        text("UPDATE projects SET deck_style_preset = :p WHERE id = :id"),
        {"p": preset, "id": int(project.id)},
    )
    await session.commit()
    from app.services import workflow_engine as _wf

    await _wf.ensure_workflow_for_project(session, project, align_from_project=True)
    await session.commit()
    if auto_pipeline:
        background_tasks.add_task(run_queued_project_pipeline_job, project.id)
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
    patch_data = body.model_dump(exclude_unset=True)
    if not patch_data:
        raise HTTPException(
            status_code=400,
            detail="请提供要修改的字段",
        )
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    if "name" in patch_data:
        name = (patch_data["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="项目名称不能为空")
        project.name = name
    if "is_shared" in patch_data:
        project.is_shared = bool(patch_data["is_shared"])
    if "tts_voice_type" in patch_data:
        raw_vt = patch_data["tts_voice_type"]
        if raw_vt is None:
            project.tts_voice_type = None
        else:
            vt = (raw_vt or "").strip()
            if len(vt) > 128:
                raise HTTPException(status_code=400, detail="音色标识过长")
            project.tts_voice_type = vt or None
    if "input_prompt" in patch_data:
        ip = patch_data["input_prompt"]
        if ip is None:
            raise HTTPException(status_code=400, detail="input_prompt 不能为 null")
        raw = str(ip).strip()
        if not raw:
            raise HTTPException(status_code=400, detail="主题素材不能为空")
        project.input_prompt = raw
    if "text_structure_mode" in patch_data:
        tsm = patch_data["text_structure_mode"]
        if tsm is None:
            project.text_structure_mode = None
        else:
            v = (str(tsm).strip().lower() or "polish")
            if v not in ("polish", "verbatim_split"):
                raise HTTPException(
                    status_code=400,
                    detail="text_structure_mode 须为 polish 或 verbatim_split",
                )
            project.text_structure_mode = v
    project.updated_at = utc_now()
    session.add(project)
    await session.commit()
    return {
        "ok": True,
        "name": project.name,
        "is_shared": bool(project.is_shared),
        "tts_voice_type": project.tts_voice_type,
        "tts_voice_effective": effective_voice_type(project.tts_voice_type),
        "input_prompt": project.input_prompt,
        "text_structure_mode": project.text_structure_mode or "polish",
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
    st_res = await session.exec(
        select(ProjectStyle).where(ProjectStyle.project_id == project_id)
    )
    st_row = st_res.first()
    if st_row is None:
        st_row = await get_or_create_project_style(session, project_id)
    preset = (st_row.style_preset or "none").strip() or "none"
    deck_style_ready, deck_style_theme_name, deck_style_version = (
        deck_style_ready_from_storage(project, st_row)
    )
    export_url = latest_export_media_url(project_id, settings.storage_root)
    pl = await compute_project_pipeline(session, project)
    return {
        "latest_export_url": export_url,
        "workflow": await workflow_public_dict_async(
            session, project, style_row=st_row
        ),
        "pipeline": pl,
        "video_exported_at": project.video_exported_at.isoformat()
        if project.video_exported_at
        else None,
        "video_source_updated_at": project.video_source_updated_at.isoformat()
        if project.video_source_updated_at
        else None,
        "project": {
            "id": project.id,
            "name": project.name,
            "owner_user_id": project.owner_user_id,
            "is_shared": bool(project.is_shared),
            "description": project.description,
            "deck_master_source_project_id": deck_master_source_project_id_from_description(
                project.description
            ),
            "include_intro": include_intro_from_description(project.description),
            "intro_style_id": intro_style_id_from_description(project.description),
            "include_outro": include_outro_from_description(project.description),
            "narration_target_seconds": project.narration_target_seconds,
            "pipeline_auto_advance": bool(
                getattr(project, "pipeline_auto_advance", True)
            ),
            "text_structure_mode": (getattr(project, "text_structure_mode", None) or "polish"),
            "manual_outline_confirmed": bool(
                getattr(project, "manual_outline_confirmed", True)
            ),
            "tts_voice_type": project.tts_voice_type,
            "tts_voice_effective": effective_voice_type(project.tts_voice_type),
            "input_prompt": project.input_prompt,
            "status": project.status,
            "deck_status": project.deck_status or "idle",
            "deck_error": project.deck_error,
            "deck_style_preset": preset,
            "deck_style_user_hint": st_row.user_style_hint or "",
            "deck_style_prompt_text": st_row.style_prompt_text or "",
            "deck_page_size": (project.deck_page_size or "16:9").strip() or "16:9",
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
    if not pl_ok and not can_start_export(project):
        raise HTTPException(status_code=409, detail="请先完成全部前置步骤后再导出")
    export_width, export_height = _resolve_export_video_size(
        project.deck_page_size, body.width, body.height
    )

    latest_url = latest_export_media_url(project_id, settings.storage_root)
    source_updated_at = (
        project.video_source_updated_at or project.created_at or project.updated_at
    )
    is_export_fresh = (
        project.video_exported_at is not None
        and project.video_exported_at >= source_updated_at
    )
    if is_export_fresh and latest_url and not body.force_reexport:
        await mark_export_success(session, project, latest_url)
        session.add(project)
        await session.commit()
        await session.refresh(project)
        pl = await compute_project_pipeline(session, project)
        return ExportVideoResponse(
            output_url=latest_url,
            action="download",
            pipeline=PipelineStages(**pl),
            video_exported_at=project.video_exported_at.isoformat()
            if project.video_exported_at
            else None,
        )

    await mark_export_running(session, project)
    session.add(project)
    await session.commit()

    try:
        output_path = await asyncio.to_thread(
            _export_video_sync,
            project_id,
            project.name,
            project.description,
            export_width,
            export_height,
            body.frontend_url,
            authorization,
        )
    except (subprocess.CalledProcessError, RuntimeError) as e:
        async with async_session_maker() as fail_session:
            p = await fail_session.get(Project, project_id)
            if p:
                detail = (
                    _export_subprocess_detail(e)
                    if isinstance(e, subprocess.CalledProcessError)
                    else str(e)
                )
                await mark_export_failed(fail_session, p, detail or "导出失败")
                await fail_session.commit()
        if isinstance(e, subprocess.CalledProcessError):
            raise HTTPException(
                status_code=500, detail=_export_subprocess_detail(e) or "导出失败"
            ) from e
        raise HTTPException(status_code=500, detail=str(e)) from e

    now = utc_now()
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在")
    project.video_exported_at = now
    # 兼容历史项目：首次成功导出时补齐 source 时间锚点，避免后续因 updated_at 变化被误判“需重导”。
    if project.video_source_updated_at is None:
        project.video_source_updated_at = now
    project.updated_at = now
    rel = output_path.relative_to(settings.storage_root)
    out_url = f"/media/{rel.as_posix()}"
    await mark_export_success(session, project, out_url)
    session.add(project)
    await session.commit()
    await session.refresh(project)
    pl = await compute_project_pipeline(session, project)
    return ExportVideoResponse(
        output_url=out_url,
        action="export",
        pipeline=PipelineStages(**pl),
        video_exported_at=project.video_exported_at.isoformat()
        if project.video_exported_at
        else None,
    )


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
    if project.text_status == "running" or project.status in (
        "queued",
        "structuring",
    ):
        raise HTTPException(status_code=409, detail="文本正在生成中")
    background_tasks.add_task(run_text_rebuild_job, project_id)
    return {"ok": True, "queued": True}


@app.post("/api/projects/{project_id}/manual/confirm-outline")
async def manual_confirm_outline(
    project_id: int,
    body: ManualConfirmOutlineRequest,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    """手动流水线：用户在大表单中改完大标题/小标题/口播后提交，写入库并允许后续配音。"""
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    if (project.text_status or "") != "success":
        raise HTTPException(status_code=409, detail="请先完成文本结构化")
    try:
        await apply_manual_outline_edits(session, project, body.pages)
        await session.commit()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True}


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
    if not can_start_audio_or_demo(project):
        raise HTTPException(status_code=409, detail="请先完成文本结构化")
    if manual_outline_blocks_media_steps(project):
        raise HTTPException(
            status_code=409,
            detail="请先在表单中确认并保存口播分段后再配音",
        )
    if project.audio_status == "running" or project.status == "synthesizing":
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
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    if not can_start_audio_or_demo(project):
        raise HTTPException(status_code=409, detail="请先完成文本结构化")
    if manual_outline_blocks_media_steps(project):
        raise HTTPException(
            status_code=409,
            detail="请先在表单中确认口播分段后再生成演示",
        )
    if manual_demo_requires_audio(project):
        if (project.audio_status or "") != STEP_SUCCESS:
            raise HTTPException(
                status_code=409,
                detail="手动流程请先完成整稿配音，再生成场景页",
            )
    await _require_deck_master_success_for_batch_scene(session, project)
    if await _demo_batch_generation_busy(session, project):
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
    background_tasks.add_task(run_generate_deck_all_job, project_id, started)
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
    if can_download(project) and (project.export_file_url or "").strip():
        return RedirectResponse(url=project.export_file_url or "", status_code=302)
    raise HTTPException(status_code=404, detail="暂无可下载的导出文件")


@app.post("/api/projects/{project_id}/workflow/step/cancel-running")
async def workflow_step_cancel_running(
    project_id: int,
    body: WorkflowStepControlRequest,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    """将当前「进行中」的步骤标记为失败（用户取消），用于顶栏流水线。"""
    from app.services import workflow_engine as wf

    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    await sync_demo_workflow_from_deck(session, project_id)
    step = body.step.strip().lower()
    cancel_allowed = {"text", "audio", "pages", "deck_master", "deck_render", "export"}
    if step not in cancel_allowed:
        raise HTTPException(status_code=400, detail=f"不支持的步骤：{body.step}")

    if step == "text":
        st = (project.status or "").strip().lower()
        if (project.text_status or "") != "running" and st not in ("queued", "structuring"):
            raise HTTPException(status_code=409, detail="文案步骤当前未在运行")
        await mark_text_failed(session, project, "用户已取消")
        project.status = "failed"
        project.updated_at = utc_now()
        session.add(project)
    elif step == "audio":
        if (project.audio_status or "") != "running" and (
            project.status or ""
        ).strip().lower() != "synthesizing":
            raise HTTPException(status_code=409, detail="配音步骤当前未在运行")
        await wf.set_step(
            session,
            project,
            wf.STEP_AUDIO,
            wf.STEP_FAILED,
            error_message="用户已取消",
        )
        project.status = "failed"
        project.updated_at = utc_now()
        session.add(project)
    elif step == "export":
        run = await wf.ensure_workflow_for_project(
            session, project, align_from_project=False
        )
        ex = await wf._get_export_row(session, int(run.id)) if run and run.id else None
        exporting = ex is not None and ex.status == wf.EXPORT_EXPORTING
        proj_run = (project.export_status or "").strip().lower() == "running"
        if not exporting and not proj_run:
            raise HTTPException(status_code=409, detail="导出当前未在进行")
        await mark_export_failed(session, project, "用户已取消")
    elif step == "deck_master":
        run = await wf.ensure_workflow_for_project(
            session, project, align_from_project=False
        )
        if run is None or run.id is None:
            raise HTTPException(status_code=409, detail="工作流未初始化")
        steps = await wf._load_steps_map(session, int(run.id))
        dm = steps.get(wf.STEP_DECK_MASTER)
        if dm is None or dm.status != wf.STEP_RUNNING:
            raise HTTPException(status_code=409, detail="母版步骤当前未在运行")
        await wf.set_step(
            session,
            project,
            wf.STEP_DECK_MASTER,
            wf.STEP_FAILED,
            error_message="用户已取消",
        )
    elif step in ("pages", "deck_render"):
        await cancel_generating_deck_pages(session, project_id, reason="用户已取消")
        await session.refresh(project)
        run = await wf.ensure_workflow_for_project(
            session, project, align_from_project=False
        )
        if run is not None and run.id is not None:
            steps = await wf._load_steps_map(session, int(run.id))
            dr = steps.get(wf.STEP_DECK_RENDER)
            if dr is not None and dr.status == wf.STEP_RUNNING:
                await wf.set_step(
                    session,
                    project,
                    wf.STEP_DECK_RENDER,
                    wf.STEP_FAILED,
                    error_message="用户已取消",
                )
        await sync_demo_workflow_from_deck(session, project_id)

    await session.commit()
    await session.refresh(project)
    return {"ok": True}


@app.post("/api/projects/{project_id}/workflow/step/reopen-success")
async def workflow_step_reopen_success(
    project_id: int,
    body: WorkflowStepControlRequest,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    """将指定步骤及其下游回退为未开始，并强制手动流水线（用于顶栏「回退」）。"""
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    await sync_demo_workflow_from_deck(session, project_id)
    try:
        await user_reopen_success_step(session, project, body.step.strip().lower())
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    await refresh_project_deck_status(session, project_id)
    await session.commit()
    await session.refresh(project)
    return {"ok": True}


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
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    """按页调用 DeepSeek 生成该页 HTML，写入对应 NodeContent.page_code。"""
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    if not can_start_audio_or_demo(project):
        raise HTTPException(status_code=409, detail="请先完成文本结构化")
    if manual_outline_blocks_media_steps(project):
        raise HTTPException(
            status_code=409,
            detail="请先在表单中确认口播分段后再生成演示页",
        )
    if manual_demo_requires_audio(project):
        if (project.audio_status or "") != STEP_SUCCESS:
            raise HTTPException(
                status_code=409,
                detail="手动流程请先完成整稿配音，再生成场景页",
            )
    await _require_deck_master_success_for_batch_scene(session, project)
    timeline = await load_deck_timeline(session, project_id)
    if not timeline:
        raise HTTPException(status_code=400, detail="没有可演示的分段")

    started = await try_start_page_deck_generation(session, project_id, node_id)
    if started == "not_found":
        raise HTTPException(status_code=404, detail="页面节点不存在")
    if started == "conflict":
        raise HTTPException(status_code=409, detail="该页演示正在生成中，请稍候")

    background_tasks.add_task(run_generate_deck_page_job, project_id, node_id)
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
            page_size=project.deck_page_size,
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
    project.deck_json = _merge_page_html_into_deck_json(project.deck_json, main_title, html)
    project.deck_status = "ready"
    project.video_source_updated_at = now
    project.video_exported_at = None
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
        reason="用户手动取消该页生成（已标记失败）",
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
        reason="用户手动取消全部页面生成（已标记失败）",
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
    if (
        body.deck_style_preset is None
        and body.deck_style_user_hint is None
        and body.deck_page_size is None
    ):
        raise HTTPException(
            status_code=400,
            detail="至少提供 deck_style_preset / deck_style_user_hint / deck_page_size 之一",
        )
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    st = await get_or_create_project_style(session, project_id)
    if body.deck_style_preset is not None:
        try:
            resolve_deck_style_preset(body.deck_style_preset)
        except RuntimeError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        st.style_preset = body.deck_style_preset.strip() or "none"
        await session.execute(
            text("UPDATE projects SET deck_style_preset = :p WHERE id = :id"),
            {"p": st.style_preset, "id": project_id},
        )
    if body.deck_style_user_hint is not None:
        uh = body.deck_style_user_hint.strip() or None
        st.user_style_hint = uh
    if body.deck_page_size is not None:
        ps = body.deck_page_size.strip()
        if ps not in DECK_PAGE_SIZE_OPTIONS:
            raise HTTPException(
                status_code=400,
                detail="deck_page_size 非法，可选：16:9, 4:3, 9:16, 1:1",
            )
        project.deck_page_size = ps
    now = utc_now()
    st.style_data_json = None
    st.style_base_json = ""
    st.style_prompt_text = ""
    st.version = int(st.version or 1) + 1
    st.updated_at = now
    session.add(st)
    project.video_source_updated_at = now
    project.video_exported_at = None
    await reset_export_only(session, project)
    project.updated_at = now
    if body.deck_style_preset is not None or body.deck_style_user_hint is not None:
        nd = merge_deck_master_source_id(project.description, None)
        if nd != project.description:
            project.description = nd
    session.add(project)
    await invalidate_all_page_decks_after_master_change(session, project_id)
    await session.commit()
    return {"ok": True}


@app.patch("/api/projects/{project_id}/deck-style-prompt-text")
async def patch_deck_style_prompt_text(
    project_id: int,
    body: DeckStylePromptTextPatch,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    """写入风格表中的 AI 风格说明；供生成场景页前在前端展示并微调。"""
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    st = await get_or_create_project_style(session, project_id)
    text = (body.deck_style_prompt_text or "").strip()
    now = utc_now()
    st.style_prompt_text = text
    st.version = int(st.version or 1) + 1
    st.updated_at = now
    session.add(st)
    project.updated_at = now
    session.add(project)
    await session.commit()
    return {"ok": True, "deck_style_prompt_text": text}


@app.post("/api/projects/{project_id}/copy-deck-style-from")
async def copy_project_deck_style_from(
    project_id: int,
    body: CopyDeckStyleFromRequest,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    """从已有工程复制就绪的演示母版样式到本项目，不调用模型生成母版。"""
    src_pid = int(body.source_project_id)
    if src_pid == int(project_id):
        raise HTTPException(status_code=400, detail="不能从本项目复制母版")
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    src_project = await _get_accessible_project(session, src_pid, int(me.id))
    st_res = await session.exec(
        select(ProjectStyle).where(ProjectStyle.project_id == src_pid)
    )
    src_style_row = st_res.first()
    ready, _, _ = deck_style_ready_from_storage(src_project, src_style_row)
    if not ready:
        raise HTTPException(
            status_code=400,
            detail="源项目还没有可用的演示风格母版，请换项目或改用「自己设计」生成",
        )
    assert src_style_row is not None
    tgt_st = await get_or_create_project_style(session, project_id)
    now = utc_now()
    tgt_st.style_preset = (src_style_row.style_preset or "none").strip() or "none"
    tgt_st.user_style_hint = src_style_row.user_style_hint
    tgt_st.style_prompt_text = src_style_row.style_prompt_text or ""
    tgt_st.style_data_json = src_style_row.style_data_json
    tgt_st.style_base_json = src_style_row.style_base_json or ""
    tgt_st.version = int(tgt_st.version or 1) + 1
    tgt_st.updated_at = now
    session.add(tgt_st)
    preset = tgt_st.style_preset
    await session.execute(
        text("UPDATE projects SET deck_style_preset = :p WHERE id = :id"),
        {"p": preset, "id": project_id},
    )
    nd = merge_deck_master_source_id(project.description, src_pid)
    if nd != project.description:
        project.description = nd
    project.video_source_updated_at = now
    project.video_exported_at = None
    await reset_export_only(session, project)
    project.updated_at = now
    session.add(project)
    await invalidate_all_page_decks_after_master_change(session, project_id)
    await session.commit()
    async with async_session_maker() as wf_session:
        await notify_deck_master_success_if_pending(wf_session, project_id)
        await sync_demo_workflow_from_deck(wf_session, project_id)
        await wf_session.commit()
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
        await ensure_style_base(project_id)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    await invalidate_all_page_decks_after_master_change(session, project_id)
    await session.commit()
    # 独立「刷新母版」接口只写 project_styles，须同步 workflow_step_runs.deck_master，
    # 否则顶栏仍显示母版失败（分步 UI 以 workflow 为准）。
    async with async_session_maker() as wf_session:
        await notify_deck_master_success_if_pending(wf_session, project_id)
        await sync_demo_workflow_from_deck(wf_session, project_id)
        await wf_session.commit()
    st_res = await session.exec(
        select(ProjectStyle).where(ProjectStyle.project_id == project_id)
    )
    row = st_res.first()
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
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    if not can_start_audio_or_demo(project):
        raise HTTPException(status_code=409, detail="请先完成文本结构化")
    if manual_outline_blocks_media_steps(project):
        raise HTTPException(
            status_code=409,
            detail="请先在表单中确认口播分段后再生成演示",
        )
    if manual_demo_requires_audio(project):
        if (project.audio_status or "") != STEP_SUCCESS:
            raise HTTPException(
                status_code=409,
                detail="手动流程请先完成整稿配音，再生成场景页",
            )
    await _require_deck_master_success_for_batch_scene(session, project)
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
    background_tasks.add_task(run_generate_deck_all_job, project_id, started)
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
            narration_target_seconds=body.narration_target_seconds,
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
    if manual_outline_blocks_media_steps(project):
        raise HTTPException(
            status_code=409,
            detail="请先在表单中确认并保存口播分段后再配音",
        )
    try:
        return await run_synthesize_project_audio(session, project_id)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"配音过程异常：{e}",
        ) from e


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


@app.patch("/api/projects/{project_id}/outline-nodes/{node_id}/narration-text")
async def patch_outline_node_narration_text(
    project_id: int,
    node_id: int,
    body: NarrationTextPatch,
    session: AsyncSession = Depends(get_session),
    me: User = Depends(get_current_user),
) -> dict:
    """仅更新 step 节点已保存的口播正文（不触发 TTS）。"""
    project = await _get_accessible_project(session, project_id, int(me.id))
    if not _can_manage_project(project, int(me.id)):
        raise HTTPException(status_code=403, detail="无权限修改该项目")
    node = await session.get(OutlineNode, node_id)
    if node is None or node.project_id != project_id:
        raise HTTPException(status_code=404, detail="段落节点不存在")
    if node.node_kind != KIND_STEP:
        raise HTTPException(status_code=400, detail="仅支持对口播 step 更新文案")
    res = await session.exec(select(NodeContent).where(NodeContent.node_id == node.id))
    nc = res.first()
    if nc is None:
        raise HTTPException(status_code=400, detail="段落缺少内容记录")
    t = utc_now()
    nc.narration_text = body.narration_text
    nc.updated_at = t
    session.add(nc)
    project.updated_at = t
    session.add(project)
    await session.commit()
    return {"ok": True, "node_id": node_id}


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
            narration_target_seconds=body.narration_target_seconds,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"生成过程异常：{e}",
        ) from e
