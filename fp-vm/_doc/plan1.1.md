# plan1.1 — 迷你 ML 前端（`mlc.js`）

目標：驗證「ADT + pattern match → LBC」這條路，為 Erlang/Haskell 共用基礎。
刻意不做型別檢查器（型別擦除），只做語法 + desugar。

## 1. 語言範圍（最小可用）

```
prog    := decl | expr  (以 ; 分隔，-- 註解，比照 lambdac.js)
decl    := datatype NAME = Ctor (of ty)? (| Ctor (of ty)?)*
         | let NAME pat* = expr
         | letrec NAME pat* = expr
expr    := \pat. expr | fun pat* -> expr
         | match expr with (pat -> expr |)+
         | let pat = expr in expr
         | if expr then expr else expr
         | f a b (curried 應用) | ( expr ) | [e, ...] | 數字/字串/true/false/nil
pat     := x | _ | Ctor | Ctor pat | Ctor (p1, p2) | (p1 :: p2) | 常數
```

* `ref` 第一版不做（可用 `set!` 直寫 Scheme 核心逃生門）。
* 例外第一版不做（等 plan1.2 的 `TRY`）。
* 不做 module/functor；單檔即可。

## 2. 編譯策略

```
*.ml ─reader/parser→ AST ─desugar→ Scheme ─lispc.compile()→ .lbc
```

* Ctor 編碼：沿用 `cljc.js` 慣例，`Ctor x y` → `(%list 'Ctor x y)`，
  nullary `Nothing` → `'Nothing`（或 `(quote (Just))` 類推，需與 `cljc` 一致擇一）。
* `match` 編譯：每條子句 → 測試鏈（`eq?(car v)'Ctor` + arity 檢查）+ 綁定（`car/cdr` 或 `nth` 取欄位），子句間以 `cond` 串接；wildcard `_` 即 else；變數 pattern 直接綁。
* 重疊/窮盡檢查：第一版只做「有 wildcard 即窮盡」，無 wildcard 補 `else (error "Match_failure")`，不做完整靜態檢查。
* 多參數 `let f p1 p2 = e` 比照 `lambdac.js` 包成 curried lambda。
* 尾位置：`match` 各分支、建構子欄位（非尾）需正確傳 `tail` 旗標，遞迴函式保持 `TAILCALL`。

## 3. 檔案與 CLI

* 新增 `mlc.js`：`compile(src)/toScheme(src)`，CLI `node mlc.js prog.ml [-o prog.lbc] [--scheme]`，比照 `cljc.js`。
* 新增 `ml/*.ml` 範例：`01_basics`（let/match/option）、`02_adt`（list/tree 遞迴）、`03_recursion`（尾遞迴 + 相互遞迴）。
* 新增 `run_ml.sh`：逐檔 `mlc → lispvm`，並比對 `lispvm` vs `vm2wasm` 輸出（抄 `run_clj.sh`）。
* `run.sh` 加掛 `run_ml.sh`。

## 4. 驗收

* `ml/01~03` 在 `lispvm` 與 wasm 兩端輸出一致。
* `match` 尾遞迴（如 `length/sum` 跑 1e6）不爆堆疊。
* `--scheme` 可讀，能看出 `cond + car/cdr` 展開。

## 5. 任務拆分

1. parser（沿用 `lambdac.js` lexer 擴充 `datatype/match/with/fun/->`）。
2. ADT 編碼 + `match` 展開（含 nested pattern 先展平成臨時變數再測）。
3. `let/letrec/fun` + tail 旗標。
4. 範例 + `run_ml.sh` + 文件。
