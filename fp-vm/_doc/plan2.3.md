# plan2.3 — 字串/Char 完整化 + `UInt*` + IO 擴充

目標：通用程式日常所需的三塊。全部走「prim（雙端）+ 別名/prelude」路線，
`leanc` parser 幾乎不動（只有 char 字面量要 lexer）。

## 1. 字串/Char

* 單位統一為 Unicode scalar：`string-length`、`string-ref`、`substring` 的索引
  皆按 scalar 算（現 `length` 是 UTF-16 單位，BMP 相同、astral 才差；suite 驗證）。
* 新 prim（雙端，同訊息）：`string-ref`（s,i→codepoint Nat，越界 THROW）、
  `substring`（s,start,end，左閉右開，越界 THROW）、`string<?` 不加——
  `<`/`>`/`<=`/`>=` 直接支援雙字串（字典序），混型別維持型別錯誤。
* Char 即 codepoint Nat：lexer 吃 `'a'`、`'\n'`、`'\\'`、`'\''`、`'\u{...}'`
  （直接吐 BigInt num token，parser 零改動）；`'ab'` 報錯。
* 新 prim `char->nat`（驗證）/`nat->char`（0..0x10FFFF 扣代理區，否則 THROW）；
  別名 `Char.toNat`、`Char.ofNat`、`String.get`、`String.extract`。
  （連字號寫不出，故一律點別名；`array?` 無連字號先例照舊。）

## 2. `UInt*`：3 個 bitwise prim + 自舉 prelude

* 新 prim（雙端，bigint 精確，JS BigInt 語意兩邊一致）：
  `bit-and`、`bit-or`、`bit-xor`（非整數/非數字同錯；`not` 用 xor-mask 代）。
* 其餘全進 baked prelude（Lean 寫成）：`pow2`、`Nat.pow`、通用
  `uMask/uAdd/uSub/uMul/uDiv/uMod/uShl/uShr/uAnd/uOr/uXor/uNot`
  （輸入一律先 mask 正規化；`uDiv/uMod` 顯式除零 guard 走 `error`），
  再加 `UInt8/16/32/64` 全套 thin wrapper（各 12 個一行 def）。
* 範圍外：`USize`（平台相關先不碰）、`Int` 有號型（Nat 世界夠用先）。

## 3. IO：`read-line`、`get-args`、`exit`

* 語意：`read-line ()` 首調讀光 stdin（行切分，尾換行不算空行；TTY 直接回 nil，
  pipe/關閉才讀，不互動卡住）、每調吐一行、EOF 回 nil；
  `get-args ()` 回參數列（程式檔之後的）；`exit code` 停機。
* 0 元 prim 取「忽略 `()`」慣例（同既有 `newline ()`），不另開呼叫語法。
* 別名 `IO.readLine`、`IO.getArgs`、`IO.exit`。
* 退出碼 plumbing：`fpvm` CLI 捕專用異常設 `exitCode`（自然收尾不斷 stdout）；
  wasm 經 worker 回報 `{exit}` 由父設碼；in-process `runBytes` 往外拋（呼叫方處理）。
  `prog.wasm` CLI 用 `--` 後接程式參數（`node vm2wasm.js prog.wasm -- a b`），
  經 `workerData` 傳入；`runBytes(bytes, args=[])` 加參（預設相容）。
* 不做：`eprint`、`file-read/write`（路徑/sandbox 另議）、互動式輸入。

## 4. 驗收

* `lean/07_strings.lean`（ops/char/`Nat.toString` roundtrip/比較/越界 catch）、
  `lean/08_uint.lean`（四寬度冒煙、遮罩正規化、除零 guard、移位、not）、
  `lean/09_io.lean`（空參數列 + 結尾 `exit 0`；`read-line`/帶參/非零碼走手測，
  stdin 具消耗性不可進比對 harness）。
* 雙端 SAME；六腳本 PASS；`_doc/v2.3.md`。

## 5. 實作狀態 (v2.3 已完成，見 `_doc/v2.3.md`)

* 與計畫出入：
  - 多了 `String.length` 別名（`length` 不吃 array，字串仍要它）。
  - 附帶打通 dotted def（`def UInt32.add` 可定義可呼叫；用戶 `def` 禁 `__`/prelude 名）。
  - `uSub` 內用截斷 `-` 安全（`A+M-B ≥ 0` 恆成立）；`uDiv/uMod` 除零 guard 在 prelude。
  - `exit` 不可 catch（process 控制直通）；`read-line` TTY 回 nil。
