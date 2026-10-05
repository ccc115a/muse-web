// @ts-check
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  // 書中會先手動啟動後端；這裡也支援自動拉起（CI 用）
  webServer: process.env.NO_WEBSERVER
    ? undefined
    : {
        command: "../backend/target/release/flowboard",
        url: "http://localhost:3001/api/health",
        reuseExistingServer: true,
        env: {
          PORT: "3001",
          FRONTEND_DIR: "../frontend/dist",
          DATA_FILE: "e2e-tasks.json",
          PATH: process.env.PATH,
        },
      },
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3001",
    trace: "on-first-retry",
  },
});
