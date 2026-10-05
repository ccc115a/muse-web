# 第一章：容器基礎

image 是模板，container 是用模板跑起來的實例。本章先熟悉最核心的生命週期指令。

先確認環境（等冪，重複執行無害）：

```shell
export DOCKER_OK=$(command -v docker >/dev/null && docker info >/dev/null 2>&1 && echo yes || echo no)
echo "DOCKER_OK=$DOCKER_OK"
```

## 拉一個 image 下來

`alpine` 是最小的 Linux image（約 5MB），最適合練習：

```shell
[ "$DOCKER_OK" = yes ] && docker pull alpine:latest || echo "Docker 未就緒：實務上這行會從 registry 拉下 alpine image"
```

```shell
[ "$DOCKER_OK" = yes ] && docker images alpine || echo "（略過）"
```

## 跑起來：run

`run` = 建 container + 啟動。`--rm` 表示結束後自動刪除：

```shell
[ "$DOCKER_OK" = yes ] && docker run --rm alpine echo "hello from container" || echo "（略過）"
```

互動模式：`-it` 開一個 shell 進去玩（跑完自動退出刪除）：

```shell
[ "$DOCKER_OK" = yes ] && docker run --rm -it alpine sh -c "cat /etc/os-release && uname -a" || echo "（略過）"
```

## 常駐容器：-d 背景執行

`-d`（detached）讓容器在背景跑，`--name` 給它名字方便操作：

```shell
[ "$DOCKER_OK" = yes ] && docker run -d --name demo-nginx -p 8080:80 nginx:alpine || echo "（略過：Docker 未就緒）"
```

## 觀察容器

```shell
[ "$DOCKER_OK" = yes ] && docker ps || echo "（略過）"
```

`ps -a` 連已停止的也列出：

```shell
[ "$DOCKER_OK" = yes ] && docker ps -a --filter name=demo-nginx || echo "（略過）"
```

## 看 log

```shell
[ "$DOCKER_OK" = yes ] && docker logs demo-nginx 2>/dev/null | head -5 || echo "（略過）"
```

## 進入運行中的容器

`exec` 在跑著的容器裡執行指令：

```shell
[ "$DOCKER_OK" = yes ] && docker exec demo-nginx sh -c "ls /usr/share/nginx/html && nginx -v" || echo "（略過）"
```

## 驗證 port 對應

`-p 8080:80` 把容器的 80 對到主機的 8080：

```shell
[ "$DOCKER_OK" = yes ] && curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:8080 || echo "（略過）"
```

## 停止與刪除

```shell
[ "$DOCKER_OK" = yes ] && docker stop demo-nginx && docker rm demo-nginx || echo "（略過）"
```

```shell
[ "$DOCKER_OK" = yes ] && docker ps -a --filter name=demo-nginx && echo "已清乾淨" || echo "（略過）"
```

## 重點回顧

- `pull` 拉模板、`run` 起實例、`--rm` 用完即丟
- `-d` 背景跑、`exec` 進去查、`logs` 看輸出
- `-p 主機port:容器port` 是對外服務的關鍵

[← 回到 README](README.md) | [下一章：寫 Dockerfile、建置 image](02-image.md)
