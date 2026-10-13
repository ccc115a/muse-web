# plan2.2 — typeclass 基礎（字典傳遞 + `deriving`）

目標：Lean 味的方法呼叫（`show x` 按執行期標籤分派）+ `deriving BEq/Repr`。
全部 desugar 可解，VM 零新指令；僅加一個現缺的 `symbol->string` prim。

## 1. 語意設計：執行期標籤分派（registry）

* 型別已擦除，無法靜態解析——`show x` 看 `x` 的**執行期標籤**找實例：
  `nullary` ctor 即符號本身、`(...)` 取 `car`、另有 `nat/string/bool/array` 種類
  （v2.2 只註冊使用者型別，其餘報清楚的錯）。
* registry 純資料、無需 `set!`：`leanc` 解析期收集全部 instance，集中 emit
  `(define %tc-table (cons (list 'C 'tag dict) ...))`（後宣告者居首 = last-wins），
  外加純函式 `%tc-tag`、`%tc-find`（assoc 查找，落空 `error`，可 catch）。
* 方法呼叫 `m a1 a2...`（`m` 為已知方法，第一參數為分派對象）降為：
  `let t = a1 in ((extract (%tc-find %tc-table 'C (%tc-tag t))) t rest...)`，
  `extract` 按方法序號走 `car/cdr`（參數只求值一次）。
* 方法名保留：與 `def` 同名即編譯錯；裸 `m` 作值不支援（`LOAD`不到定義）。

## 2. 表面語法

* `class Name [binder...] where` + 方法行 `mname : Type`（型別/binder 全跳過；
  方法順序即字典順序）。`class` 移出 PROOFKW 錯誤表。
* `instance [name] : Class Type where` + 方法實作行 `m [p...] := body`
  （單體式，分支請用 `match`；續行需更深縮排，沿用 do 的 `appBaseCol` 閘門）。
  `: Class Type` 必寫；Type 須先宣告（parse 期要它的 ctor 表）；缺方法/重複/未知方法皆報錯。
* `deriving BEq, Repr`（inductive/structure 通用）：`BEq` 即 `equal?` 包裝；
  `Repr` 共用 `%repr-any`（見 §3）。被 derive 的 class 須已宣告（取其方法序）；
  多方法 class 的非標準方法需手寫（報錯指引）。
* `try` 已在 v2.1：`show` 落空、`%tc-tag` 遇外來值皆為可 catch 字串。

## 3. 支援設施（小）

* 新 prim `symbol->string`（雙端；`Symbol.toString` 別名）：`%repr-any` 需要，
  平時也有用（錯誤訊息、除錯）。
* 別名追加：`Nat.toString`、`String.append`（`%repr-any` 需要；連字號寫不出故）。
* `%repr-any`（leanc 內建 prelude）：`nil→"[]"`、數字→字串、字串加引號、
  布林、符號、`(...)` 遞迴、`Arr→"<array>"`（v2.4 再好好做）、procedure 擋板。
  另順手把 `lispvm` 的 `string-append` 對齊 wasm（`toStr` 映射而非 JS `join`，
  非字串不再出 `[object Object]`；全量測試驗證）。

## 4. 不做

* 原生型別實例（`Show Nat` 等；要 `integer?`/`boolean?` 判別 prim，後續）。
* 具名/遞迴實例（方法體內自指；`%repr-any` 已覆蓋遞迴列印需求）。
* instance 優先級、`open` 作用域、overlapping 檢查（last-wins 一條規則）。
* 多參數 class（`class C α β`）、functional dependency。

## 5. 驗收

* `lean/06_typeclass.lean`：`Show`/`BEq` 手寫實例、多參方法（`beq a b`）、
  `deriving` 兩種、override（後贏）、巢狀值列印；雙端 SAME。
* 落空（未註冊標籤）雙端同訊息；全量六腳本 PASS。
* `_doc/v2.2.md` release 文件。

## 6. 實作狀態 (v2.2 已完成，見 `_doc/v2.2.md`)

* 與計畫出入：
  - registry 改**無 `set!` 版**：解析期收集、集中 emit 一個 `%tcTable`
    define（因此 `mlc` 只加 `{t:'sym'}`，`set!` 節點沒加；instance 可寫在
    任何位置，但呼叫仍須在執行期 after 定義——實際即全檔案皆可）。
  - `%tc-tag`/`%tc-find`/`%reprAny` 用 Lean 寫成自舉 prelude（`__` 前綴保留），
    手拼 AST 只剩 table 本體；`mlc` 另補 `string-append: 2`（prelude 需要）。
  - 另加 `symbol->string` 新 prim（雙端），`fpvm` 的 `string-append` 對齊 wasm。
  - `inductive T where` 順手支援（`where` 可選）。
  - 方法呼叫固定分派首參數；裸方法名作值不支援（`LOAD` 不到）。
