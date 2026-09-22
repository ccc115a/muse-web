// E2E：puppeteer-core 驅系統 Chrome，測 dist/ 靜態站（不含檔案選擇器手勢，見下方手動清單）
// 跑法：npm run test:e2e --workspace=@md-gh/web
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let server, base, browser, page;

function serve() {
  return new Promise((resolve) => {
    server = http
      .createServer((req, res) => {
        const file = path.join(DIST, 'index.html');
        fs.readFile(file, (err, data) => {
          if (err) {
            res.writeHead(500);
            res.end('no dist');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data);
        });
      })
      .listen(0, '127.0.0.1', () => {
        base = `http://127.0.0.1:${server.address().port}/`;
        resolve();
      });
  });
}

before(async () => {
  await serve();
  browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  page = await browser.newPage();
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#tabs .tab') !== null, { timeout: 30000 });
});

after(async () => {
  await browser?.close();
  server?.close();
});

describe('app 啟動', () => {
  it('標題＋未命名分頁＋DEMO 預覽', async () => {
    assert.match(await page.title(), /MD Editor/);
    const tab = await page.$eval('#tabs .tab', (el) => el.textContent);
    assert.match(tab, /untitled\.md/);
    const preview = await page.$eval('#preview', (el) => el.textContent);
    assert.match(preview, /Hello MD Editor/);
  });
});

describe('選單列', () => {
  it('點檔案開下拉，Esc 關閉', async () => {
    await page.click('[data-menu="file"] .menu-title');
    const visible = await page.$eval('[data-menu="file"] .menu-drop', (el) => !el.hidden);
    assert.equal(visible, true);
    await page.keyboard.press('Escape');
    const hidden = await page.$eval('[data-menu="file"] .menu-drop', (el) => el.hidden);
    assert.equal(hidden, true);
  });
  it('四個選單都在', async () => {
    const titles = await page.$$eval('#menubar .menu-title', (els) => els.map((e) => e.textContent));
    assert.deepEqual(titles, ['檔案', '檢視', '專案', '發佈']);
  });
});

describe('編輯→預覽', () => {
  it('打字即時 render（table＋mermaid 佔位）', async () => {
    await page.click('#editor .cm-content');
    await page.keyboard.press('End');
    await page.keyboard.type('\n\n## E2E 標題\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
    await page.waitForFunction(() => document.querySelector('#preview')?.textContent.includes('E2E 標題'), {
      timeout: 10000,
    });
    const hasTable = await page.$eval('#preview', (el) => el.querySelector('table') !== null);
    assert.equal(hasTable, true);
  });
  it('預覽連結不可點（pointer-events none）', async () => {
    const pe = await page.$eval('#preview a', (el) => getComputedStyle(el).pointerEvents);
    assert.equal(pe, 'none');
  });
});

describe('無資料夾時的引導', () => {
  it('發佈提示先開啟資料夾', async () => {
    await page.click('[data-menu="publish"] .menu-title');
    await page.click('#publish-site');
    await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('開啟資料夾'), {
      timeout: 5000,
    });
  });
  it('專案資訊提示先開啟資料夾', async () => {
    await page.click('[data-menu="project"] .menu-title');
    await page.click('#project-info');
    await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('開啟資料夾'), {
      timeout: 5000,
    });
  });
  it('新增檔案提示先開啟資料夾', async () => {
    await page.click('[data-menu="file"] .menu-title');
    await page.click('#new-file');
    await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('開啟資料夾'), {
      timeout: 5000,
    });
  });
});
