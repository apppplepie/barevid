# 使用 Python 版 Playwright 镜像（与 export_video.py 一致）。
# 注意：mcr.microsoft.com/playwright:v1.42.0-jammy 是 Node 版；录屏脚本需要下面这类：
#   mcr.microsoft.com/playwright/python:v1.42.0-jammy
FROM mcr.microsoft.com/playwright/python:v1.42.0-jammy

WORKDIR /app

COPY requirements-docker.txt /tmp/requirements-docker.txt
RUN pip install --no-cache-dir -r /tmp/requirements-docker.txt

# 浏览器已在官方镜像内；无需再 python -m playwright install

# 运行时请挂载整个 barevid 仓库（export_video 默认 storage 在 SlideForge/backend/storage），例如：
#   docker run --rm -it \
#     --add-host=host.docker.internal:host-gateway \
#     -v D:/workspace/code/test/barevid:/work \
#     -w /work/worker \
#     -e SLIDEFORGE_WORKER_KEY=你的密钥 \
#     -e SLIDEFORGE_API_URL=http://host.docker.internal:8000 \
#     <构建出的镜像名> \
#     python worker_export_video.py --worker-key "$SLIDEFORGE_WORKER_KEY" --api-url "$SLIDEFORGE_API_URL"
#
# 后端 .env 在「仅本机 Docker worker」场景建议：
#   EXPORT_PUBLIC_BASE_URL=http://host.docker.internal:8000
#   EXPORT_FRONTEND_URL=http://host.docker.internal:3000
# （以便容器内 Playwright 与 ffmpeg 拉音频、打开放映页）
#
# 镜像本身只装好依赖；启动命令在运行时写（见上文 docker run），不要用固定 ENTRYPOINT，
# 否则与 -w /work/worker 挂载目录易冲突。
