"""SQLite persistence for local export job history (worker-side)."""

from __future__ import annotations

import os
import sqlite3
import threading
import time
from pathlib import Path

_db_lock = threading.Lock()


def db_path() -> Path:
    raw = (os.environ.get("SLIDEFORGE_WORKER_DB_PATH") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return Path(__file__).resolve().parent / "worker_tasks.db"


def _connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(
        str(path),
        timeout=30.0,
        check_same_thread=False,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_db() -> None:
    with _db_lock:
        conn = _connect()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS export_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    backend_job_id INTEGER NOT NULL,
                    project_id INTEGER NOT NULL,
                    worker_slot TEXT,
                    status TEXT NOT NULL,
                    error TEXT,
                    started_at REAL NOT NULL,
                    finished_at REAL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_export_runs_started "
                "ON export_runs (started_at DESC)"
            )
            conn.commit()
        finally:
            conn.close()


def start_run(
    *,
    backend_job_id: int,
    project_id: int,
    worker_slot: str,
) -> int:
    now = time.time()
    with _db_lock:
        conn = _connect()
        try:
            cur = conn.execute(
                """
                INSERT INTO export_runs (
                    backend_job_id, project_id, worker_slot,
                    status, error, started_at, finished_at
                )
                VALUES (?, ?, ?, 'running', NULL, ?, NULL)
                """,
                (backend_job_id, project_id, worker_slot, now),
            )
            conn.commit()
            return int(cur.lastrowid)
        finally:
            conn.close()


def finish_run(
    run_id: int,
    *,
    success: bool,
    error: str | None = None,
) -> None:
    now = time.time()
    status = "completed" if success else "failed"
    with _db_lock:
        conn = _connect()
        try:
            conn.execute(
                """
                UPDATE export_runs
                SET status = ?, error = ?, finished_at = ?
                WHERE id = ?
                """,
                (status, error, now, run_id),
            )
            conn.commit()
        finally:
            conn.close()


def list_runs(*, limit: int = 100) -> list[dict[str, object]]:
    limit = max(1, min(500, limit))
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT id, backend_job_id, project_id, worker_slot, status, error,
                   started_at, finished_at
            FROM export_runs
            ORDER BY started_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
