# flowboard 任務看板

Rust 後端 + Node.js 前端 + Playwright E2E 的示範專案，對應書籍《軟體工程使用的工具》。

```
flowboard/
├── backend/    # Rust（std-only）REST API + 靜態檔伺服器
├── frontend/   # 原生 JS + npm scripts
├── e2e/        # Playwright 端到端測試
├── docs/       # ADR + API 文件
├── Dockerfile  # 多階段建置
├── compose.yml # 本地一鍵啟動
└── .github/workflows/ci.yml
```

快速啟動：見書中第五～七章，或直接 `docker compose up --build`。
