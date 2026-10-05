# ADR-001：技術選型

日期：2026-10-05 狀態：已接受

## 背景

flowboard 是一個小型任務看板，需要前後端分離、易於測試、可容器化交付。

## 決策

| 層級 | 選型 | 理由 |
|------|------|------|
| 後端 | Rust（std-only，無第三方依賴） | 記憶體安全、單一靜態執行檔、離線可建置 |
| 前端 | 原生 JS + npm scripts | 需求簡單不需要框架；npm 管腳本與測試 |
| 單元測試 | `cargo test` / `node --test` | 語言內建，零依賴 |
| E2E | Playwright | 真實瀏覽器驗證前後端整合 |
| 交付 | Docker 多階段建置 | 一個 image 包含全部，環境一致 |
| 流程 | Git Flow | main/develop/feature/release/hotfix，詳見書中第二章 |

## 後果

- 後端不引入 web 框架，HTTP 解析手寫：適合教學與小型服務，大型專案應改用 axum。
- 前端無打包工具：`npm run build` 只是複製；變大後應引入 vite。
