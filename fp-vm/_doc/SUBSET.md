# SUBSET.md — micro-Lean 語面子集規格（v2.6 時點）

主張方式：子集 = 本文件說了算 + `lean/` 語料庫雙端跑過為證。
凡本文件寫「支援」而跑不過的，算 bug；寫「排除」的，遇到必須是清楚報錯而非靜默錯。

## 1. 完整支援

**宣告**：`inductive`（`where` 可選）、`structure ... where`、`class`、`instance`、
`def`（單體/多方程式/`abbrev`）、`#eval`、`deriving BEq,Repr`。
**项前修饰**：`@[...]` attribute（跳過）、`private`/`protected`/`unsafe`/`partial`/
`noncomputable`（跳過）、`mutual ... end` 區塊、`set_option ... [in]`（跳過）。
**term**：`match`（可選 `h :`）、`if`（可選 `h :`）、`let x := e; b`、
`let rec f := e; b`、`have x := e; b`、`fun`、`do`/`do[M]`、`return`/`pure`（do[M] 內）、
`try e catch x => h`、`{...}`/`{p with}`、`#[...]`、`(...)`/`(a,b)`/`[e,...]`/`()`、
運算子（`+ - * / % = == != < > <= >= :: @ && ||`）、運算子 section（`(+)` 等）、
具名參數 `(x := e)`（只取値）、`apply f xs`（f 須為單參函式；多參請鏈式套用）、
`sorry`/`sorryAx`（即 `(error "sorry")`，跑到才炸、可 catch）。
**字面量**：十進位整數（全 BigInt，可寫 `1_000`）、`0x`/`0o`/`0b`、浮點、`"..."`、
`'a'` 等 char、`true/false`。**識別字**：unicode 字母可（`α` 行，`λ` 保留）。
**註解**：`--`、`/- -/`（可巢狀）。
**名字**：`NatList.cons`/`.cons` 去點、`Point.x` 全名投影、`UInt32.add` 全名 def、
`Array.size` 等 prim 別名。

## 2. 明確排除（遇到必須清楚報錯）

* 自訂 notation/macro/syntax（用了它們的檔案不在子集內）。
* tactic 與證明項：`by`、`calc`、`have` 以外的證明 tactic、`theorem/lemma/example`。
* `p.x` 通用點記法（只有 `Point.x` 全名投影；`Nat.succ n` pattern 同理不支援）。
* `structure` 的 `extends`；多參數 class；具名/遞迴 instance。
* `s!`/`m!` 字串插值；`∀` 等 unicode 關鍵字（`λ` 維持報錯）。
* 方法不可當值傳（`List.map show xs` 會報錯）；0 元方法不可定義。
* `open ... in`/`set_option` 以外的 `... in` 組合子（`set_option` 本身支援跳過）。

## 3. 語意偏差（與真 Lean 不同之處，接受即用）

* 型別全擦除：錯全是 runtime 見；`implicit` 整組略過（定義呼叫兩端一致）。
* 真值：僅 `#f` 為假（`if 0`、`if nil` 都走 then 分支）；predicate 請回 Bool。
* `Nat`：`-` 截斷、`/` 截斷除法；浮點混入 Nat 運算報錯。
  `-` 緊貼數字時是一元（`f -5` 即 `f (-5)`，Haskell 一致；`a-5` 仍是減法）。
* `[]` 是原生 list（非 ADT）；`()` 兼 unit/nil；`nil` 須先宣告（裸 `nil` 是錯）；
  已宣告的 `nil` 與 `[]` 是不同值，match 不互通，請二選一。
* 顯示有 `ctor/` 前綴；`Repr` 派生走 `__reprAny`。
* instance 重疊後者覆蓋前者（有警告）；`deriving` 只認 `beq`/`repr` 方法名。
* `do` 無註記即 direct-style；`do[M]` 的 `M` 只做執行期查表；
  do 尾是 `let` 會補 `println`（沿用舊習）；do[M] 尾須為 expr。
* `return` 在 plain-do 外即 identity；裸 `pure` 不合法；`error` 不帶參只得原語物件。
* prim 嚴格定元（`display 1 2` 報錯；.lisp 直呼會靜默忽略多餘參數，兩邊行為不同）。
* `import/open/namespace` 無意義（no-op；`import` 後不接名會報錯）；`#eval` 印值。
* do 內多行呼叫：括號內不限行，否則續行需比動作縮排深。
* 無 `main` 或 `main` 帶參數只給警告（stderr），照樣編譯。

## 4. 語料庫與驗收

* `lean/01_nat.lean` … `lean/11_fixes.lean`（含 `10_subset.lean` P0 綜合）。
* `sh run_lean.sh` 全 SAME；`sh run.sh` 全 PASS 即驗收。
