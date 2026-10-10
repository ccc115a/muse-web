#!/bin/sh
# 詳細測試：kernel＋parser＋tactics＋範例＋前端靜態檢查（零依賴，只需 node）
cd "$(dirname "$0")" || exit 1
exec node tests/run_tests.mjs
