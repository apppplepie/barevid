# 不设 # syntax=docker/dockerfile:1，避免构建时向 Docker Hub 拉取 Dockerfile 前端镜像（国内/离线易超时）。
# 构建上下文：仓库根目录（barevid），例如：
#   docker build -f barevidweb/Dockerfile -t barevidweb .
# 根目录须有 .dockerignore，避免把 SlideForge/worker/node_modules 等整库打进 context。
# 使用 20-alpine：与常见本机缓存一致，避免首次构建卡在拉取 node:22
#
# 需 BuildKit（Docker Desktop 默认开启）：npm ci 使用缓存挂载，第二次起通常明显快于首次全量拉包。
# 国内可加速：docker build --build-arg NPM_CONFIG_REGISTRY=https://registry.npmmirror.com ...
FROM node:20-alpine AS build

WORKDIR /app
COPY barevidweb/package*.json ./
# 默认官方源；国内可 docker build --build-arg NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org
ENV npm_config_registry=${NPM_CONFIG_REGISTRY}
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY barevidweb/ ./
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY barevidweb/nginx.conf.template /etc/nginx/nginx.conf.template
COPY barevidweb/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENV SLIDEFORGE_API_UPSTREAM=http://host.docker.internal:8000
EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
