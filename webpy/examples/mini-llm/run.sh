#!/bin/bash
# webpy/examples/mini-llm 一鍵訓練（對應原專案 run.sh）
# 原流程 gen_data 需 NVIDIA_API_KEY，且蒸餾語料已內含於 pretrain.txt / finetune.txt，
# 故此腳本直接做：安裝套件 → pretrain → finetune → QA 實測。
# 用法：./run.sh [--preset fast|full]
set -e
cd "$(dirname "$0")"
pip3 install ../../packages/mini-llm-numpy
python3 train.py "$@"
