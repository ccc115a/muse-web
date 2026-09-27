# 🐍 mini-LLM in webpy（瀏覽器可跑版）

來源：`se/_more/code/mini-llm/v3-distill/` —— 微型 Transformer（RMSNorm + RoPE + SwiGLU + tied embedding），
用大模型蒸餾出的「太陽系八大行星」語料做 pretrain → finetune → QA 生成。

## 為什麼是 numpy 版？

原專案 `model.py` 用的是**原生 torch**（`view_as_complex`、`torch.polar`、AdamW、Embedding），
而 Pyodide 官方沒有 torch 的 wasm build，瀏覽器跑不起來。
此筆記本改用獨立套件 **`packages/mini-llm-numpy`**（純 numpy port，同架構數學等價、從零訓練，
`pip install` 即可給其他 Python 專案引用），Cell 3 會從套件目錄即時載入，絕不內嵌複本。

## 三種預算（Cell 4 頂端 `PRESET` 切換）

| 項目 | fast（流程驗證） | standard（預設） | full（原專案同等最佳） |
|---|---|---|---|
| d_model / heads / layers | 64 / 2 / 2 | 128 / 4 / 4 | 128 / 4 / 4 |
| seq_len / batch | 32 / 16 | 32 / 32 | 64 / 32 |
| pretrain / finetune iters | 120 / 60 | 300 / 200 | 500 / 300 |
| 瀏覽器耗時 | ~2 分鐘 | ~6–8 分鐘 | ~20–40 分鐘 |
| 首題回答 | ✗ 亂碼（正常） | ✅ 很稀薄 | ✅ 很稀薄 |

舊版預設每 50 步才印一行，中間長時間無輸出易被誤認為當機；現已改為**每 10 步一行並附 it/s 與 ETA**，
只要數字在走就是活著。之前答句亂是因為 fast 訓練量不夠，已用 torch autograd 逐梯度驗證 numpy 版數學等價，
standard/full 規模本地實測收斂曲線與原專案一致。

## 執行順序

**Cell 0 → 5 依序執行**（或按 `▶ 全部執行`）。權重放在記憶體全域變數，`重啟核心`會遺失，需重跑。
