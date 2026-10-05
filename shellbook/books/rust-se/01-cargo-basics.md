# 第一章：Cargo 基礎

Cargo 是 Rust 的工程中樞：建置、測試、套件管理、文件一把抓。本章用最小範例熟悉核心指令。

先確認環境（等冪，重複執行無害）：

```shell
export RUST_OK=$(command -v cargo >/dev/null && command -v rustc >/dev/null && echo yes || echo no)
[ "$RUST_OK" = yes ] && cargo --version || echo "Rust 未就緒，請先做第零章環境設定"
```

預期輸出：

```text
cargo 1.82.0 (8f40fc59f 2024-08-21)
```

## 把範例專案搬進工作目錄

先清掉舊環境，再從本書 `examples/` 複製（先 `rm` 再 `cp`，避免 cp 進已存在目錄變成子目錄）：

```shell
if [ -z "$RUST_BOOK" ] || [ ! -d "$RUST_BOOK/examples/hello" ]; then _d="$PWD"; while [ "$_d" != / ] && [ ! -d "$_d/examples/hello" ] && [ ! -d "$_d/books/rust-se/examples/hello" ]; do _d=$(dirname "$_d"); done; if [ -d "$_d/examples/hello" ]; then export RUST_BOOK="$_d"; elif [ -d "$_d/books/rust-se/examples/hello" ]; then export RUST_BOOK="$_d/books/rust-se"; else export RUST_BOOK=$(find /Users/Shared "$HOME" -maxdepth 8 -type d -path '*shellbook/books/rust-se' 2>/dev/null | head -1); fi; unset _d; fi; echo "RUST_BOOK=$RUST_BOOK"
rm -rf /tmp/rust-demo && cp -r "$RUST_BOOK/examples/hello" /tmp/rust-demo && ls /tmp/rust-demo
```

預期輸出（`RUST_BOOK` 是你執行時所在的書目錄）：

```text
RUST_BOOK=/Users/Shared/ccc/115a/muse-web/shellbook/books/rust-se
Cargo.toml
src
```

進入專案：

```shell
cd /tmp/rust-demo && cat Cargo.toml src/main.rs
```

預期輸出：

```text
[package]
name = "hello"
version = "0.1.0"
edition = "2021"

[dependencies]
fn main() {
    println!("hello, Rust!");
}
```

## cargo run：編譯並執行

```shell
cargo run
```

預期輸出（第一次多了編譯訊息）：

```text
Compiling hello v0.1.0 (/tmp/rust-demo)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.52s
     Running `target/debug/hello`
hello, Rust!
```

第一次會建置，之後沒改碼就直接執行。`--quiet` 安靜模式：

```shell
cargo run --quiet
```

預期輸出（只剩程式輸出）：

```text
hello, Rust!
```

## cargo check：只檢查不產出執行檔

開發時最快回饋循環，比 build 快很多：

```shell
cargo check
```

預期輸出：

```text
Checking hello v0.1.0 (/tmp/rust-demo)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.05s
```

## cargo build：建置

debug 版在 `target/debug/`：

```shell
cargo build && ./target/debug/hello
```

預期輸出：

```text
Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.05s
hello, Rust!
```

release 版在 `target/release/`，有完整優化：

```shell
cargo build --release && ./target/release/hello
```

預期輸出：

```text
Finished `release` profile [optimized] target(s) in 0.21s
hello, Rust!
```

## 看看 target 裡有什麼

```shell
ls target/debug/ | head -10
```

預期輸出（檔名含 hash，每次略有不同）：

```text
build
deps
examples
hello
hello.d
incremental
```

## cargo clean：清掉建置產物

```shell
cargo clean && ls target 2>/dev/null || echo "target 已清空"
```

預期輸出：

```text
Removed 50 files, 1.9MiB total
target 已清空
```

## 重點回顧

- `cargo check`（快回饋）→ `cargo run`（執行）→ `cargo build --release`（交付）
- debug / release 產物分別在 `target/debug/`、`target/release/`
- `cargo clean` 清建置快取

[← 回到 README](README.md) | [下一章：專案結構與模組](02-project-layout.md)
