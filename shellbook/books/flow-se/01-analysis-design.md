# 第一章：分析與設計

寫程式之前，先回答三個問題：**做什麼**（需求）、**怎麼做**（設計）、**怎麼驗收**（測試標準）。本章的工具是 Issue、ADR、API 文件——全部進版控，跟著程式一起演化。

先把專案複製到工作目錄（先 `rm` 再 `cp`，避免複製成子目錄）：

```shell
[ -d books/flow-se/examples ] && export FLOW_BOOK=books/flow-se || export FLOW_BOOK=$(find "$HOME" -maxdepth 6 -type d -path '*shellbook/books/flow-se' 2>/dev/null | head -1)
rm -rf /tmp/flowboard && cp -r "$FLOW_BOOK/examples/flowboard" /tmp/flowboard && cd /tmp/flowboard && git init -b main >/dev/null 2>&1
ls
```

## 需求：用 Issue 記錄

需求不是口頭約定，而是一張可追蹤、可討論、可關閉的 Issue：

```shell
[ "$GH_OK" = yes ] && gh issue create --title "任務看板 MVP" --body "$(cat <<'EOF'
## 使用者故事
身為使用者，我可以新增 / 勾選 / 刪除任務，以便管理工作。

## 驗收標準
- [ ] POST /api/tasks 可新增任務
- [ ] PATCH 可標記完成，重整後狀態保留
- [ ] DELETE 可刪除任務
- [ ] E2E 覆蓋以上三條路徑
EOF
)" || echo "gh 未登入：實務上在 GitHub 上用這行指令建立需求 Issue"
```

## 設計：用 ADR 留下決策

ADR（Architecture Decision Record）記錄「為什麼這樣選」，新人三個月後還看得懂：

```shell
cat docs/ADR-001-stack.md
```

## 設計：API 契約先行

前後端並行開發的關鍵：先定契約，各自對著契約實作與測試：

```shell
cat docs/api.md
```

驗證文件與實作一致（文件寫的端點，程式碼裡都要有）：

```shell
grep -o "GET /[a-z/]*\|POST /[a-z/]*\|PATCH /[a-z/:]*\|DELETE /[a-z/:]*" docs/api.md | sort -u
```

```shell
grep -o '"/api/[a-z]*"' backend/src/main.rs | sort -u
```

## 驗收標準進版控

把驗收條件寫成 E2E 測試大綱（實作見第五章），先有骨架：

```shell
ls e2e/tests/ && head -12 e2e/tests/board.spec.js
```

## 提交分析產物

```shell
git add -A && git commit -m "docs: 分析與設計（ADR、API 契約、驗收標準）" 2>&1 | head -2
```

## 重點回顧

- Issue = 需求的單一事實來源，驗收標準寫在裡面
- ADR = 決策的歷史紀錄，回答「為什麼」
- API 契約 = 前後端並行的介面，文件與實作互相驗證

[← 回到 README](README.md) | [下一章：Git Flow 版本流程](02-gitflow.md)
