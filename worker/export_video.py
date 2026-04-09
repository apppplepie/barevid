import argparse
import asyncio
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

import httpx

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional for minimal installs
    load_dotenv = None  # type: ignore[assignment,misc]


def _barevid_root() -> Path:
    """仓库根目录（barevid/）；本脚本位于 barevid/worker/export_video.py。"""
    return Path(__file__).resolve().parent.parent


def _default_storage_root() -> Path:
    return _barevid_root() / "SlideForge" / "backend" / "storage"


def _which(cmd: str) -> str | None:
    return shutil.which(cmd)


def _env_first(*keys: str) -> str:
    for key in keys:
        value = (os.environ.get(key) or "").strip()
        if value:
            return value
    return ""


def _ffmpeg_timeout_seconds() -> float:
    raw = (os.environ.get("SLIDEFORGE_FFMPEG_TIMEOUT_SECONDS") or "").strip()
    if not raw:
        return 1800.0
    try:
        value = float(raw)
    except ValueError:
        return 1800.0
    return max(30.0, value)


def _export_done_wait_buffer_ms() -> int:
    """等待前端写入 __SLIDEFORGE_EXPORT_DONE_AT_MS 时在「剩余时间轴」上追加的余量（毫秒）。"""
    raw = (os.environ.get("SLIDEFORGE_EXPORT_DONE_WAIT_BUFFER_MS") or "").strip()
    if not raw:
        return 120_000
    try:
        return max(0, min(3_600_000, int(raw)))
    except ValueError:
        return 120_000


def _export_tail_buffer_ms() -> int:
    """收到播放结束信号后、关闭页面前的额外等待（毫秒）。
    给浏览器留出时间渲染最后几帧；在机器性能不足或视频较长时应适当调大。
    可通过 SLIDEFORGE_EXPORT_TAIL_BUFFER_MS 覆盖，默认 1500ms。
    """
    raw = (os.environ.get("SLIDEFORGE_EXPORT_TAIL_BUFFER_MS") or "").strip()
    if not raw:
        return 1500
    try:
        return max(0, min(10_000, int(raw)))
    except ValueError:
        return 1500


def _export_record_scale() -> float:
    """录制分辨率相对于最终输出分辨率的缩放比（0.25–1.0）。
    降低此值可大幅减轻 Playwright 录制时的渲染压力，ffmpeg 合成时再上采样还原。
    例：SLIDEFORGE_EXPORT_RECORD_SCALE=0.5 以 960×540 录制后缩放到 1920×1080。
    机器性能不足、长视频帧延迟积累时，设为 0.5 可显著改善画音同步。
    默认 1.0（与输出分辨率相同）。
    """
    raw = (os.environ.get("SLIDEFORGE_EXPORT_RECORD_SCALE") or "").strip()
    if not raw:
        return 1.0
    try:
        v = float(raw)
        return max(0.25, min(1.0, v))
    except ValueError:
        return 1.0


def _run(cmd: list[str], *, timeout_seconds: float | None = None) -> None:
    try:
        proc = subprocess.run(cmd, check=False, timeout=timeout_seconds)
    except subprocess.TimeoutExpired as exc:
        limit = int(timeout_seconds or 0)
        raise RuntimeError(
            f"Command timed out after {limit} seconds: {' '.join(cmd)}"
        ) from exc
    if proc.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(cmd)}")


def _fetch_manifest(api_url: str, project_id: int) -> dict[str, Any]:
    url = f"{api_url.rstrip('/')}/api/projects/{project_id}/play-manifest"
    headers: dict[str, str] = {}
    auth = (os.environ.get("SLIDEFORGE_EXPORT_AUTHORIZATION") or "").strip()
    if auth:
        if not auth.lower().startswith("bearer "):
            auth = f"Bearer {auth}"
        headers["Authorization"] = auth
    with httpx.Client(timeout=30) as client:
        res = client.get(url, headers=headers)
        res.raise_for_status()
        return res.json()


def _flatten_steps(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    steps: list[dict[str, Any]] = []
    for page in manifest.get("pages") or []:
        for step in page.get("steps") or []:
            steps.append(step)
    return sorted(steps, key=lambda s: int(s.get("timeline_index") or 0))


def _audio_path_from_url(storage_root: Path, audio_url: str) -> Path | None:
    if not audio_url:
        return None
    path = urlparse(audio_url).path or ""
    if path.startswith("/media/"):
        rel = path[len("/media/") :]
        return storage_root / rel
    return None


def _http_headers_for_export() -> dict[str, str]:
    headers: dict[str, str] = {}
    auth = (os.environ.get("SLIDEFORGE_EXPORT_AUTHORIZATION") or "").strip()
    if auth:
        if not auth.lower().startswith("bearer "):
            auth = f"Bearer {auth}"
        headers["Authorization"] = auth
    return headers


def _ensure_audio_file_local(
    audio_url: str,
    storage_root: Path,
    media_base: str | None,
    download_dir: Path,
) -> Path:
    """本地 storage 优先；否则在 media_base 下按 URL 下载到 download_dir。"""
    path = _audio_path_from_url(storage_root, audio_url)
    if path is not None and path.is_file():
        return path
    base = (media_base or "").strip().rstrip("/")
    if not base:
        raise RuntimeError(
            f"Audio file not found locally and SLIDEFORGE_MEDIA_BASE_URL / --media-base-url "
            f"not set: {audio_url}"
        )
    download_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(audio_url.encode("utf-8")).hexdigest()[:20]
    ext = Path(urlparse(audio_url).path or "").suffix or ".mp3"
    dest = download_dir / f"{digest}{ext}"
    if dest.is_file():
        return dest
    join = audio_url if audio_url.startswith("/") else f"/{audio_url}"
    full_url = f"{base}{join}"
    h = _http_headers_for_export()
    with httpx.Client(timeout=120.0) as client:
        res = client.get(full_url, headers=h if h else None)
        res.raise_for_status()
        dest.write_bytes(res.content)
    return dest


def _resolve_ffmpeg() -> str:
    env_path = os.environ.get("FFMPEG_PATH", "").strip()
    if env_path:
        p = Path(env_path)
        if p.is_file():
            return str(p)
    which = _which("ffmpeg")
    if which:
        return which
    # Common Windows install locations (best-effort)
    candidates = [
        Path("C:/ffmpeg/bin/ffmpeg.exe"),
        Path("C:/Program Files/ffmpeg/bin/ffmpeg.exe"),
        Path("C:/Program Files (x86)/ffmpeg/bin/ffmpeg.exe"),
    ]
    for c in candidates:
        if c.is_file():
            return str(c)
    # WinGet (Gyan.FFmpeg) installs under %LOCALAPPDATA%\...\Packages\... but often does not add bin to PATH.
    localappdata = os.environ.get("LOCALAPPDATA", "")
    if localappdata:
        wg = Path(localappdata) / "Microsoft" / "WinGet" / "Packages"
        if wg.is_dir():
            for c in wg.glob("Gyan.FFmpeg*/**/bin/ffmpeg.exe"):
                if c.is_file():
                    return str(c)
    raise RuntimeError(
        "ffmpeg not found. Install ffmpeg and add it to PATH, or set FFMPEG_PATH to the full ffmpeg.exe path."
    )


def _resolve_ffprobe(ffmpeg_path: str) -> str | None:
    env_path = os.environ.get("FFPROBE_PATH", "").strip()
    if env_path:
        p = Path(env_path)
        if p.is_file():
            return str(p)
    which = _which("ffprobe")
    if which:
        return which
    ffmpeg_file = Path(ffmpeg_path)
    sibling = ffmpeg_file.with_name("ffprobe.exe" if os.name == "nt" else "ffprobe")
    if sibling.is_file():
        return str(sibling)
    return None


def _probe_media_duration_ms(path: Path, ffprobe_path: str | None) -> int | None:
    if not ffprobe_path or not path.is_file():
        return None
    cmd = [
        ffprobe_path,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
            timeout=20.0,
        )
    except Exception:
        return None
    if proc.returncode != 0:
        return None
    raw = (proc.stdout or "").strip()
    if not raw:
        return None
    try:
        sec = float(raw)
    except ValueError:
        return None
    if sec < 0:
        return None
    return int(round(sec * 1000))


def _format_srt_time(ms: int) -> str:
    if ms < 0:
        ms = 0
    s, milli = divmod(ms, 1000)
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d},{milli:03d}"


def _word_ends_sentence(word: str) -> bool:
    t = word.rstrip()
    if not t:
        return False
    return t.endswith(
        (",", "，", "。", "！", "？", "；", "：", ".", "!", "?", ";", ":")
    )


def _word_items_from_list(words: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in words:
        if not isinstance(item, dict):
            continue
        st = item.get("start_time", item.get("startTime"))
        en = item.get("end_time", item.get("endTime"))
        word = item.get("word")
        try:
            st_i = int(round(float(st)))
            en_i = int(round(float(en)))
        except (TypeError, ValueError):
            continue
        if not isinstance(word, str):
            word = str(word or "")
        out.append({"start_ms": st_i, "end_ms": en_i, "word": word})
    return out


def _parse_words_from_alignment_dict(alignment: dict[str, Any]) -> list[dict[str, Any]]:
    addition_raw = alignment.get("addition")
    addition: Any = addition_raw
    if isinstance(addition_raw, str) and addition_raw.strip():
        try:
            addition = json.loads(addition_raw)
        except Exception:
            addition = None
    if isinstance(addition, dict):
        frontend_raw = addition.get("frontend")
        inner: Any = None
        if isinstance(frontend_raw, str) and frontend_raw.strip():
            try:
                inner = json.loads(frontend_raw)
            except Exception:
                inner = None
        elif isinstance(frontend_raw, dict):
            inner = frontend_raw
        if isinstance(inner, dict):
            words = inner.get("words")
            if isinstance(words, list) and words:
                w = _word_items_from_list(words)
                if w:
                    return w
    tw = alignment.get("words")
    if isinstance(tw, list) and tw:
        w = _word_items_from_list(tw)
        if w:
            return w
    return []


def _parse_words_from_alignment(alignment: dict[str, Any]) -> list[dict[str, Any]]:
    w = _parse_words_from_alignment_dict(alignment)
    if w:
        return w
    cache = alignment.get("ingest_json_cache")
    if isinstance(cache, str) and cache.strip():
        try:
            obj = json.loads(cache.strip())
        except Exception:
            return []
        if isinstance(obj, dict):
            return _parse_words_from_alignment_dict(obj)
    return []


def _words_to_sentence_cues(words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    buf: list[dict[str, Any]] = []

    def flush() -> None:
        nonlocal buf
        if not buf:
            return
        text = "".join(w["word"] for w in buf)
        out.append(
            {
                "text": text,
                "start_ms": int(buf[0]["start_ms"]),
                "end_ms": int(buf[-1]["end_ms"]),
            }
        )
        buf = []

    for w in words:
        buf.append(w)
        if _word_ends_sentence(w.get("word", "")):
            flush()
    flush()
    return out


def _build_subtitles(
    steps: list[dict[str, Any]],
    out_path: Path,
) -> bool:
    cues: list[tuple[int, int, str]] = []
    for step in steps:
        if str(step.get("kind") or "") == "pause":
            continue
        narration = str(step.get("narration_text") or "").strip()
        start_ms = int(step.get("start_ms") or 0)
        dur_ms = int(step.get("duration_ms") or 0)
        alignment = step.get("narration_alignment")

        sentence_cues: list[dict[str, Any]] = []
        if isinstance(alignment, dict):
            words = _parse_words_from_alignment(alignment)
            if words:
                sentence_cues = _words_to_sentence_cues(words)

        if sentence_cues:
            for s in sentence_cues:
                text = str(s.get("text") or "").strip()
                if not text:
                    continue
                st = start_ms + int(s.get("start_ms") or 0)
                en = start_ms + int(s.get("end_ms") or 0)
                if en <= st:
                    en = st + 500
                cues.append((st, en, text))
        elif narration:
            en = start_ms + max(500, dur_ms)
            cues.append((start_ms, en, narration))

    if not cues:
        return False

    lines: list[str] = []
    for i, (st, en, text) in enumerate(cues, start=1):
        lines.append(str(i))
        lines.append(f"{_format_srt_time(st)} --> {_format_srt_time(en)}")
        lines.append(text)
        lines.append("")
    out_path.write_text("\n".join(lines), encoding="utf-8")
    return True


def _build_audio(
    steps: list[dict[str, Any]],
    storage_root: Path,
    out_path: Path,
    ffmpeg_path: str,
    *,
    media_base: str | None = None,
    download_dir: Path | None = None,
) -> None:
    inputs: list[tuple[str, Any]] = []
    dl_root = download_dir or (storage_root / "_export_dl_unused")
    for step in steps:
        kind = str(step.get("kind") or "")
        audio_url = str(step.get("audio_url") or "")
        duration_ms = int(step.get("duration_ms") or 0)
        if kind == "pause" or not audio_url.strip():
            dur_s = max(0.05, duration_ms / 1000.0)
            inputs.append(("silence", dur_s))
            continue
        path = _ensure_audio_file_local(audio_url, storage_root, media_base, dl_root)
        inputs.append(("file", path))

    if not inputs:
        raise RuntimeError("No audio steps found.")

    cmd: list[str] = [ffmpeg_path, "-y"]
    for kind, payload in inputs:
        if kind == "file":
            cmd += ["-i", str(payload)]
        else:
            cmd += [
                "-f",
                "lavfi",
                "-t",
                f"{payload:.3f}",
                "-i",
                "anullsrc=r=44100:cl=stereo",
            ]

    if len(inputs) == 1:
        cmd += ["-c:a", "aac", "-b:a", "192k", str(out_path)]
    else:
        concat = "".join(f"[{i}:a]" for i in range(len(inputs)))
        concat += f"concat=n={len(inputs)}:v=0:a=1[outa]"
        cmd += [
            "-filter_complex",
            concat,
            "-map",
            "[outa]",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            str(out_path),
        ]
    _run(cmd, timeout_seconds=_ffmpeg_timeout_seconds())


async def _record_video(
    url: str,
    duration_ms: int,
    out_dir: Path,
    width: int,
    height: int,
    auth_token: str | None = None,
) -> tuple[Path, int, int, int]:
    """录制并返回 (视频路径, preroll_ms, 实际录制宽度, 实际录制高度)。"""
    try:
        from playwright.async_api import async_playwright
    except Exception as exc:  # pragma: no cover - runtime guard
        raise RuntimeError(
            "Playwright not installed. Run: pip install playwright && python -m playwright install chromium"
        ) from exc

    scale = _export_record_scale()
    rec_width = max(1, int(width * scale))
    rec_height = max(1, int(height * scale))

    out_dir.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            args=[
                "--autoplay-policy=no-user-gesture-required",
                # 以下参数减轻录制时的渲染压力，改善长视频帧延迟积累：
                "--disable-dev-shm-usage",            # 避免 /dev/shm 不足导致渲染卡顿
                "--disable-background-timer-throttling",  # 防止后台标签页 timer 被节流
                "--disable-renderer-backgrounding",   # 防止渲染进程被降级
                "--disable-backgrounding-occluded-windows",
                "--disable-ipc-flooding-protection",  # 减少 IPC 节流带来的帧延迟
            ]
        )
        context = await browser.new_context(
            viewport={"width": rec_width, "height": rec_height},
            record_video_dir=str(out_dir),
            record_video_size={"width": rec_width, "height": rec_height},
        )
        if auth_token:
            safe_token = json.dumps(auth_token)
            # 前端使用 neoncast_auth_token；旧 slideforge_token 兼容
            await context.add_init_script(
                f"localStorage.setItem('neoncast_auth_token', {safe_token});"
                f"localStorage.setItem('slideforge_token', {safe_token});"
            )
        page = await context.new_page()
        # networkidle：等所有网络请求静止后再继续，确保字体/CSS/iframe 内容全部就绪，
        # 避免录制开始时浏览器仍在后台加载资源造成渲染压力和首帧延迟。
        # 线上反代/长连接场景若 networkidle 超时，可设 SLIDEFORGE_EXPORT_WAIT_UNTIL=domcontentloaded 降级。
        nav_timeout_ms = max(60000, min(180000, duration_ms + 30000))
        _wait_until = (os.environ.get("SLIDEFORGE_EXPORT_WAIT_UNTIL") or "networkidle").strip() or "networkidle"
        await page.goto(url, wait_until=_wait_until, timeout=nav_timeout_ms)  # noqa: E501
        try:
            # 放映页可用态：加载提示消失 + 播放器壳 + 音频节点；
            # 若有 deck iframe 则等其 document complete（与 SlidePlayer iframe onLoad 对齐）。
            await page.wait_for_function(
                """
                () => {
                  const loadingMsg = Array.from(document.querySelectorAll(".sf-play-msg"))
                    .some((el) => (el.textContent || "").includes("加载放映数据"));
                  if (loadingMsg) return false;
                  const hasMain = Boolean(document.querySelector(".sf-play-main-body"));
                  const hasAudio = Boolean(document.querySelector(".sf-controls audio"));
                  if (!hasMain || !hasAudio) return false;
                  const iframe = document.querySelector("iframe.sf-deck-iframe, iframe.sf-html-stage");
                  if (!iframe) return true;
                  try {
                    const doc = iframe.contentDocument;
                    if (!doc || doc.readyState !== "complete") return false;
                    return true;
                  } catch {
                    return true;
                  }
                }
                """,
                timeout=max(15000, min(90000, duration_ms + 15000)),
            )
        except Exception:
            # 兼容样式类名调整：若检测失败，后续仍以 started 标记为准裁剪。
            pass
        try:
            # 等待主文档和 deck iframe 的字体都加载完成，减少首帧录到回退字体的概率。
            await page.evaluate(
                """
                async () => {
                  async function waitFonts(doc) {
                    try {
                      const fonts = doc.fonts;
                      if (fonts && fonts.ready) await fonts.ready;
                    } catch {
                      /* 单个文档字体失败不阻塞整次导出 */
                    }
                  }
                  await waitFonts(document);
                  const iframe = document.querySelector("iframe.sf-deck-iframe, iframe.sf-html-stage");
                  if (iframe && iframe.contentDocument) {
                    try { await waitFonts(iframe.contentDocument); } catch { /* ignore */ }
                  }
                  return true;
                }
                """
            )
        except Exception:
            pass
        # 在「页面已就绪 + 字体已加载」之后再额外等待，是真正有效的缓冲。
        # 可通过 SLIDEFORGE_EXPORT_EXTRA_WAIT_MS 覆盖（默认 3000ms）。
        extra_wait_ms = 3000
        raw_extra_wait = (os.environ.get("SLIDEFORGE_EXPORT_EXTRA_WAIT_MS") or "").strip()
        if raw_extra_wait:
            try:
                extra_wait_ms = max(0, min(8000, int(raw_extra_wait)))
            except ValueError:
                extra_wait_ms = 3000
        if extra_wait_ms > 0:
            await page.wait_for_timeout(extra_wait_ms)
        preroll_ms = 0
        try:
            await page.wait_for_function(
                "() => typeof window.__SLIDEFORGE_EXPORT_STARTED_AT_MS === 'number'",
                timeout=max(20000, min(120000, duration_ms + 20000)),
            )
            raw = await page.evaluate(
                "() => Number(window.__SLIDEFORGE_EXPORT_STARTED_AT_MS || 0)"
            )
            if isinstance(raw, (int, float)):
                preroll_ms = max(0, int(round(raw)))
        except Exception:
            preroll_ms = 0
        now_ms = 0
        try:
            raw_now = await page.evaluate("() => Number(Math.round(performance.now()))")
            if isinstance(raw_now, (int, float)):
                now_ms = max(0, int(raw_now))
        except Exception:
            now_ms = 0
        elapsed_since_start_ms = max(0, now_ms - preroll_ms) if preroll_ms > 0 else 0
        remain_ms = max(1200, duration_ms - elapsed_since_start_ms)
        try:
            # 由前端在播放自然结束时写入 done 标记；优先按真实完成时刻收尾。
            # 勿对 remain_ms 做固定上限（例如曾误用 min(..., 120000)）：长片会在约 2 分钟内
            # 超时关页，画面远短于音轨，-shortest 截断音频与字幕，表现为后段口播/「下文」丢失。
            done_timeout_ms = max(6000, remain_ms + _export_done_wait_buffer_ms())
            await page.wait_for_function(
                "() => typeof window.__SLIDEFORGE_EXPORT_DONE_AT_MS === 'number'",
                timeout=done_timeout_ms,
            )
            # 收到结束信号后额外等待，让浏览器有时间渲染最后几帧；
            # 在机器性能不足或长视频时应调大 SLIDEFORGE_EXPORT_TAIL_BUFFER_MS（默认 1500ms）。
            await page.wait_for_timeout(_export_tail_buffer_ms())
        except Exception:
            # 兜底：兼容旧前端或标记丢失场景，仅做短暂收尾等待，避免总时长翻倍。
            await page.wait_for_timeout(1200)
        try:
            sync_diag = await page.evaluate(
                """
                () => {
                  const logs = Array.isArray(window.__SLIDEFORGE_EXPORT_SYNC_LOGS)
                    ? window.__SLIDEFORGE_EXPORT_SYNC_LOGS
                    : [];
                  let maxAbsClip = 0;
                  let maxAbsGlobal = 0;
                  for (const item of logs) {
                    const clip = Number(item?.clip_drift_ms || 0);
                    const global = Number(item?.global_drift_ms || 0);
                    maxAbsClip = Math.max(maxAbsClip, Math.abs(clip));
                    maxAbsGlobal = Math.max(maxAbsGlobal, Math.abs(global));
                  }
                  return {
                    clock_mode: String(window.__SLIDEFORGE_EXPORT_CLOCK_MODE || ""),
                    count: logs.length,
                    max_abs_clip_drift_ms: maxAbsClip,
                    max_abs_global_drift_ms: maxAbsGlobal,
                    tail: logs.slice(-12),
                  };
                }
                """
            )
            if isinstance(sync_diag, dict):
                clock_mode = str(sync_diag.get("clock_mode") or "unknown")
                count = int(sync_diag.get("count") or 0)
                max_abs_clip = int(sync_diag.get("max_abs_clip_drift_ms") or 0)
                max_abs_global = int(sync_diag.get("max_abs_global_drift_ms") or 0)
                print(
                    "[export-sync] "
                    f"clock_mode={clock_mode} samples={count} "
                    f"max_abs_clip_drift_ms={max_abs_clip} "
                    f"max_abs_global_drift_ms={max_abs_global}",
                    flush=True,
                )
                tail = sync_diag.get("tail")
                if isinstance(tail, list) and tail:
                    for idx, row in enumerate(tail, start=1):
                        print(
                            f"[export-sync] tail#{idx} "
                            f"{json.dumps(row, ensure_ascii=False)}",
                            flush=True,
                        )
        except Exception:
            pass
        video = page.video
        await page.close()
        video_path = await video.path() if video else None
        await context.close()
        await browser.close()
        if not video_path:
            raise RuntimeError("Failed to capture video.")
        return Path(video_path), preroll_ms, rec_width, rec_height


def _escape_subtitle_path(path: Path) -> str:
    p = str(path).replace("\\", "/")
    p = p.replace(":", "\\:")
    p = p.replace("'", "\\'")
    return p


def _mux_video_audio(
    video_path: Path,
    audio_path: Path,
    out_path: Path,
    ffmpeg_path: str,
    subtitle_path: Path | None,
    video_preroll_ms: int = 0,
    *,
    output_width: int | None = None,
    output_height: int | None = None,
    rec_width: int | None = None,
    rec_height: int | None = None,
) -> None:
    cmd = [ffmpeg_path, "-y"]
    # 解码 VP8 + 字幕滤镜 + x264 在 1080p 下可能吃满内存；限制线程可降低峰值（尤其 Windows）。
    # 例：SLIDEFORGE_FFMPEG_THREADS=1
    ff_threads = (os.environ.get("SLIDEFORGE_FFMPEG_THREADS") or "").strip()
    if ff_threads:
        cmd += ["-threads", ff_threads]
    x264_preset = (os.environ.get("SLIDEFORGE_EXPORT_X264_PRESET") or "").strip() or "veryfast"
    x264_crf = (os.environ.get("SLIDEFORGE_EXPORT_X264_CRF") or "").strip() or "18"
    trim_s = max(0.0, video_preroll_ms / 1000.0)
    if trim_s > 0.01:
        cmd += ["-ss", f"{trim_s:.3f}"]
    cmd += ["-i", str(video_path), "-i", str(audio_path)]

    # 当录制分辨率低于输出分辨率时（SLIDEFORGE_EXPORT_RECORD_SCALE < 1.0），
    # 在 vf 滤镜链中插入 scale 上采样，使最终输出保持目标分辨率。
    needs_scale = (
        output_width and output_height and rec_width and rec_height
        and (rec_width != output_width or rec_height != output_height)
    )
    scale_filter = f"scale={output_width}:{output_height}:flags=lanczos" if needs_scale else ""

    # 总需要 libx264 重编码的条件：有字幕滤镜、有 scale 滤镜、或者有时间裁剪。
    needs_reencode = bool(
        (subtitle_path and subtitle_path.is_file()) or scale_filter or trim_s > 0.01
    )

    if needs_reencode:
        vf_parts: list[str] = []
        if scale_filter:
            vf_parts.append(scale_filter)
        if subtitle_path and subtitle_path.is_file():
            sub = _escape_subtitle_path(subtitle_path)
            vf_parts.append(f"subtitles='{sub}'")
        cmd += ["-vf", ",".join(vf_parts)] if vf_parts else []
        cmd += ["-c:v", "libx264", "-crf", x264_crf, "-preset", x264_preset]
    else:
        cmd += ["-c:v", "copy"]

    cmd += [
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "-movflags",
        "+faststart",
        str(out_path),
    ]
    _run(cmd, timeout_seconds=_ffmpeg_timeout_seconds())


def _default_api_url() -> str:
    """Play-manifest 与媒体下载应对齐后端 API 根；勿用 SLIDEFORGE_FRONTEND_URL。"""
    raw = _env_first("SLIDEFORGE_API_URL", "EXPORT_API_URL")
    return raw or "http://127.0.0.1:8000"


def _default_frontend_url() -> str:
    """Playwright 打开的放映页 origin；勿与 API 混用，且无公网默认（避免误连线上）。"""
    raw = _env_first("SLIDEFORGE_FRONTEND_URL", "EXPORT_FRONTEND_URL")
    return raw or "http://127.0.0.1:3000"


def _export_timeline_clock_enabled() -> bool:
    """是否强制使用 timelineClock=1（旧导出时钟）；默认关闭，优先音频驱动以降低长片漂移。"""
    raw = (os.environ.get("SLIDEFORGE_EXPORT_TIMELINE_CLOCK") or "").strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    return False


def main(argv: Iterable[str] | None = None) -> int:
    env_path = Path(__file__).resolve().parent / ".env"
    if load_dotenv is not None:
        load_dotenv(env_path)

    parser = argparse.ArgumentParser(description="Auto play and export video.")
    parser.add_argument("--project-id", type=int, required=True)
    parser.add_argument(
        "--frontend-url",
        default=_default_frontend_url(),
        help="Play page origin (env SLIDEFORGE_FRONTEND_URL; default http://127.0.0.1:3000). Not the API base.",
    )
    parser.add_argument(
        "--api-url",
        default=_default_api_url(),
        help="Backend API base for /api/projects/... (env SLIDEFORGE_API_URL; default http://127.0.0.1:8000).",
    )
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument(
        "--storage-root", type=Path, default=_default_storage_root()
    )
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument(
        "--media-base-url",
        default="",
        help="远程 worker：可从此根 URL 下载 /media/... 音频（或用环境变量 SLIDEFORGE_MEDIA_BASE_URL）",
    )
    args = parser.parse_args(argv)

    ffmpeg_path = _resolve_ffmpeg()
    ffprobe_path = _resolve_ffprobe(ffmpeg_path)

    manifest = _fetch_manifest(args.api_url, args.project_id)
    steps = _flatten_steps(manifest)
    if not steps:
        raise RuntimeError("Manifest has no steps.")

    total_ms = int(sum(int(s.get("duration_ms") or 0) for s in steps))
    if total_ms <= 0:
        raise RuntimeError("Total duration is 0ms.")

    if args.output:
        output = Path(args.output).resolve()
        export_dir = output.parent
        export_dir.mkdir(parents=True, exist_ok=True)
    else:
        export_dir = (
            _default_storage_root()
            / "projects"
            / str(args.project_id)
            / "exports"
            / time.strftime("%Y%m%d-%H%M%S")
        )
        export_dir.mkdir(parents=True, exist_ok=True)
        output = export_dir / "export.mp4"

    media_base = (
        (args.media_base_url or "").strip()
        or (os.environ.get("SLIDEFORGE_MEDIA_BASE_URL") or "").strip()
        or None
    )
    dl_dir = (export_dir / "_audio_dl") if media_base else None
    audio_path = export_dir / "audio.m4a"
    _build_audio(
        steps,
        args.storage_root,
        audio_path,
        ffmpeg_path,
        media_base=media_base,
        download_dir=dl_dir,
    )

    subtitle_path = export_dir / "subtitles.srt"
    has_sub = _build_subtitles(steps, subtitle_path)

    query = "autoplay=1&clean=1&export=1&nativeSub=0"
    timeline_clock_enabled = _export_timeline_clock_enabled()
    if timeline_clock_enabled:
        # 仅用于回退兼容：新前端默认音频驱动，长片更不易出现音画累计漂移。
        query += "&timelineClock=1"
    play_url = f"{args.frontend_url.rstrip('/')}/play/{args.project_id}/present?{query}"
    print(
        "[export-diagnose] "
        f"project_id={args.project_id} timeline_clock={int(timeline_clock_enabled)} "
        f"width={args.width} height={args.height} total_ms={total_ms}",
        flush=True,
    )
    print(f"[export-diagnose] play_url={play_url}", flush=True)
    raw_auth = (os.environ.get("SLIDEFORGE_EXPORT_AUTHORIZATION") or "").strip()
    auth_token = ""
    if raw_auth:
        auth_token = raw_auth[7:].strip() if raw_auth.lower().startswith("bearer ") else raw_auth
    video_path, video_preroll_ms, rec_width, rec_height = asyncio.run(
        _record_video(
            play_url,
            total_ms,
            export_dir,
            args.width,
            args.height,
            auth_token=auth_token or None,
        )
    )

    _mux_video_audio(
        video_path,
        audio_path,
        output,
        ffmpeg_path,
        subtitle_path if has_sub else None,
        video_preroll_ms=video_preroll_ms,
        output_width=args.width,
        output_height=args.height,
        rec_width=rec_width,
        rec_height=rec_height,
    )
    raw_video_ms = _probe_media_duration_ms(video_path, ffprobe_path)
    audio_ms = _probe_media_duration_ms(audio_path, ffprobe_path)
    output_ms = _probe_media_duration_ms(output, ffprobe_path)
    print(
        "[export-diagnose] "
        f"preroll_ms={video_preroll_ms} has_sub={int(has_sub)} "
        f"raw_video_ms={raw_video_ms if raw_video_ms is not None else 'na'} "
        f"audio_ms={audio_ms if audio_ms is not None else 'na'} "
        f"output_ms={output_ms if output_ms is not None else 'na'}",
        flush=True,
    )
    if raw_video_ms is not None and audio_ms is not None:
        drift_ms = raw_video_ms - audio_ms
        print(f"[export-diagnose] raw_video_minus_audio_ms={drift_ms}", flush=True)
    if output_ms is not None and audio_ms is not None:
        out_vs_audio_ms = output_ms - audio_ms
        print(f"[export-diagnose] output_minus_audio_ms={out_vs_audio_ms}", flush=True)

    for p in (video_path, audio_path):
        try:
            if p.is_file():
                p.unlink()
        except OSError:
            pass
    if has_sub:
        try:
            if subtitle_path.is_file():
                subtitle_path.unlink()
        except OSError:
            pass

    print(f"Exported: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
