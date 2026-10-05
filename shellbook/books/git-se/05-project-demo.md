# 第五章：完整專案建置實例

把前四章串起來：從零建立 `demo-app`，走完 **init → repo → 開發 → PR → CI → merge → release** 完整流程。每個區塊接續上一步，全部可執行。

## 0. 全新開始

```shell
export GH_OK=$(command -v gh >/dev/null && gh auth status >/dev/null 2>&1 && echo yes || echo no)
rm -rf /tmp/demo-remote.git /tmp/demo-app
git init --bare /tmp/demo-remote.git
```

## 1. 初始化本地專案

```shell
mkdir -p /tmp/demo-app && cd /tmp/demo-app && git init -b main
```

```shell
echo "# demo-app" > README.md && printf "node_modules/\n.env\n" > .gitignore
```

```shell
git add . && git commit -m "chore: initial commit"
```

## 2. 建立遠端 repo 並綁定

真實 GitHub 上可用一行 `gh repo create demo-app --private --source . --push`；本地示範用 bare 遠端，同樣可執行：

```shell
if [ "$GH_OK" = yes ]; then
  gh repo create demo-app --private --source . --push
else
  git remote add origin /tmp/demo-remote.git && git push -u origin main
fi
```

```shell
git remote -v
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

```shell
git add .github && git commit -m "ci: add CI workflow" && git push origin main
```

## 4. 開 Issue 記錄需求

```shell
[ "$GH_OK" = yes ] && gh issue create --title "加入 hello 指令" --body "專案需要一個 hello.js，輸出問候語" || echo "（略過：gh 未登入）"
```

## 5. 開功能分支開發

```shell
git switch -c feature/hello
```

```shell
echo 'console.log("hello, GitHub!");' > hello.js
```

```shell
git add hello.js && git commit -m "feat: add hello command (#1)"
```

```shell
git push -u origin feature/hello
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
)" --base main || echo "（略過：gh 未登入）"
```

## 7. 等 CI 綠燈後合併

```shell
[ "$GH_OK" = yes ] && gh pr checks || echo "（略過：gh 未登入）"
```

有 GitHub 走 PR squash merge；本地用 no-ff merge 模擬：

```shell
if [ "$GH_OK" = yes ]; then
  gh pr merge --squash --delete-branch && git switch main && git pull
else
  git switch main && git merge --no-ff feature/hello -m "merge: feature/hello (closes #1)"
fi
```

```shell
git log --oneline -3 && node hello.js
```

## 8. 打 Tag、發布 Release

```shell
git tag -a v1.0.0 -m "first release" && git push origin v1.0.0
```

```shell
[ "$GH_OK" = yes ] && gh release create v1.0.0 --title "v1.0.0" --notes "第一版：hello 指令" || echo "（略過：gh 未登入。真實 GitHub 上這行會建立 Release 頁面）"
```

```shell
[ "$GH_OK" = yes ] && gh release view || git tag -l
```

## 9. 回顧整條流水線

```shell
git log --oneline -5 && git tag -l && git branch -a
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
