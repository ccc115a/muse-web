'use strict';
// Runs the real public/app.js against a real server inside jsdom.
// xterm.js itself is replaced by a tiny recorder (it needs a real browser); everything else is real:
// fetch -> /api/*, WebSocket -> /ws, pty shell.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { createShellbook } = require('../../src/server');
const { tmpDocs } = require('../helpers');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const wait = async (fn, label, ms = 5000) => {
  const t = Date.now();
  for (;;) {
    try { const v = fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() - t > ms) throw new Error(`timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};

async function openApp(t, files) {
  const sb = createShellbook({ root: tmpDocs(files), shell: '/bin/bash' });
  const { url } = await sb.listen(0);
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: `${url}/`, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.fetch = (u, o) => fetch(new URL(u, url), o);
  w.ResizeObserver = class { observe() {} };
  w.crypto.getRandomValues = (a) => require('crypto').randomFillSync(a);
  w.__terms = [];
  w.Terminal = class {
    constructor() { this.cols = 80; this.rows = 24; this.output = ''; w.__terms.push(this); }
    loadAddon() {} open() {} focus() {}
    reset() { this.output = ''; }
    write(d) { this.output += d; }
    onData(cb) { this.type = cb; }
  };
  w.FitAddon = { FitAddon: class { fit() {} } };
  w.eval(fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8'));
  t.after(async () => { w.close(); await sb.close(); });
  const $ = (sel) => w.document.querySelector(sel);
  await wait(() => $('#term-status').dataset.state === 'open', 'terminal connected'); // no handshake left in flight at teardown
  return { w, $, sb, term: () => w.__terms[0] };
}

const DOCS = {
  'README.md': '# Home\n\n[chapter one](01.md)\n\n```shell\nexport V=from-block\necho "$V"\n```\n',
  '01.md': '# One\n\n[back to README](README.md)\n\n```sh\necho chapter-one-ran\n```\n',
};

test('frontend: renders README, navigates to a chapter and back', async (t) => {
  const { w, $ } = await openApp(t, DOCS);
  await wait(() => $('#doc h1')?.textContent === 'Home', 'README rendered');
  assert.equal($('#crumb').textContent, 'README.md');
  assert.equal($('#back-btn').disabled, true);

  $('#doc a[data-doc="01.md"]').click();
  await wait(() => $('#doc h1')?.textContent === 'One', 'chapter rendered');
  assert.equal($('#crumb').textContent, '01.md');
  assert.equal(w.location.search, '?p=01.md');
  assert.equal($('#back-btn').disabled, false);

  $('#back-btn').click(); // history.back()
  await wait(() => $('#doc h1')?.textContent === 'Home', 'back to README');
  assert.equal($('#crumb').textContent, 'README.md');
  assert.equal($('#back-btn').disabled, true);
});

test('frontend: in-document link back to README pushes history and back returns to the chapter', async (t) => {
  const { $ } = await openApp(t, DOCS);
  await wait(() => $('#doc h1')?.textContent === 'Home', 'README');
  $('#doc a[data-doc="01.md"]').click();
  await wait(() => $('#doc h1')?.textContent === 'One', 'chapter');
  $('#doc a[data-doc="README.md"]').click();
  await wait(() => $('#doc h1')?.textContent === 'Home', 'README again');
  $('#back-btn').click();
  await wait(() => $('#doc h1')?.textContent === 'One', 'back to chapter');
});

test('frontend: Run button sends the block to the shell and typing in the terminal works, same shell', async (t) => {
  const { $, term } = await openApp(t, DOCS);
  await wait(() => $('#term-status').dataset.state === 'open', 'ws open');
  await wait(() => $('#doc .run-btn'), 'run button');

  $('#doc .run-btn').click();
  assert.equal($('#doc .run-btn').textContent, '已送出');
  await wait(() => /from-block/.test(term().output.replace(/echo "\$V"/, '')), 'block output');

  term().type('echo typed-$V\r'); // user types straight into xterm
  await wait(() => /typed-from-block/.test(term().output), 'typed command sees block state');
});

test('frontend: shell survives navigation between documents', async (t) => {
  const { $, term } = await openApp(t, DOCS);
  await wait(() => $('#term-status').dataset.state === 'open', 'ws open');
  await wait(() => $('#doc .run-btn'), 'run button');
  $('#doc .run-btn').click();
  await wait(() => /from-block/.test(term().output), 'first run');
  $('#doc a[data-doc="01.md"]').click();
  await wait(() => $('#doc h1')?.textContent === 'One', 'chapter');
  $('#doc .run-btn').click();
  await wait(() => /chapter-one-ran/.test(term().output), 'second run');
  term().type('echo V=$V\r');
  await wait(() => /V=from-block/.test(term().output), 'variable from README still set');
});

test('frontend: missing document shows a message with available files', async (t) => {
  const { $ } = await openApp(t, { ...DOCS, 'README.md': '# Home\n\n[x](gone.md)\n' });
  await wait(() => $('#doc a[data-doc="gone.md"]'), 'link');
  assert.ok($('#doc a.missing'));
  $('#doc a[data-doc="gone.md"]').click();
  await wait(() => $('[data-testid="notice"]'), 'notice');
  assert.match($('[data-testid="notice"]').textContent, /gone\.md/);
  assert.ok($('[data-testid="notice"] a[data-doc="README.md"]'));
});

test('frontend: folder without README lists markdown files', async (t) => {
  const { $ } = await openApp(t, { 'a.md': '# a' });
  await wait(() => $('[data-testid="notice"]'), 'notice');
  assert.match($('[data-testid="notice"]').textContent, /README\.md/);
  assert.ok($('[data-testid="notice"] a[data-doc="a.md"]'));
});

test('frontend: the shell session id is stable for the tab (reload re-attaches)', async (t) => {
  const { w, $ } = await openApp(t, DOCS);
  await wait(() => $('#term-status').dataset.state === 'open', 'ws open');
  const id = w.sessionStorage.getItem('shellbook.session');
  assert.match(id, /^[A-Za-z0-9_-]{8,64}$/);
});
