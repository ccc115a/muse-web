# 第五章：完整專案建置實例

把前四章串起來：從零建立 `demo-app`，走完 **init → repo → 開發 → PR → CI → merge → release** 完整流程。每個區塊接續上一步，全部可執行。

## 0. 全新開始

```shell
export GH_OK=$(command -v gh >/dev/null && gh auth status >/dev/null 2>&1 && echo yes || echo no)
rm -rf /tmp/demo-remote.git /tmp/demo-app
git init --bare /tmp/demo-remote.git
```

預期輸出：

```text
hint: Using 'master' as the name for the initial branch...
Initialized empty Git repository in /tmp/demo-remote.git/
```

## 1. 初始化本地專案

```shell
mkdir -p /tmp/demo-app && cd /tmp/demo-app && git init -b main
```

預期輸出：

```text
Initialized empty Git repository in /tmp/demo-app/.git/
```

```shell
echo "# demo-app" > README.md && printf "node_modules/\n.env\n" > .gitignore
```

預期輸出：無輸出。

```shell
git add . && git commit -m "chore: initial commit"
```

預期輸出：

```text
[main (root-commit) xxxxxxx] chore: initial commit
 2 files changed, 3 insertions(+)
 create mode 100644 .gitignore
 create mode 100644 README.md
```

## 2. 建立遠端 repo 並綁定

真實 GitHub 上可用一行 `gh repo create demo-app --private --source . --push`；本地示範用 bare 遠端，同樣可執行：

```shell
if [ "$GH_OK" = yes ]; then
  if gh repo view demo-app >/dev/null 2>&1; then
    echo "GitHub repo 已存在，跳過建立"
  else
    gh repo create demo-app --private --source . --push
  fi
  URL=$(gh repo view demo-app --json sshUrl --jq .sshUrl)
  git remote add origin "$URL" 2>/dev/null || git remote set-url origin "$URL"
  echo "origin 已指向：$(git remote get-url origin)"
  git push -u origin main 2>&1 | tail -1
else
  git remote add origin /tmp/demo-remote.git 2>/dev/null || git remote set-url origin /tmp/demo-remote.git
  git push -u origin main
fi
```

預期輸出（`GH_OK=yes` 且 repo 已存在時——重跑都是這個樣子）：

```text
GitHub repo 已存在，跳過建立
origin 已指向：git@github.com:<你的帳號>/demo-app.git
branch 'main' set up to track 'origin/main'.
```

第一次執行（repo 不存在）則會看到新建過程：

```text
✓ Created repository <你的帳號>/demo-app on github.com
  https://github.com/<你的帳號>/demo-app
origin 已指向：git@github.com:<你的帳號>/demo-app.git
branch 'main' set up to track 'origin/main'.
```

```shell
git remote -v
```

預期輸出（`GH_OK=yes` 是 GitHub 網址，否則是本地路徑）：

```text
origin	/tmp/demo-remote.git (fetch)
origin	/tmp/demo-remote.git (push)
```

## 3. 建立 CI workflow

```shell
mkdir -p .github/workflows && cat > .github/workflows/ci.yml <<'EOF'
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: test -f README.md && echo "OK"
EOF
```

預期輸出：無輸出（寫出 workflow 檔）。

```shell
git add .github && git commit -m "ci: add CI workflow" && git push origin main
```

預期輸出：

```text
[main xxxxxxx] ci: add CI workflow
 1 file changed, 14 insertions(+)
 create mode 100644 .github/workflows/ci.yml
To /tmp/demo-remote.git
   xxxxxxx..xxxxxxx  main -> main
```

## 4. 開 Issue 記錄需求

```shell
[ "$GH_OK" = yes ] && gh issue create --title "加入 hello 指令" --body "專案需要一個 hello.js，輸出問候語" || echo "（略過：需 gh 已登入且在你的 GitHub repo 內執行）"
```

預期輸出：

```text
https://github.com/<你的帳號>/<repo>/issues/1
```

## 5. 開功能分支開發

```shell
git switch -c feature/hello
```

預期輸出：

```text
Switched to a new branch 'feature/hello'
```

```shell
echo 'console.log("hello, GitHub!");' > hello.js
```

預期輸出：無輸出。

```shell
git add hello.js && git commit -m "feat: add hello command (#1)"
```

預期輸出：

```text
[feature/hello xxxxxxx] feat: add hello command (#1)
 1 file changed, 1 insertion(+)
 create mode 100644 hello.js
```

```shell
git push -u origin feature/hello
```

預期輸出：

```text
To /tmp/demo-remote.git
 * [new branch]      feature/hello -> feature/hello
branch 'feature/hello' set up to track 'origin/feature/hello'.
```

## 6. 建立 Pull Request

```shell
[ "$GH_OK" = yes ] && gh pr create --title "feat: hello command" --body "$(cat <<'EOF'
Closes #1

## 變更
- 新增 hello.js

## 驗證
- [x] node hello.js 輸出正確
EOF
)" --base main || echo "（略過：需 gh 已登入且在你的 GitHub repo 內執行）"
```

預期輸出（PR 描述裡的 `Closes #1` 會在合併時自動關閉 Issue #1）：

```text
https://github.com/<你的帳號>/<repo>/pull/1
```

## 7. 等 CI 綠燈後合併

```shell
[ "$GH_OK" = yes ] && gh pr checks || echo "（略過：需 gh 已登入且在你的 GitHub repo 內執行）"
```

預期輸出（CI 跑完後顯示各 check 狀態；尚無 check 時顯示 `no checks reported`）：

```text
ci  success  ...
```

有 GitHub 走 PR squash merge；本地用 no-ff merge 模擬：

```shell
if [ "$GH_OK" = yes ]; then
  gh pr merge --squash --delete-branch && git switch main && git pull
else
  git switch main && git merge --no-ff feature/hello -m "merge: feature/hello (closes #1)"
fi
```

預期輸出（`GH_OK=yes` 用 squash merge；否則本地合併）：

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

```shell
git log --oneline -3 && node hello.js
```

預期輸出：

```text
xxxxxxx merge: feature/hello (closes #1)
xxxxxxx feat: add hello command (#1)
xxxxxxx ci: add CI workflow
hello, GitHub!
```

## 8. 打 Tag、發布 Release

```shell
git tag -a v1.0.0 -m "first release" && git push origin v1.0.0
```

預期輸出：

```text
To /tmp/demo-remote.git
 * [new tag]         v1.0.0 -> v1.0.0
```

```shell
if [ "$GH_OK" = yes ]; then
  gh release view v1.0.0 >/dev/null 2>&1 || gh release create v1.0.0 --title "v1.0.0" --notes "第一版：hello 指令"
else
  echo "（略過：需 gh 已登入且在你的 GitHub repo 內執行）"
fi
```

預期輸出（Release 不存在時建立並回傳網址；已存在則無輸出）：

```text
https://github.com/<你的帳號>/<repo>/releases/tag/v1.0.0
```

```shell
[ "$GH_OK" = yes ] && gh release view || git tag -l
```

預期輸出（`GH_OK=yes` 顯示 Release 資訊，否則列出本地 tag）：

```text
title:	v1.0.0
tag:	v1.0.0
...
```

```text
v1.0.0
```

## 9. 回顧整條流水線

```shell
git log --oneline -5 && git tag -l && git branch -a
```

預期輸出（分支、tag、遠端追蹤分支一覽）：

```text
xxxxxxx merge: feature/hello (closes #1)
xxxxxxx feat: add hello command (#1)
xxxxxxx ci: add CI workflow
xxxxxxx chore: initial commit
v1.0.0
* main
  remotes/origin/feature/hello
  remotes/origin/main
```

完整流程對應的工程實踐：

| 步驟 | 指令 | 工程意義 |
|------|------|----------|
| init + commit | `git init` / `git commit` | 版本控管起點 |
| 建 repo | `gh repo create --push` | 代碼上雲、可協作 |
| CI | `.github/workflows/` | 自動化品質關卡 |
| Issue | `gh issue create` | 需求追蹤 |
| 分支 + PR | `git switch -c` / `gh pr create` | code review 流程 |
| merge | `gh pr merge --squash` | main 歷史乾淨 |
| release | `git tag` / `gh release create` | 版本交付 |

[← 回到 README](README.md)
