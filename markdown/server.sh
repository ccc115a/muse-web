#!/bin/sh
# 啟動 MD-GH Web 版：build 後用 vite preview  serve dist/
# 用法：./server.sh [port]   (預設 4173)
set -e
cd "$(dirname "$0")"
PORT="${1:-4173}"
[ -d node_modules ] || npm install
npm run build --workspace=@md-gh/web
PORT="$PORT" npm run preview --workspace=@md-gh/web -- --port "$PORT" --host
