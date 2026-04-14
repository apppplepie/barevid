"""
PyInstaller 入口：等价于
  python -m uvicorn app.main:app --host 127.0.0.1 --port <BAREVID_API_PORT>
环境变量由 Electron 主进程注入（DATABASE_URL、STORAGE_ROOT 等）。
"""
from __future__ import annotations

import os


def main() -> None:
    port = int(os.environ.get("BAREVID_API_PORT", "18080"))
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=port,
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    main()
