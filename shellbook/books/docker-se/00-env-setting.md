# 第零章：環境設定

開始之前，先確認 Docker 就緒。結果存進 `DOCKER_OK` 變數，後面章節都會用到——**請先執行完本章再往下讀**。

## 偵測 Docker

```shell
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  export DOCKER_OK=yes
else
  export DOCKER_OK=no
fi
echo "DOCKER_OK=$DOCKER_OK"
```

預期輸出：

```text
DOCKER_OK=yes
```

如果 daemon 沒跑，先啟動（macOS 用 Docker Desktop），等啟動後**重跑上面的檢查**：

```shell
[ "$DOCKER_OK" = no ] && open -a Docker && echo "請等 Docker Desktop 啟動後再執行一次上面的檢查" || echo "Docker 已就緒"
```

預期輸出（已就緒時）：

```text
Docker 已就緒
```

## 開啟指令追蹤（推薦）

shell 是持久的，執行一次 `set -x`，之後**每個指令執行前都會先印出 `+` 追蹤**，指令和輸出對照一目了然：

```shell
set -x
```

預期輸出：無輸出，但從下一個指令開始都會多一行追蹤，例如：

```text
+zsh:1> echo "DOCKER_OK=$DOCKER_OK"
DOCKER_OK=yes
```

想關掉時執行（追蹤本身也算一個指令，所以會看到它自己的追蹤）：

```shell
set +x
```

## 重點回顧

- `DOCKER_OK` 是全書開關，開新 shell 要重跑本章
- 需要網路拉 image 或登入 registry 的步驟會自動偵測，可行就真的執行

[← 回到 README](README.md) | [下一章：容器基礎](01-basics.md)
