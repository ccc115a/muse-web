# 第六章：Docker 與 CI/CD

交付的標準答案：multi-stage Dockerfile 把 Rust 編譯 + Node 建置收斂成單一 image；Compose 一鍵啟動；GitHub Actions 每次 push 自動驗證。接續前面的 shell 狀態（`/tmp/flowboard`）。

先確保環境就緒（等冪，重複執行無害）：

```shell
[ -d /tmp/flowboard/Dockerfile ] || { [ -d books/flow-se/examples ] && export FLOW_BOOK=books/flow-se || export FLOW_BOOK=$(find "$HOME" -maxdepth 6 -type d -path '*shellbook/books/flow-se' 2>/dev/null | head -1); rm -rf /tmp/flowboard && cp -r "$FLOW_BOOK/examples/flowboard" /tmp/flowboard; }
cd /tmp/flowboard && cat Dockerfile
```

## 看懂三個階段

1. `backend`：Rust image 內 `cargo build --release`，產出 Linux 版執行檔
2. `frontend`：Node image 內 `npm run build`，產出 dist
3. 最終：alpine 只裝執行檔 + dist，不到 20MB（Rust 靜態連結、Node 只在建置期需要）

## docker build（第一次要幾分鐘，之後用快取）

```shell
[ "$DOCKER_OK" = yes ] && docker build -t flowboard:0.1.0 . || echo "（略過：Docker 未就緒）"
```

## 跑起來驗證

```shell
[ "$DOCKER_OK" = yes ] && docker rm -f flowboard >/dev/null 2>&1; docker run -d --name flowboard -p 3001:3001 flowboard:0.1.0 && sleep 3 && curl -s http://localhost:3001/api/health && echo || echo "（略過）"
```

```shell
curl -s http://localhost:3001/ | head -c 100 && echo
```

```shell
curl -s -X POST http://localhost:3001/api/tasks -d '{"title":"容器裡的任務"}' && echo
```

```shell
docker rm -f flowboard && docker images flowboard --format '{{.Repository}}:{{.Tag}} {{.Size}}'
```

## Compose：一鍵啟動 + 資料持久化

`compose.yml` 把 image、port、volume 寫死，新人一行就跑起來：

```shell
cat compose.yml
```

```shell
[ "$DOCKER_OK" = yes ] && APP_VERSION=0.1.0 docker compose up -d && sleep 3 && curl -s http://localhost:3001/api/health && echo || echo "（略過）"
```

驗證 volume：寫入任務後重建容器，資料還在：

```shell
curl -s -X POST http://localhost:3001/api/tasks -d '{"title":"重啟後還在嗎"}' >/dev/null && docker compose restart app && sleep 3 && curl -s http://localhost:3001/api/tasks && echo
```

```shell
docker compose down && docker volume ls --filter name=flowboard
```

## CI：把整條流水線交給 GitHub Actions

```shell
cat .github/workflows/ci.yml
```

四個 job 對應本書的章節：backend（第三章）→ frontend（第四章）→ e2e（第五章）→ image（本章），前一個不過、後一個不跑：

```shell
[ "$GH_OK" = yes ] && gh run list --limit 3 || echo "（略過：gh 未登入。push 到 GitHub 後，這裡會列出 CI 執行紀錄）"
```

## 重點回顧

- multi-stage：建置期依賴不進最終 image，又小又安全
- Compose：把「怎麼跑」寫成檔案，開發/展示環境一致
- CI job 的 `needs` 串起測試金字塔：單元 → E2E → 建置 image

[← 回到 README](README.md) | [下一章：發布與運維](07-release-ops.md)
