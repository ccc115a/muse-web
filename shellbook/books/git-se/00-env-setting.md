# 第零章：環境設定

開始之前，先確認工具就緒。結果存進 `GH_OK` 變數，後面章節都會用到——**請先執行完本章再往下讀**。

## 確認 git 可用

```shell
git --version
```

預期輸出（版本號可能不同）：

```text
git version 2.49.0
```

## 偵測 gh 登入狀態

```shell
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  export GH_OK=yes
else
  export GH_OK=no
fi
echo "GH_OK=$GH_OK"
```

預期輸出：

```text
GH_OK=yes
```

如果是 `GH_OK=no`，先安裝（已安裝就跳過）：

```shell
[ "$GH_OK" = no ] && brew install gh || echo "gh 已安裝"
```

預期輸出（已安裝時）：

```text
gh 已安裝
```

## 強烈建議：先登入 GitHub

本書有兩種模式，登入後體驗完整很多：

- `GH_OK=yes`：`gh pr create`、`gh issue create`、`gh release create` 等都會**真的執行**，在你的 GitHub 帳號上建立 PR / Issue / Release
- `GH_OK=no`：上述指令自動跳過，git 流程改用本地模擬（照樣可執行，但看不到 GitHub 上的東西）

執行下面這行登入（瀏覽器開 GitHub 按授權即可），登入後**重跑上面的 GH_OK 檢查**：

```shell
[ "$GH_OK" = no ] && gh auth login || gh auth status
```

預期輸出（已登入時）：

```text
github.com
  ✓ Logged in to github.com account <你的帳號> (keyring)
  - Active account: true
  - Git operations protocol: ssh
  - Token: gho_************************************
  - Token scopes: 'admin:public_key', 'gist', 'read:org', 'repo'
```

## 開啟指令追蹤（推薦）

shell 是持久的，執行一次 `set -x`，之後**每個指令執行前都會先印出 `+` 追蹤**，指令和輸出對照一目了然：

```shell
set -x
```

預期輸出：無輸出，但從下一個指令開始都會多一行追蹤，例如：

```text
+zsh:1> echo "GH_OK=$GH_OK"
GH_OK=yes
```

想關掉時執行（追蹤本身也算一個指令，所以會看到它自己的追蹤）：

```shell
set +x
```

## 重點回顧

- `GH_OK` 是全書開關，開新 shell 要重跑本章
- 登入後體驗完整，沒登入也能用本地模擬走完流程

[← 回到 README](README.md) | [下一章：遠端協作基礎](01-remote.md)
