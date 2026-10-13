# 其他的函數式程式語言，如果轉成 .lbc 中間碼？可行嗎？例如 Clojure, Haskell, Erlang, ....


**可行，而且難度因語言差很多。** LBC 本質上是「動態型別、有閉包、有尾呼叫的 Scheme 核心」。凡是能先簡化成這個核心的語言，都能用同樣的模式處理，就像 `lambdac.js` 把 lambda calculus 轉成 LBC 那樣。

## 先看 LBC 現在有什麼、缺什麼

**已經有的：**
- 一等公民函式和閉包
- 真正的尾呼叫（Erlang 和 Clojure 的 `recur` 都靠它）
- 數字、字串、符號、pair/list
- 用 `set!` 做簡單的可變狀態

**缺少的：**
- 例外處理（try/catch）
- `apply`、vector、hash map、字元、bignum 和 64 位元整數（目前是 JS 的 double）
- continuation 或 coroutine
- 巨集
- 模組和檔案 I/O

## 各語言評估

| 語言 | 難度 | 可直接對應 | 主要缺口 |
|---|---|---|---|
| **Clojure**（核心子集） | 低 | 它本來就是 Lisp，`defn`、`let`、`if`、`cond` 幾乎 1:1 | vector/map/set、巨集、lazy seq、Java interop |
| **OCaml / ML / Elm** | 中 | eager 求值，型別可以直接擦除 | 代數資料型別、模式匹配、例外、ref |
| **Erlang / Elixir**（單一程序） | 中 | 模式匹配、尾遞迴、atom、不可變資料 | tuple、binary、try/catch |
| **Erlang / Elixir**（含並行） | 高 | 無 | process、信箱、`receive` 需要排程器 |
| **Haskell** | 高 | 閉包、模式匹配 | 惰性求值、type class、`Integer` bignum、IO monad |

## 幾個關鍵轉換

**Clojure 的 `recur`** 對應到具名 let，編譯成 `TAILCALL`：

```clojure
(loop [i 0 acc 0] (if (= i n) acc (recur (inc i) (+ acc i))))
;; => (let loop ((i 0) (acc 0)) (if (= i n) acc (loop (+ i 1) (+ acc i))))
```

**Erlang 的多子句函式**變成 `cond`，尾呼叫保留：

```erlang
loop(0, Acc) -> Acc;
loop(N, Acc) -> loop(N-1, Acc+N).
```

**Haskell 的代數資料型別**可以用帶標記的 list 表示，模式匹配變成 `eq?` 測試加 `car`/`cdr`：

```haskell
data Maybe a = Nothing | Just a
f (Just x) = x + 1
f Nothing  = 0
;; Just x => (list 'Just x)；case 變成 (cond ((eq? (car v) 'Just) ...))
```

**Haskell 的惰性求值**可以用「帶快取的 thunk」模擬，LBC 已有 `set!`，所以做得到：

```scheme
(define (delay f)
  (let ((done #f) (val #f))
    (lambda () (if done val (begin (set! val (f)) (set! done #t) val)))))
```

但每個函式參數都得包成 thunk，速度會明顯變慢，還需要嚴格性分析來優化。

## 最難的幾件事

1. **Haskell 的 type class**：`show`、`+` 的重載要靠型別推論加「字典傳遞」，這是完整的型別檢查器，工程量遠大於其他部分。
2. **Erlang 的並行**：LBC 沒有 continuation，每個 process 需要自己的堆疊。要嘛把程式整個轉成 CPS，要嘛在 VM 加 `SPAWN`/`SEND`/`RECEIVE` 指令。
3. **bignum**：Haskell 的 `Integer`、Clojure 的 ratio 都需要。這個容易補，用 JS 的 `BigInt`；但 wasm 版要自己實作。

## 降低前端工作量的做法

不必自己寫完整的 parser 和型別檢查器，可以從各語言編譯器已經產生的中間表示接上：

- **Haskell**：GHC 的 Core 或 STG（`-ddump-stg-final`），這時型別類別和惰性求值已經被編譯器處理成明確的形式。
- **Erlang**：Core Erlang（`erlc +to_core`）。
- **OCaml**：Lambda IR（`-dlambda`）。

這比從原始碼重新實作語言本身實際得多。

## 建議的步驟

1. 先寫一個**迷你 Clojure → LBC**，最快有成果。
2. 再寫**迷你 ML**（代數資料型別加模式匹配），驗證 `case` 的轉換方式。
3. 之後擴充 VM：`apply`、vector、map、例外、`BigInt`。
4. 最後才挑戰 Erlang 並行和 Haskell 惰性求值。

另外要注意，`vm2wasm.js` 目前沒有 GC，所以這些語言要在 wasm 上跑得好，最好先改用 WasmGC 版本。

想先做哪一個？我可以直接寫迷你 Clojure、迷你 ML，或是先替 VM 補上 `apply`、vector 和例外處理。