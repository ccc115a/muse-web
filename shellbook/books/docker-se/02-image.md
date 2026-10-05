# 第二章：寫 Dockerfile、建置 image

Dockerfile 是把「怎麼把我的程式跑起來」寫成可重現的腳本，`docker build` 把它變成 image。接續前面的 shell 狀態（`DOCKER_OK`）。

先確認環境（等冪）：

```shell
export DOCKER_OK=$(command -v docker >/dev/null && docker info >/dev/null 2>&1 && echo yes || echo no)
[ -d /tmp/demo-docker ] || mkdir -p /tmp/demo-docker
cd /tmp/demo-docker
```

預期輸出：無輸出（切到工作目錄）。

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

預期輸出：無輸出（寫出 `server.js`）。

```shell
node server.js & sleep 1 && curl -s http://localhost:3000 && kill %1
```

預期輸出（先本地驗證邏輯正確，再容器化）：

```text
listening on 3000
demo-app vdev @ 2026-10-04T12:34:12.265Z
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

預期輸出：無輸出（寫出 `Dockerfile`）。

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

預期輸出（最後幾行；每一層 `DONE` 表示建好）：

```text
#11 unpacking to docker.io/library/demo-app:1.0 0.0s done
#11 DONE 0.2s
```

## 跑起來驗證

```shell
[ "$DOCKER_OK" = yes ] && docker run -d --name demo-app -p 3000:3000 demo-app:1.0 && sleep 3 && curl -s http://localhost:3000 || echo "（略過）"
```

預期輸出（跟本地跑的結果一樣——這就是環境一致性）：

```text
a1b2c3d4e5f6...（container id）
demo-app vdev @ 2026-10-04T12:35:34.282Z
```

## 觀察 image 的構成

`history` 顯示每一層怎麼來的——Docker 的分層快取就建立在這之上：

```shell
[ "$DOCKER_OK" = yes ] && docker history demo-app:1.0 || echo "（略過）"
```

預期輸出（每行一層，最上面是你的 `CMD`，下面是 base image 的層）：

```text
IMAGE          CREATED        CREATED BY                                      SIZE
xxxxxxxxxxxx   ... ago   CMD ["node" "server.js"]                      ...
xxxxxxxxxxxx   ... ago   ENV PORT=3000                                 ...
xxxxxxxxxxxx   ... ago   COPY server.js .                              ...
...（node:20-alpine 的層）
```

```shell
[ "$DOCKER_OK" = yes ] && docker image inspect demo-app:1.0 --format '{{.Config.Cmd}} / size={{.Size}}' || echo "（略過）"
```

預期輸出（啟動命令 + image 大小，數字每次略有不同）：

```text
[node server.js] / size=187123456
```

## 改程式碼、重建：體驗分層快取

改一行，再 build 一次。沒變動的層（FROM、WORKDIR）會直接用快取：

```shell
sed -i '' 's/demo-app v/demo-app 改版 v/' server.js && [ "$DOCKER_OK" = yes ] && docker build -t demo-app:1.1 . || echo "（略過）"
```

預期輸出（注意 `CACHED`：沒變動的層直接重用，所以第二次很快）：

```text
#8 [2/4] WORKDIR /app 0.0s done
...
#11 DONE 0.2s
```

```shell
[ "$DOCKER_OK" = yes ] && docker images demo-app || echo "（略過）"
```

預期輸出（兩個版本並存）：

```text
REPOSITORY   TAG       IMAGE ID       CREATED        SIZE
demo-app     1.1       xxxxxxxxxxxx   ... ago   ...MB
demo-app     1.0       xxxxxxxxxxxx   ... ago   ...MB
```

## 清理

```shell
[ "$DOCKER_OK" = yes ] && docker rm -f demo-app || echo "（略過）"
```

預期輸出：

```text
demo-app
```

## 重點回顧

- Dockerfile = 可重現的環境定義，`build -t name:tag` 產出 image
- 分層結構讓重建很快：只重做變動的層
- `EXPOSE` 是聲明，`-p` 才是實際 port 對應

[← 回到 README](README.md) | [下一章：Volume 與 Network](03-volumes-networks.md)
