# 第二章：分支與 Pull Request 流程

軟體工程的核心紀律：**不直接改 main**。所有變更走 feature branch → PR → review → merge。接續第一章的 shell 狀態（`/tmp/demo-app`、`GH_OK`）。

若你是直接跳進這一章，先確保環境就緒（這段是等冪的，重複執行無害）：

```shell
export GH_OK=$(command -v gh >/dev/null && gh auth status >/dev/null 2>&1 && echo yes || echo no)
[ -d /tmp/demo-app/.git ] || { git init --bare /tmp/demo-remote.git >/dev/null 2>&1; mkdir -p /tmp/demo-app && cd /tmp/demo-app && git init -b main && git remote add origin /tmp/demo-remote.git; }
cd /tmp/demo-app && git status
```

預期輸出（工作目錄乾淨時只顯示分支名；有未提交變更會列出來）：

```text
On branch main
...（若有未提交檔案會顯示 Changes / Untracked）
```

## 建立功能分支

```shell
git switch -c feature/greeting
```

預期輸出：

```text
Switched to a new branch 'feature/greeting'
```

```shell
git branch --show-current
```

預期輸出：

```text
feature/greeting
```

## 開發、提交

```shell
echo 'console.log("hello, GitHub!");' > hello.js
```

預期輸出：無輸出（產生 `hello.js`）。

```shell
git add hello.js && git commit -m "feat: add hello command"
```

預期輸出：

```text
[feature/greeting xxxxxxx] feat: add hello command
 1 file changed, 1 insertion(+)
 create mode 100644 hello.js
```

## 推上遠端

```shell
git push -u origin feature/greeting
```

預期輸出：

```text
To /tmp/demo-remote.git
 * [new branch]      feature/greeting -> feature/greeting
branch 'feature/greeting' set up to track 'origin/feature/greeting'.
```

## 建立 Pull Request

實務上在 GitHub 用 `gh pr create`；它會偵測目前分支並引導你（未登入 gh 時會跳過，流程繼續）：

```shell
[ "$GH_OK" = yes ] && gh pr create --title "feat: hello command" --body "新增 hello.js，請 review" --base main || echo "（略過：在你的 GitHub repo 上用 gh pr create 或網頁建立 PR）"
```

預期輸出（`GH_OK=yes` 且分支已推上你的 GitHub repo 時回傳 PR 網址）：

```text
https://github.com/<你的帳號>/<repo>/pull/1
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

預期輸出：同上（已有 PR 時顯示略過，屬正常）。

## Review 與討論

```shell
[ "$GH_OK" = yes ] && gh pr list || echo "（略過：需 gh 已登入且在你的 GitHub repo 內執行）"
```

預期輸出（有 PR 時列出狀態、標題、分支）：

```text
1	feat: hello command	feature/greeting	OPEN	2026-10-05T02:08:19Z
```

```shell
[ "$GH_OK" = yes ] && gh pr view || echo "（略過：需 gh 已登入且在你的 GitHub repo 內執行）"
```

預期輸出（PR 詳情：標題、狀態、分支、描述）：

```text
feat: hello command #1
Open · <你的帳號> wants to merge 1 commit into main from feature/greeting
...
```

請求特定人 review：

```shell
[ "$GH_OK" = yes ] && gh pr edit --add-reviewer octocat || echo "（略過：需 gh 已登入且在你的 GitHub repo 內執行）"
```

預期輸出（成功時回傳 PR 網址；對方非協作者會報錯並顯示略過）：

```text
https://github.com/<你的帳號>/<repo>/pull/1
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

預期輸出（`GH_OK=yes` 時合併 PR 並同步回 main；未登入時本地合併）：

```text
✓ Squashed and merged pull request #1 (feat: hello command)
Switched to branch 'main'
```

```text
Switched to branch 'main'
Merge made by the 'ort' strategy.
 hello.js | 1 +
 1 file changed, 1 insertion(+)
 create mode 100644 hello.js
```

## 驗證合併結果

```shell
git log --oneline -3
```

預期輸出：

```text
xxxxxxx merge: feature/greeting
xxxxxxx feat: add hello command
xxxxxxx chore: initial commit
```

```shell
ls hello.js && node hello.js
```

預期輸出：

```text
hello.js
hello, GitHub!
```

## 重點回顧

- `git switch -c` 開分支；`gh pr create` / `gh pr merge` 走 PR 流程
- squash merge 讓 main 每個 commit 都是一個完整功能
- PR 是 code review 的關卡，不是形式

[← 回到 README](README.md) | [下一章：Issue 與專案管理](03-issues.md)
