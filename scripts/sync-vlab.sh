#!/usr/bin/env bash
set -euo pipefail

upstream=https://github.com/TwinJades/USTC_Study_Materials_Navigation.git
base=$HOME/.local/share/yexi-bookshelf
repo=$base/repo
releases=$base/releases
service=yexi-bookshelf.service
export PATH="$HOME/.local/bin:$PATH"

mkdir -p "$releases" "$base/shared"
exec 9>"$base/sync.lock"
flock -n 9 || exit 0

if [[ ! -d $repo ]]; then git init --quiet --bare "$repo"; fi
git -C "$repo" fetch --atomic --quiet --no-tags "$upstream" \
  refs/heads/main:refs/heads/main \
  refs/heads/monitoring-data:refs/heads/monitoring-data
main=$(git -C "$repo" rev-parse 'refs/heads/main^{commit}')
monitor=$(git -C "$repo" rev-parse 'refs/heads/monitoring-data:data/monitoring.json')
release=$releases/$main-$monitor
previous=$(readlink "$base/current" || true)
if [[ -e $base/current && ! -L $base/current ]]; then
  printf 'current 必须是符号链接。\n' >&2
  exit 1
fi
if [[ $release == "$previous" ]]; then
  printf '已部署 %s。\n' "${release##*/}"
  exit 0
fi

switch_current() {
  ln -sfn "$1" "$staging/current"
  mv -Tf "$staging/current" "$base/current"
}

staging=$(mktemp -d "$releases/.build.XXXXXXXX")
activating=0
cleanup() {
  local status=$?
  if (( activating )); then
    if [[ -n $previous ]]; then
      switch_current "$previous" && systemctl --user restart "$service" || printf '恢复旧版本失败。\n' >&2
    else
      systemctl --user stop "$service" || true
      rm -f -- "$base/current"
    fi
  fi
  rm -rf -- "$staging"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

if [[ ! -d $release ]]; then
  mkdir "$staging/tree"
  git -C "$repo" archive "$main" | tar -x -C "$staging/tree"
  git -C "$repo" cat-file blob "$monitor" >"$staging/tree/data/monitoring.json"
  (
    cd "$staging/tree"
    npm run validate -- --strict-research --require-monitoring
    YEXI_SELF_HOSTED=1 npm run build
    test -s dist/index.html && test -s dist/data/catalog.json && test -s scripts/lib/visit-stats.mjs
  )
  mv -T "$staging/tree" "$release"
fi

activating=1
switch_current "$release"
systemctl --user restart "$service"
for ((attempt=0; attempt<15; attempt++)); do
  if curl --fail --silent --max-time 2 --output /dev/null http://127.0.0.1:8080/; then
    activating=0
    break
  fi
  sleep 1
done
if (( activating )); then
  printf '新版本未通过 HTTP 检查，恢复旧版本。\n' >&2
  exit 1
fi
printf '已部署 %s。\n' "${release##*/}"

# 仅清理本脚本生成的发布目录，保留当前和上一个版本。
for old in "$releases"/*; do
  [[ $old != "$release" && $old != "$previous" && -d $old && ! -L $old ]] || continue
  [[ ${old##*/} =~ ^[a-f0-9]{40}-[a-f0-9]{40}$ ]] || continue
  rm -rf -- "$old"
done
