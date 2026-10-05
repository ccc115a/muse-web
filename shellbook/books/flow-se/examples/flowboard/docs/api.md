# flowboard API（v1）

Base URL：`http://localhost:3001`

## 健康檢查

`GET /api/health` → `{"status":"ok"}`

## 任務

- `GET /api/tasks` → 任務陣列 `[{"id":1,"title":"...","done":false}]`
- `POST /api/tasks` body `{"title":"..."}` → `201` 新任務（title 空白回 `400`）
- `PATCH /api/tasks/:id` body `{"done":true}` → `200` 更新後任務，找不到回 `404`
- `DELETE /api/tasks/:id` → `204`，找不到回 `404`

## 前端頁面

- `GET /`、`GET /app.js`、`GET /style.css`：前端靜態檔（由後端 serve `FRONTEND_DIR`）
