# 第六章：Docker 與 CI/CD

交付的標準答案：multi-stage Dockerfile 把 Rust 編譯 + Node 建置收斂成單一 image；Compose 一鍵啟動；GitHub Actions 每次 push 自動驗證。接續前面的 shell 狀態（`/tmp/flowboard`）。

先確保環境就緒（等冪，重複執行無害）：

```shell
[ -d /tmp/flowboard/Dockerfile ] || { if [ -z "$FLOW_BOOK" ] || [ ! -d "$FLOW_BOOK/examples/flowboard" ]; then _d="$PWD"; while [ "$_d" != / ] && [ ! -d "$_d/examples/flowboard" ] && [ ! -d "$_d/books/flow-se/examples/flowboard" ]; do _d=$(dirname "$_d"); done; if [ -d "$_d/examples/flowboard" ]; then export FLOW_BOOK="$_d"; elif [ -d "$_d/books/flow-se/examples/flowboard" ]; then export FLOW_BOOK="$_d/books/flow-se"; else export FLOW_BOOK=$(find /Users/Shared "$HOME" -maxdepth 8 -type d -path '*shellbook/books/flow-se' 2>/dev/null | head -1); fi; unset _d; fi; echo "FLOW_BOOK=$FLOW_BOOK"; rm -rf /tmp/flowboard && cp -r "$FLOW_BOOK/examples/flowboard" /tmp/flowboard; }
cd /tmp/flowboard && cat Dockerfile
```

預期輸出：

```text
# 多階段建置：Rust 後端 + Node 前端 → 單一執行 image
# NOTE：第一次 build 要下載 rust/node  base image，會花幾分鐘；之後都用快取。
FROM rust:1-alpine AS backend
...
FROM node:20-alpine AS frontend
...
FROM alpine:3.20
...
CMD ["./flowboard"]
```

## 看懂三個階段

1. `backend`：Rust image 內 `cargo build --release`，產出 Linux 版執行檔
2. `frontend`：Node image 內 `npm run build`，產出 dist
3. 最終：alpine 只裝執行檔 + dist，不到 20MB（Rust 靜態連結、Node 只在建置期需要）

## docker build（第一次要幾分鐘，之後用快取）

```shell
[ "$DOCKER_OK" = yes ] && docker build -t flowboard:0.1.0 . || echo "（略過：Docker 未就緒）"
```

預期輸出（最後幾行；第一次會下載 base image 花幾分鐘）：

```text
#19 naming to docker.io/library/flowboard:0.1.0 done
#19 unpacking to docker.io/library/flowboard:0.1.0 0.4s done
#19 DONE 4.0s
```

## 跑起來驗證

```shell
[ "$DOCKER_OK" = yes ] && docker rm -f flowboard >/dev/null 2>&1; docker run -d --name flowboard -p 3001:3001 flowboard:0.1.0 && sleep 3 && curl -s http://localhost:3001/api/health && echo || echo "（略過）"
```

預期輸出（一長串 container id 後接健康檢查）：

```text
a1b2c3d4e5f6...（container id）
{"status":"ok"}
```

```shell
curl -s http://localhost:3001/ | head -c 100 && echo
```

預期輸出（容器裡的前端頁面）：

```text
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset
```

```shell
curl -s -X POST http://localhost:3001/api/tasks -d '{"title":"容器裡的任務"}' && echo
```

預期輸出：

```text
{"id":1,"title":"容器裡的任務","done":false}
```

```shell
docker rm -f flowboard && docker images flowboard --format '{{.Repository}}:{{.Tag}} {{.Size}}'
```

預期輸出（alpine 最終 image 不到 20MB）：

```text
flowboard
flowboard:0.1.0 14.7MB
```

## Compose：一鍵啟動 + 資料持久化

`compose.yml` 把 image、port、volume 寫死，新人一行就跑起來：

```shell
cat compose.yml
```

預期輸出：

```text
services:
  app:
    build: .
    image: flowboard:dev
    ports:
      - "3001:3001"
    environment:
      - APP_VERSION=${APP_VERSION:-dev}
    volumes:
      - flowboard-data:/app/data

volumes:
  flowboard-data:
```

```shell
[ "$DOCKER_OK" = yes ] && APP_VERSION=0.1.0 docker compose up -d && sleep 3 && curl -s http://localhost:3001/api/health && echo || echo "（略過）"
```

預期輸出：

```text
...
Container flowboard-app-1 Started
{"status":"ok"}
```

驗證 volume：寫入任務後重建容器，資料還在：

```shell
curl -s -X POST http://localhost:3001/api/tasks -d '{"title":"重啟後還在嗎"}' >/dev/null && docker compose restart app && sleep 3 && curl -s http://localhost:3001/api/tasks && echo
```

```shell
docker compose down && docker volume ls --filter name=flowboard
```

預期輸出（`down` 預設保留 volume，資料還在）：

```text
...
DRIVER    VOLUME NAME
local     flowboard_flowboard-data
```

## CI：把整條流水線交給 GitHub Actions

```shell
cat .github/workflows/ci.yml
```

預期輸出（開頭；四個 job 用 `needs` 串起來）：

```text
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  backend:
  ...
```

四個 job 對應本書的章節：backend（第三章）→ frontend（第四章）→ e2e（第五章）→ image（本章），前一個不過、後一個不跑：

```shell
[ "$GH_OK" = yes ] && gh run list --limit 3 || echo "（略過：需 gh 已登入且 push 到 GitHub 觸發 CI 後才有紀錄）"
```

預期輸出（有 push 觸發過 CI 才看得到；欄位：狀態、結果、名稱、分支、時間）：

```text
STATUS  TITLE  WORKFLOW  BRANCH  EVENT  ID  ELAPSED  AGE
completed  success  ci  CI  main  push  37254322568  9s  ...
```

## 重點回顧

- multi-stage：建置期依賴不進最終 image，又小又安全
- Compose：把「怎麼跑」寫成檔案，開發/展示環境一致
- CI job 的 `needs` 串起測試金字塔：單元 → E2E → 建置 image

[← 回到 README](README.md) | [下一章：發布與運維](07-release-ops.md)
