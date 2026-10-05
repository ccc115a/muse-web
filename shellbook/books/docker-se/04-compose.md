# 第四章：Docker Compose 多容器編排

真實專案很少只有一個容器：app + 資料庫 + 快取。Docker Compose 用一個 YAML 把整組服務一次拉起——這是本地開發環境標準化的實踐。接續前面的 shell 狀態（`DOCKER_OK`）。

先確認環境（等冪）：

```shell
export DOCKER_OK=$(command -v docker >/dev/null && docker info >/dev/null 2>&1 && echo yes || echo no)
[ -d /tmp/demo-docker ] || mkdir -p /tmp/demo-docker
cd /tmp/demo-docker
```

## 寫 compose.yml

兩個服務：`app`（第二章建的 Node.js image）+ `redis`。同一個 compose 內的服務自動同網路、用服務名互連：

```shell
cat > compose.yml <<'EOF'
services:
  app:
    image: demo-app:1.1
    build: .
    ports:
      - "3000:3000"
    environment:
      - APP_VERSION=1.1
    depends_on:
      - redis
  redis:
    image: redis:alpine
    volumes:
      - redis-data:/data
volumes:
  redis-data:
EOF
```

關鍵概念：

- `build: .`：這個服務用本地 Dockerfile 建（有 image 就直接用，可兩者並存）
- `depends_on`：啟動順序
- `volumes:`（頂層）：named volume，讓 redis 資料持久化
- 服務名 `redis` 就是網路內的主機名，app 可直接連

## 拉起整組服務

```shell
[ "$DOCKER_OK" = yes ] && docker compose up -d || echo "（略過：Docker 未就緒）"
```

```shell
[ "$DOCKER_OK" = yes ] && docker compose ps || echo "（略過）"
```

## 驗證服務

```shell
[ "$DOCKER_OK" = yes ] && sleep 1 && curl -s http://localhost:3000 || echo "（略過）"
```

從 app 容器內連 redis（用服務名）：

```shell
[ "$DOCKER_OK" = yes ] && docker compose exec redis redis-cli ping || echo "（略過）"
```

## 看 log

```shell
[ "$DOCKER_OK" = yes ] && docker compose logs --tail 3 || echo "（略過）"
```

## 改 compose 後套用

改環境變數再 up，compose 只重建有變動的服務：

```shell
sed -i '' 's/APP_VERSION=1.1/APP_VERSION=1.2/' compose.yml && [ "$DOCKER_OK" = yes ] && docker compose up -d && sleep 1 && curl -s http://localhost:3000 || echo "（略過）"
```

## 收掉整組服務

```shell
[ "$DOCKER_OK" = yes ] && docker compose down || echo "（略過）"
```

`down -v` 連 named volume 一起刪（預設 down 會保留資料）：

```shell
[ "$DOCKER_OK" = yes ] && docker compose down -v 2>/dev/null || echo "（略過）"
```

## 重點回顧

- `docker compose up -d` 一行拉起整組開發環境
- 服務名 = 主機名，app 直連 redis 不用查 IP
- `down` 保留資料、`down -v` 全清

[← 回到 README](README.md) | [下一章：完整專案容器化實例](05-project-demo.md)
