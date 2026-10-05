# 第一章：遠端協作基礎

GitHub 上的每個 repo 都是一個 Git 遠端。所有協作都從「同步」開始。本章用本地 bare repo 模擬 GitHub 遠端，每個指令都能真正執行。

先清掉舊的示範環境，建立一個裸遠端（bare repo 就像 GitHub 上的 repo，只收 push 不工作）：

```shell
rm -rf /tmp/demo-remote.git /tmp/demo-app /tmp/demo-app-2
git init --bare /tmp/demo-remote.git
```

預期輸出：

```text
hint: Using 'master' as the name for the initial branch...
Initialized empty Git repository in /tmp/demo-remote.git/
```

## 建立專案並完成第一個 commit

```shell
mkdir -p /tmp/demo-app && cd /tmp/demo-app && git init -b main
```

預期輸出：

```text
Initialized empty Git repository in /tmp/demo-app/.git/
```

```shell
echo "# demo-app" > README.md && printf "node_modules/\n.env\n" > .gitignore
```

預期輸出：無輸出（只產生 `README.md` 和 `.gitignore` 兩個檔案）。

```shell
git add . && git commit -m "chore: initial commit"
```

預期輸出（hash 每次不同）：

```text
[main (root-commit) xxxxxxx] chore: initial commit
 2 files changed, 3 insertions(+)
 create mode 100644 .gitignore
 create mode 100644 README.md
```

## 綁定遠端並 push

`-u` 會設定上游追蹤，之後 `git push` / `git pull` 不用再寫遠端名：

```shell
git remote add origin /tmp/demo-remote.git 2>/dev/null || git remote set-url origin /tmp/demo-remote.git
git push -u origin main
```

預期輸出：

```text
To /tmp/demo-remote.git
 * [new branch]      main -> main
branch 'main' set up to track 'origin/main'.
```

```shell
git remote -v
```

預期輸出：

```text
origin	/tmp/demo-remote.git (fetch)
origin	/tmp/demo-remote.git (push)
```

## Clone：把遠端 repo 抓下來

模擬另一位隊友 clone 同一個 repo：

```shell
git clone /tmp/demo-remote.git /tmp/demo-app-2 && git -C /tmp/demo-app-2 log --oneline
```

預期輸出：

```text
Cloning into '/tmp/demo-app-2'...
done.
xxxxxxx chore: initial commit
```

## Fetch：只下載、不合併

先讓「隊友」產生一個新 commit 並推上遠端：

```shell
git -C /tmp/demo-app-2 commit --allow-empty -m "docs: teammate's commit" && git -C /tmp/demo-app-2 push
```

預期輸出：

```text
[main xxxxxxx] docs: teammate's commit
To /tmp/demo-remote.git
   xxxxxxx..xxxxxxx  main -> main
```

`fetch` 把遠端更新抓下來但不動你的工作目錄，可以先看歷史再決定：

```shell
git fetch origin && git log origin/main --oneline -5
```

預期輸出（看到遠端的新 commit，但本地還沒合併）：

```text
xxxxxxx docs: teammate's commit
xxxxxxx chore: initial commit
```

## Pull：下載並合併

```shell
git pull origin main && git log --oneline -2
```

預期輸出：

```text
From /tmp/demo-remote
 * branch            main       -> FETCH_HEAD
Updating xxxxxxx..xxxxxxx
Fast-forward
 xxxxxxx docs: teammate's commit
 xxxxxxx chore: initial commit
```

## 查看遠端細節

```shell
git remote show origin
```

預期輸出：

```text
* remote origin
  Fetch URL: /tmp/demo-remote.git
  Push  URL: /tmp/demo-remote.git
  HEAD branch: main
  Remote branch:
    main tracked
  Local branch configured for 'git pull':
    main merges with remote main
  Local ref configured for 'git push':
    main pushes to main (up to date)
```

## 改 repo 網址

repo 搬家（或像我們這樣從 GitHub 換成本地路徑）時用 `set-url`，這裡設回同一個位址做無害示範：

```shell
git remote set-url origin /tmp/demo-remote.git && git remote -v
```

預期輸出（跟上面一樣，證明網址沒變）：

```text
origin	/tmp/demo-remote.git (fetch)
origin	/tmp/demo-remote.git (push)
```

## 重點回顧

- `clone` 一次性；`pull` / `push` 是日常
- `fetch` 先看後合併，比盲目 `pull` 安全
- `-u` 設定上游追蹤，簡化日常指令

[← 回到 README](README.md) | [下一章：分支與 Pull Request](02-branch-pr.md)
