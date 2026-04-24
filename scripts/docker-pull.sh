#!/usr/bin/env bash
# 拉取 compose 中镜像的最新版本；默认包含 prod profile
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

profile_args=""
pull_args=""
has_profile=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --profile)
      profile_args="$profile_args --profile $2"
      has_profile=1
      shift 2
      ;;
    --profile=*)
      profile_args="$profile_args $1"
      has_profile=1
      shift
      ;;
    *)
      pull_args="$pull_args $1"
      shift
      ;;
  esac
done

if [ "$has_profile" -eq 0 ]; then
  profile_args="--profile prod"
fi

exec docker compose $profile_args pull $pull_args
