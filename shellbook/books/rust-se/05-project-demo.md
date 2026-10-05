# 第五章：完整專案建置實例

把前四章串起來：從本書 `examples/` 取得 `todolist`，走完 **檢查 → 測試 → 建置 → clippy → 文件 → 安裝 → 發布** 的完整 Rust 工程流水線。每個區塊接續上一步，全部可執行。

## 0. 全新開始

```shell
[ -d books/rust-se/examples ] && export RUST_BOOK=books/rust-se || export RUST_BOOK=$(find "$HOME" -maxdepth 6 -type d -path '*shellbook/books/rust-se' 2>/dev/null | head -1)
rm -rf /tmp/rust-release && cp -r "$RUST_BOOK/examples/todolist" /tmp/rust-release && cd /tmp/rust-release
git init -b main >/dev/null 2>&1; printf "/target\n" > .gitignore && git add . && git commit -m "feat: todolist CLI" 2>/dev/null
```

> `.gitignore` 排除 `target/`：建置產物不進版控，`Cargo.lock` 要進。

## 1. 快速檢查

```shell
cargo check 2>&1 | tail -2
```

## 2. 跑測試

```shell
cargo test 2>&1 | grep "test result"
```

## 3. clippy：官方 linter

Rust 社群的品質關卡，抓出常見壞味道：

```shell
cargo clippy 2>&1 | tail -5
```

嚴格模式（把 warning 當錯誤，CI 常用）：

```shell
cargo clippy -- -D warnings 2>&1 | tail -3
```

## 4. release 建置

```shell
cargo build --release 2>&1 | tail -2 && ls -lh target/release/todolist
```

## 5. 實際驗證 CLI

```shell
./target/release/todolist add "第一項任務"
```

```shell
./target/release/todolist add "第二項任務" && ./target/release/todolist list
```

```shell
./target/release/todolist done 1 && ./target/release/todolist list
```

## 6. 產生文件

`cargo doc` 從 doc comment 產生 HTML 文件（lib 開發的標準交付物）：

```shell
cargo doc --no-deps 2>&1 | tail -2 && open target/doc/todolist/index.html 2>/dev/null || echo "文件在 target/doc/todolist/index.html"
```

## 7. 安裝到本機

`cargo install` 把專案裝成全域指令（像 Homebrew 一樣）：

```shell
cargo install --path . 2>&1 | tail -2
```

```shell
todolist list
```

## 8. 打 tag 發布

```shell
git tag -a v0.1.0 -m "first release" && git tag -l
```

真實發布到 crates.io（需帳號與 API token，會偵測後跳過）：

```shell
[ -f ~/.cargo/credentials.toml ] && cargo publish --dry-run 2>&1 | tail -3 || echo "未設定 crates.io 憑證：實務上 cargo login 後執行 cargo publish"
```

## 9. 回顧整條流水線

```shell
git log --oneline 2>/dev/null; git tag -l; ls target/release/todolist && cargo test 2>&1 | grep "test result"
```

完整流程對應的工程實踐：

| 步驟 | 指令 | 工程意義 |
|------|------|----------|
| check | `cargo check` | 最快的編譯回饋循環 |
| test | `cargo test` | 內建測試，零依賴 |
| clippy | `cargo clippy -- -D warnings` | 品質關卡，CI 必備 |
| build | `cargo build --release` | 優化後的交付產物 |
| doc | `cargo doc` | API 文件自動生成 |
| install | `cargo install --path .` | 全域部署驗證 |
| publish | `cargo publish` | 發布到 crates.io 生態系 |

[← 回到 README](README.md)
