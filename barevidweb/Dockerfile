# 构建上下文：仓库根目录（barevid），例如：
#   docker build -f barevidweb/Dockerfile -t barevidweb .
# 使用 20-alpine：与常见本机缓存一致，避免首次构建卡在拉取 node:22
FROM node:20-alpine AS build

WORKDIR /app
COPY barevidweb/package*.json ./
RUN npm ci

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
