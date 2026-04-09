import asyncio
import json
from collections.abc import AsyncGenerator, Awaitable, Callable
from datetime import datetime, timezone
from typing import TypeVar

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import settings

T = TypeVar("T")

_raw_db_url = (settings.database_url or "").strip()
if not _raw_db_url:
    raise RuntimeError(
        "未设置 DATABASE_URL。后端只读取 SlideForge/backend/.env（不是 frontend/.env）。\n"
        "示例：DATABASE_URL=mysql+asyncmy://user:pass@localhost:3306/slideforge?charset=utf8mb4\n"
        "若必须使用 SQLite，请显式填写 sqlite+aiosqlite:////绝对路径/slideforge.db"
    )

DATABASE_URL = _raw_db_url

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"timeout": 30} if DATABASE_URL.startswith("sqlite") else {},
)
async_session_maker = sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    # 避免 SELECT 触发隐式 flush（Query-invoked autoflush），降低并发更新时死锁概率。
    autoflush=False,
)


def _migrate_project_styles_v2(sync_conn) -> None:
    """project_styles 增加列并从旧 projects 风格列 / style_base_json 回填。"""
    insp = inspect(sync_conn)
    if not insp.has_table("project_styles"):
        return
    proj_cols = {c["name"] for c in insp.get_columns("projects")}
    has_proj_preset = "deck_style_preset" in proj_cols
    has_proj_hint = "deck_style_user_hint" in proj_cols
    has_proj_cache = "deck_style_cache_json" in proj_cols

    for sql in (
        "ALTER TABLE project_styles ADD COLUMN style_preset TEXT DEFAULT 'none'",
        "ALTER TABLE project_styles ADD COLUMN user_style_hint TEXT",
        "ALTER TABLE project_styles ADD COLUMN style_prompt_text TEXT DEFAULT ''",
        "ALTER TABLE project_styles ADD COLUMN style_data_json TEXT",
    ):
        try:
            sync_conn.execute(text(sql))
        except OperationalError as e:
            err = str(e).lower()
            if "duplicate column" not in err:
                raise

    insp = inspect(sync_conn)
    cols = {c["name"] for c in insp.get_columns("project_styles")}
    if "origin_project_id" in cols and "project_id" not in cols:
        return
    if "style_base_json" in cols and "style_data_json" in cols:
        sync_conn.execute(
            text(
                "UPDATE project_styles SET style_data_json = style_base_json "
                "WHERE (style_data_json IS NULL OR TRIM(style_data_json) = '') "
                "AND style_base_json IS NOT NULL AND TRIM(style_base_json) != ''"
            )
        )

    rows = sync_conn.execute(
        text("SELECT id, style_data_json, style_base_json FROM project_styles")
    ).fetchall()
    for rid, data_j, legacy_j in rows:
        blob = (data_j or "").strip() or (legacy_j or "").strip()
        if not blob:
            continue
        try:
            cache = json.loads(blob)
        except json.JSONDecodeError:
            continue
        if not isinstance(cache, dict):
            continue
        preset = cache.get("preset")
        hint = cache.get("user_hint")
        sb = cache.get("style_base")
        prompt = ""
        if isinstance(sb, dict):
            ss = sb.get("style_summary")
            if isinstance(ss, str) and ss.strip():
                prompt = ss.strip()
        sync_conn.execute(
            text(
                "UPDATE project_styles SET style_preset = COALESCE(:sp, style_preset), "
                "user_style_hint = COALESCE(:uh, user_style_hint), "
                "style_prompt_text = CASE WHEN (style_prompt_text IS NULL OR TRIM(style_prompt_text) = '') "
                "AND :pt != '' THEN :pt ELSE style_prompt_text END "
                "WHERE id = :id"
            ),
            {
                "sp": preset if isinstance(preset, str) and preset.strip() else None,
                "uh": hint if hint is not None else None,
                "pt": prompt,
                "id": rid,
            },
        )

    if has_proj_preset or has_proj_hint or has_proj_cache:
        plist = sync_conn.execute(text("SELECT id FROM projects")).fetchall()
        for (pid,) in plist:
            ex = sync_conn.execute(
                text("SELECT id FROM project_styles WHERE project_id = :pid"),
                {"pid": pid},
            ).first()
            if ex:
                if has_proj_preset or has_proj_hint:
                    prow = sync_conn.execute(
                        text(
                            "SELECT deck_style_preset, deck_style_user_hint "
                            "FROM projects WHERE id = :pid"
                        ),
                        {"pid": pid},
                    ).first()
                    if prow:
                        pp, ph = prow[0], prow[1]
                        # POST /api/projects 只写 project_styles，不写 projects.deck_style_preset；
                        # 若此处用 NULL 回退成占位 none，会在每次 init_db 覆盖用户所选预设，
                        # 而 style_prompt_text 仍为原风格 → 出现「库中是极光玻璃、画面却是别的风格」。
                        pp_s = (pp or "").strip()
                        if pp_s:
                            if ph is not None:
                                sync_conn.execute(
                                    text(
                                        "UPDATE project_styles SET style_preset = :sp, "
                                        "user_style_hint = :uh WHERE project_id = :pid"
                                    ),
                                    {"sp": pp_s, "uh": ph, "pid": pid},
                                )
                            else:
                                sync_conn.execute(
                                    text(
                                        "UPDATE project_styles SET style_preset = :sp "
                                        "WHERE project_id = :pid"
                                    ),
                                    {"sp": pp_s, "pid": pid},
                                )
                        elif has_proj_hint:
                            ph_s = (ph or "").strip() if ph is not None else ""
                            if ph_s:
                                sync_conn.execute(
                                    text(
                                        "UPDATE project_styles SET user_style_hint = :uh "
                                        "WHERE project_id = :pid"
                                    ),
                                    {"uh": ph_s, "pid": pid},
                                )
                if has_proj_cache:
                    sd_row = sync_conn.execute(
                        text(
                            "SELECT style_data_json FROM project_styles WHERE project_id = :pid"
                        ),
                        {"pid": pid},
                    ).first()
                    cur = (sd_row[0] or "").strip() if sd_row else ""
                    if not cur:
                        c_row = sync_conn.execute(
                            text(
                                "SELECT deck_style_cache_json FROM projects WHERE id = :pid"
                            ),
                            {"pid": pid},
                        ).first()
                        cj = (c_row[0] or "").strip() if c_row else ""
                        if cj:
                            sync_conn.execute(
                                text(
                                    "UPDATE project_styles SET style_data_json = :s, "
                                    "style_base_json = :s WHERE project_id = :pid"
                                ),
                                {"s": cj, "pid": pid},
                            )
                continue
            if has_proj_cache:
                prow = sync_conn.execute(
                    text(
                        "SELECT deck_style_preset, deck_style_user_hint, deck_style_cache_json "
                        "FROM projects WHERE id = :pid"
                    ),
                    {"pid": pid},
                ).first()
            else:
                prow = sync_conn.execute(
                    text(
                        "SELECT deck_style_preset, deck_style_user_hint "
                        "FROM projects WHERE id = :pid"
                    ),
                    {"pid": pid},
                ).first()
            if not prow:
                continue
            pp, ph = prow[0], prow[1]
            pc = prow[2] if has_proj_cache and len(prow) > 2 else None
            sp = (pp or "").strip() or "none"
            cache_s = (pc or "").strip() if isinstance(pc, str) else ""
            legacy_blob = cache_s if cache_s else "{}"
            now = _dt_param(None)
            sync_conn.execute(
                text(
                    "INSERT INTO project_styles (project_id, style_preset, user_style_hint, "
                    "style_prompt_text, style_data_json, style_base_json, version, created_at, updated_at) "
                    "VALUES (:pid, :sp, :uh, '', :sd, :sb, 1, :c, :u)"
                ),
                {
                    "pid": pid,
                    "sp": sp,
                    "uh": ph,
                    "sd": cache_s or None,
                    "sb": legacy_blob,
                    "c": now,
                    "u": now,
                },
            )


async def _migrate_sqlite(conn) -> None:
    """已有库补列（create_all 不会 ALTER）。"""
    stmts = [
        "ALTER TABLE projects ADD COLUMN deck_status TEXT",
        "ALTER TABLE projects ADD COLUMN deck_json TEXT",
        "ALTER TABLE projects ADD COLUMN deck_error TEXT",
        "ALTER TABLE node_contents ADD COLUMN page_code TEXT",
        "ALTER TABLE node_contents ADD COLUMN page_deck_status TEXT",
        "ALTER TABLE node_contents ADD COLUMN page_deck_error TEXT",
        "ALTER TABLE node_contents ADD COLUMN narration_brief TEXT",
        "ALTER TABLE projects ADD COLUMN deck_style_preset TEXT",
        "ALTER TABLE projects ADD COLUMN deck_style_user_hint TEXT",
        "ALTER TABLE projects ADD COLUMN deck_style_cache_json TEXT",
        "ALTER TABLE projects ADD COLUMN deck_page_size TEXT",
        "ALTER TABLE node_contents ADD COLUMN narration_alignment_json TEXT",
        "ALTER TABLE projects ADD COLUMN video_exported_at TEXT",
        "ALTER TABLE projects ADD COLUMN video_source_updated_at TEXT",
        "ALTER TABLE projects ADD COLUMN user_id INTEGER",
        "ALTER TABLE projects ADD COLUMN owner_user_id INTEGER",
        "ALTER TABLE projects ADD COLUMN is_shared INTEGER",
        "ALTER TABLE projects ADD COLUMN text_status TEXT",
        "ALTER TABLE projects ADD COLUMN audio_status TEXT",
        "ALTER TABLE projects ADD COLUMN demo_status TEXT",
        "ALTER TABLE projects ADD COLUMN export_status TEXT",
        "ALTER TABLE projects ADD COLUMN text_error TEXT",
        "ALTER TABLE projects ADD COLUMN audio_error TEXT",
        "ALTER TABLE projects ADD COLUMN demo_error TEXT",
        "ALTER TABLE projects ADD COLUMN export_error TEXT",
        "ALTER TABLE projects ADD COLUMN text_result_url TEXT",
        "ALTER TABLE projects ADD COLUMN audio_result_url TEXT",
        "ALTER TABLE projects ADD COLUMN demo_result_url TEXT",
        "ALTER TABLE projects ADD COLUMN export_file_url TEXT",
        "ALTER TABLE projects ADD COLUMN target_narration_seconds INTEGER",
        "ALTER TABLE projects ADD COLUMN pipeline_auto_advance INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE projects ADD COLUMN tts_voice_type TEXT",
        "ALTER TABLE projects ADD COLUMN text_structure_mode TEXT",
    ]

    _create_project_styles = """
    CREATE TABLE IF NOT EXISTS project_styles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        origin_project_id INTEGER,
        style_preset TEXT NOT NULL DEFAULT 'none',
        user_style_hint TEXT,
        style_prompt_text TEXT NOT NULL DEFAULT '',
        style_data_json TEXT,
        style_base_json TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(origin_project_id) REFERENCES projects(id)
    )
    """
    try:
        await conn.execute(text(_create_project_styles))
    except OperationalError as e:
        err = str(e).lower()
        if "already exists" not in err:
            raise
    try:
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_project_styles_origin_project_id ON project_styles(origin_project_id)")
        )
    except OperationalError:
        pass

    _wf_run = """
    CREATE TABLE IF NOT EXISTS workflow_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL UNIQUE,
        owner_user_id INTEGER NOT NULL,
        overall_status VARCHAR NOT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        finished_at DATETIME,
        FOREIGN KEY(project_id) REFERENCES projects(id),
        FOREIGN KEY(owner_user_id) REFERENCES users(id)
    )
    """
    _wf_step = """
    CREATE TABLE IF NOT EXISTS workflow_step_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_run_id INTEGER NOT NULL,
        step_key VARCHAR NOT NULL,
        status VARCHAR NOT NULL,
        attempt_no INTEGER NOT NULL DEFAULT 0,
        input_snapshot TEXT,
        output_snapshot TEXT,
        error_message TEXT,
        started_at DATETIME,
        ready_at DATETIME,
        finished_at DATETIME,
        cancelled_at DATETIME,
        updated_at DATETIME NOT NULL,
        FOREIGN KEY(workflow_run_id) REFERENCES workflow_runs(id),
        UNIQUE (workflow_run_id, step_key)
    )
    """
    _wf_export = """
    CREATE TABLE IF NOT EXISTS workflow_export_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_run_id INTEGER NOT NULL UNIQUE,
        status VARCHAR NOT NULL,
        export_format TEXT,
        output_file_url TEXT,
        error_message TEXT,
        started_at DATETIME,
        finished_at DATETIME,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        FOREIGN KEY(workflow_run_id) REFERENCES workflow_runs(id)
    )
    """
    _wf_art = """
    CREATE TABLE IF NOT EXISTS workflow_artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_run_id INTEGER NOT NULL,
        step_key VARCHAR NOT NULL,
        artifact_type VARCHAR NOT NULL,
        file_url TEXT,
        meta_json TEXT,
        created_at DATETIME NOT NULL,
        FOREIGN KEY(workflow_run_id) REFERENCES workflow_runs(id)
    )
    """
    for ddl in (_wf_run, _wf_step, _wf_export, _wf_art):
        try:
            await conn.execute(text(ddl))
        except OperationalError as e:
            err = str(e).lower()
            if "already exists" not in err:
                raise
    for ix_sql in (
        "CREATE INDEX IF NOT EXISTS ix_workflow_step_runs_workflow_run_id ON workflow_step_runs(workflow_run_id)",
        "CREATE INDEX IF NOT EXISTS ix_workflow_step_runs_step_key ON workflow_step_runs(step_key)",
        "CREATE INDEX IF NOT EXISTS ix_workflow_export_runs_workflow_run_id ON workflow_export_runs(workflow_run_id)",
        "CREATE INDEX IF NOT EXISTS ix_workflow_artifacts_workflow_run_id ON workflow_artifacts(workflow_run_id)",
        "CREATE INDEX IF NOT EXISTS ix_workflow_artifacts_step_key ON workflow_artifacts(step_key)",
    ):
        try:
            await conn.execute(text(ix_sql))
        except OperationalError:
            pass

    def _sync_check_slides(sc) -> bool:
        return inspect(sc).has_table("slides")

    has_slides = await conn.run_sync(_sync_check_slides)
    if has_slides:
        stmts.append("ALTER TABLE slides ADD COLUMN main_title TEXT")

    for sql in stmts:
        try:
            await conn.execute(text(sql))
        except OperationalError as e:
            err = str(e).lower()
            if "duplicate column" in err or "no such table" in err:
                continue
            raise
    await conn.execute(
        text(
            "UPDATE projects "
            "SET video_source_updated_at = COALESCE(video_source_updated_at, updated_at, created_at) "
            "WHERE video_source_updated_at IS NULL OR TRIM(CAST(video_source_updated_at AS TEXT)) = ''"
        )
    )
    await conn.run_sync(_migrate_project_styles_v2)


def _ensure_legacy_user_sync(sync_conn) -> None:
    insp = inspect(sync_conn)
    if not insp.has_table("users"):
        return
    u = sync_conn.execute(
        text(
            "SELECT id FROM users WHERE username IN ('dev', 'legacy') "
            "AND password_hash IN ('disabled', 'legacy-dev-bypass') "
            "ORDER BY (CASE username WHEN 'dev' THEN 0 WHEN 'legacy' THEN 1 ELSE 2 END) "
            "LIMIT 1"
        ),
    ).first()
    if u is None:
        sync_conn.execute(
            text(
                "INSERT INTO users (username, password_hash, created_at, updated_at) "
                "VALUES (:u, :p, :c, :u2)"
            ),
            {
                "u": "dev",
                "p": "disabled",
                "c": _dt_param(None),
                "u2": _dt_param(None),
            },
        )
        u = sync_conn.execute(
            text(
                "SELECT id FROM users WHERE username = 'dev' "
                "AND password_hash IN ('disabled', 'legacy-dev-bypass')"
            ),
        ).first()
    if u is None:
        return
    legacy_user_id = int(u[0])
    if insp.has_table("projects"):
        sync_conn.execute(
            text(
                "UPDATE projects SET owner_user_id = user_id "
                "WHERE (owner_user_id IS NULL OR owner_user_id = 0) "
                "AND user_id IS NOT NULL AND user_id != 0"
            )
        )
        sync_conn.execute(
            text(
                "UPDATE projects SET owner_user_id = :uid "
                "WHERE owner_user_id IS NULL OR owner_user_id = 0"
            ),
            {"uid": legacy_user_id},
        )
        sync_conn.execute(
            text("UPDATE projects SET is_shared = 0 WHERE is_shared IS NULL")
        )
        sync_conn.execute(
            text(
                "UPDATE projects SET user_id = owner_user_id "
                "WHERE (user_id IS NULL OR user_id = 0) "
                "AND owner_user_id IS NOT NULL AND owner_user_id != 0"
            )
        )


def _dt_param(v) -> str:
    if v is None:
        return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    if isinstance(v, datetime):
        if v.tzinfo is not None:
            v = v.astimezone(timezone.utc).replace(tzinfo=None)
        return v.isoformat()
    return str(v)


def _migrate_project_slides(
    sync_conn, rows: list, migrated_project_ids: list[int]
) -> None:
    """将某个项目在 slides 中的多行写入 outline（rows 已按 sequence_no 排序）。"""
    current_project: int | None = None
    last_main: str | None = None
    section_sort = -1
    section_id: int | None = None
    segment_sort = 0
    section_created: str | None = None
    prev_updated = _dt_param(None)

    def flush_section_timestamps(last_updated: str) -> None:
        nonlocal section_id, section_created
        if section_id is None:
            return
        sync_conn.execute(
            text(
                "UPDATE outline_nodes SET created_at = :c, updated_at = :u, "
                "subtree_has_content = 1 WHERE id = :id"
            ),
            {"c": section_created, "u": last_updated, "id": section_id},
        )

    for row in rows:
        pid = int(row["project_id"])
        if pid != current_project:
            if current_project is not None and section_id is not None:
                flush_section_timestamps(prev_updated)
            current_project = pid
            last_main = None
            section_sort = -1
            section_id = None
            segment_sort = 0
            section_created = None

        mt = (row["main_title"] or "").strip() or "（未标注大标题）"
        if mt != last_main:
            if last_main is not None and section_id is not None:
                flush_section_timestamps(prev_updated)
            last_main = mt
            section_sort += 1
            segment_sort = 0
            section_created = _dt_param(row["created_at"])
            r = sync_conn.execute(
                text(
                    "INSERT INTO outline_nodes (project_id, parent_id, sort_order, title, "
                    "node_kind, subtree_has_content, created_at, updated_at) "
                    "VALUES (:pid, NULL, :so, :title, 'page', 0, :ca, :ua) "
                    "RETURNING id"
                ),
                {
                    "pid": pid,
                    "so": section_sort,
                    "title": mt,
                    "ca": section_created,
                    "ua": _dt_param(row["updated_at"]),
                },
            )
            section_id = int(r.scalar_one())
        segment_sort += 1
        prev_updated = _dt_param(row["updated_at"])
        r2 = sync_conn.execute(
            text(
                "INSERT INTO outline_nodes (project_id, parent_id, sort_order, title, "
                "node_kind, subtree_has_content, created_at, updated_at) "
                "VALUES (:pid, :parent, :so, :title, 'step', 1, :ca, :ua) "
                "RETURNING id"
            ),
            {
                "pid": pid,
                "parent": section_id,
                "so": segment_sort,
                "title": (row["title"] or "").strip() or "（无小标题）",
                "ca": _dt_param(row["created_at"]),
                "ua": prev_updated,
            },
        )
        seg_id = int(r2.scalar_one())
        sync_conn.execute(
            text(
                "INSERT INTO node_contents (node_id, narration_text, duration_ms, "
                "audio_sequence, audio_asset_id, image_asset_id, background_asset_id, "
                "scene_style_json, enter_transition, exit_transition, created_at, updated_at) "
                "VALUES (:nid, :nar, :dur, :aseq, :aa, :ia, :ba, :ss, :en, :ex, :ca, :ua)"
            ),
            {
                "nid": seg_id,
                "nar": row["narration_text"] or "",
                "dur": row["duration_ms"],
                "aseq": int(row["sequence_no"]),
                "aa": row["audio_asset_id"],
                "ia": row["image_asset_id"],
                "ba": row["background_asset_id"],
                "ss": row["scene_style_json"],
                "en": row["enter_transition"],
                "ex": row["exit_transition"],
                "ca": _dt_param(row["created_at"]),
                "ua": prev_updated,
            },
        )
        sync_conn.execute(
            text(
                "UPDATE outline_nodes SET subtree_has_content = 1 WHERE id = :sid"
            ),
            {"sid": section_id},
        )

    if current_project is not None and section_id is not None:
        flush_section_timestamps(prev_updated)

    migrated_project_ids.append(int(rows[0]["project_id"]))


def _migrate_slides_to_outline_sync(sync_conn) -> None:
    """将旧 slides 表按项目迁入 outline_nodes + node_contents；已有大纲的项目跳过。"""
    insp = inspect(sync_conn)
    if not insp.has_table("slides"):
        return
    slide_count = sync_conn.execute(text("SELECT COUNT(*) FROM slides")).scalar_one()
    if slide_count == 0:
        sync_conn.execute(text("DROP TABLE IF EXISTS slides"))
        return
    if not insp.has_table("outline_nodes"):
        return

    rows_all = sync_conn.execute(
        text(
            "SELECT project_id, sequence_no, main_title, title, narration_text, "
            "duration_ms, audio_asset_id, image_asset_id, background_asset_id, "
            "scene_style_json, enter_transition, exit_transition, created_at, updated_at "
            "FROM slides ORDER BY project_id, sequence_no"
        )
    ).mappings().all()

    outlined_projects = set(
        sync_conn.execute(
            text("SELECT DISTINCT project_id FROM outline_nodes")
        ).scalars().all()
    )

    by_project: dict[int, list] = {}
    for row in rows_all:
        by_project.setdefault(int(row["project_id"]), []).append(row)

    migrated: list[int] = []
    for project_id, prow in sorted(by_project.items()):
        if project_id in outlined_projects:
            continue
        _migrate_project_slides(sync_conn, prow, migrated)

    for pid in migrated:
        sync_conn.execute(text("DELETE FROM slides WHERE project_id = :pid"), {"pid": pid})

    sync_conn.execute(
        text(
            "DELETE FROM slides WHERE project_id IN "
            "(SELECT DISTINCT project_id FROM outline_nodes)"
        )
    )

    remaining = sync_conn.execute(text("SELECT COUNT(*) FROM slides")).scalar_one()
    if remaining == 0:
        sync_conn.execute(text("DROP TABLE IF EXISTS slides"))


def _migrate_outline_node_kinds_legacy_sync(sync_conn) -> None:
    """历史库：section/segment → page/step。"""
    if not inspect(sync_conn).has_table("outline_nodes"):
        return
    sync_conn.execute(
        text("UPDATE outline_nodes SET node_kind = 'page' WHERE node_kind = 'section'")
    )
    sync_conn.execute(
        text("UPDATE outline_nodes SET node_kind = 'step' WHERE node_kind = 'segment'")
    )


def _migrate_mysql_add_project_target_narration_seconds_sync(sync_conn) -> None:
    insp = inspect(sync_conn)
    if not insp.has_table("projects"):
        return
    cols = {c["name"] for c in insp.get_columns("projects")}
    if "target_narration_seconds" in cols:
        return
    sync_conn.execute(
        text("ALTER TABLE projects ADD COLUMN target_narration_seconds INT NULL")
    )


def _migrate_mysql_add_project_pipeline_auto_advance_sync(sync_conn) -> None:
    insp = inspect(sync_conn)
    if not insp.has_table("projects"):
        return
    cols = {c["name"] for c in insp.get_columns("projects")}
    if "pipeline_auto_advance" in cols:
        return
    sync_conn.execute(
        text(
            "ALTER TABLE projects ADD COLUMN pipeline_auto_advance TINYINT(1) NOT NULL DEFAULT 1"
        )
    )


def _migrate_mysql_add_project_tts_voice_type_sync(sync_conn) -> None:
    insp = inspect(sync_conn)
    if not insp.has_table("projects"):
        return
    cols = {c["name"] for c in insp.get_columns("projects")}
    if "tts_voice_type" in cols:
        return
    sync_conn.execute(
        text("ALTER TABLE projects ADD COLUMN tts_voice_type VARCHAR(200) NULL")
    )


def _migrate_mysql_add_project_text_structure_mode_sync(sync_conn) -> None:
    insp = inspect(sync_conn)
    if not insp.has_table("projects"):
        return
    cols = {c["name"] for c in insp.get_columns("projects")}
    if "text_structure_mode" in cols:
        return
    sync_conn.execute(
        text("ALTER TABLE projects ADD COLUMN text_structure_mode VARCHAR(32) NULL")
    )


def _migrate_mysql_text_columns_sync(sync_conn) -> None:
    """MySQL 历史库早期由 create_all 建表，很多长文本字段被落成 VARCHAR(255)。"""
    insp = inspect(sync_conn)
    if not insp.has_table("node_contents"):
        return

    stmts = [
        "ALTER TABLE projects MODIFY COLUMN description TEXT NULL",
        "ALTER TABLE projects MODIFY COLUMN input_prompt TEXT NOT NULL",
        "ALTER TABLE project_styles MODIFY COLUMN style_prompt_text TEXT NOT NULL",
        "ALTER TABLE project_styles MODIFY COLUMN style_data_json TEXT NULL",
        "ALTER TABLE project_styles MODIFY COLUMN style_base_json TEXT NULL",
        "ALTER TABLE workflow_step_runs MODIFY COLUMN input_snapshot TEXT NULL",
        "ALTER TABLE workflow_step_runs MODIFY COLUMN output_snapshot TEXT NULL",
        "ALTER TABLE workflow_step_runs MODIFY COLUMN error_message TEXT NULL",
        "ALTER TABLE workflow_export_runs MODIFY COLUMN output_file_url TEXT NULL",
        "ALTER TABLE workflow_export_runs MODIFY COLUMN error_message TEXT NULL",
        "ALTER TABLE workflow_artifacts MODIFY COLUMN file_url TEXT NULL",
        "ALTER TABLE workflow_artifacts MODIFY COLUMN meta_json TEXT NULL",
        "ALTER TABLE node_contents MODIFY COLUMN page_code TEXT NULL",
        "ALTER TABLE node_contents MODIFY COLUMN page_deck_error TEXT NULL",
        "ALTER TABLE node_contents MODIFY COLUMN narration_text TEXT NOT NULL",
        "ALTER TABLE node_contents MODIFY COLUMN narration_brief TEXT NULL",
        "ALTER TABLE node_contents MODIFY COLUMN narration_alignment_json TEXT NULL",
        "ALTER TABLE node_contents MODIFY COLUMN scene_style_json TEXT NULL",
    ]
    for sql in stmts:
        sync_conn.execute(text(sql))


def _migrate_mysql_workflow_step_runs_timestamp_columns_sync(sync_conn) -> None:
    """ready_at / cancelled_at：新库 create_all 已含列时不得重复 ADD。"""
    insp = inspect(sync_conn)
    if not insp.has_table("workflow_step_runs"):
        return
    cols = {c["name"] for c in insp.get_columns("workflow_step_runs")}
    if "ready_at" not in cols:
        sync_conn.execute(
            text(
                "ALTER TABLE workflow_step_runs ADD COLUMN ready_at DATETIME NULL DEFAULT NULL"
            )
        )
    if "cancelled_at" not in cols:
        sync_conn.execute(
            text(
                "ALTER TABLE workflow_step_runs ADD COLUMN cancelled_at DATETIME NULL DEFAULT NULL"
            )
        )


async def init_db() -> None:
    # 确保 models 已导入以注册 metadata
    from app.db import models as _models  # noqa: F401

    async with engine.begin() as conn:
        if DATABASE_URL.startswith("sqlite"):
            await conn.exec_driver_sql("PRAGMA journal_mode=WAL")
        await conn.run_sync(SQLModel.metadata.create_all)
        if DATABASE_URL.startswith("sqlite"):
            await _migrate_sqlite(conn)
            await conn.run_sync(_migrate_slides_to_outline_sync)
            await conn.run_sync(_migrate_outline_node_kinds_legacy_sync)
            await conn.run_sync(_ensure_legacy_user_sync)
        elif DATABASE_URL.startswith("mysql"):
            await conn.run_sync(_migrate_mysql_text_columns_sync)
            await conn.run_sync(_migrate_mysql_workflow_step_runs_timestamp_columns_sync)
            await conn.run_sync(_migrate_mysql_add_project_target_narration_seconds_sync)
            await conn.run_sync(_migrate_mysql_add_project_pipeline_auto_advance_sync)
            await conn.run_sync(_migrate_mysql_add_project_tts_voice_type_sync)
            await conn.run_sync(_migrate_mysql_add_project_text_structure_mode_sync)

    from app.services.workflow_engine import backfill_workflow_for_all_projects
    from app.services.workflow_state import backfill_legacy_workflow_columns

    async with async_session_maker() as session:
        await backfill_legacy_workflow_columns(session)
    async with async_session_maker() as session:
        await backfill_workflow_for_all_projects(session)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session


def is_retryable_mysql_lock_error(exc: OperationalError) -> bool:
    """MySQL 死锁/锁等待超时判定（1213 / 1205）。"""
    msg = str(exc).lower()
    if "deadlock found when trying to get lock" in msg:
        return True
    if "lock wait timeout exceeded" in msg:
        return True
    code = None
    orig = getattr(exc, "orig", None)
    if orig is not None:
        try:
            args = getattr(orig, "args", None) or ()
            if args:
                code = int(args[0])
        except Exception:
            code = None
    return code in (1205, 1213)


async def with_session_deadlock_retry(
    op: Callable[[AsyncSession], Awaitable[T]],
    *,
    max_retries: int = 2,
    base_delay_seconds: float = 0.06,
) -> T:
    """通用事务重试封装：每次重试使用全新 session，成功后自动 commit。"""
    retries = max(0, int(max_retries))
    for attempt in range(retries + 1):
        async with async_session_maker() as session:
            try:
                result = await op(session)
                await session.commit()
                return result
            except OperationalError as exc:
                await session.rollback()
                if (not is_retryable_mysql_lock_error(exc)) or attempt >= retries:
                    raise
                delay = float(base_delay_seconds) * (2**attempt)
                await asyncio.sleep(delay)
            except Exception:
                await session.rollback()
                raise
    raise RuntimeError("deadlock retry exhausted")
