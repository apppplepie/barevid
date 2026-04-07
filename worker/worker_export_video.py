#!/usr/bin/env python3
"""
SlideForge export worker.

This process polls the backend for export jobs and runs `export_video.py`
in child processes so each export is isolated from the long-lived worker.

Set ``SLIDEFORGE_WORKER_LOG_POLL=1`` to print every ~30s when the server
returns no queued job (otherwise the loop is silent).
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from pathlib import Path

import httpx
from dotenv import load_dotenv

import task_db


def _env_int(key: str, *, default: int, minimum: int = 1) -> int:
    raw = (os.environ.get(key) or "").strip()
    if not raw:
        return max(minimum, default)
    try:
        return max(minimum, int(raw))
    except ValueError:
        return max(minimum, default)


def _env_float(key: str, *, default: float, minimum: float = 0.0) -> float:
    raw = (os.environ.get(key) or "").strip()
    if not raw:
        return max(minimum, default)
    try:
        return max(minimum, float(raw))
    except ValueError:
        return max(minimum, default)


def _default_export_video_script() -> Path:
    return Path(__file__).resolve().parent / "export_video.py"


def _job_timeout_seconds() -> float | None:
    default_timeout = 3600.0
    raw = (os.environ.get("SLIDEFORGE_EXPORT_JOB_TIMEOUT_SECONDS") or "").strip()
    if not raw:
        return default_timeout
    try:
        value = float(raw)
    except ValueError:
        return default_timeout
    if value <= 0:
        return default_timeout
    return max(30.0, value)


def _empty_queue_log_enabled() -> bool:
    raw = (os.environ.get("SLIDEFORGE_WORKER_LOG_POLL") or "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _worker_slot_ids(worker_id_base: str, concurrency: int) -> list[str]:
    base = (worker_id_base or "worker1").strip() or "worker1"
    if concurrency <= 1:
        return [base]
    return [f"{base}-{i + 1}" for i in range(concurrency)]


def _heartbeat_once(base: str, headers: dict[str, str], slot_ids: list[str]) -> None:
    for wid in slot_ids:
        try:
            httpx.post(
                f"{base}/internal/worker/heartbeat",
                headers=headers,
                params={"worker_id": wid},
                timeout=30.0,
            ).raise_for_status()
        except httpx.HTTPError:
            pass


def _heartbeat_loop(
    base: str,
    headers: dict[str, str],
    slot_ids: list[str],
    interval: float,
    stop: threading.Event,
) -> None:
    while not stop.is_set():
        _heartbeat_once(base, headers, slot_ids)
        _sleep_poll(interval, stop)


def _sleep_poll(seconds: float, stop: threading.Event) -> None:
    end = time.monotonic() + max(0.0, seconds)
    while time.monotonic() < end:
        if stop.is_set():
            return
        time.sleep(min(0.1, end - time.monotonic()))


def _terminate_process_tree(proc: subprocess.Popen[object]) -> None:
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            os.killpg(proc.pid, signal.SIGTERM)
    except Exception:
        try:
            proc.terminate()
        except Exception:
            pass

    deadline = time.monotonic() + 8.0
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            return
        time.sleep(0.1)

    try:
        if os.name == "nt":
            proc.kill()
        else:
            os.killpg(proc.pid, signal.SIGKILL)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def _run_export_subprocess(
    cmd: list[str],
    env: dict[str, str],
    stop: threading.Event,
    *,
    timeout_seconds: float | None,
) -> tuple[bool, str | None]:
    kwargs: dict[str, object] = {"env": env}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True

    proc = subprocess.Popen(cmd, **kwargs)
    started = time.monotonic()
    try:
        while True:
            rc = proc.poll()
            if rc is not None:
                if rc == 0:
                    return True, None
                return False, f"export_video.py exited with code {rc}"

            if stop.is_set():
                _terminate_process_tree(proc)
                return False, "worker is shutting down, export cancelled"

            if timeout_seconds is not None and time.monotonic() - started > timeout_seconds:
                _terminate_process_tree(proc)
                return False, f"export exceeded timeout of {int(timeout_seconds)} seconds"

            time.sleep(0.5)
    finally:
        if proc.poll() is None:
            _terminate_process_tree(proc)


def _process_single_job(
    client: httpx.Client,
    base: str,
    headers: dict[str, str],
    job: dict,
    *,
    worker_slot: str,
    python: str,
    export_script: Path,
    stop: threading.Event,
) -> None:
    job_id = int(job["job_id"])
    project_id = int(job["project_id"])
    print(f"claim job_id={job_id} project_id={project_id}", flush=True)

    run_id = task_db.start_run(
        backend_job_id=job_id,
        project_id=project_id,
        worker_slot=worker_slot,
    )
    outcome: tuple[bool, str | None] | None = None

    try:
        with tempfile.TemporaryDirectory(prefix="sf_export_") as td:
            td_path = Path(td)
            out_mp4 = td_path / "export.mp4"
            env = os.environ.copy()
            env["SLIDEFORGE_EXPORT_AUTHORIZATION"] = str(job["authorization"])

            cmd = [
                python,
                str(export_script),
                "--project-id",
                str(project_id),
                "--output",
                str(out_mp4),
                "--frontend-url",
                str(job["frontend_url"]),
                "--api-url",
                str(job["api_url"]),
                "--width",
                str(job["width"]),
                "--height",
                str(job["height"]),
                "--media-base-url",
                str(job["media_base_url"]),
                "--storage-root",
                str(td_path),
            ]

            ok, detail = _run_export_subprocess(
                cmd,
                env,
                stop,
                timeout_seconds=_job_timeout_seconds(),
            )
            if not ok:
                detail = detail or "export_video.py failed"
                try:
                    client.post(
                        f"{base}/internal/worker/video-export/jobs/{job_id}/fail",
                        headers=headers,
                        json={"error": detail},
                    ).raise_for_status()
                except httpx.HTTPError as exc:
                    print(f"report fail error: {exc}", flush=True)
                print(detail, file=sys.stderr)
                outcome = (False, detail)
                return

            if not out_mp4.is_file():
                err = "missing export.mp4"
                try:
                    client.post(
                        f"{base}/internal/worker/video-export/jobs/{job_id}/fail",
                        headers=headers,
                        json={"error": err},
                    ).raise_for_status()
                except httpx.HTTPError:
                    pass
                print(err, file=sys.stderr)
                outcome = (False, err)
                return

            try:
                with out_mp4.open("rb") as fh:
                    up = client.post(
                        f"{base}/internal/worker/video-export/jobs/{job_id}/complete",
                        headers=headers,
                        files={"file": ("export.mp4", fh, "video/mp4")},
                    )
                    up.raise_for_status()
                print(f"job {job_id} completed", flush=True)
                outcome = (True, None)
            except httpx.HTTPError as exc:
                print(f"upload failed: {exc}", file=sys.stderr)
                if getattr(exc, "response", None) is not None:
                    try:
                        print(exc.response.text[:2000], file=sys.stderr)
                    except Exception:
                        pass
                fail_msg = f"upload failed: {exc!s}"
                try:
                    client.post(
                        f"{base}/internal/worker/video-export/jobs/{job_id}/fail",
                        headers=headers,
                        json={"error": fail_msg},
                    ).raise_for_status()
                except httpx.HTTPError:
                    traceback.print_exc()
                outcome = (False, fail_msg)
    except Exception as exc:
        if outcome is None:
            outcome = (False, str(exc) or type(exc).__name__)
        raise
    finally:
        if outcome is not None:
            task_db.finish_run(run_id, success=outcome[0], error=outcome[1])


def _slot_loop(
    slot: int,
    concurrency: int,
    base: str,
    headers: dict[str, str],
    worker_id_base: str,
    poll_seconds: float,
    python: str,
    export_script: Path,
    stop: threading.Event,
) -> None:
    wid = f"{worker_id_base}-{slot + 1}" if concurrency > 1 else worker_id_base
    if concurrency > 1:
        print(f"slot {slot + 1}/{concurrency} worker_id={wid!r} started", flush=True)

    empty_log_at: dict[str, float] = {"t": 0.0}
    with httpx.Client(timeout=300.0) as client:
        while not stop.is_set():
            try:
                try:
                    response = client.get(
                        f"{base}/internal/worker/video-export/jobs/next",
                        params={"worker_id": wid},
                        headers=headers,
                    )
                    response.raise_for_status()
                    job = response.json()
                except httpx.HTTPError as exc:
                    print(f"[{wid}] claim failed: {exc}", flush=True)
                    _sleep_poll(poll_seconds, stop)
                    continue

                if not job:
                    if _empty_queue_log_enabled():
                        now = time.monotonic()
                        if now - empty_log_at["t"] >= 30.0:
                            print(
                                f"[{wid}] poll OK, server has no queued export job",
                                flush=True,
                            )
                            empty_log_at["t"] = now
                    _sleep_poll(poll_seconds, stop)
                    continue

                if stop.is_set():
                    break

                _process_single_job(
                    client,
                    base,
                    headers,
                    job,
                    worker_slot=wid,
                    python=python,
                    export_script=export_script,
                    stop=stop,
                )
            except Exception:
                print(f"[{wid}] worker loop crashed", flush=True)
                traceback.print_exc()
                _sleep_poll(poll_seconds, stop)


def main(argv: list[str] | None = None) -> int:
    load_dotenv(Path(__file__).resolve().parent / ".env")

    parser = argparse.ArgumentParser(description="SlideForge export worker")
    parser.add_argument(
        "--api-url",
        default=(os.environ.get("SLIDEFORGE_API_URL") or "").strip(),
        help="Backend API base URL, for example https://api.example.com",
    )
    parser.add_argument(
        "--worker-key",
        default=(os.environ.get("SLIDEFORGE_WORKER_KEY") or "").strip(),
        help="Worker secret, must match backend EXPORT_WORKER_TOKEN",
    )
    parser.add_argument(
        "--worker-id",
        default=(os.environ.get("SLIDEFORGE_WORKER_ID") or "worker1").strip(),
    )
    parser.add_argument(
        "--concurrency",
        "-j",
        type=int,
        default=_env_int("SLIDEFORGE_WORKER_CONCURRENCY", default=1, minimum=1),
        help="How many worker slots poll and export in parallel",
    )
    parser.add_argument(
        "--poll-seconds",
        type=float,
        default=_env_float("SLIDEFORGE_WORKER_POLL_SECONDS", default=3.0, minimum=0.1),
        help="Polling interval when there is no job",
    )
    parser.add_argument(
        "--python",
        default=sys.executable,
        help="Python executable used to run export_video.py",
    )
    parser.add_argument(
        "--export-script",
        type=Path,
        default=None,
        help="Path to export_video.py",
    )
    args = parser.parse_args(argv)

    if not args.api_url:
        print("missing --api-url or SLIDEFORGE_API_URL", file=sys.stderr)
        return 1
    if not args.worker_key:
        print("missing --worker-key or SLIDEFORGE_WORKER_KEY", file=sys.stderr)
        return 1
    if args.concurrency < 1:
        print("--concurrency must be >= 1", file=sys.stderr)
        return 1

    export_script = (
        args.export_script.resolve()
        if args.export_script is not None
        else _default_export_video_script()
    )
    if not export_script.is_file():
        print(f"export_video.py not found: {export_script}", file=sys.stderr)
        return 1

    base = args.api_url.rstrip("/")
    headers = {"X-SlideForge-Worker-Key": args.worker_key}

    task_db.init_db()

    print(
        f"Worker {args.worker_id!r} connected to {base} with concurrency={args.concurrency}",
        flush=True,
    )
    if _empty_queue_log_enabled():
        print(
            "SLIDEFORGE_WORKER_LOG_POLL=1: logging every ~30s when queue is empty",
            flush=True,
        )

    stop = threading.Event()
    slot_ids = _worker_slot_ids(args.worker_id, args.concurrency)
    hb_sec = _env_float(
        "SLIDEFORGE_WORKER_HEARTBEAT_SECONDS", default=60.0, minimum=0.0
    )
    if hb_sec > 0:
        hb_thread = threading.Thread(
            target=_heartbeat_loop,
            args=(base, headers, slot_ids, hb_sec, stop),
            name="slideforge-worker-heartbeat",
            daemon=True,
        )
        hb_thread.start()
        print(
            f"heartbeat every {hb_sec:.0f}s for: {', '.join(slot_ids)} "
            f"(set SLIDEFORGE_WORKER_HEARTBEAT_SECONDS=0 to disable)",
            flush=True,
        )

    threads: list[threading.Thread] = []
    for slot in range(args.concurrency):
        thread = threading.Thread(
            target=_slot_loop,
            args=(
                slot,
                args.concurrency,
                base,
                headers,
                args.worker_id,
                args.poll_seconds,
                args.python,
                export_script,
                stop,
            ),
        )
        thread.start()
        threads.append(thread)

    try:
        while True:
            time.sleep(0.25)
    except KeyboardInterrupt:
        print("Stopping worker and cancelling active exports...", flush=True)
        stop.set()
        for thread in threads:
            thread.join(timeout=600.0)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
