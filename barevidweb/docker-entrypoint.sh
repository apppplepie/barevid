#!/bin/sh
set -e
UP="${SLIDEFORGE_API_UPSTREAM:-http://host.docker.internal:8000}"
# 去掉尾部斜杠，避免 proxy_pass 出现 //
UP=$(echo "$UP" | sed 's|/*$||')
sed "s|__SLIDEFORGE_API_UPSTREAM__|${UP}|g" /etc/nginx/nginx.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
