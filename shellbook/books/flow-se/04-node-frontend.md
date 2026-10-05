# 第四章：實作 Node.js 前端

前端是原生 JS + npm scripts：`build` 產出 dist、`test` 跑 node 內建測試、`start` 本地預覽。接續前面的 shell 狀態（`/tmp/flowboard`）。

先確保環境就緒（等冪，重複執行無害）：

```shell
[ -d /tmp/flowboard/frontend ] || { if [ -z "$FLOW_BOOK" ] || [ ! -d "$FLOW_BOOK/examples/flowboard" ]; then _d="$PWD"; while [ "$_d" != / ] && [ ! -d "$_d/examples/flowboard" ] && [ ! -d "$_d/books/flow-se/examples/flowboard" ]; do _d=$(dirname "$_d"); done; if [ -d "$_d/examples/flowboard" ]; then export FLOW_BOOK="$_d"; elif [ -d "$_d/books/flow-se/examples/flowboard" ]; then export FLOW_BOOK="$_d/books/flow-se"; else export FLOW_BOOK=$(find /Users/Shared "$HOME" -maxdepth 8 -type d -path '*shellbook/books/flow-se' 2>/dev/null | head -1); fi; unset _d; fi; echo "FLOW_BOOK=$FLOW_BOOK"; rm -rf /tmp/flowboard && cp -r "$FLOW_BOOK/examples/flowboard" /tmp/flowboard; }
cd /tmp/flowboard/frontend && cat package.json
```

## npm run build：產出 dist

本專案不需要打包工具，build 腳本把 `public/` 複製到 `dist/`（變大後可換成 vite，不用改流程）：

```shell
npm run build && ls dist/
```

## npm test：node 內建測試

`lib.js` 是無 DOM 依賴的純函式，可被 `node --test` 直接測試：

```shell
cat lib.js && npm test 2>&1 | grep -E "pass|fail"
```

## 看前端怎麼呼叫後端

```shell
grep -n "fetch" public/app.js
```

## 前後端聯調：後端 serve 剛建好的 dist

Rust 後端同時是靜態檔伺服器（`FRONTEND_DIR` 指定 dist），先建後端再一起跑：

```shell
cd ../backend && cargo build 2>&1 | tail -1
```

```shell
FRONTEND_DIR=../frontend/dist DATA_FILE=/tmp/fb-tasks.json ./target/debug/flowboard & sleep 1 && curl -s http://localhost:3001/ | head -c 150 && echo
```

瀏覽器打開 http://localhost:3001 即可操作（新增任務、勾選、刪除都會打到 Rust API）。

```shell
curl -s -X POST http://localhost:3001/api/tasks -d '{"title":"從前端來的任務"}' && echo && kill %1 2>/dev/null; rm -f /tmp/fb-tasks.json; echo "server 已停止"
```

## npm start：純前端預覽（無後端時切版用）

```shell
cd ../frontend && timeout 3 npm start || echo "（預覽 server 已停止，這是正常的）"
```

## 重點回顧

- `npm run <script>` 是前端工程的統一入口：build/test/start/preview
- 前後端用 `docs/api.md` 契約整合，後端直接 serve 前端 dist——部署時只要一個 container
- 純函式抽到 `lib.js`，不需瀏覽器就能單元測試

[← 回到 README](README.md) | [下一章：Playwright 端到端測試](05-e2e.md)
