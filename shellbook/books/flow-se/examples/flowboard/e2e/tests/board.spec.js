const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // 每個測試前清空：把既有任務逐一刪除
  for (const btn of await page.getByRole("button", { name: /^刪除 / }).all()) {
    await btn.click();
  }
  await expect(page.getByRole("listitem")).toHaveCount(0);
});

test("新增任務後出現在列表", async ({ page }) => {
  await page.getByPlaceholder("輸入新任務…").fill("寫 e2e 測試");
  await page.getByRole("button", { name: "新增" }).click();
  await expect(page.getByText("寫 e2e 測試")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("共 1 項");
});

test("勾選完成會跨重整保留", async ({ page }) => {
  await page.getByPlaceholder("輸入新任務…").fill("持久化檢查");
  await page.getByRole("button", { name: "新增" }).click();
  await page.getByRole("checkbox", { name: "完成 持久化檢查" }).check();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "完成 持久化檢查" })).toBeChecked();
  await expect(page.getByRole("status")).toContainText("未完成 0 項");
});

test("刪除任務", async ({ page }) => {
  await page.getByPlaceholder("輸入新任務…").fill("待刪除");
  await page.getByRole("button", { name: "新增" }).click();
  await page.getByRole("button", { name: "刪除 待刪除" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(0);
});
