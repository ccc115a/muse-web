# plan1.x — 其他函數式語言轉 .lbc 總體規劃

> 狀態：迷你 Clojure（`cljc.js`）已完成。本規劃是後續路線圖。

## 1. 前提

LBC v1 本質是「動態型別 + 閉包 + 真尾呼叫的 Scheme 核心」。
前端統一模式（`cljc.js` 已驗證）：

```
Reader → Desugar 成 Scheme 核心 → lispc.compile() → .lbc → lispvm / vm2wasm
```

## 2. LBC 現況

已有：閉包、一級函式、`TAILCALL`、`set!`、數字/字串/符號/pair-list。
缺少：`APPLY`（現用 `_apply-list` 展開至 10 參繞過）、原生 vector/map
（現用 `(%vec ...)`/`(%map ...)` 標籤 list 模擬，O(n)）、例外、bignum、
GC（wasm 版為 bump allocator）。

## 3. 各語言評估

| 語言 | 難度 | 對應 | 缺口 |
|---|---|---|---|
| Clojure 子集 | ✅ 已完成 | `defn/let/loop/recur` 1:1 | lazy seq、macro、`#{}`、`try`、interop（已切掉） |
| OCaml / SML 子集 | 低~中，下一個 | eager 直對，型別擦除 | ADT + `match`、例外、`ref` → plan1.1 |
| Erlang 單行程子集 | 中 | 多子句→`cond`，atom→symbol，tuple→`%vec` | `try/catch`、binary |
| Erlang 含並行 | 高 | 無 | `spawn/send/receive` 需 VM 排程器或全 CPS |
| Haskell | 高 | 閉包、ADT | 惰性、typeclass 字典傳遞、`Integer`、IO |

## 4. 關鍵轉換（已驗證 + 待驗證）

* `recur` → 具名 let → `TAILCALL`（`cljc.js` 已做）。
* Erlang 多子句 → `cond`，保留尾呼叫。
* ADT → 帶標籤 list，`match/case` → `cond + eq? + car/cdr`（plan1.1 驗證）。
* 惰性 → 帶快取 thunk（`set!` 可做，但全參數包 thunk 很慢，需嚴格性分析）。

## 5. 最難的三件事

1. Haskell typeclass：要字典傳遞，約等於寫半個型別檢查器。
2. Erlang 並行：LBC 無 continuation，每 process 要獨立堆疊。
3. bignum：JS 端易（`BigInt`），wasm 端要自幹。

## 6. 省工做法

不從原始碼重寫完整語言，接各編譯器的 IR：
GHC STG（`-ddump-stg-final`）、Core Erlang（`erlc +to_core`）、
OCaml Lambda（`-dlambda`）。

## 7. 步驟

1. ✅ 迷你 Clojure → LBC（已完成）。
2. → plan1.1：迷你 ML（ADT + pattern match）。
3. → plan1.2：擴 VM（`APPLY`、原生 vector/map、例外、`BigInt`）。
4. 最後：Erlang 並行、Haskell 惰性。

wasm 要跑得好，最終需 WasmGC，本階段先不做。
