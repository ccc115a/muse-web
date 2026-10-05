# 第三章：實作 Rust 後端

後端是 Rust（std-only 零依賴）：REST API + 靜態檔伺服器 + JSON 檔案持久化。接續前面的 shell 狀態（`/tmp/flowboard`）。

先確保環境就緒（等冪，重複執行無害）：

```shell
[ -d /tmp/flowboard/backend ] || { if [ -z "$FLOW_BOOK" ] || [ ! -d "$FLOW_BOOK/examples/flowboard" ]; then _d="$PWD"; while [ "$_d" != / ] && [ ! -d "$_d/examples/flowboard" ] && [ ! -d "$_d/books/flow-se/examples/flowboard" ]; do _d=$(dirname "$_d"); done; if [ -d "$_d/examples/flowboard" ]; then export FLOW_BOOK="$_d"; elif [ -d "$_d/books/flow-se/examples/flowboard" ]; then export FLOW_BOOK="$_d/books/flow-se"; else export FLOW_BOOK=$(find /Users/Shared "$HOME" -maxdepth 8 -type d -path '*shellbook/books/flow-se' 2>/dev/null | head -1); fi; unset _d; fi; echo "FLOW_BOOK=$FLOW_BOOK"; rm -rf /tmp/flowboard && cp -r "$FLOW_BOOK/examples/flowboard" /tmp/flowboard; }
cd /tmp/flowboard/backend && ls src/

## 看架構：兩個檔案

- `src/main.rs`：HTTP 解析、路由、靜態檔 serving
- `src/tasks.rs`：`Store`（任務增刪改查 + JSON 持久化）+ 單元測試

```shell
grep -n "pub fn" src/tasks.rs
```

## cargo check：最快回饋

```shell
cargo check 2>&1 | tail -1
```

## cargo test：單元測試

```shell
cargo test 2>&1 | grep "test result"
```

## 跑起來，用 curl 打完整 CRUD

背景啟動（`&`），測完再砍掉。注意 `DATA_FILE` 指向 /tmp，避免污染專案：

```shell
cargo build 2>&1 | tail -1 && DATA_FILE=/tmp/fb-tasks.json ./target/debug/flowboard & sleep 1 && curl -s http://localhost:3001/api/health && echo
```

```shell
curl -s -X POST http://localhost:3001/api/tasks -H 'Content-Type: application/json' -d '{"title":"買牛奶"}' && echo
```

```shell
curl -s http://localhost:3001/api/tasks && echo
```

```shell
curl -s -X PATCH http://localhost:3001/api/tasks/1 -d '{"done":true}' && echo
```

```shell
curl -s http://localhost:3001/api/tasks && echo
```

```shell
curl -s -X DELETE http://localhost:3001/api/tasks/1 -w "HTTP %{http_code}\n"
```

錯誤路徑也要測（空標題 400、不存在 404）：

```shell
curl -s -X POST http://localhost:3001/api/tasks -d '{"title":"  "}' -w " HTTP %{http_code}\n"
```

```shell
curl -s http://localhost:3001/api/tasks/999 -w " HTTP %{http_code}\n"
```

```shell
kill %1 2>/dev/null; rm -f /tmp/fb-tasks.json; echo "server 已停止"
```

## clippy：品質關卡

```shell
cargo clippy -- -D warnings 2>&1 | tail -2
```

## 重點回顧

- `tasks.rs` 是純邏輯（可單元測試），`main.rs` 是 I/O 邊界——測試金字塔的基礎
- 每個 API 都用 curl 實際打過：正常路徑 + 錯誤路徑
- `cargo clippy -- -D warnings` 是進 CI 的門檻

[← 回到 README](README.md) | [下一章：實作 Node.js 前端](04-node-frontend.md)
