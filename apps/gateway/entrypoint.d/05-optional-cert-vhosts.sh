#!/bin/sh
set -eu

disable_if_missing() {
  vhost="$1"
  cert="$2"
  key="$3"
  if [ ! -s "$cert" ] || [ ! -s "$key" ]; then
    echo "[gateway] disabling $vhost: certificate or key unavailable" >&2
    rm -f "/etc/nginx/conf.d/$vhost.conf"
  fi
}

disable_if_missing admin.voloian.cn /etc/nginx/ssl/admin.voloian.cn_nginx/admin.voloian.cn_bundle.crt /etc/nginx/ssl/admin.voloian.cn_nginx/admin.voloian.cn.key
disable_if_missing voloian.cn /etc/nginx/ssl/voloian.cn_nginx/voloian.cn_bundle.crt /etc/nginx/ssl/voloian.cn_nginx/voloian.cn.key
