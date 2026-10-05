# 第二章：專案結構與模組

Rust 的標準專案結構把「函式庫」與「執行檔」分開：`src/lib.rs` 放核心邏輯、`src/main.rs` 只做 CLI 包裝、`tests/` 放整合測試——這讓測試與重用變簡單。本章用一個真實的 todo CLI 來看。

先確保環境就緒（等冪，重複執行無害）：

```shell
if [ -z "$RUST_BOOK" ] || [ ! -d "$RUST_BOOK/examples/todolist" ]; then _d="$PWD"; while [ "$_d" != / ] && [ ! -d "$_d/examples/todolist" ] && [ ! -d "$_d/books/rust-se/examples/todolist" ]; do _d=$(dirname "$_d"); done; if [ -d "$_d/examples/todolist" ]; then export RUST_BOOK="$_d"; elif [ -d "$_d/books/rust-se/examples/todolist" ]; then export RUST_BOOK="$_d/books/rust-se"; else export RUST_BOOK=$(find /Users/Shared "$HOME" -maxdepth 8 -type d -path '*shellbook/books/rust-se' 2>/dev/null | head -1); fi; unset _d; fi; echo "RUST_BOOK=$RUST_BOOK"
rm -rf /tmp/rust-todo && cp -r "$RUST_BOOK/examples/todolist" /tmp/rust-todo
cd /tmp/rust-todo && find . -name '*.rs' -o -name 'Cargo.toml' | sort
```

預期輸出（標準 lib + bin + 整合測試佈局）：

```text
./Cargo.toml
./src/lib.rs
./src/main.rs
./src/todo.rs
./tests/cli.rs
```

## 看核心邏輯：src/todo.rs

`TodoList` 結構體 + impl，附單元測試：

```shell
sed -n '1,35p' src/todo.rs
```

預期輸出（前 35 行：結構體 + 建構 + 讀檔）：

```text
use std::fs;
use std::path::PathBuf;

pub struct TodoList {
    tasks: Vec<(String, bool)>,
    path: PathBuf,
}

impl TodoList {
    pub fn new() -> Self {
        TodoList::with_path(PathBuf::from("todos.txt"))
    }
    ...
```

## 看執行檔包裝：src/main.rs

`main.rs` 只解析參數、呼叫 lib，不含業務邏輯：

```shell
cat src/main.rs
```

預期輸出（注意 `main` 裡沒有業務邏輯，只有參數解析）：

```text
use todolist::todo::TodoList;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut list = TodoList::new();
    ...
```

`pub mod todo;`（在 `lib.rs`）把模組公開給外部；`use todolist::todo::TodoList;` 在 main 中引入。

## 實際跑跑看

```shell
cargo run --quiet -- add "寫文件"
```

預期輸出：

```text
已加入：寫文件
```

```shell
cargo run --quiet -- add "寫測試" && cargo run --quiet -- list
```

預期輸出（資料已存檔，跨 process 看得到）：

```text
已加入：寫測試
  1. [ ] 寫文件
  2. [ ] 寫測試
共 2 項，未完成 2 項
```

```shell
cargo run --quiet -- done 1 && cargo run --quiet -- list
```

預期輸出：

```text
已完成第 1 項
  1. [✓] 寫文件
  2. [ ] 寫測試
共 2 項，未完成 1 項
```

錯誤用法會走 stderr 並回傳非零結束碼：

```shell
cargo run --quiet -- badcmd; echo "exit=$?"
```

預期輸出（用法說明走 stderr，結束碼非零）：

```text
用法: todolist add <任務> | list | done <編號>
exit=1
```

## 模組的工程意義

- **lib + bin 分離**：核心邏輯可被測試、被其他 crate 重用
- **`pub` / `use`**：明確的模組邊界，API 面清楚
- **錯誤處理**：`Result` 讓呼叫端無法忽略錯誤——這是 Rust 編譯期強制的

[← 回到 README](README.md) | [下一章：測試](03-testing.md)
