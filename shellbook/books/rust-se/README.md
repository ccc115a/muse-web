# Rust 軟體工程實務

這是一份可以「邊讀邊執行」的文件。按下程式碼區塊右上角的 **執行**，指令就會送進下方的終端機。

**同一個 shell 不會中斷**：前一步 `cd` 過的目錄、設定的變數，下一步都還在。所以全書的指令要**依照順序執行**。

Rust 在軟體工程中的定位：

- **記憶體安全**：所有權（ownership）系統在編譯期擋掉整類 memory bug，不需要 GC
- **零成本抽象**：效能等同 C/C++，但表達力高很多
- **Cargo**：內建的建置工具 + 套件管理 + 測試框架，工程化程度是各語言之最
- **並發安全**：`Send` / `Sync` 在編譯期保證執行緒安全

本書的範例程式放在本書資料夾的 `examples/` 下（`hello`、`todolist`），shell 指令會用 `cp` 把範例搬進 `/tmp` 工作目錄再操作——每個指令都能真正執行。

> 小提醒：`cp -r src dest` 時若 `dest` 已存在，會複製成 `dest/src` 子目錄。本書的指令都先清掉工作目錄再複製，不會踩這個坑。

## 章節

- [第一章：Cargo 基礎](01-cargo-basics.md)
- [第二章：專案結構與模組](02-project-layout.md)
- [第三章：測試](03-testing.md)
- [第四章：依賴管理](04-crates.md)
- [第五章：完整專案建置實例](05-project-demo.md)

## 環境檢查（先執行這些）

```shell
if command -v cargo >/dev/null && command -v rustc >/dev/null; then
  export RUST_OK=yes
else
  export RUST_OK=no
fi
echo "RUST_OK=$RUST_OK"
cargo --version && rustc --version
```

如果尚未安裝，用 rustup 安裝：

```shell
[ "$RUST_OK" = no ] && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh || echo "Rust 已就緒"
```

[← 回到 shellbook 首頁](../../README.md)
