# Mini-Lean — 純前端證明系統

用 Node.js 寫的 Lean 風格證明系統，**證明全部在前端執行**（瀏覽器 ES 模組，無後端、零依賴），同時可在 Node.js 做詳細測試。

```
lean/
├── index.html      # 純前端 UI（模組載入 src/lean.mjs）
├── app.js          # 前端邏輯：載入範例、執行、顯示 goals/trace/proof term
├── style.css
├── server.mjs      # 本地靜態伺服器（只有靜態檔案服務，無證明後端）
├── src/
│   ├── kernel.mjs  # 可信 kernel：相依型別檢查、defeq、whnf（β/δ/ι）
│   ├── prelude.mjs # 內建常數：Prop 邏輯、Eq、Nat＋運算、可信引理
│   ├── parser.mjs  # .lean 語法：宣告、表達式、tactic
│   ├── elab.mjs    # 表面語法 → kernel 項（含 `_`  holes 合一）
│   ├── tactics.mjs # tactic 引擎：組 proof term，最後一律 kernel 重驗
│   └── lean.mjs    # 外觀：checkSource / axioms 追蹤 / #check / #eval
├── examples/       # 6 個可執行證明範例（＋manifest.json）
└── tests/
    └── run_tests.mjs  # 詳細測試（npm test）
```

## 快速開始

```bash
npm test          # 詳細測試：kernel＋parser＋tactics＋範例＋前端靜態檢查（114 項全過）
npm run serve     # 靜態伺服器 → 開啟 http://127.0.0.1:8080/
```

> 瀏覽器需經由靜態伺服器開啟（`file://` 下 ES 模組與 `fetch` 被瀏覽器阻擋，這是瀏覽器安全限制，不是後端）。
> 證明計算 100% 在瀏覽器內進行；`server.mjs` 只送靜態檔。

## 範例（`examples/`，前端下拉選單可直接執行）

| 檔案 | 內容 |
|---|---|
| `01_prop_logic.lean` | And/Or/→ 的引入消去、`cases` 分裂、`constructor`、`left/right` |
| `02_eq_rewrite.lean` | `rfl`、`apply`、`rw`（含 `<-` 反向）、引理改寫鏈 |
| `03_nat_basic.lean` | `induction`、`simp`、具體計算 `2 + 3 = 5`（`rfl` 直接算） |
| `04_nat_add_comm.lean` | 加法交換律：歸納＋輔助引理＋結合律推論 |
| `05_exists_forall.lean` | `∃` 引入（`⟨w, h⟩`）、`cases` 消去、`∀` 引入消去 |
| `06_nat_mul.lean` | 乘法引理、`simp` 化簡、`def` 展開（`show`） |

每個證明的 proof term 都會被 kernel 重新檢查；前端會顯示每步 tactic 後的 goals、用到的 axioms、proof term 與耗時。

## 語言（子集）

- 型別：`Prop`、`Type`（`Type n`）、`Nat`；`∀ x : T, P`、`∃ x : T, P`、`fun x => e`、`fun (x : T) => e`
- 命題：`∧` `/\`、`∨` `\/`、`¬`/`~`、`->`、`p ↔ q`（即雙向蘊涵的 `And`）、`=`、`True`、`False`
- 自然數：字面量、`+`、`*`、`Nat.zero/succ/add/mul/rec`
- 宣告：`theorem/lemma/example/def/abbrev/axiom 名 (x : T) : P := by …` 或 `:= 項`；`#check e`、`#eval e`
- tactic：`intro`、`exact`（含 `⟨a, b⟩`）、`apply`、`assumption`、`trivial`、`rfl`、`constructor`、`left/right`、`cases h with …`、`induction n with k ih`、`rw [h, <- h2]`、`simp [lem]`/`simp only [lem]`、`have h : T := …`、`show T`、`sorry`、`·`、`case tag => tac; tac`、`all_goals tac`

語義：每行 tactic 作用於**第一個**子目標；同行 `a; b` 會把 `b` 廣播到 `a` 產生的**全部**子目標。

## 設計取捨（誠實揭露）

- `Prop` 在定義上等於 `Type 0`（impredicative，類似 Calculus of Constructions 的簡化版），因此 `Nat.rec` 可消去到 `Prop` 目標。
- `apply` 要求結論能唯一決定所有參數；`Eq.trans` 的中間項這類決定不了的請用 `exact Eq.trans Nat a b c h1 h2` 並寫清參數。
- `Nat.add_zero` 等計算引理與 `Prop` 等式改寫引理是**內建公理**（皆為真；前端會列出每個證明用到的 axioms）。
- `sorry` 以單一公理 `sorryAx : ∀ α : Type, α` 實現並在使用處警告；範例檔皆無 `sorry`。
- 目前不支援：`rw ... at h`（只改寫目標）、隱式參數 `{}`（一律按顯式處理）、`import`（每檔獨立檢查）、 universe 多態。
