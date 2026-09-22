# MD Editor · 顯示與 GitHub 一致的 Markdown 工具（Web + VSCode 插件）

定位：只管「寫＋看得跟 GitHub 一樣」，不管你的 repo。
存檔、git、push 全部在 VSCode／終端機自己做，本工具不碰 GitHub、不存 token、沒有後端。

## 結構

```
packages/core/   # renderer/sanitize/獨立 HTML 匯出/站點產生/git 解析 + 測試 + 全語法範例
apps/web/        # Vite 純靜態站：類 VSCode 工作區＋專案資訊＋發佈靜態網站
extensions/vscode-md-gh/  # 側邊預覽 + 匯出獨立 HTML
```

## 顯示支援（與 github.com 一致為目標）

GFM（table / task-list / strikethrough / autolink / footnote / emoji / heading-id）
+ Alert（`> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]`，含標題列）
+ ` ```mermaid `（mermaid@11）
+ TeX（`$..$` / `$$..$$` / ` ```math `，KaTeX；code 區塊裡的 `$` 不會被當數學，跟 GitHub 一樣）
+ fenced code 高亮。範例見 `packages/core/sample/all-in-one.md`。

## Web 版用法（類 VSCode 工作區，可部署到任何靜態主機）

```bash
npm install
npm run dev:web      # http://localhost:5173
npm run build:web    # dist/ 單一 index.html，雙擊也能開
./server.sh [port]   # 本機預覽 dist/
```

1. 按「開啟資料夾」載入本機目錄：左側檔案樹＋分頁編輯，`Ctrl+S` 儲存。
   Chromium（Chrome/Edge）可直接寫回磁碟；Firefox/Safari 走相容模式（唯讀瀏覽＋下載存檔）。
2. `.md` 分頁右側即時預覽（編輯／並排／預覽可切）；右鍵檔名可重新命名／刪除；可新增檔案／資料夾。
3. 按「發佈靜態網站」：選**來源資料夾**（`/` 整個 repo 或任一子目錄）→ 轉成 gh-pages 站點
   （`.md`→同 renderer 的 HTML＋左側導覽，圖片等原樣複製），Chromium 寫入 `<repo>/<siteDir>/` ＋
   `<repo>/.github/workflows/gh-pages.yml`（官方 Pages Action，`enablement: true` 首次自動開通）；
   相容模式改下載 zip。選擇會記回 `.mdeditor.json`（`srcDir`／`siteDir`／`branch`）。
   之後在 VSCode push，到 Actions 看第一次 run 變綠即上線（Source 應為 GitHub Actions）。
   （跳過 `.git`／`node_modules`／隱藏檔／輸出目錄本身；來源內根目錄 `README.md` 自動當首頁。）
4. 若是 git 專案，按「專案資訊」：本機分支／HEAD／最後 commit／remotes（唯讀），
   GitHub 專案再加 repo 簡介＋stars、最近 5 次 Actions 結果、Pages 站點與設定連結（公開 API 免登入）。
5. 「專案設定」開啟 `.mdeditor.json`（`siteDir`／`branch`，不存在自動建，分支預填目前 git 分支），
   發佈流程讀它，不再有 `prompt()` 跳窗；新增／刪除／重新命名改用站內對話框。
6. terminal 尚未實作。git/push 照樣在 VSCode 自己做。

## VSCode 插件用法

```bash
npm run build:webview --workspace=@md-gh/web  # 先產 Webview bundle
npm run package --workspace=vscode-md-gh      # 產 md-gh.vsix
```

安裝 `.vsix` 後：

- `MD: 開啟側邊預覽`：在 `.md` 旁開 Webview（不取代內建預覽），打字即時更新，mermaid＋TeX 顯示跟 GitHub 一致。
- `MD: 匯出獨立 HTML`：產同名 `.html`，放任何主機皆可。

## 測試

```bash
./test.sh  # core 單測（31）＋ web build ＋ e2e（puppeteer 驅系統 Chrome，8 項）＋產物確認
```

e2e 需系統 Chrome（預設 `/Applications/Google Chrome.app`，可用 `CHROME_PATH` 蓋掉）。
檔案選擇器要真人手勢，自動化測不到開資料夾流程，改列手動清單：
開資料夾→開檔→改→Ctrl+S 寫回磁碟→發佈→檢視 GitHub 網站。
