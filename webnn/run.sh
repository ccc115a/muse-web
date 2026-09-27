#!/bin/bash
# webnn 一鍵訓練：./run.sh [--preset fast|standard|full]
# 不給 preset 預設 fast（約 1-2 分鐘）；standard 約 30 分鐘，full 更久。
set -e
cd "$(dirname "$0")"
npm install --no-audit --no-fund
if [[ "$*" != *"--preset"* ]]; then
  set -- "$@" --preset fast
fi
node train.mjs "$@"
