import shutil
import wave
from pathlib import Path

from mutagen import File as MutagenFile


def _duration_from_wave(path: Path) -> int | None:
    try:
        with wave.open(str(path), "rb") as w:
            frames = w.getnframes()
            rate = w.getframerate()
            if rate <= 0:
                return 0
            return int(1000 * frames / float(rate))
    except (wave.Error, EOFError, OSError):
        return None


def _duration_from_mutagen(path: Path) -> int | None:
    meta = MutagenFile(str(path))
    if meta is None or not hasattr(meta, "info") or meta.info is None:
        return None
    length = getattr(meta.info, "length", None)
    if length is None:
        return None
    return int(float(length) * 1000)


def audio_duration_ms(path: Path) -> int:
    """
    扩展名为 .wav 但实际为 MP3 等压缩格式时，wave 会失败，需走 mutagen。
    """
    path = Path(path)
    ms = _duration_from_wave(path)
    if ms is not None:
        return ms
    ms = _duration_from_mutagen(path)
    if ms is not None:
        return ms
    raise RuntimeError(f"无法解析音频时长（非 WAV/支持的压缩格式？）: {path}")


def _resolve_slide_audio_file(
    project_id: int, sequence_no: int, storage_root: Path
) -> Path | None:
    if sequence_no <= 0:
        return None
    base = storage_root / "projects" / str(project_id) / "audio"
    if not base.is_dir():
        return None

    # 优先命中标准命名
    for ext in ("mp3", "wav", "MP3", "WAV"):
        p = base / f"{sequence_no:03d}.{ext}"
        if p.is_file():
            return p

    # 兼容历史命名（无前导零、大小写扩展名）
    seq_plain = str(sequence_no)
    seq_padded = f"{sequence_no:03d}"
    for p in base.iterdir():
        if not p.is_file():
            continue
        suffix = p.suffix.lower()
        if suffix not in (".mp3", ".wav"):
            continue
        stem = p.stem.strip()
        if stem == seq_plain or stem == seq_padded:
            return p
    return None


def resolve_slide_audio_url(project_id: int, sequence_no: int, storage_root: Path) -> str:
    """磁盘上实际是 .mp3 或旧版 .wav 时，返回存在的文件的 URL。"""
    p = _resolve_slide_audio_file(project_id, sequence_no, storage_root)
    if p is not None:
        try:
            version = int(p.stat().st_mtime_ns)
        except OSError:
            version = 0
        return f"/media/projects/{project_id}/audio/{p.name}?v={version}"
    return f"/media/projects/{project_id}/audio/{sequence_no:03d}.mp3"


def latest_export_media_url(project_id: int, storage_root: Path) -> str | None:
    """
    扫描 projects/{id}/exports/*/*.mp4，返回修改时间最新的一条 /media/... URL。
    兼容新旧命名：历史为 export.mp4，新版为「项目名.mp4」。
    """
    exports = storage_root / "projects" / str(project_id) / "exports"
    if not exports.is_dir():
        return None
    best_mtime: float | None = None
    best_file: Path | None = None
    for sub in exports.iterdir():
        if not sub.is_dir():
            continue
        for f in sub.glob("*.mp4"):
            if not f.is_file():
                continue
            try:
                m = f.stat().st_mtime
            except OSError:
                continue
            if best_mtime is None or m > best_mtime:
                best_mtime = m
                best_file = f
    if best_file is None:
        return None
    try:
        rel = best_file.resolve().relative_to(storage_root.resolve())
    except ValueError:
        return None
    return f"/media/{rel.as_posix()}"


def delete_project_export_files(storage_root: Path, project_id: int) -> int:
    """
    删除 projects/{id}/exports 下全部导出子目录/文件（强制重新导出前调用，避免旧 mp4 与队列状态不一致）。
    返回删除的目录数（每个时间戳子目录计 1）。
    """
    exports = storage_root / "projects" / str(project_id) / "exports"
    if not exports.is_dir():
        return 0
    n = 0
    for sub in list(exports.iterdir()):
        try:
            if sub.is_dir():
                shutil.rmtree(sub, ignore_errors=True)
                n += 1
            elif sub.is_file() and sub.suffix.lower() == ".mp4":
                sub.unlink(missing_ok=True)
                n += 1
        except OSError:
            continue
    return n


def resolve_slide_audio_path(
    project_id: int, sequence_no: int, storage_root: Path
) -> Path | None:
    """与 resolve_slide_audio_url 同规则；无有效序号或文件不存在时返回 None。"""
    return _resolve_slide_audio_file(project_id, sequence_no, storage_root)
