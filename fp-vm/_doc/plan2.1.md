# plan2.1 — Array（原生 TAG）+ structure（純 desugar）

目標：補上 Lean 通用程式最有感的兩個缺口。Array 是第一個需要新值型別的特性
（做法給後續立模板）；structure 零 VM 改動，純 desugar 即可。

## 1. Array：新 TAG.ARR = 12

* **表示**：`fpvm` 用 `Arr` 包裝類（包 JS 陣列，與 `Pair` 區分）；
  wasm 線性記憶體載體 `[ARR][len][elems...]`（i32 槽序列）。
* **語意**：persistent——`set` 返回新 array，舊的不變。v2.1 取**全拷貝**
  O(n)（簡單正確；結構共享等有效能投訴再做，文件註明）。
* **CONST**：`{"arr":[...]}`，`toDatum`/`fromDatum`/`Static.value` 三處同步；
  `toStr` 雙端統一印 `#[1, 2, 3]`；`equal` 逐元素（含跨型別數值相等）。
* **prims**（`PRIM_NAMES` 附加，`lisp`/`lean` 層同名可用）：
  `array`（變元建構）、`array-push`、`array-get`、`array-set`、`array-size`、`array?`。
  越界 `get/set` 走 `THROW`（字串訊息，可 catch；雙端訊息一致）。
* **表面語法**（`leanc`）：`#[1, 2, 3]`、`#[]`（lexer 需在 `#eval` 之外認出 `#` +
  `[`，注意現有 `#directive` 規則）。
* **不做**：`Array.map/filter` 高階函式（v2.4 prelude 做）、slice、結構共享。

## 2. structure：純 desugar，VM 零改動

* `structure Point where` + 欄位行（`x : Nat` 逐行，`:` 後型別跳過）→ 降為
  單 ctor inductive（`mk`，欄位依序）+ 每欄一個投影 `def Point.x (p) := match ...`。
* `{ x := 1, y := 2 }`（expr 位置，大括號；與 def binder 的 `{ }` 位置不衝突）
  → ctor 應用。
* `{ p with x := 3 }` → `mk` + 投影讀舊欄（desugar 期展開）。
* `extends` 繼承延到 v2.2+（牽涉欄位合併與投影轉發，先不碰）。

## 3. 改動清單

* `fpvm.js`：`Arr` 類 + prims 6 個 + `toStr`/`equal`/`fromDatum`。
* `vm2wasm.js`：`TAG.ARR` + `Static` 載體 + host 鏡像 prims（`mkArr`、`arrOf`）。
* `leanc.js`：`#[...]` lexer/parser（降為 `(array e...)` runtime 建構，
  不經 CONST，故 `toDatum` 免改）、`structure`、`{...}`、`{p with...}`。
* 範例：`lean/04_array.lean`（建構/push/get/set/size/越界 catch/persistent 語意）、
  `lean/05_struct.lean`（定義/實例/投影/with 更新）。
* `run_lean.sh` 自動納入（glob）；`_doc/v2.1.md` release 文件。

## 4. 驗收

* 新範例雙端 SAME；越界 `array-get` 可 catch，訊息雙端一致。
* `set` 後舊 array 內容不變（persistent 語意測試）。
* 全量回歸：六腳本 PASS；舊 `.fbc` 行為不變（TAG/prim 皆加法）。

## 5. 實作狀態 (v2.1 已完成，見 `_doc/v2.1.md`)

* 與計畫出入：
  - prim 做成 7 個（多一個 0 元 `array-empty`，`#[]` 之外備用）。
  - `#[...]` 降為 `(array e...)` runtime 建構——`toDatum`/`fromDatum`/`Static.value`
    三處**免改**（與 §1 CONST 條原計畫不同）。
  - 連字號 prim 加 `Array.size/push/get/set/empty` 別名（`-` 進不了 Lean 識別字）。
  - 附帶做了 `leanc` 的 `try` 表面 + `mlc` 的 `call`/`try` 節點
    （越界測試與 v2.0 的 Match_failure 驗收需要它）。
  - `mlc` 的 `PRIM_ARITY` 登入 5 個 array prim（`array` 變元不入表）。
* structure 照計畫（`extends`、`p.x` 延後）；`{...}` 解析採欄位集合比對，
  structure 須先宣告（`Point.mk` 表達式可前向）。
