# webpy — 純前端 Colab-like Python 筆記本

`Pyodide (Wasm CPython)` 驅動, **100% 完整 Python 語法**, 不自寫 parser。
瀏覽器重運算跑在 **Web Worker**, 主線程零卡頓、可一鍵中斷死迴圈。
Node.js 與 Browser 共用同一套核心概念 (Runner / Worker)。

## 架構

```
index.html + app.js (筆記本 UI, 主線程)
    │ postMessage {run, context}
    ▼
pyodide.worker.js (背景線程, loadPyodide)
    │ runPythonAsync
    ▼
Pyodide wasm CPython

Node.js: pythonRunner.js (直接 loadPyodide, 無 Worker)
```

| 方案 | 語法 | pip/科學庫 | 備註 |
|---|---|---|---|
| **Pyodide (採用)** | 100% CPython 3.11+ | numpy/pandas/micropip | Node + Browser |
| Brython | ~95% | 僅純 Python | 不採用 |
| Transcrypt/Skulpt | ~90% | 弱 | 不採用 |

## 檔案

- `pythonRunner.js` — Node/主線程統一 Runner (`init/run/loadPackage/pipInstall/reset`)
- `pyodide.worker.js` — Worker 核心 (`init/run/loadPackages/pipInstall/reset`)
- `AsyncPyodideWorker.js` — 主線程 Promise 封裝 (`run/restart/terminate`)
- `app.js`/`style.css`/`index.html` — 筆記本 UI (多 cell, md/code, Run All, 中斷/重啟, 存檔/讀檔, pip 安裝)
- `examples/node-demo.mjs` — Node 範例
- `examples/mini-llm/` — LLM 範例（mini Transformer 蒸餾專案的瀏覽器可跑版）
- `packages/mini-llm-numpy/` — 獨立 pip 套件（純 numpy Transformer，零 torch 依賴；`pip install ./packages/mini-llm-numpy`，`pytest` 已含梯度檢查）

## 使用

```bash
cd webpy
npm install
# 瀏覽器版 (pure frontend, 需 http, 不可用 file:// 開)
npx serve .   # 開 http://localhost:3000
# Node 版
node examples/node-demo.mjs
```

## 注意

1. **PyProxy 記憶體**: Runner/Worker 已自動 `toJs()` + `destroy()`, 大物件避免長期持有 proxy。
2. **pip**: `micropip` 只能裝純 Python wheel; `numpy/pandas` 用 `loadPackage()` 較穩。
3. **死迴圈**: 按 `⏹ 中斷` → `worker.restart()` 秒殺重建, 頁面不當掉。
4. **CDN**: worker 預設 `cdn.jsdelivr.net/pyodide/v0.25.0`; 離線環境請自託 `pyodide/` 目錄並改 `importScripts` 路徑。
