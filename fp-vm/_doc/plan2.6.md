# plan2.6 — 語法缺陷修復批

目標：audit 列出的缺陷全修（B 全修、C 修訊息、D 修「會靜默錯」的）。
VM 語意不動（只改一條報錯訊息）；`mlc` 加 `apply` 節點；其餘全是 `leanc`。

## 1. 修復清單

* B1 `let rec`：term 與 do 皆可，`←` 版報錯；desugar 到現成 `letrec` 節點。
* B2 緊貼負號：空白/開括號/運算子後才算一元（`f -5` 即 `f (-5)`；`a-5` 仍減法）。
* B3 display 多參：維持嚴格（lisp 直呼的寬容不動），修報錯不修語意。
* B4 `nil`/`[]` 分裂：維持，文件立規二選一（SUBSET §3）。
* B5 括號 gate：`bracketDepth`，括號內不限行。
* B6 0 元方法：parse 期擋掉。B7 main 警告：無 main / 帶參 main（stderr，不擋編譯）。
  B8 instance 重複：警告（def 重複本來就報錯）。
* C：`Point.x` 打錯提示候選投影；match/方程式空分支訊息；頂層 `;` 跳過；
  `import` 後不接名報錯。
* D：unicode 識別字（`\p{L}`，`λ` 維持報錯，ctor 判準同步 `\p{Lu}`）；
  `1_000`；`(+)` 等 section（`/`、 `-` 走 Nat 語意）；`apply f xs`（單參函式，
  多參請鏈式套用）；lispc 保留字（12 個）禁定義（leanc + mlc）。
* 文件：SUBSET 同步（真值/尾 let/return/strict/error 空參/display 差異/新語法），
  本檔 + `v2.6.md`。

## 2. 刻意不修

* `p.x` 通用點記法、高階傳方法、`for`、match guard（P1，見 SUBSET §2）。
* `nil`/`[]` 合一、`display` 放寬、`()` 空 call（語意改動，風險大於收益）。
* wasm 溢出實測（50k 非尾遞迴已過；RangeError 路徑只 code-review）。
* `end` 落單、`open X in e` 的深層語意（維持現狀報錯）。
