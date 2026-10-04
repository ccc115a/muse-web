const { defineConfig, devices } = require('@playwright/test');

const PORT = 4599;
module.exports = defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node bin/shellbook.js examples --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/info`,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
