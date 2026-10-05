# Git + GitHub 軟體工程實務

這是一份可以「邊讀邊執行」的文件。按下程式碼區塊右上角的 **執行**，指令就會送進下方的終端機。

**同一個 shell 不會中斷**：前一步 `cd` 過的目錄、設定的變數，下一步都還在。所以全書的指令要**依照順序執行**，就能走完一條完整的軟體工程流水線。

GitHub 把 Git 變成軟體工程的核心平台：

- **版本控管**：每一行代碼的歷史都可追溯
- **協作**：Pull Request + Code Review 讓多人合作有品質關卡
- **追蹤**：Issue / Milestone / Project 管理需求與進度
- **自動化**：GitHub Actions 在每次 push 時跑測試與部署
- **發布**：Release / Tag 管理版本交付

本書用一個範例專案 `demo-app`（位於 `/tmp/demo-app`），以本地 bare repo 模擬 GitHub 遠端，所有 git 指令都能真正執行；需要 GitHub 帳號的 `gh` 指令會自動偵測登入狀態——有登入就真的執行，沒登入就優雅跳過，流程不會中斷。

## 章節

- [第零章：環境設定](00-env-setting.md) ← 先執行這章
- [第一章：遠端協作基礎](01-remote.md)
- [第二章：分支與 Pull Request 流程](02-branch-pr.md)
- [第三章：Issue 與專案管理](03-issues.md)
- [第四章：GitHub Actions CI/CD](04-actions.md)
- [第五章：完整專案建置實例](05-project-demo.md)

[← 回到 shellbook 首頁](../../README.md)
