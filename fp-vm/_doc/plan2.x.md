# plan2.x — 新語言 2.x 總體規劃（通用程式線，VM 中間碼路線）

定位：以 Lean 語面為基礎發展的新語言，**通用程式優先，證明延後**；
執行目標一律是 `.fbc`（`fpvm.js` 直譯 + `vm2wasm.js` 編譯），不走 C 編譯。
`.fbc` 目前即 LBC v1 文字格式，僅換副檔名標示 FP-VM 線
（`lispvm.js` + `.lbc` 凍結保留為歷史快照）；二進位編碼列為後續選項（§4）。

## 1. 為何走 VM 中間碼

* 現有雙後端可直接沿用：新語言特性九成靠 desugar（inductive/match/do 已證明可行），
  少量進 prim；每個版本都能當天在 VM + wasm 雙端驗證。
* 與 Lean 原生對照：Lean 靠 C + GMP + 特化；我們靠 BigInt + 原生 TAG + host 回落。
  效能天花板較低，但換來後端單一、行為一致（雙端逐位元組比對）。
* 相容政策沿用 plan1.2：LBC 加法不減法；`PRIM_NAMES` 只附加不重排；
  `meta.tags` 機制可複用給新值型別。

## 2. 版本路線圖

| 版本 | 內容 | 狀態 |
|---|---|---|
| v2.0 | micro-Lean 原型（inductive/match/def/do/#eval） | ✅ 完成 |
| v2.1 | Array（原生 TAG）+ structure（純 desugar） | ✅ 完成 |
| v2.2 | typeclass 基礎：`class`/`instance` 字典傳遞 + 簡單解析，`deriving BEq/Repr` | ✅ 完成 |
| v2.3 | 字串/`Char` 完整化、`UInt*` wraparound prim、IO 擴充（argv/exit/readLine） | ✅ 完成 |
| v2.4 | 標準函式庫起步：`Option`/`Except`/`List` 高階函式（Lean 語面 prelude）+ `Monad` + `do[M]` | ✅ 完成 |
| v2.5 | SUBSET.md 定版 + P0 語面缺口（attribute/修飾詞/mutual/具名參數/sorry/have/hex/set_option） | ✅ 完成 |
| v2.6 | 語法缺陷修復批（let rec/緊貼負號/unicode/`1_000`/section/apply/訊息品質） | ✅ 完成 |
| 2.P | 證明側另開 track（小 kernel + `Decidable` 反射），2.x 主線不碰 |

順序理由：Array 是 Lean 程式（vs ML 線）最有感的缺口，且是 `List` 之外第一個
需要新 TAG 的值型別——做完它，後面加型別都有模板可抄。structure 零 VM 改動，
順手收。typeclass 放 v2.2 因為它主要是 desugar + 解析，不堵 Array。

## 3. 架構原則（2.x 通用）

1. **desugar 最大化，指令最小化**：能用 tagged-list / cond / 閉包表達的，不加指令。
2. 新值型別才加 TAG：載體放線性記憶體，`toStr`/`equal`/`fromDatum` 三處同步，
   雙後端一次到位；`F_FAST` 只認小整數，其餘走 host（正確優先）。
3. 新 prim 走 `PRIM_NAMES` 附加流程 + `meta` 發布（如需位址），`cljc`/`mlc` 不受影響。
4. 每版都帶 `lean/NN_*.lean` 範例 + `run_lean.sh` 雙端比對 + `_doc/vX.Y.md` release 文件。

## 4. 速度線：`.fbc` → wasm 要很快

目標：數值迴圈類程式，wasm 明顯快於 `fpvm` 直譯（以倍數計，而非百分之幾），
且優化不改變任何語意（雙端比對持續全過）。

* **評測先行**：新增 `bench/*.lean` + `run_bench.sh`，固定量測 `fpvm` vs wasm
  耗時（`fib 25`、`loop 1e7` 級距、`sum` over array v2.1 後），優化前先建基線。
  `--run` 的 worker 啟動開銷不計入（bench 走 in-process `runBytes`）。
* **已有的牌**：小整數 `F_FAST`（wasm 內算術/比較，不進宿主）、`return_call`
  真尾呼叫、常數靜態化 + intern 共用、`.wasm` 檔案快取（編一次跑多次）。
* **待打的牌**（按 CP 值排序）：
  1. `F_FAST` 覆蓋擴大：`min/max/abs`、單參 `-`、BIG 小值（31-bit 內的大數轉回小整數表示）。
  2. 減少 host 往返：常見雙參 prim（`cons`、`nth` 類）整段搬進 wasm；`APPLY`
     的 spread 已在 wasm 內，再省即 `F_CALL` 的 env 配置（參數綁定迴圈展開）。
  3. peephole / superinstruction：`LOAD + CALL prim` 融合、`CONST` 摺疊、
     無用 `POP`/`VOID` 消除（在 `genFunc` 前加 LBC→LBC 一遍）。
  4. 單態特化（小步）：函式內全小整數路徑可跳過 tag 檢查（需簡易型別推論，先只做
     區域變數 tracing，不過度設計）。
  5. WasmGC 遷移：bump-allocator 無 GC 是長跑程式的天花板；列為大項，v2.3 後評估
     （改記憶體佈局，動到所有 TAG）。
* **本版不做**：二進位 `.fbc` 編碼（載入 parse 省毫秒級，效益低先不碰）、
  自動向量化、跨函式 inline（閉包語意風險高）。
