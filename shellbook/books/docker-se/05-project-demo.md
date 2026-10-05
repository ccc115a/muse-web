# 第五章：完整專案容器化實例

把前四章串起來：從零建立 `demo-app`，走完 **開發 → Dockerfile → build → run 驗證 → Compose 編排 → 打 tag → push registry** 的完整容器化交付流程。每個區塊接續上一步，全部可執行。

## 0. 全新開始

```shell
export DOCKER_OK=$(command -v docker >/dev/null && docker info >/dev/null 2>&1 && echo yes || echo no)
rm -rf /tmp/demo-docker && mkdir -p /tmp/demo-docker && cd /tmp/demo-docker
```

預期輸出：無輸出（全新乾淨的工作目錄）。

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

預期輸出：

```text
listening on 3000
demo-app vdev @ 2026-10-04T12:34:12.265Z
```

```shell
printf "node_modules/\n.env\n" > .gitignore && git init -b main >/dev/null 2>&1; git add . && git commit -m "feat: initial server" 2>/dev/null
```

預期輸出：無輸出（已初始化 git；可用 `git log --oneline` 確認）。

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

預期輸出：無輸出（寫出多階段 `Dockerfile`）。

```shell
echo '{"name":"demo-app","version":"1.0.0"}' > package.json
```

預期輸出：無輸出。

`USER node` 讓容器用非 root 執行——安全最佳實踐。

## 3. 建置 image

```shell
[ "$DOCKER_OK" = yes ] && docker build -t demo-app:1.0.0 . || echo "（略過：Docker 未就緒）"
```

預期輸出（最後幾行，多階段共十幾個步驟）：

```text
#11 unpacking to docker.io/library/demo-app:1.0.0 0.0s done
#11 DONE 0.2s
```

```shell
[ "$DOCKER_OK" = yes ] && docker images demo-app || echo "（略過）"
```

預期輸出：

```text
REPOSITORY   TAG       IMAGE ID       CREATED        SIZE
demo-app     1.0.0     xxxxxxxxxxxx   ... ago   ...MB
```

## 4. 單容器驗證

```shell
[ "$DOCKER_OK" = yes ] && docker run -d --name demo-app -p 3000:3000 -e APP_VERSION=1.0.0 demo-app:1.0.0 && sleep 3 && curl -s http://localhost:3000 || echo "（略過）"
```

預期輸出：

```text
a1b2c3d4e5f6...（container id）
demo-app v1.0.0 @ 2026-10-04T12:39:18.931Z
```

驗證非 root 執行：

```shell
[ "$DOCKER_OK" = yes ] && docker exec demo-app whoami || echo "（略過）"
```

預期輸出（不是 root，是 `USER node` 的功勞）：

```text
node
```

```shell
[ "$DOCKER_OK" = yes ] && docker rm -f demo-app || echo "（略過）"
```

預期輸出：

```text
demo-app
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

預期輸出：無輸出（寫出 `compose.yml`）。

```shell
[ "$DOCKER_OK" = yes ] && docker compose up -d --build && sleep 3 && curl -s http://localhost:3000 || echo "（略過）"
```

預期輸出：

```text
...
Container demo-docker-app-1 Started
demo-app v1.0.0 @ 2026-10-04T12:39:18.931Z
```

```shell
[ "$DOCKER_OK" = yes ] && docker compose ps && docker compose exec redis redis-cli ping || echo "（略過）"
```

預期輸出：

```text
NAME                  IMAGE          ...   SERVICE   ...   STATUS   ...
demo-docker-app-1     demo-app:1.0.0 ...   app       ...   Up ...
demo-docker-redis-1   redis:alpine   ...   redis     ...   Up ...
PONG
```

## 6. 收掉、打版本 tag

```shell
[ "$DOCKER_OK" = yes ] && docker compose down -v || echo "（略過）"
```

預期輸出：

```text
[+] Running 4/4
 ✔ Container demo-docker-app-1  Removed
 ✔ Container demo-docker-redis-1  Removed
 ✔ Network demo-docker_default  Removed
 ✔ Volume demo-docker_redis-data  Removed
```

```shell
git tag -a v1.0.0 -m "containerized release" 2>/dev/null; git tag -l
```

預期輸出：

```text
v1.0.0
```

## 7. 推上 registry（發布）

image tag 加上 registry 前綴（預設 `yourname`，可用 `export REGISTRY_PREFIX=你的帳號` 覆蓋）：

```shell
export REGISTRY_PREFIX="${REGISTRY_PREFIX:-yourname}"
docker tag demo-app:1.0.0 "$REGISTRY_PREFIX/demo-app:1.0.0" && echo "已標記 $REGISTRY_PREFIX/demo-app:1.0.0" || echo "（略過：Docker 未就緒）"
```

預期輸出（沒改 `REGISTRY_PREFIX` 就是 `yourname`）：

```text
已標記 yourname/demo-app:1.0.0
```

```shell
if [ "$DOCKER_OK" = yes ] && docker info 2>/dev/null | grep -q "Username:"; then
  docker push "$REGISTRY_PREFIX/demo-app:1.0.0"
else
  echo "未登入 registry：實務上先 docker login，再執行 docker push $REGISTRY_PREFIX/demo-app:1.0.0"
fi
```

預期輸出（沒登入時）：

```text
未登入 registry：實務上先 docker login，再執行 docker push yourname/demo-app:1.0.0
```

## 8. 回顧整條流水線

```shell
[ "$DOCKER_OK" = yes ] && docker images demo-app || echo "（略過）"
git log --oneline 2>/dev/null; git tag -l
```

預期輸出：

```text
REPOSITORY   TAG       IMAGE ID       CREATED        SIZE
demo-app     1.0.0     xxxxxxxxxxxx   ... ago   ...MB
yourname/demo-app  1.0.0  ...（同一個 image ID）
xxxxxxx feat: initial server
v1.0.0
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
