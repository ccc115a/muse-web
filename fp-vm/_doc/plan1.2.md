# plan1.2 — 擴充 VM（LBC v1.x）

目標：補上 plan1.1（迷你 ML）與 Erlang 單行程子集共用的缺口。
原則：向後相容，舊 `.lbc` 不需重編即可跑。

## 1. APPLY（動態參數個數呼叫）

* 現況：`CALL n` 的 `n` 是靜態的；`cljc` 用 `_apply-list` 展開至 10 參繞過。
* 設計：加 `APPLY` 指令，語意 `[... f arglist] → 結果`（`arglist` 為 LBC list）。
* 改動點：`lispc.js`（emit）、`lispvm.js`（`listToArray` 後分派 Closure/primitive）、
  `vm2wasm.js`（從線性記憶體讀 list，填 `ARGBUF` 後走既有 `call/tailcall` 路徑；arity 錯誤沿用 `E_ARITY`）。
* 驗收：`(apply + '(1 2 3))`、`(apply f xs)` 任意長度；`cljc` 的 `_apply-list` 上限可刪。

## 2. 原生 vector / map（可選加速）

* 現況：`cljc` 用 `(%vec ...)`/`(%map ...)` 標籤 list 模擬，`nth/get` O(n)。
* 設計（二選一）：
  * A. 不加指令，只在兩後端加 primitives（`vec/nth/get/assoc` 直接操作標籤 list，語意不變、效能小升）。
  * B. 加真值型別 `VEC/MAP` + 指令（效能好，但 `vm2wasm.js` 記憶體佈局、GC、列印全要動）。
* 建議：先做 A；B 等 wasm 切 WasmGC 再做。

## 3. 例外（TRY / THROW / CATCH）

* 語法（Scheme 層）：`(try body (catch var handler))`， desugar 目標供 `mlc/cljc` 共用。
* 設計：LBC 加 `TRY Lcatch / UNTRY / THROW`（或 `THROW` 即 `CALL error` 的結構化版）；
  `lispvm.js` 在 frame 加 handler 指標，`THROW` unwind 到最近 handler；
  `vm2wasm.js` 用 wasm `try_table`（需 toolchain 支援）或顯式 handler 堆疊模擬，擇一。
* 驗收：`Match_failure`、除以零、`assoc` 越界皆可 catch；未 catch 沿用現有報錯路徑。

## 4. BigInt / 數字

* 現況：數字是 JS double；`fact 20` 已溢位為浮點。
* 設計：JS 端切 `BigInt`（小整數仍走現快速路徑，大整數轉物件）；wasm 端先以 `FLOAT` + host 回落頂著，真 64-bit 留到 WasmGC 階段。
* 驗收：`fact 30`、`fib` 大數精確；舊小整數程式效能不退化（`F_FAST` 仍命中）。

## 5. 不做的事（本階段）

* 並行（`SPAWN/SEND/RECEIVE`）、continuation/coroutine、WasmGC 遷移、檔案 I/O。

## 6. 相容與測試

* LBC 版本頭沿用 `; LBC v1`，新指令為加法；`load()` 遇未知指令報錯（不靜默）。
* 每項改動同時改 `lispvm.js + vm2wasm.js`，`run_wasm.sh` 全量比對必須全過。
* 新增 `lisp/try.lbc`（或 `.lisp`）與 `apply` 測試，納入 `run_*.sh`。

## 7. 實作狀態 (v1.2 已完成)

* APPLY/TAILAPPLY：`lispc` 表面 `(apply f lst)`（恰 2 參，尾位置自動 TAILAPPLY）；
  `cljc` 的 `_apply-list`（10 參上限）已刪，改走 `%apply` + spread，`(apply f a b lst)` 由
  `exCall` 改寫經 `core/_spread`；`swap!/update/update-in` 內部站點同步改寫。
* 例外：`lispc` 表面 `(try body (catch var h...))` + `(throw e)`；body 強制非尾編譯
  （TAILCALL 會跳過 UNTRY），handler 保持尾位置。`cljc` 支援單一無型別 catch（自動忽略
  類別名），無 finally。`mlc/.lc` 表面本次不加（延後）。
* wasm 例外：legacy EH（tag section 在 global 之前；`try` 佔一個 label 深度，
  handler 回 `\$again` 要 `br 2`；`rethrow` 不可嵌在 `if` 內，改用同 payload 再 `throw`）。
  宿主 `err/prim/error` 一律丟 `WebAssembly.Exception`，uncaught 在宿主還原訊息，
  與 `lispvm` 輸出一致（含 `car: 不是 pair`、`除以零`、`未定義的變數`）。
* BigInt：`lispc/lambdac` 支援 `123N` 字面量（CONST 記為 `{"big":"..."}`）；
  `mlc/cljc` 本次不加（文件註記）。混合運算自動提升，非整除 `/` 回落 Number；
  `=` 跨型別按值比較；小整數仍走 `F_FAST`。
* vector/map (A)：`vector` + `hash-map` 變元原生（`PRIM_NAMES` 僅附加，舊 ID 不變）；
  標籤符號位址經 `meta.tags` 發布（不污染 GLOBALS）；`hash-map` 去重（後贏，
  保持首次順序，同 `_assoc1`）；`cljc` 的 `vector/hash-map` 改為 thin wrapper，
  固定參數另有直呼快速路徑。真 VEC/MAP 型別 (B) 仍延到 WasmGC。
* 新測試：`lisp/apply.lisp`、`lisp/try.lisp`、`lisp/bigint.lisp`、`lisp/vecmap.lisp`
  （皆納入 `run_wasm.sh` 雙端比對）；uncaught 路徑雙端訊息一致（僅 apply 超限多了
  256 上限註記）。
* 不相容注意：含新指令的 `.lbc` 需新版 VM；舊 `.lbc` 行為不變（15 個舊測試全過）。
  wasm 例外需 Node 24（legacy EH + `WebAssembly.Exception`）。
