#!/bin/bash
# llm/03-distill 一鍵訓練（對應原專案 run.sh）
# 原 gen_data_distill.py 需 NVIDIA_API_KEY，蒸餾語料已內含於 corpus/ 故略過。
# 用法：./run.sh
set -e
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund
fi
# tfjs-node 4.22 與 Node 24 不相容（reshape/oneHot 崩潰），鎖 node@22（同 llm.sh）
npx --yes node@22 --no-deprecation pretrain.js
npx --yes node@22 --no-deprecation finetune.js
