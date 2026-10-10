#!/bin/sh
# 啟動純前端網站（靜態檔案伺服器，無證明後端；證明全在瀏覽器執行）
# 開啟 http://127.0.0.1:8080/
cd "$(dirname "$0")" || exit 1
exec node server.mjs
