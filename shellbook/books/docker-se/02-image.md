# 第二章：寫 Dockerfile、建置 image

Dockerfile 是把「怎麼把我的程式跑起來」寫成可重現的腳本，`docker build` 把它變成 image。接續前面的 shell 狀態（`DOCKER_OK`）。

先確認環境（等冪）：

```shell
export DOCKER_OK=$(command -v docker >/dev/null && docker info >/dev/null 2>&1 && echo yes || echo no)
[ -d /tmp/demo-docker ] || mkdir -p /tmp/demo-docker
cd /tmp/demo-docker
```

## 寫一個最小的 Node.js 應用

```shell
cat > server.js <<'EOF'
const http = require("http");
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.end(`demo-app v${process.env.APP_VERSION || "dev"} @ ${new Date().toISOString()}\n`);
}).listen(port, () => console.log(`listening on ${port}`));
EOF
```

```shell
node server.js & sleep 1 && curl -s http://localhost:3000 && kill %1
```

## 寫 Dockerfile

多階段在這個例子用不上，直接用 `node:20-alpine`：

```shell
cat > Dockerfile <<'EOF'
FROM node:20-alpine
WORKDIR /app
COPY server.js .
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
EOF
```

每個指令的意義：

- `FROM`：基底 image
- `WORKDIR`：工作目錄（沒有會自動建立）
- `COPY`：把檔案複製進 image
- `ENV`：環境變數
- `EXPOSE`：聲明容器會聽哪個 port（文件性質，實際對應靠 `-p`）
- `CMD`：容器啟動時執行的指令

## 建置 image

`-t` 給 image 取名（`name:tag` 格式）：

```shell
[ "$DOCKER_OK" = yes ] && docker build -t demo-app:1.0 . || echo "（略過：Docker 未就緒）"
```

## 跑起來驗證

```shell
[ "$DOCKER_OK" = yes ] && docker run -d --name demo-app -p 3000:3000 demo-app:1.0 && sleep 3 && curl -s http://localhost:3000 || echo "（略過）"
```

## 觀察 image 的構成

`history` 顯示每一層怎麼來的——Docker 的分層快取就建立在這之上：

```shell
[ "$DOCKER_OK" = yes ] && docker history demo-app:1.0 || echo "（略過）"
```

```shell
[ "$DOCKER_OK" = yes ] && docker image inspect demo-app:1.0 --format '{{.Config.Cmd}} / size={{.Size}}' || echo "（略過）"
```

## 改程式碼、重建：體驗分層快取

改一行，再 build 一次。沒變動的層（FROM、WORKDIR）會直接用快取：

```shell
sed -i '' 's/demo-app v/demo-app 改版 v/' server.js && [ "$DOCKER_OK" = yes ] && docker build -t demo-app:1.1 . || echo "（略過）"
```

```shell
[ "$DOCKER_OK" = yes ] && docker images demo-app || echo "（略過）"
```

## 清理

```shell
[ "$DOCKER_OK" = yes ] && docker rm -f demo-app || echo "（略過）"
```

## 重點回顧

- Dockerfile = 可重現的環境定義，`build -t name:tag` 產出 image
- 分層結構讓重建很快：只重做變動的層
- `EXPOSE` 是聲明，`-p` 才是實際 port 對應

[← 回到 README](README.md) | [下一章：Volume 與 Network](03-volumes-networks.md)
