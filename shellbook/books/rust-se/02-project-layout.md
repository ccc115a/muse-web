# 第二章：專案結構與模組

Rust 的標準專案結構把「函式庫」與「執行檔」分開：`src/lib.rs` 放核心邏輯、`src/main.rs` 只做 CLI 包裝、`tests/` 放整合測試——這讓測試與重用變簡單。本章用一個真實的 todo CLI 來看。

先確保環境就緒（等冪，重複執行無害）：

```shell
[ -d books/rust-se/examples ] && export RUST_BOOK=books/rust-se || export RUST_BOOK=$(find "$HOME" -maxdepth 6 -type d -path '*shellbook/books/rust-se' 2>/dev/null | head -1)
rm -rf /tmp/rust-todo && cp -r "$RUST_BOOK/examples/todolist" /tmp/rust-todo
cd /tmp/rust-todo && find . -name '*.rs' -o -name 'Cargo.toml' | sort
```

## 看核心邏輯：src/todo.rs

`TodoList` 結構體 + impl，附單元測試：

```shell
sed -n '1,35p' src/todo.rs
```

## 看執行檔包裝：src/main.rs

`main.rs` 只解析參數、呼叫 lib，不含業務邏輯：

```shell
cat src/main.rs
```

`pub mod todo;`（在 `lib.rs`）把模組公開給外部；`use todolist::todo::TodoList;` 在 main 中引入。

## 實際跑跑看

```shell
cargo run --quiet -- add "寫文件"
```

```shell
cargo run --quiet -- add "寫測試" && cargo run --quiet -- list
```

```shell
cargo run --quiet -- done 1 && cargo run --quiet -- list
```

錯誤用法會走 stderr 並回傳非零結束碼：

```shell
cargo run --quiet -- badcmd; echo "exit=$?"
```

## 模組的工程意義

- **lib + bin 分離**：核心邏輯可被測試、被其他 crate 重用
- **`pub` / `use`**：明確的模組邊界，API 面清楚
- **錯誤處理**：`Result` 讓呼叫端無法忽略錯誤——這是 Rust 編譯期強制的

[← 回到 README](README.md) | [下一章：測試](03-testing.md)
