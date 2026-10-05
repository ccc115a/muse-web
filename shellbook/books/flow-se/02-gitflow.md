# 第二章：Git Flow 版本流程

Git Flow 用分支分工：`main` 永遠可發布、`develop` 是整合線、`feature/*` 做功能、`release/*` 準備發布、`hotfix/*` 修線上 bug。接續前面的 shell 狀態（`/tmp/flowboard`）。

先確保環境就緒（等冪，重複執行無害）：

```shell
[ -d /tmp/flowboard/.git ] || { if [ -z "$FLOW_BOOK" ] || [ ! -d "$FLOW_BOOK/examples/flowboard" ]; then _d="$PWD"; while [ "$_d" != / ] && [ ! -d "$_d/examples/flowboard" ] && [ ! -d "$_d/books/flow-se/examples/flowboard" ]; do _d=$(dirname "$_d"); done; if [ -d "$_d/examples/flowboard" ]; then export FLOW_BOOK="$_d"; elif [ -d "$_d/books/flow-se/examples/flowboard" ]; then export FLOW_BOOK="$_d/books/flow-se"; else export FLOW_BOOK=$(find /Users/Shared "$HOME" -maxdepth 8 -type d -path '*shellbook/books/flow-se' 2>/dev/null | head -1); fi; unset _d; fi; echo "FLOW_BOOK=$FLOW_BOOK"; rm -rf /tmp/flowboard && cp -r "$FLOW_BOOK/examples/flowboard" /tmp/flowboard && cd /tmp/flowboard && git init -b main >/dev/null 2>&1; }
cd /tmp/flowboard && git status --short | head -3
```

預期輸出（全新複製時列出未追蹤檔案；已跑過第一章時無輸出）：

```text
?? .dockerignore
?? .github/
?? Dockerfile
```

## 建立遠端與 develop 分支

本地 bare repo 模擬 GitHub（每個指令都能真正執行）：

```shell
rm -rf /tmp/flow-remote.git && git init --bare /tmp/flow-remote.git >/dev/null && git remote add origin /tmp/flow-remote.git 2>/dev/null; git add -A && git commit -m "docs: 分析與設計" 2>/dev/null; git push -u origin main 2>&1 | tail -1
```

預期輸出：

```text
branch 'main' set up to track 'origin/main'.
```

從 main 開出 develop——之後所有功能都從 develop 長出來：

```shell
git switch -c develop && git push -u origin develop 2>&1 | tail -1
```

預期輸出：

```text
Switched to a new branch 'develop'
branch 'develop' set up to track 'origin/develop'.
```

真實 GitHub 上建 repo（`origin` 已被本地 bare 遠端佔用，所以用 `--remote github` 另取名字；repo 已存在就跳過）：

```shell
if [ "$GH_OK" = yes ]; then
  if gh repo view flowboard >/dev/null 2>&1; then
    echo "GitHub repo 已存在，跳過建立"
  else
    gh repo create flowboard --private --source . --remote github --push
  fi
  if git remote get-url github >/dev/null 2>&1; then
    echo "github 遠端已就緒：$(git remote get-url github)"
  else
    git remote add github "$(gh repo view flowboard --json sshUrl --jq .sshUrl)" && echo "已加入 github 遠端"
  fi
else
  echo "（略過：gh 未登入，本地 bare 遠端已可演練全流程）"
fi
```

預期輸出（repo 已存在且遠端就緒時——以後重跑都是這個樣子）：

```text
GitHub repo 已存在，跳過建立
github 遠端已就緒：git@github.com:<你的帳號>/flowboard.git
```

第一次執行（repo 不存在）則會看到新建過程：

```text
✓ Created repository <你的帳號>/flowboard on github.com
  https://github.com/<你的帳號>/flowboard
已加入 github 遠端
```

```shell
git remote -v
```

預期輸出（`GH_OK=yes` 會多一組 `github` 遠端）：

```text
github	https://github.com/<你的帳號>/flowboard.git (fetch)
github	https://github.com/<你的帳號>/flowboard.git (push)
origin	/tmp/flow-remote.git (fetch)
origin	/tmp/flow-remote.git (push)
```

## feature/*：做功能

```shell
git switch -c feature/api-tasks
```

預期輸出：

```text
Switched to a new branch 'feature/api-tasks'
```

```shell
printf "# Changelog\n\n## Unreleased\n- 任務 API 與前端看板 MVP\n" > CHANGELOG.md && cat CHANGELOG.md
```

預期輸出：

```text
# Changelog

## Unreleased
- 任務 API 與前端看板 MVP
```

```shell
git add -A && git commit -m "feat: 任務 API 與前端看板" && git push -u origin feature/api-tasks 2>&1 | tail -1
```

預期輸出：

```text
branch 'feature/api-tasks' set up to track 'origin/feature/api-tasks'.
```

## 合併回 develop（模擬 PR）

有 GitHub 就走 PR + review（分支要先推上 GitHub，PR 才開得起來）；沒登入就用本地 `--no-ff` 合併模擬：

```shell
if [ "$GH_OK" = yes ]; then
  git push -u github feature/api-tasks 2>&1 | tail -1 && gh pr create --title "feat: 任務 API 與前端看板" --base develop
else
  git switch develop && git merge --no-ff feature/api-tasks -m "merge: feature/api-tasks"
fi
```

預期輸出（`GH_OK=yes` 顯示 PR 網址；未登入顯示本地合併）：

```text
https://github.com/<你的帳號>/flowboard/pull/1
```

```text
Switched to branch 'develop'
Merge made by the 'ort' strategy.
 CHANGELOG.md | 4 ++++
 1 file changed, 1 insertion(+)
 create mode 100644 CHANGELOG.md
```

示範直接合併（真實專案要等 review + CI 綠燈）；沒登入就看剛才的本地合併結果：

```shell
if [ "$GH_OK" = yes ]; then
  gh pr merge --squash --delete-branch 2>/dev/null; git switch develop 2>/dev/null && git pull github develop
fi
git log --oneline --graph -5
```

預期輸出（hash 每次不同；`GH_OK=yes` 會多出 squash merge 的 commit）：

```text
*   xxxxxxx merge: feature/api-tasks
|\
| * xxxxxxx feat: 任務 API 與前端看板
|/
* xxxxxxx docs: 分析與設計
```

## release/*：準備發布

功能齊了，從 develop 開 release 分支，只做收斂（定版 CHANGELOG、修 bug），不再加功能：

```shell
git switch -c release/0.1.0 && sed -i '' 's/## Unreleased/## 0.1.0/' CHANGELOG.md && cat CHANGELOG.md
```

預期輸出：

```text
Switched to a new branch 'release/0.1.0'
# Changelog

## 0.1.0
- 任務 API 與前端看板 MVP
```

```shell
git add -A && git commit -m "chore(release): 版號 0.1.0" && git push -u origin release/0.1.0 2>&1 | tail -1
```

預期輸出：

```text
branch 'release/0.1.0' set up to track 'origin/release/0.1.0'.
```

## 發布：合併到 main 並打 tag

```shell
git switch main && git merge --no-ff release/0.1.0 -m "merge: release/0.1.0" && git tag -a v0.1.0 -m "flowboard 首版" && git switch develop && git merge --no-ff release/0.1.0 -m "merge: release/0.1.0 回 develop"
```

預期輸出：

```text
Switched to branch 'main'
Switched to branch 'develop'
```

```shell
git log --oneline --graph -6 && git tag -l
```

預期輸出（分支圖；tag 只有 v0.1.0）：

```text
*   xxxxxxx merge: release/0.1.0 回 develop
|\
| * xxxxxxx chore(release): 版號 0.1.0
|/
...
v0.1.0
```

真實 GitHub 上再補一個 Release（偵測登入後執行）：

```shell
[ "$GH_OK" = yes ] && git push origin v0.1.0 2>&1 | tail -1
if [ "$GH_OK" = yes ]; then
  gh release view v0.1.0 >/dev/null 2>&1 || gh release create v0.1.0 --title "v0.1.0" --notes "首版：任務看板 MVP"
else
  echo "（略過：gh 未登入，tag 已在本地建立）"
fi
```

預期輸出（`GH_OK=yes` 且 Release 不存在時建立；已存在則無輸出）：

```text
https://github.com/<你的帳號>/flowboard/releases/tag/v0.1.0
```

## hotfix/*：修線上 bug

線上出問題，直接從 main 開 hotfix，修完同時合併回 main **和** develop：

```shell
git switch main && git switch -c hotfix/health-check && grep -n "health" backend/src/main.rs | head -2
```

預期輸出：

```text
Switched to branch 'main'
Switched to a new branch 'hotfix/health-check'
87:        ("GET", "/api/health") => json(200, r#"{"status":"ok"}"#),
```

```shell
git commit --allow-empty -m "fix: 健康檢查回傳格式" && git switch main && git merge --no-ff hotfix/health-check -m "merge: hotfix/health-check" && git tag -a v0.1.1 -m "hotfix" && git switch develop && git merge --no-ff hotfix/health-check -m "merge: hotfix 回 develop" && git branch -d hotfix/health-check release/0.1.0 feature/api-tasks
```

預期輸出：

```text
Switched to branch 'main'
Switched to branch 'develop'
Deleted branch hotfix/health-check (was xxxxxxx).
Deleted branch release/0.1.0 (was xxxxxxx).
Deleted branch feature/api-tasks (was xxxxxxx).
```

```shell
git log --oneline --graph -8
```

預期輸出（hotfix 同時回到 main 和 develop；最後是兩個 tag）：

```text
*   xxxxxxx merge: hotfix 回 develop
|\
| * xxxxxxx fix: 健康檢查回傳格式
|/
...
```

注意：上面只顯示 log，tag 用 `git tag -l` 看：

```shell
git tag -l
```

```text
v0.1.0
v0.1.1
```

## 重點回顧

- `main` 可發布、`develop` 整合、`feature/*` 開發、`release/*` 收斂、`hotfix/*` 救火
- release/hotfix 完成後要同時回到 main **和** develop，兩邊才一致
- tag 跟著 main 走：`v0.1.0`、`v0.1.1`…

[← 回到 README](README.md) | [下一章：實作 Rust 後端](03-rust-backend.md)
