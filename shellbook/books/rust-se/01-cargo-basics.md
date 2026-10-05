# 第一章：Cargo 基礎

Cargo 是 Rust 的工程中樞：建置、測試、套件管理、文件一把抓。本章用最小範例熟悉核心指令。

先確認環境（等冪，重複執行無害）：

```shell
export RUST_OK=$(command -v cargo >/dev/null && command -v rustc >/dev/null && echo yes || echo no)
[ "$RUST_OK" = yes ] && cargo --version || echo "Rust 未就緒，請先回到 README 安裝"
```

## 把範例專案搬進工作目錄

先清掉舊環境，再從本書 `examples/` 複製（先 `rm` 再 `cp`，避免 cp 進已存在目錄變成子目錄）：

```shell
[ -d books/rust-se/examples ] && export RUST_BOOK=books/rust-se || export RUST_BOOK=$(find "$HOME" -maxdepth 6 -type d -path '*shellbook/books/rust-se' 2>/dev/null | head -1)
rm -rf /tmp/rust-demo && cp -r "$RUST_BOOK/examples/hello" /tmp/rust-demo && ls /tmp/rust-demo
```

進入專案：

```shell
cd /tmp/rust-demo && cat Cargo.toml src/main.rs
```

## cargo run：編譯並執行

```shell
cargo run
```

第一次會建置，之後沒改碼就直接執行。`--quiet` 安靜模式：

```shell
cargo run --quiet
```

## cargo check：只檢查不產出執行檔

開發時最快回饋循環，比 build 快很多：

```shell
cargo check
```

## cargo build：建置

debug 版在 `target/debug/`：

```shell
cargo build && ./target/debug/hello
```

release 版在 `target/release/`，有完整優化：

```shell
cargo build --release && ./target/release/hello
```

## 看看 target 裡有什麼

```shell
ls target/debug/ | head -10
```

## cargo clean：清掉建置產物

```shell
cargo clean && ls target 2>/dev/null || echo "target 已清空"
```

## 重點回顧

- `cargo check`（快回饋）→ `cargo run`（執行）→ `cargo build --release`（交付）
- debug / release 產物分別在 `target/debug/`、`target/release/`
- `cargo clean` 清建置快取

[← 回到 README](README.md) | [下一章：專案結構與模組](02-project-layout.md)
