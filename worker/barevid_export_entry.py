"""
PyInstaller 单文件入口：生成 worker.exe，等价于
  python export_video.py <args>
"""
from __future__ import annotations

from export_video import main


if __name__ == "__main__":
    raise SystemExit(main())
