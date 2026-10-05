# 第七章：發布與運維

軟體上線不是結束：打版、驗證、監控、備份、回滾都是運維的基本功。本章接續 Git Flow（第二章）走完發布，並用 Compose 演練日常運維。接續前面的 shell 狀態（`/tmp/flowboard`）。

先確保環境就緒（等冪，重複執行無害）：

```shell
[ -d /tmp/flowboard/.git ] || { if [ -z "$FLOW_BOOK" ] || [ ! -d "$FLOW_BOOK/examples/flowboard" ]; then _d="$PWD"; while [ "$_d" != / ] && [ ! -d "$_d/examples/flowboard" ] && [ ! -d "$_d/books/flow-se/examples/flowboard" ]; do _d=$(dirname "$_d"); done; if [ -d "$_d/examples/flowboard" ]; then export FLOW_BOOK="$_d"; elif [ -d "$_d/books/flow-se/examples/flowboard" ]; then export FLOW_BOOK="$_d/books/flow-se"; else export FLOW_BOOK=$(find /Users/Shared "$HOME" -maxdepth 8 -type d -path '*shellbook/books/flow-se' 2>/dev/null | head -1); fi; unset _d; fi; echo "FLOW_BOOK=$FLOW_BOOK"; rm -rf /tmp/flowboard && cp -r "$FLOW_BOOK/examples/flowboard" /tmp/flowboard && cd /tmp/flowboard && git init -b main >/dev/null 2>&1 && git add -A && git commit -m "feat: flowboard MVP" >/dev/null 2>&1; }
cd /tmp/flowboard && git log --oneline -1 && git tag -l | tail -2
```

預期輸出（剛複製時還沒有 tag，所以只有一行 log）：

```text
xxxxxxx feat: flowboard MVP
```

## 發布：tag 即版本

```shell
git tag -a v0.1.0 -m "flowboard 首版：任務看板 MVP" 2>/dev/null; git tag -l
```

預期輸出：

```text
v0.1.0
```

```shell
if [ "$GH_OK" = yes ]; then
  gh release view v0.1.0 >/dev/null 2>&1 || gh release create v0.1.0 --title "v0.1.0" --notes "首版：任務看板 MVP（Rust 後端 + Node 前端 + E2E）"
else
  echo "（略過：需 gh 已登入且在你的 GitHub repo 內執行。真實流程會在 GitHub 產生 Release 頁面）"
fi
```

預期輸出（`GH_OK=yes` 且 Release 不存在時建立；已存在則無輸出）：

```text
https://github.com/<你的帳號>/flowboard/releases/tag/v0.1.0
```

image 也打上同版號，代碼與產物版本對齊：

```shell
[ "$DOCKER_OK" = yes ] && docker tag flowboard:0.1.0 "${REGISTRY_PREFIX:-yourname}/flowboard:0.1.0" 2>/dev/null && echo "image 已標記" || echo "（略過：需先完成第六章的 docker build）"
```

預期輸出：

```text
image 已標記
```

## 上線：Compose 啟動

```shell
[ "$DOCKER_OK" = yes ] && docker compose up -d && sleep 3 && echo "--- 上線後健康檢查 ---" && curl -s http://localhost:3001/api/health && echo || echo "（略過）"
```

預期輸出：

```text
...
Container flowboard-app-1 Started
--- 上線後健康檢查 ---
{"status":"ok"}
```

## 運維 1：持續健康檢查

```shell
for i in 1 2 3; do curl -s -o /dev/null -w "check $i: HTTP %{http_code}\n" http://localhost:3001/api/health; sleep 1; done
```

預期輸出：

```text
check 1: HTTP 200
check 2: HTTP 200
check 3: HTTP 200
```

實務上這個檢查交給監控系統（Prometheus / uptime monitor），異常就告警。

## 運維 2：看 log

```shell
[ "$DOCKER_OK" = yes ] && docker compose logs --tail 5 || echo "（略過）"
```

預期輸出：

```text
app-1  | flowboard listening on 0.0.0.0:3001
```

## 運維 3：備份資料

任務資料在 named volume 裡，一行備份出來：

```shell
[ "$DOCKER_OK" = yes ] && export VOL=$(docker volume ls -q --filter name=flowboard-data | head -1) && docker run --rm -v "$VOL:/data" -v /tmp:/backup alpine tar czf /backup/flowboard-data.tgz -C /data . && ls -lh /tmp/flowboard-data.tgz || echo "（略過）"
```

預期輸出（大小每次略有不同）：

```text
-rw-r--r--  1 cccuser  wheel   187B Oct  5 09:28 /tmp/flowboard-data.tgz
```

還原演練（先停服務、還原、重啟、驗證）：

```shell
[ "$DOCKER_OK" = yes ] && curl -s -X POST http://localhost:3001/api/tasks -d '{"title":"備份前任務"}' >/dev/null && docker run --rm -v "$VOL:/data" -v /tmp:/backup alpine tar xzf /backup/flowboard-data.tgz -C /data && docker compose restart app && sleep 3 && curl -s http://localhost:3001/api/tasks && echo || echo "（略過）"
```

預期輸出（還原的是備份當下的資料，所以「備份前任務」不會出現——這證明還原生效）：

```text
[{"id":1,"title":"重啟後還在嗎","done":false}]
```

注意：如果你是從第六章連續做下來，ID 和標題會跟上面不完全一樣，重點是「備份前任務」不在列表裡。

## 運維 4：回滾

新版出問題時，Compose 換回舊版 image 即回滾（這裡示範流程，舊版 tag 需事先保留）：

```shell
[ "$DOCKER_OK" = yes ] && docker images flowboard --format '{{.Repository}}:{{.Tag}}' || echo "（略過）"
```

預期輸出（`yourname` 換成你的 registry 帳號後才會出現第二行）：

```text
flowboard:0.1.0
```

## 收尾

```shell
[ "$DOCKER_OK" = yes ] && docker compose down -v 2>/dev/null; rm -f /tmp/flowboard-data.tgz; git log --oneline -3; git tag -l
```

預期輸出（container、volume、備份檔全清掉，只剩 git 歷史）：

```text
...
Network flowboard_default Removed
xxxxxxx feat: flowboard MVP
v0.1.0
```

## 全書回顧：軟體開發流程

| 階段 | 章節 | 工具 | 產物 |
|------|------|------|------|
| 分析 | 第一章 | Issue | 需求 + 驗收標準 |
| 設計 | 第一章 | ADR、API 文件 | 技術決策 + 契約 |
| 版本流程 | 第二章 | git、gh（Git Flow） | 分支、PR、tag |
| 實作 | 第三、四章 | Rust+cargo、Node+npm | 後端、前後整合 |
| 測試 | 第三～五章 | cargo test、node --test、Playwright | 測試金字塔 |
| DevOps | 第六章 | Docker、Compose、Actions | image、CI 流水線 |
| 運維 | 本章 | health check、log、備份 | 穩定運行的服務 |

[← 回到 README](README.md)
