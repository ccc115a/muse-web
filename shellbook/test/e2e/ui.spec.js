// Browser e2e (Playwright). Runs against ./examples served by playwright.config.js.
const { test, expect } = require('@playwright/test');
const path = require('path');

const term = (page) => page.locator('.xterm-rows');
const connected = (page) => expect(page.getByTestId('term-status')).toHaveAttribute('data-state', 'open');
const typeInTerminal = async (page, text) => {
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('doc').locator('h1')).toHaveText('shellbook 範例');
  await connected(page);
});

test('renders README.md with runnable and non-runnable code blocks', async ({ page }) => {
  await expect(page.getByTestId('crumb')).toHaveText('README.md');
  await expect(page.getByTestId('shell-block')).toHaveCount(3);
  await expect(page.locator('pre code.language-js')).toBeVisible();
  await expect(page.locator('.run-btn')).toHaveCount(3); // js block has no button
});

test('clicking a link opens the chapter without a page reload; Back returns to README', async ({ page }) => {
  await page.evaluate(() => { window.__marker = 'same-page'; });
  await page.getByRole('link', { name: '第一章：基本指令' }).click();
  await expect(page.getByTestId('doc').locator('h1')).toHaveText('第一章：基本指令');
  await expect(page).toHaveURL(/\?p=01-chapter1\.md/);
  expect(await page.evaluate(() => window.__marker)).toBe('same-page');

  await page.getByTestId('back-btn').click();
  await expect(page.getByTestId('doc').locator('h1')).toHaveText('shellbook 範例');
  await expect(page.getByTestId('crumb')).toHaveText('README.md');
  await expect(page.getByTestId('back-btn')).toBeDisabled();
});

test('browser back/forward buttons work the same way', async ({ page }) => {
  await page.getByRole('link', { name: '第一章：基本指令' }).click();
  await expect(page.getByTestId('crumb')).toHaveText('01-chapter1.md');
  await page.goBack();
  await expect(page.getByTestId('crumb')).toHaveText('README.md');
  await page.goForward();
  await expect(page.getByTestId('crumb')).toHaveText('01-chapter1.md');
});

test('relative links work from a nested document', async ({ page }) => {
  await page.getByRole('link', { name: '子資料夾裡的文件' }).click();
  await expect(page.getByTestId('crumb')).toHaveText('sub/deep.md');
  await page.getByRole('link', { name: '回到上層 README' }).click();
  await expect(page.getByTestId('crumb')).toHaveText('README.md');
});

test('deep link with #fragment scrolls to the heading', async ({ page }) => {
  await page.getByRole('link', { name: '第二章：環境變數' }).click();
  await expect(page.getByTestId('crumb')).toHaveText('02-chapter2.md');
  await expect(page).toHaveURL(/#/);
  await expect(page.locator('h2#保持狀態')).toBeInViewport();
});

test('a missing document shows a helpful message and the list of available files', async ({ page }) => {
  await page.getByRole('link', { name: '不存在的文件' }).click();
  await expect(page.getByTestId('notice')).toContainText('找不到文件');
  await expect(page.getByTestId('notice').getByRole('link', { name: 'README.md' })).toBeVisible();
  await page.getByTestId('back-btn').click();
  await expect(page.getByTestId('crumb')).toHaveText('README.md');
});

test('the Run button sends the block to the terminal and shows its output', async ({ page }) => {
  await page.getByTestId('shell-block').first().getByRole('button', { name: '執行' }).click();
  await expect(term(page)).toContainText('hello from shellbook');
});

test('typing a command directly in the terminal works', async ({ page }) => {
  await typeInTerminal(page, 'echo typed-$((6*7))');
  await expect(term(page)).toContainText('typed-42');
});

test('blocks and typed commands share one continuous shell', async ({ page }) => {
  const blocks = page.getByTestId('shell-block');
  await blocks.nth(1).getByRole('button', { name: '執行' }).click(); // export GREETING
  await typeInTerminal(page, 'echo typed-sees-$GREETING');
  await expect(term(page)).toContainText('typed-sees-你好');
  await blocks.nth(2).getByRole('button', { name: '執行' }).click(); // echo "$GREETING, ..."
  await expect(term(page)).toContainText('你好, examples');
});

test('shell state survives navigating between documents', async ({ page }) => {
  await page.getByTestId('shell-block').nth(1).getByRole('button', { name: '執行' }).click();
  await page.getByRole('link', { name: '第二章：環境變數' }).click();
  await expect(page.getByTestId('crumb')).toHaveText('02-chapter2.md');
  await page.getByTestId('shell-block').getByRole('button', { name: '執行' }).click();
  await expect(term(page)).toContainText('GREETING=你好');
});

test('multi-line blocks run to completion', async ({ page }) => {
  await page.getByRole('link', { name: '第一章：基本指令' }).click();
  await page.getByTestId('shell-block').nth(1).getByRole('button', { name: '執行' }).click();
  for (const n of [1, 2, 3]) await expect(term(page)).toContainText(`line ${n}`);
});

test('reloading the page re-attaches to the same shell', async ({ page }) => {
  await typeInTerminal(page, 'export SURVIVE=yes');
  await typeInTerminal(page, 'echo before-reload');
  await expect(term(page)).toContainText('before-reload');
  await page.reload();
  await connected(page);
  await expect(page.getByTestId('term-status')).toContainText('還原');
  await expect(term(page)).toContainText('before-reload'); // scrollback replayed
  await typeInTerminal(page, 'echo SURVIVE=$SURVIVE');
  await expect(term(page)).toContainText('SURVIVE=yes');
});

test('after `exit`, typing starts a fresh shell', async ({ page }) => {
  await typeInTerminal(page, 'exit');
  await expect(page.getByTestId('term-status')).toContainText('已結束');
  await typeInTerminal(page, 'echo reborn');
  await expect(term(page)).toContainText('reborn');
});

test('the terminal reconnects to the same shell after the websocket drops', async ({ page }) => {
  const sockets = [];
  await page.routeWebSocket(/\/ws\?/, (ws) => { ws.connectToServer(); sockets.push(ws); });
  await page.reload();
  await connected(page);
  await typeInTerminal(page, 'export KEEP=1');
  await typeInTerminal(page, 'echo armed');
  await expect(term(page)).toContainText('armed');
  await sockets[0].close();
  await expect(page.getByTestId('term-status')).toContainText('還原', { timeout: 10_000 });
  await typeInTerminal(page, 'echo KEEP=$KEEP');
  await expect(term(page)).toContainText('KEEP=1');
});

test('folder dialog: browse, pick another folder, doc changes and the shell moves there', async ({ page }) => {
  const sub = path.resolve(__dirname, '..', '..', 'examples', 'sub');
  await page.getByTestId('folder-btn').click();
  await expect(page.getByTestId('folder-dialog')).toBeVisible();
  await page.getByTestId('folder-path-input').fill(sub);
  await page.getByRole('button', { name: '前往' }).click();
  await expect(page.getByTestId('folder-path-input')).toHaveValue(sub);
  await expect(page.locator('#folder-hint')).toContainText('沒有 README.md');
  await page.getByTestId('folder-select').click();
  await expect(page.getByTestId('notice')).toContainText('README.md'); // sub has none → listing
  await expect(page.getByTestId('notice').getByRole('link', { name: 'deep.md' })).toBeVisible();
  await expect(page.getByTestId('folder-btn')).toContainText('sub');
  await typeInTerminal(page, 'echo now-in-$(basename "$PWD")');
  await expect(term(page)).toContainText('now-in-sub');
});

test('folder dialog reports bad paths without closing', async ({ page }) => {
  await page.getByTestId('folder-btn').click();
  await page.getByTestId('folder-path-input').fill('/definitely/not/a/folder');
  await page.getByRole('button', { name: '前往' }).click();
  await expect(page.locator('#folder-hint')).toContainText('資料夾不存在');
  await expect(page.getByTestId('folder-dialog')).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByTestId('folder-dialog')).toBeHidden();
});

test('dragging the divider resizes the terminal', async ({ page }) => {
  const box = () => page.getByTestId('terminal').boundingBox();
  const before = (await box()).height;
  const r = await page.locator('#resizer').boundingBox();
  await page.mouse.move(r.x + r.width / 2, r.y + 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2, r.y - 150, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await box()).height).toBeGreaterThan(before + 80);
});
