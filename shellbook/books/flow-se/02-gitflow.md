# 第二章：Git Flow 版本流程

Git Flow 用分支分工：`main` 永遠可發布、`develop` 是整合線、`feature/*` 做功能、`release/*` 準備發布、`hotfix/*` 修線上 bug。接續前面的 shell 狀態（`/tmp/flowboard`）。

先確保環境就緒（等冪，重複執行無害）：

```shell
[ -d /tmp/flowboard/.git ] || { if [ -z "$FLOW_BOOK" ] || [ ! -d "$FLOW_BOOK/examples/flowboard" ]; then _d="$PWD"; while [ "$_d" != / ] && [ ! -d "$_d/examples/flowboard" ] && [ ! -d "$_d/books/flow-se/examples/flowboard" ]; do _d=$(dirname "$_d"); done; if [ -d "$_d/examples/flowboard" ]; then export FLOW_BOOK="$_d"; elif [ -d "$_d/books/flow-se/examples/flowboard" ]; then export FLOW_BOOK="$_d/books/flow-se"; else export FLOW_BOOK=$(find /Users/Shared "$HOME" -maxdepth 8 -type d -path '*shellbook/books/flow-se' 2>/dev/null | head -1); fi; unset _d; fi; echo "FLOW_BOOK=$FLOW_BOOK"; rm -rf /tmp/flowboard && cp -r "$FLOW_BOOK/examples/flowboard" /tmp/flowboard && cd /tmp/flowboard && git init -b main >/dev/null 2>&1; }
cd /tmp/flowboard && git status --short | head -3
```

## 建立遠端與 develop 分支

本地 bare repo 模擬 GitHub（每個指令都能真正執行）：

```shell
rm -rf /tmp/flow-remote.git && git init --bare /tmp/flow-remote.git >/dev/null && git remote add origin /tmp/flow-remote.git 2>/dev/null; git add -A && git commit -m "docs: 分析與設計" 2>/dev/null; git push -u origin main 2>&1 | tail -1
```

從 main 開出 develop——之後所有功能都從 develop 長出來：

```shell
git switch -c develop && git push -u origin develop 2>&1 | tail -1
```

真實 GitHub 上等同於：

```shell
[ "$GH_OK" = yes ] && gh repo create flowboard --private --source . --push || echo "（略過：gh 未登入，本地 bare 遠端已可演練全流程）"
```

## feature/*：做功能

```shell
git switch -c feature/api-tasks
```

```shell
printf "# Changelog\n\n## Unreleased\n- 任務 API 與前端看板 MVP\n" > CHANGELOG.md && cat CHANGELOG.md
```

```shell
git add -A && git commit -m "feat: 任務 API 與前端看板" && git push -u origin feature/api-tasks 2>&1 | tail -1
```

## 合併回 develop（模擬 PR）

有 GitHub 就走 PR + review；本地用 `--no-ff` 合併保留分支痕跡：

```shell
[ "$GH_OK" = yes ] && gh pr create --title "feat: 任務 API 與前端看板" --base develop || git switch develop && git merge --no-ff feature/api-tasks -m "merge: feature/api-tasks"
```

```shell
git log --oneline --graph -5
```

## release/*：準備發布

功能齊了，從 develop 開 release 分支，只做收斂（定版 CHANGELOG、修 bug），不再加功能：

```shell
git switch -c release/0.1.0 && sed -i '' 's/## Unreleased/## 0.1.0/' CHANGELOG.md && cat CHANGELOG.md
```

```shell
git add -A && git commit -m "chore(release): 版號 0.1.0" && git push -u origin release/0.1.0 2>&1 | tail -1
```

## 發布：合併到 main 並打 tag

```shell
git switch main && git merge --no-ff release/0.1.0 -m "merge: release/0.1.0" && git tag -a v0.1.0 -m "flowboard 首版" && git switch develop && git merge --no-ff release/0.1.0 -m "merge: release/0.1.0 回 develop"
```

```shell
git log --oneline --graph -6 && git tag -l
```

真實 GitHub 上再補一個 Release（偵測登入後執行）：

```shell
[ "$GH_OK" = yes ] && git push origin v0.1.0 && gh release create v0.1.0 --title "v0.1.0" --notes "首版：任務看板 MVP" || echo "（略過：gh 未登入，tag 已在本地建立）"
```

## hotfix/*：修線上 bug

線上出問題，直接從 main 開 hotfix，修完同時合併回 main **和** develop：

```shell
git switch main && git switch -c hotfix/health-check && grep -n "health" backend/src/main.rs | head -2
```

```shell
git commit --allow-empty -m "fix: 健康檢查回傳格式" && git switch main && git merge --no-ff hotfix/health-check -m "merge: hotfix/health-check" && git tag -a v0.1.1 -m "hotfix" && git switch develop && git merge --no-ff hotfix/health-check -m "merge: hotfix 回 develop" && git branch -d hotfix/health-check release/0.1.0 feature/api-tasks
```

```shell
git log --oneline --graph -8
```

## 重點回顧

- `main` 可發布、`develop` 整合、`feature/*` 開發、`release/*` 收斂、`hotfix/*` 救火
- release/hotfix 完成後要同時回到 main **和** develop，兩邊才一致
- tag 跟著 main 走：`v0.1.0`、`v0.1.1`…

[← 回到 README](README.md) | [下一章：實作 Rust 後端](03-rust-backend.md)
