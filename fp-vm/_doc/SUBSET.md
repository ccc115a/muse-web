# SUBSET.md — micro-Lean 語面子集規格（v2.4 時點）

主張方式：子集 = 本文件說了算 + `lean/` 語料庫雙端跑過為證。
凡本文件寫「支援」而跑不過的，算 bug；寫「排除」的，遇到必須是清楚報錯而非靜默錯。

## 1. 完整支援

**宣告**：`inductive`（`where` 可選）、`structure ... where`、`class`、`instance`、
`def`（單體/多方程式/`abbrev`）、`#eval`、`deriving BEq,Repr`。
**项前修饰**：`@[...]` attribute（跳過）、`private`/`protected`/`unsafe`/`partial`/
`noncomputable`（跳過）、`mutual ... end` 區塊、`set_option ... [in]`（跳過）。
**term**：`match`（可選 `h :`）、`if`（可選 `h :`）、`let x := e; b`、
`have x := e; b`、`fun`、`do`/`do[M]`、`return`/`pure`（do[M] 內）、
`try e catch x => h`、`{...}`/`{p with}`、`#[...]`、`(...)`/`(a,b)`/`[e,...]`/`()`、
運算子（`+ - * / % = == != < > <= >= :: @ && ||`）、具名參數 `(x := e)`（只取値）、
`sorry`/`sorryAx`（即 `(error "sorry")`，跑到才炸、可 catch）。
**字面量**：十進位整數（全 BigInt）、`0x`/`0o`/`0b`、浮點、`"..."`、`'a'` 等 char、
`true/false`。**註解**：`--`、`/- -/`（可巢狀）。
**名字**：`NatList.cons`/`.cons` 去點、`Point.x` 全名投影、`UInt32.add` 全名 def、
`Array.size` 等 prim 別名。

## 2. 明確排除（遇到必須清楚報錯）

* 自訂 notation/macro/syntax（用了它們的檔案不在子集內）。
* tactic 與證明項：`by`、`calc`、`have` 以外的證明 tactic、`theorem/lemma/example`。
* `p.x` 通用點記法（只有 `Point.x` 全名投影；`Nat.succ n` pattern 同理不支援）。
* `structure` 的 `extends`；多參數 class；具名/遞迴 instance。
* `s!`/`m!` 字串插值；`∀` 等 unicode 關鍵字；希臘字母識別字。
* `open ... in`/`set_option` 以外的 `... in` 組合子（`set_option` 本身支援跳過）。

## 3. 語意偏差（與真 Lean 不同之處，接受即用）

* 型別全擦除：錯全是 runtime 見；`implicit` 整組略過（定義呼叫兩端一致）。
* `Nat`：`-` 截斷、`/` 截斷除法；浮點混入 Nat 運算報錯。
* `[]` 是原生 list（非 ADT）；`()` 兼 unit/nil；`nil` 須先宣告（裸 `nil` 是錯）。
* 顯示有 `ctor/` 前綴；`Repr` 派生走 `__reprAny`。
* instance 重疊一律 last-wins（靜默）；`deriving` 只認 `beq`/`repr` 方法名。
* `do` 無註記即 direct-style；`do[M]` 的 `M` 只做執行期查表。
* `import/open/namespace` 無意義（no-op）；`#eval` 印值。

## 4. 語料庫與驗收

* `lean/01_nat.lean` … `lean/09_io.lean` + 本次新增的 P0 綜合檔（見下）。
* `sh run_lean.sh` 全 SAME；`sh run.sh` 全 PASS 即驗收。
