# webpy 範例：瀏覽器裡從零訓練一顆 mini-LLM

來源：`se/_more/code/mini-llm/v3-distill/`（Transformer + RoPE + 太陽系 QA 蒸餾語料）。

## 內容

- `pretrain.txt` / `finetune.txt` — 蒸餾語料（原專案產出，直接沿用）
- `cells/*.py` + `cells/*.md` — 筆記本原始碼（可讀、可改）
- `build_notebook.py` — 組裝 `mini-llm.webpy.json`
- `mini-llm.webpy.json` — **成品筆記本**，用 webpy 讀檔開啟即跑

## 為什麼是 numpy 版？

原 `model.py` 用原生 torch，Pyodide 沒有 torch 的 wasm build。
模型本體已獨立為 pip 套件 **`../../packages/mini-llm-numpy`**（純 numpy port，
同架構數學等價，`pip install` 可給其他 Python 專案引用，內附 pytest 梯度檢查）。
本筆記本的 Cell 3 會即時從套件目錄載入，**絕不內嵌模型程式碼**（單一真相來源）。

## 三種預算（Cell 4 頂端 `PRESET`，`train.py` 用 `--preset`）

- `fast`：約 2 分鐘，只驗流程（答句會亂，正常）
- `standard`（預設）：約 6–8 分鐘，完整 1M 模型 + 短 seq，首題答對
- `full`：約 20–40 分鐘，原專案同等最佳（pretrain ~0.29 / finetune ~0.23）

訓練中每 10 步印一行（含 it/s 與 ETA）；數字有在走就代表活著，不是當機。

## 在 webpy 打開（瀏覽器）

瀏覽器開 `index.html` → `📂 讀檔` → 選 `examples/mini-llm/mini-llm.webpy.json` →
`▶ 全部執行`。Cell 0 會自動裝 numpy，Cell 1 會自動 fetch 同目錄語料。

## 在命令列跑（對應原專案 run.sh）

```bash
cd examples/mini-llm
./run.sh                  # full 預設：裝套件 → pretrain → finetune → QA 實測
./run.sh --preset fast    # 快速驗證版
```

`run.sh` 先 `pip install` 套件再跑 `train.py`（吃 `mini_llm_numpy` API，
產出 `vocab.json` / `pretrain.npz` / `finetune.npz`，對應原版的 `.pt`）。
原 `gen_data_distill.py` 需 NVIDIA API key，直接沿用已蒸餾好的 txt 語料故略過。

## 重新產生筆記本

```bash
cd examples/mini-llm && python3 build_notebook.py
```
