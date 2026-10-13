# plan2.0 — 微型 Lean 前端（`leanc.js`，新語言的基礎）

目標：Lean 風格表面語法 → `.fbc`，驗證 inductive + Nat + do-notation 這條路。
刻意不做 elaborator：無 dependent unification、無 tactic、無完整 typeclass 推論，
型別全部擦除（Prop/證明項不存在於 runtime）。

## 1. 為何可行（比 Haskell 容易）

* Lean 求值是 eager 的——沒有惰性求值大坑。
* 證明擦除：`if h : p then` 的 `h`、termination 證明都不進 runtime。
* 困難部分（完整 elaboration）整塊切掉，只做「已 elaborated 風格」的表面語法。

## 2. 語言範圍（v1）

```
prog    := item*                        (換行分隔，不需分號；-- 與 /- -/ 註解)
item    := inductive NAME (| Ctor (T)*)* [deriving ...]
         | def name (param)* [: Ret] := expr
         | def name [: Ty] (| fname pat* => expr)+     多方程式（LHS 首個為函式名）
         | abbrev name ... := expr                    (同 def)
         | #eval expr                                 (求值並印出)
         | import/open/namespace/section/end/variable/universe ...   (no-op，跳過)
expr    := fun x => expr | match e with (| pat => expr)+
         | match h : e with ... | if [h :] c then a else b
         | let x := e; body | do action+ | f a b (curried) | Nat/字串
         | (e) | [e, ...] | () | 運算子 (+ - * / % = == != < > <= >= :: @)
pat     := _ | x | 數字 | "字串" | true | false | Ctor | Ctor pat ... | p :: p | (p, p)
action  := expr | let x := e | let x ← e | x ← e
```

* 不做：`structure/class/instance`（字典手動傳）、`theorem/lemma`（直接報錯）、
  `finally` 以外的 tactic、`Nat.succ n` pattern（Nat 是 primitive bigint，
  只能比對字面量/變數）、字串插值、`#[...]`、`'c'`、 Girard 世界的一切。
* `do` 以「下一個頂層關鍵字或 `|`（match arm）或 EOF」為界，不需縮排追蹤；
  IO 取 direct-style（`println` 即印出，`←` 即 `let`），無真正 monad 值。

## 3. 編碼決策

* `Nat` = 不帶 `N` 的十進位字面量一律 BigInt（`mlc` 的 `show` 補 `N` 後綴，
  `lispc` 已支援）。
* `/` = truncating 除法（`quotient`），`%` = `modulo`，`-` = 截斷減法
  （`(let ((a..)(b..)) (if (< a b) 0 (- a b)))`，Nat 語意）。
* `inductive` = `datatype`（欄位數 = 括號群個數，型別內容忽略）；
  點名 `NatList.cons`/`.cons` 取最後一段。
* 多方程式：單參直接 `match`，多參先包 tuple 再 `match`（`mlc` 已支援 tuple pattern）。
* 隱式 `{x}`/`[inst]` 參數整組略過（定義與呼叫兩端一致，micro 世界自洽）。

## 4. 實作

* `leanc.js`：自有 lexer/parser（Lean token：`:=` `=>` `←` `|` `:` `.`），
  產出 **mlc AST**，直接 `require('./mlc.js').Desugar` 做 `program()` → Scheme → LBC。
  需 `mlc.js` 小改：匯出 `Desugar`，`show` 支援 bigint（加 `N`）。
* `lean/*.lean`：`01_nat`（遞迴/fib/#eval）、`02_list`（inductive+match+多方程式）、
  `03_io`（do/println）。
* `run_lean.sh`（抄 `run_ml.sh`：VM/wasm 比對），掛進 `run.sh`。

## 5. 驗收

* 三範例雙端輸出 SAME；`fact 30` 精確；`match` 缺分支跑出 `Match_failure` 可 catch。
* `--scheme` 可讀。

## 6. 後續（不做在本版）

Array（要新 TAG 才有 O(1)）、`UInt*` wraparound prim、讀檔 IO、
`structure`、完整 typeclass、`Nat.succ` pattern。

## 7. 實作狀態 (v2.0 原型已完成)

* `leanc.js`（約 600 行）：自有 lexer（含 `--`、`/- -/`、col 追蹤）→ mlc AST →
  `mlc.Desugar` → Scheme → LBC。`mlc.js` 配合小改：匯出 `Desugar`、`show` 吃
  bigint（補 `N`）、新增 `begin` 節點。
* 建構子一律 mangle 為 `ctor/名`（`nil` 可用；`true/false` 禁止，另有布林字面量）。
* do-action 並置跨行需更深縮排（`parseApp` 閘門 + `appBaseCol`），否則判為新動作；
  do 以頂層關鍵字/`|`/EOF 收尾。
* 三範例 `lean/01_nat,02_list,03_io.lean` 雙端 SAME，已納 `run_lean.sh` + `run.sh`。
* 已知 deviation：`-`/`/` 取 Nat 語意（截斷；浮點混用會錯）、`[]` 是原生 list
  （非 ADT，需手寫 `.cons`）、`()` 兼 unit/nil、輸出顯示 `ctor/` 前綴。
