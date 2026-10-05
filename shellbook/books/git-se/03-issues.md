# 第三章：Issue 與專案管理

GitHub Issues 把「要做什麼」、「誰負責」、「進度如何」都留在代碼旁邊。接續前面的 shell 狀態（`/tmp/demo-app`、`GH_OK`）。

先確保環境就緒（等冪，重複執行無害）：

```shell
export GH_OK=$(command -v gh >/dev/null && gh auth status >/dev/null 2>&1 && echo yes || echo no)
[ -d /tmp/demo-app/.git ] || { mkdir -p /tmp/demo-app && cd /tmp/demo-app && git init -b main; }
cd /tmp/demo-app
```

## 建立 Issue

```shell
[ "$GH_OK" = yes ] && gh issue create --title "支援多國語系" --body "目前只支援英文，需要加入中文介面" || echo "gh 未登入：實務上在 GitHub 上用這行指令建立 Issue"
```

## Labels：分類

常用 label 慣例：`bug`（壞了）、`enhancement`（新功能）、`docs`（文件）、`good first issue`（適合新手）。

先確保 repo 有 `bug` label，再建立一個 bug issue：

```shell
[ "$GH_OK" = yes ] && gh label create bug --color d73a4a --description "功能壞了" 2>/dev/null; [ "$GH_OK" = yes ] && gh issue create --title "登入頁偶爾 500" --body "錯誤 log 顯示 timeout" --label bug || echo "（略過：gh 未登入）"
```

## 查看與篩選

```shell
[ "$GH_OK" = yes ] && gh issue list || echo "（略過：gh 未登入）"
```

```shell
[ "$GH_OK" = yes ] && gh issue list --label bug || echo "（略過：gh 未登入）"
```

```shell
[ "$GH_OK" = yes ] && gh issue list --state all --limit 10 || echo "（略過：gh 未登入）"
```

## 在 Issue 下討論

```shell
[ "$GH_OK" = yes ] && gh issue comment 1 --body "我先認領這個，預計本週完成" || echo "（略過：gh 未登入）"
```

```shell
[ "$GH_OK" = yes ] && gh issue view 1 || echo "（略過：gh 未登入）"
```

## Issue 與 PR 的連結

在 PR 描述寫 `Closes #1`，合併時會自動關閉對應 Issue。先開一個對應分支：

```shell
git switch -c issue-1-i18n && echo '{"lang":"zh"}' > i18n.json && git add i18n.json && git commit -m "feat: 多國語系 (closes #1)" && git push -u origin issue-1-i18n
```

```shell
[ "$GH_OK" = yes ] && gh pr create --title "feat: 多國語系" --body "Closes #1" --base main || echo "（略過：gh 未登入）"
```

## Milestones 與 Projects

Milestone 用來規劃版本（如 v1.0）；Projects 是看板，追蹤整體進度：

```shell
[ "$GH_OK" = yes ] && gh api $(git remote get-url origin | sed 's#.*github.com[:/]##;s#\.git$##')/milestones --method POST -f title="v1.0" || echo "（略過：gh 未登入）"
```

```shell
[ "$GH_OK" = yes ] && gh issue edit 1 --milestone "v1.0" || echo "（略過：gh 未登入）"
```

## 關閉與重開

```shell
[ "$GH_OK" = yes ] && gh issue close 1 --comment "已完成，見 PR" || echo "（略過：gh 未登入）"
```

```shell
[ "$GH_OK" = yes ] && gh issue reopen 1 || echo "（略過：gh 未登入）"
```

## 重點回顧

- Issue = 需求/缺陷的單一事實來源
- `Closes #N` 自動串聯 PR 與 Issue
- label + milestone + project = 輕量級專案管理

[← 回到 README](README.md) | [下一章：GitHub Actions CI/CD](04-actions.md)
