# plan2.5 — SUBSET.md 定版 + P0 語面缺口

目標：把「Lean 子集」從口號變成規格（`_doc/SUBSET.md`），並補上真實檔案
開頭一定會踩到的 P0 缺口。全部是 parser/lexer 層工作，VM 零改動。

## 1. SUBSET.md

操作型定義：子集 = 文件說了算 + `lean/` 語料庫雙端跑過為證。
§1 完整支援表、§2 明確排除表（附理由，遇到須清楚報錯）、§3 語意偏差表、
§4 語料庫與驗收方式。

## 2. P0 內容

* attribute：`@[...]` 平衡跳過（巢狀/字串/行號/未閉合報錯）；`@f` 即 `f`。
* 修飾詞：`private/protected/unsafe/partial/noncomputable` 跳過。
* `mutual ... end`（可帶名，可巢狀；互遞迴本靠共享環境）。
* 具名參數 `(x := e)` 只取值（單個與 tuple 元素）。
* `sorry`/`sorryAx` 即 `(error "sorry")`（跑到才炸，可 catch）。
* `have`（具名即 `let`，匿名即 `begin`；`let` 本體維持必須具名）。
* `0x`/`0o`/`0b` 走 BigInt；`set_option ... [in]` 跳過。

## 3. 驗收

* `lean/10_subset.lean` 進 harness，雙端 SAME；六腳本 PASS。
* `_doc/v2.5.md`。
