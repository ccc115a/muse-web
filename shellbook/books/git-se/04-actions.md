# 第四章：GitHub Actions CI/CD

GitHub Actions 讓每次 push / PR 自動執行測試、建置、部署——這是「持續整合」的實踐。接續前面的 shell 狀態（`/tmp/demo-app`、`GH_OK`）。

先確保環境就緒（等冪，重複執行無害）：

```shell
export GH_OK=$(command -v gh >/dev/null && gh auth status >/dev/null 2>&1 && echo yes || echo no)
[ -d /tmp/demo-app/.git ] || { mkdir -p /tmp/demo-app && cd /tmp/demo-app && git init -b main; }
cd /tmp/demo-app
```

## Workflow 檔案放哪裡

所有 workflow 放在 `.github/workflows/` 下的 YAML 檔：

```shell
mkdir -p .github/workflows
```

預期輸出：無輸出（建立目錄）。

## 寫一個 CI workflow

每次 push 或開 PR 時，跑檢查。用 heredoc 直接寫出真實檔案：

```shell
cat > .github/workflows/ci.yml <<'EOF'
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run checks
        run: |
          echo "running lint..."
          echo "running tests..."
          test -f README.md
          test -f hello.js
EOF
```

預期輸出：無輸出（寫出 `.github/workflows/ci.yml`）。

關鍵概念：

- `on:`：觸發時機（push、pull_request、schedule…）
- `jobs:`：一個 workflow 可有多個 job，各自在獨立 VM 上跑
- `steps:`：job 內的步驟，`uses:` 用現成 action，`run:` 跑 shell 指令

## 驗證 YAML 格式（本地就能跑）

```shell
git diff --stat && cat .github/workflows/ci.yml
```

預期輸出（新檔案尚未 commit，`diff --stat` 無輸出，接著印出檔案內容）：

```text
name: CI

on:
  push:
    branches: [main]
  pull_request:
...
```

## 推上去觸發 CI

在真實 GitHub 上，這次 push 會立刻觸發 workflow；本地 bare 遠端只收不跑：

```shell
git switch main 2>/dev/null; git add .github && git commit -m "ci: add CI workflow" && git push origin main
```

預期輸出：

```text
[main xxxxxxx] ci: add CI workflow
 1 file changed, 19 insertions(+)
 create mode 100644 .github/workflows/ci.yml
To /tmp/demo-remote.git
   xxxxxxx..xxxxxxx  main -> main
```

## 用 gh 觀察執行狀態

```shell
[ "$GH_OK" = yes ] && gh run list --limit 5 || echo "（略過：需 gh 已登入且有 CI 執行紀錄）"
```

預期輸出（有 push 觸發過 CI 才看得到）：

```text
STATUS  TITLE  WORKFLOW  BRANCH  EVENT  ID  ELAPSED  AGE
completed  success  ci  CI  main  push  37254322568  9s  ...
```

```shell
[ "$GH_OK" = yes ] && gh run watch || echo "（略過：需有執行中的 run）"
```

預期輸出：`gh run watch` 要帶 run ID（例如 `gh run watch 37254322568`），不帶會直接顯示略過；有執行中的 run 時會即時跟隨進度，跑完自動結束。

查看失敗 log（除錯必備）：

```shell
[ "$GH_OK" = yes ] && gh run view --log-failed || echo "（略過：需有失敗的 run）"
```

預期輸出：同上要帶 run ID（例如 `gh run view 37254322568 --log-failed` 只印失敗步驟的 log）；ID 不存在或無失敗時顯示略過。

## 常見模式：Secrets

需要 secrets（如 API key）時，先在 repo 設定，再於 workflow 中引用：

```shell
[ "$GH_OK" = yes ] && gh secret set API_KEY --body "demo-value" || echo "（略過：需 gh 已登入且在你的 GitHub repo 內執行）"
```

預期輸出：無輸出（`--body` 直接給值，不會互動式提問；成功就靜靜設好）。

```yaml
# workflow 中引用 secret（示意）
# env:
#   API_KEY: ${{ secrets.API_KEY }}
```

## 定時任務與部署

```yaml
# 每天半夜跑（示意）
# on:
#   schedule:
#     - cron: "0 18 * * *"   # UTC 時間
```

## 重點回顧

- workflow YAML 放 `.github/workflows/`，push 即觸發
- PR + CI 綠燈 = 合併的前提，這就是持續整合
- `gh run list` / `gh run view --log-failed` 是除錯主力

[← 回到 README](README.md) | [下一章：完整專案建置實例](05-project-demo.md)
