# 第二章：分支與 Pull Request 流程

軟體工程的核心紀律：**不直接改 main**。所有變更走 feature branch → PR → review → merge。接續第一章的 shell 狀態（`/tmp/demo-app`、`GH_OK`）。

若你是直接跳進這一章，先確保環境就緒（這段是等冪的，重複執行無害）：

```shell
export GH_OK=$(command -v gh >/dev/null && gh auth status >/dev/null 2>&1 && echo yes || echo no)
[ -d /tmp/demo-app/.git ] || { git init --bare /tmp/demo-remote.git; mkdir -p /tmp/demo-app && cd /tmp/demo-app && git init -b main; }
cd /tmp/demo-app && git status
```

## 建立功能分支

```shell
git switch -c feature/greeting
```

```shell
git branch --show-current
```

## 開發、提交

```shell
echo 'console.log("hello, GitHub!");' > hello.js
```

```shell
git add hello.js && git commit -m "feat: add hello command"
```

## 推上遠端

```shell
git push -u origin feature/greeting
```

## 建立 Pull Request

實務上在 GitHub 用 `gh pr create`；它會偵測目前分支並引導你（未登入 gh 時會跳過，流程繼續）：

```shell
[ "$GH_OK" = yes ] && gh pr create --title "feat: hello command" --body "新增 hello.js，請 review" --base main || echo "gh 未登入：此步驟在真實 GitHub 上用 gh pr create 或網頁建立 PR"
```

PR 描述也可以用 heredoc 寫得更完整：

```shell
[ "$GH_OK" = yes ] && gh pr create --title "feat: hello command" --body "$(cat <<'EOF'
## 變更內容
- 新增 hello.js

## 測試
- [x] node hello.js 輸出正確
EOF
)" --base main || echo "（若 PR 已存在或未登入，此步驟略過）"
```

## Review 與討論

```shell
[ "$GH_OK" = yes ] && gh pr list || echo "（略過：gh 未登入）"
```

```shell
[ "$GH_OK" = yes ] && gh pr view || echo "（略過：gh 未登入）"
```

請求特定人 review：

```shell
[ "$GH_OK" = yes ] && gh pr edit --add-reviewer octocat || echo "（略過：gh 未登入）"
```

## 合併

CI 綠燈後合併：有 GitHub 用 squash merge 保持 main 歷史乾淨；沒有 GitHub 就用本地 merge 模擬同樣效果：

```shell
if [ "$GH_OK" = yes ]; then
  gh pr merge --squash --delete-branch
  git switch main && git pull
else
  git switch main && git merge --no-ff feature/greeting -m "merge: feature/greeting"
fi
```

## 驗證合併結果

```shell
git log --oneline -3
```

```shell
ls hello.js && node hello.js
```

## 重點回顧

- `git switch -c` 開分支；`gh pr create` / `gh pr merge` 走 PR 流程
- squash merge 讓 main 每個 commit 都是一個完整功能
- PR 是 code review 的關卡，不是形式

[← 回到 README](README.md) | [下一章：Issue 與專案管理](03-issues.md)
