# 第四章：依賴管理

Cargo 的依賴管理：`cargo add` 加依賴、`Cargo.lock` 鎖版本、`cargo tree` 看依賴樹。接續前面的 shell 狀態（`/tmp/rust-todo`）。

先確保環境就緒（等冪，重複執行無害）：

```shell
[ -d /tmp/rust-todo ] || { if [ -z "$RUST_BOOK" ] || [ ! -d "$RUST_BOOK/examples/todolist" ]; then _d="$PWD"; while [ "$_d" != / ] && [ ! -d "$_d/examples/todolist" ] && [ ! -d "$_d/books/rust-se/examples/todolist" ]; do _d=$(dirname "$_d"); done; if [ -d "$_d/examples/todolist" ]; then export RUST_BOOK="$_d"; elif [ -d "$_d/books/rust-se/examples/todolist" ]; then export RUST_BOOK="$_d/books/rust-se"; else export RUST_BOOK=$(find /Users/Shared "$HOME" -maxdepth 8 -type d -path '*shellbook/books/rust-se' 2>/dev/null | head -1); fi; unset _d; fi; echo "RUST_BOOK=$RUST_BOOK"; rm -rf /tmp/rust-todo && cp -r "$RUST_BOOK/examples/todolist" /tmp/rust-todo; }
cd /tmp/rust-todo
```

## 用 cargo add 加依賴

試著加入熱門的 `clap`（CLI 參數解析）。需要連 crates.io 下載，可行就真的執行：

```shell
cargo add clap --features derive 2>&1 | head -5 || echo "（無法連 crates.io，可離線時改看下面的手動寫法）"
```

也可以手動編輯 `Cargo.toml`（效果相同）：

```toml
# [dependencies]
# clap = { version = "4", features = ["derive"] }
```

## 看依賴樹

```shell
cargo tree 2>&1 | head -10 || echo "（略過：無依賴或無法下載）"
```

## Cargo.lock：鎖版本

lock 檔記錄每個依賴的精確版本，讓團隊與 CI 建出完全相同的結果——**要 commit 進版控**：

```shell
cat Cargo.lock 2>/dev/null | head -15 || echo "（略過）"
```

## 驗證建置仍正常

```shell
cargo check 2>&1 | tail -2
```

clap 加了但還沒用到，會有 warning；先移除保持乾淨（或留著給下一章用）：

```shell
cargo remove clap 2>&1 | head -2 || sed -i '' '/^clap /d; /^clap =/d' Cargo.toml
```

```shell
cargo check 2>&1 | tail -2
```

## 搜尋與資訊

```shell
cargo search serde 2>&1 | head -5 || echo "（略過：無法連 crates.io）"
```

## 更新依賴

```shell
cargo update --dry-run 2>&1 | head -5 || echo "（略過）"
```

## 重點回顧

- `cargo add` / `cargo remove` 管依賴；`Cargo.lock` 要進版控
- `cargo tree` 看依賴關係、`cargo search` � crate
- lock 檔 = 可重現建置的關鍵

[← 回到 README](README.md) | [下一章：完整專案建置實例](05-project-demo.md)
