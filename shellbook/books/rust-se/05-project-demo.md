# 第五章：完整專案建置實例

把前四章串起來：從本書 `examples/` 取得 `todolist`，走完 **檢查 → 測試 → 建置 → clippy → 文件 → 安裝 → 發布** 的完整 Rust 工程流水線。每個區塊接續上一步，全部可執行。

## 0. 全新開始

```shell
if [ -z "$RUST_BOOK" ] || [ ! -d "$RUST_BOOK/examples/todolist" ]; then _d="$PWD"; while [ "$_d" != / ] && [ ! -d "$_d/examples/todolist" ] && [ ! -d "$_d/books/rust-se/examples/todolist" ]; do _d=$(dirname "$_d"); done; if [ -d "$_d/examples/todolist" ]; then export RUST_BOOK="$_d"; elif [ -d "$_d/books/rust-se/examples/todolist" ]; then export RUST_BOOK="$_d/books/rust-se"; else export RUST_BOOK=$(find /Users/Shared "$HOME" -maxdepth 8 -type d -path '*shellbook/books/rust-se' 2>/dev/null | head -1); fi; unset _d; fi; echo "RUST_BOOK=$RUST_BOOK"
rm -rf /tmp/rust-release && cp -r "$RUST_BOOK/examples/todolist" /tmp/rust-release && cd /tmp/rust-release
git init -b main >/dev/null 2>&1; printf "/target\n" > .gitignore && git add . && git commit -m "feat: todolist CLI" 2>/dev/null
```

預期輸出：無輸出（初始化完成，可用 `git log --oneline` 確認）。

> `.gitignore` 排除 `target/`：建置產物不進版控，`Cargo.lock` 要進。

## 1. 快速檢查

```shell
cargo check 2>&1 | tail -2
```

預期輸出：

```text
Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.77s
```

## 2. 跑測試

```shell
cargo test 2>&1 | grep "test result"
```

預期輸出（4 個單元測試 + 1 個整合測試全過）：

```text
test result: ok. 4 passed; 0 failed; ...
test result: ok. 1 passed; 0 failed; ...
```

## 3. clippy：官方 linter

Rust 社群的品質關卡，抓出常見壞味道：

```shell
cargo clippy 2>&1 | tail -5
```

預期輸出（零 warning）：

```text
Checking todolist v0.1.0 (/tmp/rust-release)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.69s
```

嚴格模式（把 warning 當錯誤，CI 常用）：

```shell
cargo clippy -- -D warnings 2>&1 | tail -3
```

預期輸出（嚴格模式也通過）：

```text
Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.28s
```

## 4. release 建置

```shell
cargo build --release 2>&1 | tail -2 && ls -lh target/release/todolist
```

預期輸出（大小每次略有不同）：

```text
Finished `release` profile [optimized] target(s) in 0.55s
-rwxr-xr-x  1 cccuser  wheel   444K Oct  5 08:31 target/release/todolist
```

## 5. 實際驗證 CLI

```shell
./target/release/todolist add "第一項任務"
```

預期輸出：

```text
已加入：第一項任務
```

```shell
./target/release/todolist add "第二項任務" && ./target/release/todolist list
```

預期輸出：

```text
已加入：第二項任務
  1. [ ] 第一項任務
  2. [ ] 第二項任務
共 2 項，未完成 2 項
```

```shell
./target/release/todolist done 1 && ./target/release/todolist list
```

預期輸出：

```text
已完成第 1 項
  1. [✓] 第一項任務
  2. [ ] 第二項任務
共 2 項，未完成 1 項
```

## 6. 產生文件

`cargo doc` 從 doc comment 產生 HTML 文件（lib 開發的標準交付物）：

```shell
cargo doc --no-deps 2>&1 | tail -2 && open target/doc/todolist/index.html 2>/dev/null || echo "文件在 target/doc/todolist/index.html"
```

預期輸出（有圖形介面會直接開啟文件頁）：

```text
Generated /tmp/rust-release/target/doc/todolist/index.html
```

## 7. 安裝到本機

`cargo install` 把專案裝成全域指令（像 Homebrew 一樣）：

```shell
cargo install --path . 2>&1 | tail -2
```

預期輸出：

```text
Installed package `todolist v0.1.0 (/tmp/rust-release)` (executable `todolist`)
```

```shell
todolist list
```

預期輸出（全域安裝的版本讀得到同目錄的 `todos.txt`）：

```text
  1. [✓] 第一項任務
  2. [ ] 第二項任務
共 2 項，未完成 1 項
```

## 8. 打 tag 發布

```shell
git tag -a v0.1.0 -m "first release" && git tag -l
```

預期輸出：

```text
v0.1.0
```

真實發布到 crates.io（需帳號與 API token，會偵測後跳過）：

```shell
[ -f ~/.cargo/credentials.toml ] && cargo publish --dry-run 2>&1 | tail -3 || echo "未設定 crates.io 憑證：實務上 cargo login 後執行 cargo publish"
```

預期輸出（無憑證時）：

```text
未設定 crates.io 憑證：實務上 cargo login 後執行 cargo publish
```

## 9. 回顧整條流水線

```shell
git log --oneline 2>/dev/null; git tag -l; ls target/release/todolist && cargo test 2>&1 | grep "test result"
```

預期輸出：

```text
xxxxxxx feat: todolist CLI
v0.1.0
target/release/todolist
test result: ok. 4 passed; 0 failed; ...
test result: ok. 1 passed; 0 failed; ...
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
