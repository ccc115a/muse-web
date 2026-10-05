# shellbook

邊讀文件邊執行指令的 Markdown 閱讀器。

- 顯示資料夾中的 `README.md`，點連結（如 `01-chapter1.md`）切換文件，「返回」回到上一頁
- 文件中的 ` ```shell ` 區塊（也支援 `sh` / `bash` / `zsh`）有「執行」按鈕，內容會送進下方終端機
- 終端機也能直接打指令；所有指令都在同一個 shell，換文件、重新整理頁面都不會中斷
- 通訊：WebSocket + pty（`@lydell/node-pty`），前端終端為 xterm.js

## 使用

    npm install
    npm start                         # 書架 ./books（自己選一本）→ http://127.0.0.1:3000
    node bin/shellbook.js <資料夾> [--port 3000] [--host 127.0.0.1]

## 測試

    npm test                          # 單元 + 協定層 e2e（真實 WebSocket/pty）+ jsdom 前端
    npx playwright install chromium
    npm run test:e2e                  # Playwright 瀏覽器 e2e

## 安全

這個程式等於提供一個本機 shell。預設只綁 127.0.0.1，並檢查 Host / Origin。
**不要**對外網開放（`--host 0.0.0.0`），也不要開啟不信任的文件資料夾後按「執行」。
