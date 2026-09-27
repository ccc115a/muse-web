# llm/03-distill — v3 蒸餾專案的 tf.js 重製版

來源：`se/_more/code/mini-llm/v3-distill/`（Transformer + RoPE + 太陽系 QA 蒸餾語料）。
同架構（RMSNorm + RoPE + SwiGLU + tied embedding + AdamW），同超參數
（d=128 / 4頭 / 4層 / seq=64 / batch=32 / pretrain 500 / finetune 300），
用 `@tensorflow/tfjs-node`（原生 CPU 後端）求快。

## 用法

```bash
./run.sh        # pretrain → finetune → QA 實測，約 100 秒
```

`corpus/` 內含蒸餾好的語料（原 `gen_data_distill.py` 需 NVIDIA API key，故略過）。
產出：`vocab.json`、`weights.pretrain.json`、`weights.finetune.json`（對應原版 `.pt`）。

## 實測（MacBook，原生 CPU）

| | torch 原版 | 本專案 |
|---|---|---|
| pretrain loss | 5.49 → 0.29 | 5.39 → 0.28 |
| finetune loss | 5.01 → 0.24 | 5.28 → 0.26 |
| 首題回答 | 很稀薄 ✅ | 很稀薄 ✅ |
| 總耗時 | 數分鐘 | ~100 秒 |

## 實作要點

- `src/model.js` — 模型本體。RoPE 用 rotate-half 版（split/concat，比 complex 版更適合 tfjs；
  從零訓練，等價有效）。embedding 用 `tf.gather`（01 版的 oneHot@E 又慢又吃記憶體）。
- `src/train.js` — 手寫 AdamW（tfjs 內建 adam 無 weight-decay）+ 全域梯度裁剪。
  記憶體紀律是重點：`assign()` 不清舊值、`tidy` 會吃掉 assign 進 variable 的 tensor，
  所以新值一律 `tf.keep`、舊值配對 `dispose`，800 步零增長（曾抓到 +38 tensor/步的 leak）。
- `generate` 必須餵 **logits** 給 `tf.multinomial`（它內部會 exp；餵 probs 等於壓平分佈，
  曾因此整段亂碼，loss 正常也照樣錯——已修正並驗證）。

## 已知限制

- tfjs-node 4.22 與 **Node 24 不相容**（reshape/oneHot 崩潰），`run.sh` 鎖 `node@22`
  （同層 `01-pretrain/llm.sh` 亦然）。跟 01 版一樣壞掉不是我們的錯，已實測確認。
