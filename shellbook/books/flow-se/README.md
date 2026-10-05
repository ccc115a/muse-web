# 軟體工程使用的工具

這是一份可以「邊讀邊執行」的文件。按下程式碼區塊右上角的 **執行**，指令就會送進下方的終端機。

**同一個 shell 不會中斷**：前一步 `cd` 過的目錄、設定的變數，下一步都還在。所以全書的指令要**依照順序執行**。

本書用一個完整專案 **flowboard**（任務看板：Rust 後端 + Node.js 前端）串起軟體工程的整條生命週期：

```
flowboard/
├── backend/    # Rust（std-only）REST API + 靜態檔伺服器
├── frontend/   # 原生 JS + npm scripts
├── e2e/        # Playwright 端到端測試
├── docs/       # ADR + API 文件
├── Dockerfile  # 多階段建置（Rust 編譯 + Node 建置 → 單一 image）
├── compose.yml # 本地一鍵啟動
└── .github/workflows/ci.yml
```

| 階段 | 章節 | 工具 |
|------|------|------|
| 分析、設計 | 第一章 | Issue、ADR、API 文件 |
| 版本流程 | 第二章 | git + GitHub（Git Flow） |
| 實作後端 | 第三章 | Rust + cargo |
| 實作前端 | 第四章 | Node.js + npm |
| 測試 | 第三～五章 | cargo test、node --test、Playwright |
| DevOps | 第六章 | Docker、Compose、GitHub Actions |
| 運維 | 第七章 | release、health check、log、備份 |

範例專案放在本書資料夾的 `examples/flowboard/`，shell 指令會把它複製到 `/tmp/flowboard` 再操作——每個指令都能真正執行。

## 章節

- [第零章：環境設定](00-env-setting.md) ← 先執行這章
- [第一章：分析與設計](01-analysis-design.md)
- [第二章：Git Flow 版本流程](02-gitflow.md)
- [第三章：實作 Rust 後端](03-rust-backend.md)
- [第四章：實作 Node.js 前端](04-node-frontend.md)
- [第五章：Playwright 端到端測試](05-e2e.md)
- [第六章：Docker 與 CI/CD](06-docker-devops.md)
- [第七章：發布與運維](07-release-ops.md)

[← 回到 shellbook 首頁](../../README.md)
