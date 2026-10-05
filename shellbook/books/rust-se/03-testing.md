# 第三章：測試

Rust 內建測試框架：`cargo test` 一行跑單元測試 + 整合測試，不需要額外依賴。接續前面的 shell 狀態（`/tmp/rust-todo`）。

先確保環境就緒（等冪，重複執行無害）：

```shell
if [ -z "$RUST_BOOK" ] || [ ! -d "$RUST_BOOK/examples/todolist" ]; then _d="$PWD"; while [ "$_d" != / ] && [ ! -d "$_d/examples/todolist" ] && [ ! -d "$_d/books/rust-se/examples/todolist" ]; do _d=$(dirname "$_d"); done; if [ -d "$_d/examples/todolist" ]; then export RUST_BOOK="$_d"; elif [ -d "$_d/books/rust-se/examples/todolist" ]; then export RUST_BOOK="$_d/books/rust-se"; else export RUST_BOOK=$(find /Users/Shared "$HOME" -maxdepth 8 -type d -path '*shellbook/books/rust-se' 2>/dev/null | head -1); fi; unset _d; fi; echo "RUST_BOOK=$RUST_BOOK"
[ -d /tmp/rust-todo ] || { rm -rf /tmp/rust-todo && cp -r "$RUST_BOOK/examples/todolist" /tmp/rust-todo; }
cd /tmp/rust-todo
```

## 單元測試：放在被測程式旁邊

`src/todo.rs` 底部的 `#[cfg(test)] mod tests` 就是單元測試，`#[test]` 標記每個測試：

```shell
sed -n '/#\[cfg(test)\]/,$p' src/todo.rs
```

## 跑全部測試

```shell
cargo test
```

輸出分成幾段：單元測試（bin）、整合測試（tests/cli.rs）、doc tests。

## 整合測試：tests/ 目錄

`tests/cli.rs` 從外部使用者的角度呼叫 lib，驗證完整流程：

```shell
cat tests/cli.rs
```

```shell
cargo test --test cli
```

## 只跑特定測試

用名稱過濾：

```shell
cargo test complete
```

## 觀察測試輸出細節

`--nocapture` 顯示測試中的 println：

```shell
cargo test add_and_pending -- --nocapture
```

## 失敗的測試長怎樣

故意改壞再跑，看 Rust 的失敗報告（看完會還原）：

```shell
sed -i '' 's/assert_eq!(list.pending().len(), 2);/assert_eq!(list.pending().len(), 3);/' src/todo.rs && cargo test add_and_pending 2>&1 | grep -A5 "panicked"; git checkout -- src/todo.rs 2>/dev/null || sed -i '' 's/assert_eq!(list.pending().len(), 3);/assert_eq!(list.pending().len(), 2);/' src/todo.rs
```

還原後重跑確認綠燈：

```shell
cargo test 2>&1 | grep "test result"
```

## 重點回顧

- `cargo test` 內建、零依賴；單元測試放 `#[cfg(test)]`、整合測試放 `tests/`
- `cargo test <名稱>` 過濾、`-- --nocapture` 看輸出
- 測試紅燈的報告會指出確切的行號與值——除錯很快

[← 回到 README](README.md) | [下一章：依賴管理](04-crates.md)
