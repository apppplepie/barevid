#!/bin/sh
set -e

# 扫描挂载的 /vidsrc（只读卷里可能没有 manifest.json），在可写目录生成清单供 nginx 固定路径提供。
# 添加 mp4 后无需在宿主机执行 npm run vidsrc:manifest。
VIDSRC_DIR=/usr/share/nginx/html/vidsrc
MANIFEST_DIR=/run/barevid
MANIFEST_FILE="$MANIFEST_DIR/vidsrc-manifest.json"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g;s/"/\\"/g'
}

mkdir -p "$MANIFEST_DIR"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

for ext in mp4 MP4 webm WEBM mov MOV; do
  for f in "$VIDSRC_DIR"/*."$ext"; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    [ "$base" = "manifest.json" ] && continue
    case "$base" in .*) continue ;; esac
    printf '%s\n' "$base"
  done
done | sort -V -u > "$tmp"

generated=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
{
  printf '{"generated":"%s","videos":[' "$generated"
  sep=""
  while IFS= read -r base || [ -n "$base" ]; do
    [ -z "$base" ] && continue
    esc=$(json_escape "$base")
    printf '%s{"file":"%s"}' "$sep" "$esc"
    sep=","
  done < "$tmp"
  printf ']}\n'
} > "$MANIFEST_FILE"
chmod 644 "$MANIFEST_FILE"

UP="${SLIDEFORGE_API_UPSTREAM:-http://host.docker.internal:8000}"
# 去掉尾部斜杠，避免 proxy_pass 出现 //
UP=$(echo "$UP" | sed 's|/*$||')
sed "s|__SLIDEFORGE_API_UPSTREAM__|${UP}|g" /etc/nginx/nginx.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
