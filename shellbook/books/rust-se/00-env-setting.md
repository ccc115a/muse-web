# 第零章：環境設定

開始之前，先確認 Rust 工具鏈就緒。結果存進 `RUST_OK` 變數——**請先執行完本章再往下讀**。

## 偵測 Rust

```shell
if command -v cargo >/dev/null && command -v rustc >/dev/null; then
  export RUST_OK=yes
else
  export RUST_OK=no
fi
echo "RUST_OK=$RUST_OK"
cargo --version && rustc --version
```

預期輸出（版本號可能不同）：

```text
RUST_OK=yes
cargo 1.82.0 (8f40fc59f 2024-08-21)
rustc 1.82.0 (f6e511eec 2024-10-15)
```

如果尚未安裝，用 rustup 安裝（裝完重開 shell 再重跑上面的檢查）：

```shell
[ "$RUST_OK" = no ] && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh || echo "Rust 已就緒"
```

預期輸出（已安裝時）：

```text
Rust 已就緒
```

## 開啟指令追蹤（推薦）

shell 是持久的，執行一次 `set -x`，之後**每個指令執行前都會先印出 `+` 追蹤**，指令和輸出對照一目了然：

```shell
set -x
```

預期輸出：無輸出，但從下一個指令開始都會多一行追蹤，例如：

```text
+zsh:1> echo "RUST_OK=$RUST_OK"
RUST_OK=yes
```

想關掉時執行（追蹤本身也算一個指令，所以會看到它自己的追蹤）：

```shell
set +x
```

## 重點回顧

- `RUST_OK` 是全書開關，開新 shell 要重跑本章
- 本書範例零依賴，離線也能建置

[← 回到 README](README.md) | [下一章：Cargo 基礎](01-cargo-basics.md)
