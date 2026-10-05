# Docker 軟體工程實務

這是一份可以「邊讀邊執行」的文件。按下程式碼區塊右上角的 **執行**，指令就會送進下方的終端機。

**同一個 shell 不會中斷**：前一步 `cd` 過的目錄、設定的變數，下一步都還在。所以全書的指令要**依照順序執行**，就能走完一條完整的容器化交付流水線。

Docker 在軟體工程中解決的核心問題是「**在我機器上可以跑**」：

- **環境一致性**：應用程式連同依賴打包成 image，開發/測試/正式環境完全相同
- **隔離**：每個容器互不干擾，不再互相搶 port、搶版本
- **交付單位**：image 是可版本化的交付產物，配合 registry 做發布
- **組合**：Docker Compose 把 app + 資料庫 + 快取一次拉起
- **CI/CD 基石**：現代部署流程幾乎都以「build image → push → deploy」為骨架

本書用一個範例專案 `demo-app`（位於 `/tmp/demo-docker`）走完整流程。所有指令都能真正執行；需要網路拉 image 或登入 registry 的步驟會自動偵測——可行就真的執行，不行就優雅跳過，流程不會中斷。

## 章節

- [第一章：容器基礎](01-basics.md)
- [第二章：寫 Dockerfile、建置 image](02-image.md)
- [第三章：Volume 與 Network](03-volumes-networks.md)
- [第四章：Docker Compose 多容器編排](04-compose.md)
- [第五章：完整專案容器化實例](05-project-demo.md)

## 環境檢查（先執行這些）

確認 Docker 已安裝且 daemon 在跑，結果存進 `DOCKER_OK` 變數，後面章節都會用到：

```shell
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  export DOCKER_OK=yes
else
  export DOCKER_OK=no
fi
echo "DOCKER_OK=$DOCKER_OK"
```

如果 daemon 沒跑，先啟動（macOS 用 Docker Desktop）：

```shell
[ "$DOCKER_OK" = no ] && open -a Docker && echo "請等 Docker Desktop 啟動後再執行一次上面的檢查" || echo "Docker 已就緒"
```

[← 回到 shellbook 首頁](../../README.md)
