# 第零章：環境設定

開始之前，先確認所有工具就緒。結果存進變數，後面章節都會用到——**請先執行完本章再往下讀**。

## 一次偵測所有工具

```shell
export GH_OK=$(command -v gh >/dev/null && gh auth status >/dev/null 2>&1 && echo yes || echo no)
export RUST_OK=$(command -v cargo >/dev/null && echo yes || echo no)
export NODE_OK=$(command -v node >/dev/null && command -v npm >/dev/null && echo yes || echo no)
export DOCKER_OK=$(command -v docker >/dev/null && docker info >/dev/null 2>&1 && echo yes || echo no)
export PW_OK=$(ls ~/Library/Caches/ms-playwright 2>/dev/null | grep -q chromium && echo yes || echo no)
echo "GH_OK=$GH_OK RUST_OK=$RUST_OK NODE_OK=$NODE_OK DOCKER_OK=$DOCKER_OK PW_OK=$PW_OK"
```

預期輸出（全部 yes 最理想；`GH_OK=no` 也可繼續，只是 GitHub 相關步驟會自動跳過）：

```text
GH_OK=yes RUST_OK=yes NODE_OK=yes DOCKER_OK=yes PW_OK=yes
```

## 確認版本

```shell
cargo --version && node --version && docker --version
```

預期輸出（版本號可能不同）：

```text
cargo 1.82.0 (8f40fc59f 2024-08-21)
v24.14.0
Docker version 29.1.3, build f52814d
```

## 強烈建議：先登入 GitHub

本書有兩種模式，登入後體驗完整很多：

- `GH_OK=yes`：`gh issue create`、`gh pr create`、`gh release create` 等都會**真的執行**
- `GH_OK=no`：上述指令自動跳過，改用本地模擬（照樣可執行，但看不到 GitHub 上的東西）

執行下面這行登入，登入後**重跑上面的環境檢查**：

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

- 五個 `*_OK` 變數是全書開關，開新 shell 要重跑本章
- `GH_OK` 決定 GitHub 指令是真的執行還是優雅跳過

[← 回到 README](README.md) | [下一章：分析與設計](01-analysis-design.md)
