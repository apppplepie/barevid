# Python 版 Playwright（与 export_video.py 一致）。
# 仓库根 docker compose 会构建本镜像并启动 worker_export_video.py。
# 仅本机调试仍可挂载源码覆盖 /barevid/worker（见仓库根 README）。
FROM mcr.microsoft.com/playwright/python:v1.42.0-jammy

WORKDIR /barevid/worker

COPY requirements-docker.txt /tmp/requirements-docker.txt
RUN pip install --no-cache-dir -r /tmp/requirements-docker.txt

COPY export_video.py worker_export_video.py task_db.py panel.py ./

ENV PYTHONUNBUFFERED=1

CMD ["python", "worker_export_video.py"]
