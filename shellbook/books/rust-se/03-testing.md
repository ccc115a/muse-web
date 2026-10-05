# 第三章：測試

Rust 內建測試框架：`cargo test` 一行跑單元測試 + 整合測試，不需要額外依賴。接續前面的 shell 狀態（`/tmp/rust-todo`）。

先確保環境就緒（等冪，重複執行無害）：

```shell
if [ -z "$RUST_BOOK" ] || [ ! -d "$RUST_BOOK/examples/todolist" ]; then _d="$PWD"; while [ "$_d" != / ] && [ ! -d "$_d/examples/todolist" ] && [ ! -d "$_d/books/rust-se/examples/todolist" ]; do _d=$(dirname "$_d"); done; if [ -d "$_d/examples/todolist" ]; then export RUST_BOOK="$_d"; elif [ -d "$_d/books/rust-se/examples/todolist" ]; then export RUST_BOOK="$_d/books/rust-se"; else export RUST_BOOK=$(find /Users/Shared "$HOME" -maxdepth 8 -type d -path '*shellbook/books/rust-se' 2>/dev/null | head -1); fi; unset _d; fi; echo "RUST_BOOK=$RUST_BOOK"
[ -d /tmp/rust-todo ] || { rm -rf /tmp/rust-todo && cp -r "$RUST_BOOK/examples/todolist" /tmp/rust-todo; }
cd /tmp/rust-todo
```

預期輸出：無輸出（`/tmp/rust-todo` 已存在就什麼都不做）。

## 單元測試：放在被測程式旁邊

`src/todo.rs` 底部的 `#[cfg(test)] mod tests` 就是單元測試，`#[test]` 標記每個測試：

```shell
sed -n '/#\[cfg(test)\]/,$p' src/todo.rs
```

預期輸出（4 個單元測試，含跨 process 持久化測試）：

```text
#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_list() -> TodoList {
        TodoList::with_path(std::env::temp_dir().join(...))
    }

    #[test]
    fn add_and_pending() {
        ...
        assert_eq!(list.pending().len(), 2);
        ...
    }
    ...（complete_marks_done、state_persists_across_instances、complete_out_of_range_is_err）
```

## 跑全部測試

```shell
cargo test
```

預期輸出（四段：lib 單元測試 4 個、bin 單元測試、整合測試 1 個、doc tests）：

```text
running 4 tests
test result: ok. 4 passed; 0 failed; ...
running 1 test
test result: ok. 1 passed; 0 failed; ...
```

輸出分成幾段：單元測試（bin）、整合測試（tests/cli.rs）、doc tests。

## 整合測試：tests/ 目錄

`tests/cli.rs` 從外部使用者的角度呼叫 lib，驗證完整流程：

```shell
cat tests/cli.rs
```

預期輸出：

```text
use todolist::todo::TodoList;

#[test]
fn full_workflow() {
    let path = std::env::temp_dir().join(...);
    let mut list = TodoList::with_path(path.clone());
    list.add("寫功能".into());
    list.add("寫測試".into());
    list.complete(1).unwrap();
    assert_eq!(list.pending(), vec!["寫測試"]);
    std::fs::remove_file(path).unwrap();
}
```

```shell
cargo test --test cli
```

預期輸出（只跑整合測試）：

```text
running 1 test
test full_workflow ... ok
test result: ok. 1 passed; 0 failed; ...
```

## 只跑特定測試

用名稱過濾：

```shell
cargo test complete
```

預期輸出（名字含 complete 的測試都跑，含單元 + 整合）：

```text
test todo::tests::complete_marks_done ... ok
test todo::tests::complete_out_of_range_is_err ... ok
test result: ok. 2 passed; ...
```

## 觀察測試輸出細節

`--nocapture` 顯示測試中的 println：

```shell
cargo test add_and_pending -- --nocapture
```

預期輸出：

```text
test todo::tests::add_and_pending ... ok
test result: ok. 1 passed; 0 failed; ...
```

## 失敗的測試長怎樣

故意改壞再跑，看 Rust 的失敗報告（看完會還原）：

```shell
sed -i '' 's/assert_eq!(list.pending().len(), 2);/assert_eq!(list.pending().len(), 3);/' src/todo.rs && cargo test add_and_pending 2>&1 | grep -A5 "panicked"; git checkout -- src/todo.rs 2>/dev/null || sed -i '' 's/assert_eq!(list.pending().len(), 3);/assert_eq!(list.pending().len(), 2);/' src/todo.rs
```

預期輸出（紅燈報告指出確切行號與左右值；`/tmp/rust-todo` 不是 git repo，所以走後面的 `sed` 還原）：

```text
thread 'todo::tests::add_and_pending' (...) panicked at src/todo.rs:92:9:
assertion `left == right` failed
  left: 2
 right: 3
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

還原後重跑確認綠燈：

```shell
cargo test 2>&1 | grep "test result"
```

預期輸出（還原後全綠）：

```text
test result: ok. 4 passed; 0 failed; ...
test result: ok. 1 passed; 0 failed; ...
```

## 重點回顧

- `cargo test` 內建、零依賴；單元測試放 `#[cfg(test)]`、整合測試放 `tests/`
- `cargo test <名稱>` 過濾、`-- --nocapture` 看輸出
- 測試紅燈的報告會指出確切的行號與值——除錯很快

[← 回到 README](README.md) | [下一章：依賴管理](04-crates.md)
