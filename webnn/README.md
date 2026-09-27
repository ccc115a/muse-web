# webnn — 從零寫的 JS 神經網路引擎 + mini-LLM

零 ML 依賴（模型路徑不用 tf.js，只用它當速度對照組）。先有引擎，再有 LLM。

```
src/
  tensor.js   Tensor（Float32Array + row-major + 零拷貝 view）
  rng.js      可重現隨機數（mulberry32 + Box-Muller）
  kernels.js  L0：分塊 GEMM 家族（gemm/gemmAT/gemmBT/bmm系，轉置用專用kernel絕不物化）、
              softmax、RMSNorm、RoPE、SiLU門、embedding gather/scatter、融合CE
  optim.js    AdamW（bias correction）+ 全域梯度裁剪
  model.js    L1/L2：同 mini-llm 架構的 Transformer（RMSNorm+RoPE+SwiGLU+tied embedding），
              顯式 reverse-mode（forward 存 cache，backward 逐層回傳），multinomial 生成
  data.js     字元詞表、編解碼、取 batch
train.mjs     CLI（--preset fast|standard|full，語料預設讀 ../webpy/examples/mini-llm/）
tests/        kernels.mjs（各 kernel 數值微分單測）
              gradcheck.mjs（全模型數值梯度檢查）
              equiv.mjs（同權重同 batch 對 numpy/torch 版：loss 6 位一致、全梯度 ≤3.4e-4）
bench/        matmul.mjs（與 tf.js CPU 同形狀對比）
```

## 用法

```bash
npm test                  # 全部測試（kernel 單測 + 梯度檢查 + 對等驗證）
node train.mjs --preset fast     # 端到端訓練（fast/standard/full，超參數寫死在 preset 裡）
node bench/matmul.mjs     # 速度對比（需 npm install）
```

## 速度（同機器實測，MacBook）

| 項目 | webnn（從零手寫） | tf.js CPU | 原生 numpy |
|---|---|---|---|
| GEMM (1024×128)@(128×512) | **63.5ms（2.11 GFLOPS）** | 103.8ms（1.29 GFLOPS） | — |
| 全模型訓練每步（standard） | 3.38s | — | ~0.05s |

- 對「tf.js 一樣快」：**CPU 後端我們快 1.63x**（同形狀、結果 2e-6 一致）。但注意 tf.js 在瀏覽器預設跑 WebGL/WebGPU，那是另一個量級；要打 GPU 得整個引擎換 WebGPU 後端，不在「從零寫」範圍內。
- 對原生 numpy 慢 ~60x：差在多線程 SIMD BLAS（Accelerate/OpenBLAS），不是 kernel 寫法問題——單線程純 JS 的天花板就在這。這也是瀏覽器版註定比命令列慢的原因（見 mini-llm README）。

## 驗證故事（都曾抓到真 bug）

開發過程靠測試抓到三個真 bug：GEMM 轉置參數順序、attention 輸出佈局、反向漏乘 Wo^T。
`equiv.mjs` 以 torch 驗證過的 numpy 版為錨，保證 JS 引擎數學等價。
