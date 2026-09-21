# MD Editor · 顯示與 GitHub 一致的 Markdown 工具（Web + VSCode 插件）

定位：只管「寫＋看得跟 GitHub 一樣」，不管你的 repo。
存檔、git、push 全部在 VSCode／終端機自己做，本工具不碰 GitHub、不存 token、沒有後端。

## 結構

```
packages/core/   # renderer/sanitize/獨立 HTML 匯出 + 測試 + 全語法範例
apps/web/        # Vite 純靜態站：CodeMirror 編輯 + 即時預覽 + 開檔/下載
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
3. terminal 尚未實作。git/push 照樣在 VSCode 自己做。

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
npm test   # core：14 tests（GFM 一致性 + sanitize + export）
```
