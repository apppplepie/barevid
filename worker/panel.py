#!/usr/bin/env python3
"""Minimal FastAPI dashboard for local export history (reads worker SQLite).

Run from the worker directory::

    uvicorn panel:app --host 127.0.0.1 --port 9090

Startup opens the default browser to http://127.0.0.1:9090/ unless
``SLIDEFORGE_PANEL_AUTO_OPEN=0``. Override URL with ``SLIDEFORGE_PANEL_BROWSER_URL``.

Override DB path with env ``SLIDEFORGE_WORKER_DB_PATH`` (same as the worker process).
"""

from __future__ import annotations

import os
import threading
import time
import webbrowser

from fastapi import FastAPI, Query
from fastapi.responses import HTMLResponse

import task_db

app = FastAPI(title="SlideForge Worker", version="0.1")

_DEFAULT_PANEL_URL = "http://127.0.0.1:9090/"


def _maybe_open_browser() -> None:
    raw = (os.environ.get("SLIDEFORGE_PANEL_AUTO_OPEN") or "1").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return
    url = (os.environ.get("SLIDEFORGE_PANEL_BROWSER_URL") or "").strip() or _DEFAULT_PANEL_URL
    time.sleep(0.7)
    webbrowser.open(url)


@app.on_event("startup")
def _startup() -> None:
    task_db.init_db()
    threading.Thread(target=_maybe_open_browser, daemon=True).start()


@app.get("/api/runs")
def api_runs(limit: int = Query(100, ge=1, le=500)) -> list[dict[str, object]]:
    return task_db.list_runs(limit=limit)


_INDEX_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SlideForge Worker</title>
  <style>
    :root { font-family: system-ui, sans-serif; background: #0f1419; color: #e6edf3; }
    body { margin: 0; padding: 1.25rem; max-width: 1200px; margin-inline: auto; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 1rem; }
    .bar { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
    button {
      background: #238636; color: #fff; border: 0; padding: 0.4rem 0.85rem;
      border-radius: 6px; cursor: pointer; font-size: 0.875rem;
    }
    button:hover { filter: brightness(1.08); }
    .muted { color: #8b949e; font-size: 0.8rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
    th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid #30363d; vertical-align: top; }
    th { color: #8b949e; font-weight: 500; }
    .ok { color: #3fb950; }
    .fail { color: #f85149; }
    .run { color: #d29922; }
    .err { max-width: 28rem; word-break: break-word; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>导出任务记录</h1>
  <div class="bar">
    <button type="button" id="refresh">刷新</button>
    <span class="muted" id="status"></span>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>后端 job</th>
        <th>项目</th>
        <th>槽位</th>
        <th>状态</th>
        <th>开始</th>
        <th>结束</th>
        <th>错误</th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <script>
    function fmt(ts) {
      if (ts == null) return "—";
      const d = new Date(ts * 1000);
      return isNaN(d) ? "—" : d.toLocaleString();
    }
    function statusClass(s) {
      if (s === "completed") return "ok";
      if (s === "failed") return "fail";
      if (s === "running") return "run";
      return "";
    }
    async function load() {
      const st = document.getElementById("status");
      const tbody = document.getElementById("rows");
      st.textContent = "加载中…";
      try {
        const r = await fetch("/api/runs?limit=200");
        if (!r.ok) throw new Error(r.status + " " + r.statusText);
        const data = await r.json();
        tbody.innerHTML = "";
        for (const row of data) {
          const tr = document.createElement("tr");
          tr.innerHTML =
            "<td>" + row.id + "</td>" +
            "<td>" + row.backend_job_id + "</td>" +
            "<td>" + row.project_id + "</td>" +
            "<td>" + (row.worker_slot || "—") + "</td>" +
            "<td class='" + statusClass(row.status) + "'>" + row.status + "</td>" +
            "<td>" + fmt(row.started_at) + "</td>" +
            "<td>" + fmt(row.finished_at) + "</td>" +
            "<td class='err'>" + (row.error ? String(row.error) : "—") + "</td>";
          tbody.appendChild(tr);
        }
        st.textContent = "共 " + data.length + " 条";
      } catch (e) {
        st.textContent = "错误: " + e;
        tbody.innerHTML = "";
      }
    }
    document.getElementById("refresh").addEventListener("click", load);
    load();
    setInterval(load, 15000);
  </script>
</body>
</html>
"""


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse(_INDEX_HTML)
