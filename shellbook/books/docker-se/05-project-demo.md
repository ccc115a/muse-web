# 第五章：完整專案容器化實例

把前四章串起來：從零建立 `demo-app`，走完 **開發 → Dockerfile → build → run 驗證 → Compose 編排 → 打 tag → push registry** 的完整容器化交付流程。每個區塊接續上一步，全部可執行。

## 0. 全新開始

```shell
export DOCKER_OK=$(command -v docker >/dev/null && docker info >/dev/null 2>&1 && echo yes || echo no)
rm -rf /tmp/demo-docker && mkdir -p /tmp/demo-docker && cd /tmp/demo-docker
```

## 1. 開發應用程式

```shell
cat > server.js <<'EOF'
const http = require("http");
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.end(`demo-app v${process.env.APP_VERSION || "dev"} @ ${new Date().toISOString()}\n`);
}).listen(port, () => console.log(`listening on ${port}`));
EOF
node server.js & sleep 1 && curl -s http://localhost:3000 && kill %1
```

```shell
printf "node_modules/\n.env\n" > .gitignore && git init -b main >/dev/null 2>&1; git add . && git commit -m "feat: initial server" 2>/dev/null
```

## 2. 寫 Dockerfile（多階段建置示範）

這個例子雖然簡單，但用標準的多階段寫法——build 階段和執行階段分離，是最終 image 瘦身的工程實踐：

```shell
cat > Dockerfile <<'EOF'
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json .
COPY server.js .
RUN echo "dependencies ready"

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app .
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server.js"]
EOF
```

```shell
echo '{"name":"demo-app","version":"1.0.0"}' > package.json
```

`USER node` 讓容器用非 root 執行——安全最佳實踐。

## 3. 建置 image

```shell
[ "$DOCKER_OK" = yes ] && docker build -t demo-app:1.0.0 . || echo "（略過：Docker 未就緒）"
```

```shell
[ "$DOCKER_OK" = yes ] && docker images demo-app || echo "（略過）"
```

## 4. 單容器驗證

```shell
[ "$DOCKER_OK" = yes ] && docker run -d --name demo-app -p 3000:3000 -e APP_VERSION=1.0.0 demo-app:1.0.0 && sleep 3 && curl -s http://localhost:3000 || echo "（略過）"
```

驗證非 root 執行：

```shell
[ "$DOCKER_OK" = yes ] && docker exec demo-app whoami || echo "（略過）"
```

```shell
[ "$DOCKER_OK" = yes ] && docker rm -f demo-app || echo "（略過）"
```

## 5. Compose 編排完整環境

app + redis，redis 資料用 named volume 持久化：

```shell
cat > compose.yml <<'EOF'
services:
  app:
    image: demo-app:1.0.0
    build: .
    ports:
      - "3000:3000"
    environment:
      - APP_VERSION=1.0.0
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

```shell
[ "$DOCKER_OK" = yes ] && docker compose up -d --build && sleep 3 && curl -s http://localhost:3000 || echo "（略過）"
```

```shell
[ "$DOCKER_OK" = yes ] && docker compose ps && docker compose exec redis redis-cli ping || echo "（略過）"
```

## 6. 收掉、打版本 tag

```shell
[ "$DOCKER_OK" = yes ] && docker compose down -v || echo "（略過）"
```

```shell
git tag -a v1.0.0 -m "containerized release" 2>/dev/null; git tag -l
```

## 7. 推上 registry（發布）

image tag 加上 registry 前綴（預設 `yourname`，可用 `export REGISTRY_PREFIX=你的帳號` 覆蓋）：

```shell
export REGISTRY_PREFIX="${REGISTRY_PREFIX:-yourname}"
docker tag demo-app:1.0.0 "$REGISTRY_PREFIX/demo-app:1.0.0" && echo "已標記 $REGISTRY_PREFIX/demo-app:1.0.0" || echo "（略過：Docker 未就緒）"
```

```shell
if [ "$DOCKER_OK" = yes ] && docker info 2>/dev/null | grep -q "Username:"; then
  docker push "$REGISTRY_PREFIX/demo-app:1.0.0"
else
  echo "未登入 registry：實務上先 docker login，再執行 docker push $REGISTRY_PREFIX/demo-app:1.0.0"
fi
```

## 8. 回顧整條流水線

```shell
[ "$DOCKER_OK" = yes ] && docker images demo-app || echo "（略過）"
git log --oneline 2>/dev/null; git tag -l
```

完整流程對應的工程實踐：

| 步驟 | 指令 | 工程意義 |
|------|------|----------|
| 開發 | `node server.js` | 本地先驗證 |
| Dockerfile | 多階段 build + `USER node` | 環境可重現、image 瘦身、安全 |
| build | `docker build -t name:tag` | image 是可版本化的交付單位 |
| 單容器驗證 | `docker run` / `curl` | 上線前煙霧測試 |
| Compose | `docker compose up -d` | 本地整組環境標準化 |
| tag | `git tag` + `docker tag` | 代碼與 image 版本對齊 |
| push | `docker push` | 交付到 registry，供部署拉取 |

[← 回到 README](README.md)
