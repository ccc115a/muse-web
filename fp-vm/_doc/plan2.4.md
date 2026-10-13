# plan2.4 — 標準函式庫起步 + `Monad` + `do[M]`

目標：`Option`/`Except`/`List` 高階函式 baked 進 prelude，`Monad` 跑起來，
`do` 長出 monad 變體。型別維持用戶宣告（stdlib 只給函式，不給型別）。

## 1. 範圍抉擇（重要）

* **只 bake 函式，不 bake 型別/class/實例**：`List.map` 等引用 `nil`/`cons`
  經字面 tag 集合解析；執行期 builder 由用戶的 inductive 提供（全範例本來就有）。
  避開「重複宣告形狀比對」一整類麻煩；用戶要 `do[Option]` 就自己宣告
  `Option` + `class Monad` + instance（範例 07 示範，全套約 10 行）。
* 因此：無 baked-rows 問題、`do[M]` 的 `M` 全部走用戶 instance；
  `pure` 查表落空即清楚報錯。

## 2. `do[M]` 語意

* `do [M] ...`（`M` 為型別名）：`x ← e` 降為 `bind`（`e` 為分派對象）；
  `let` 維持純綁定；一般動作逐個 bind（`_` 續行）；`return e`/`pure e`
  走 `(Monad, M)` 型別列查表（不看值 tags，這是 `pure` 沒東西可分派的唯一解）。
* 無註記 `do` 維持 direct-style；`pure` 在 plain-do/裸用走值分派（多半落空報錯，正常）。
* monadic block 結尾必須是 expr（尾 `let`/`←` 報錯；plain-do 舊規則不動）。
* 巢狀 do 各自獨立（monad 存在區域變數，不共用 parser 欄位）。

## 3. prelude（Lean 寫成，自舉）

* `List.map/filter/foldl/length/append/reverse(+Aux)`：吃任何 cons/nil-tagged ADT；
  predicate 回傳須為 Bool（lisp 真值：僅 `#f` 為假，`nil` 算真，注意）。
* `Option.map/bind/getD`、`Except.map/bind/getD/toOption`。
* 全部 plain def（dotted 名，`def` 保留機制自動保護）；`List.map` 的 `f` 為閉包參數。

## 4. 不做

* `List` 型別本身、`Monad` class/實例內建（用戶宣告，範例給模板）。
* transformer（`StateT` 等）、多參數 class（沿用 v2.2 規則）。
* `pure` 高階傳值、`do` 結尾 `let` 的 monadic 語意（報錯）。

## 5. 驗收

* `lean/07_monad.lean`：`safeDiv` 鏈、`do[Except]` 短路、`List.*` 綜合、
  `return` 封裝；雙端 SAME。
* 落空（無 instance 的 `pure`、無註冊標籤）雙端同訊息；六腳本 PASS。
* `_doc/v2.4.md`。

## 6. 實作狀態 (v2.4 已完成，見 `_doc/v2.4.md`)

* 與計畫出入：
  - 型別/class/實例**不 bake**（只 bake 14 個函式）；`do[Option]` 的 `Option`
    等由用戶宣告，prelude 解析只靠字面 tag 集合。
  - `pure` 查 `(Monad, M)` 型別列（instance 記錄多帶 `ty`）；`bind` 照舊值分派。
  - monad 放 parseDo 區域變數（巢狀 do 安全）；`return` 在 do[M] 內特判，
    plain-do 行為不動。
  - 實作中抓到 `buildBind` 漏套 scrutinee（方法只吃了 continuation），已修。
