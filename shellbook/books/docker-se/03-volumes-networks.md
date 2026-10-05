# 第三章：Volume 與 Network

容器是無狀態的：刪掉就沒了。Volume 負責**資料持久化**，Network 負責**容器間通訊**——這是軟體工程中「資料」與「服務」分離的基礎。接續前面的 shell 狀態（`DOCKER_OK`）。

先確認環境（等冪）：

```shell
export DOCKER_OK=$(command -v docker >/dev/null && docker info >/dev/null 2>&1 && echo yes || echo no)
[ -d /tmp/demo-docker ] || mkdir -p /tmp/demo-docker
cd /tmp/demo-docker
```

## Volume：資料持久化

建立一個 named volume：

```shell
[ "$DOCKER_OK" = yes ] && docker volume create demo-data || echo "（略過：Docker 未就緒）"
```

```shell
[ "$DOCKER_OK" = yes ] && docker volume ls --filter name=demo-data || echo "（略過）"
```

把 volume 掛進容器寫入資料，容器刪了資料還在：

```shell
[ "$DOCKER_OK" = yes ] && docker run --rm -v demo-data:/data alpine sh -c "echo '重要的資料' > /data/note.txt && cat /data/note.txt" || echo "（略過）"
```

新開一個容器掛同一個 volume，資料讀得到：

```shell
[ "$DOCKER_OK" = yes ] && docker run --rm -v demo-data:/data alpine cat /data/note.txt || echo "（略過）"
```

## Bind mount：掛本機目錄

開發時最常用：把本機目錄直接掛進去，改程式碼立刻生效：

```shell
mkdir -p web && echo "<h1>hello docker</h1>" > web/index.html
```

```shell
[ "$DOCKER_OK" = yes ] && docker run --rm -p 8081:80 -v "$PWD/web:/usr/share/nginx/html:ro" nginx:alpine & sleep 2 && curl -s http://localhost:8081 && kill %1 2>/dev/null
```

`:ro` 表示唯讀（read-only），容器只能讀不能改。

## Network：容器間通訊

建立一個自訂網路：

```shell
[ "$DOCKER_OK" = yes ] && docker network create demo-net || echo "（略過：Docker 未就緒）"
```

同一個自訂網路裡的容器，可以用**容器名稱**互相找到（這是 compose 編排的基礎）。先跑一個「資料庫」：

```shell
[ "$DOCKER_OK" = yes ] && docker run -d --name demo-redis --network demo-net redis:alpine || echo "（略過）"
```

再跑一個 client 容器，直接用 `demo-redis` 這個名字連上它：

```shell
[ "$DOCKER_OK" = yes ] && docker run --rm --network demo-net redis:alpine redis-cli -h demo-redis ping || echo "（略過）"
```

## 觀察網路

```shell
[ "$DOCKER_OK" = yes ] && docker network inspect demo-net --format '{{range .Containers}}{{.Name}} {{end}}' || echo "（略過）"
```

## 清理

```shell
[ "$DOCKER_OK" = yes ] && docker rm -f demo-redis && docker network rm demo-net && docker volume rm demo-data || echo "（略過）"
```

## 重點回顧

- 容器刪了就沒了；named volume 讓資料活過容器生命週期
- bind mount（`-v 本機目錄:容器目錄`）是開發時的熱更新手段
- 自訂網路讓容器用名字互連——下一章 Compose 就是靠這個

[← 回到 README](README.md) | [下一章：Docker Compose 多容器編排](04-compose.md)
