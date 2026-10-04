'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createShellbook, hostnameOf } = require('../../src/server');
const { tmpDocs } = require('../helpers');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function setup(t, files) {
  const root = tmpDocs(files);
  const sb = createShellbook({ root, shell: '/bin/bash' });
  const { url, port } = await sb.listen(0);
  t.after(() => sb.close());
  const get = (p, init) => fetch(url + p, init);
  const json = async (p, init) => { const r = await get(p, init); return { status: r.status, body: await r.json(), headers: r.headers }; };
  return { root, sb, url, port, get, json };
}

const DOCS = {
  'README.md': '# Home\n\n[c1](01-chapter1.md)\n\n[gone](gone.md)\n\n![p](pic.png)\n\n```shell\necho hi\n```\n',
  '01-chapter1.md': '# Chapter 1\n\n[back](README.md)\n',
  'sub/deep.md': '# Deep\n\n[up](../README.md)\n',
  'sub/README.md': '# Sub readme\n',
  'notes.txt': 'plain',
  '.secret.md': '# hidden',
  '.git/config': 'x',
};

test('hostnameOf', () => {
  assert.equal(hostnameOf('localhost:3000'), 'localhost');
  assert.equal(hostnameOf('127.0.0.1'), '127.0.0.1');
  assert.equal(hostnameOf('[::1]:80'), '[::1]');
  assert.equal(hostnameOf('Evil.COM:1'), 'evil.com');
  assert.equal(hostnameOf(undefined), '');
});

test('GET /api/info reports folder, entry and a cd command', async (t) => {
  const { json, root } = await setup(t, DOCS);
  const { status, body } = await json('/api/info');
  assert.equal(status, 200);
  assert.equal(body.root, root);
  assert.equal(body.entry, 'README.md');
  assert.equal(body.cd, `cd -- '${root}'`);
});

test('GET /api/info: entry is null without a README and readme.md is found case-insensitively', async (t) => {
  const a = await setup(t, { 'a.md': '#' });
  assert.equal((await a.json('/api/info')).body.entry, null);
  const b = await setup(t, { 'readme.md': '# x' });
  assert.equal((await b.json('/api/info')).body.entry, 'readme.md');
});

test('GET /api/doc without p returns README with rendered shell block', async (t) => {
  const { json } = await setup(t, DOCS);
  const { status, body } = await json('/api/doc');
  assert.equal(status, 200);
  assert.equal(body.path, 'README.md');
  assert.equal(body.title, 'Home');
  assert.equal(body.shellBlocks, 1);
  assert.match(body.html, /data-doc="01-chapter1\.md"/);
  assert.match(body.html, /data-doc="gone\.md" data-hash="" class="missing"/);
  assert.match(body.html, /src="\/api\/file\?p=pic\.png"/);
});

test('GET /api/doc?p= fetches linked chapter and nested docs resolve relative links', async (t) => {
  const { json } = await setup(t, DOCS);
  assert.equal((await json('/api/doc?p=01-chapter1.md')).body.title, 'Chapter 1');
  const deep = await json('/api/doc?p=sub%2Fdeep.md');
  assert.equal(deep.status, 200);
  assert.match(deep.body.html, /data-doc="README\.md"/);
});

test('GET /api/doc on a folder serves that folder README', async (t) => {
  const { json } = await setup(t, DOCS);
  assert.equal((await json('/api/doc?p=sub')).body.path, 'sub/README.md');
});

test('GET /api/doc errors: missing 404, folder without README 404, traversal 403, non-md 415, dotfiles 404', async (t) => {
  const { json } = await setup(t, { ...DOCS, 'empty/x.txt': '1' });
  assert.equal((await json('/api/doc?p=nope.md')).status, 404);
  assert.equal((await json('/api/doc?p=empty')).status, 404);
  assert.equal((await json('/api/doc?p=..%2F..%2Fetc%2Fpasswd')).status, 403);
  assert.equal((await json('/api/doc?p=notes.txt')).status, 415);
  assert.equal((await json('/api/doc?p=.secret.md')).status, 404);
  assert.equal((await json('/api/doc?p=.git%2Fconfig')).status, 404);
});

test('GET /api/doc without README gives a helpful 404', async (t) => {
  const { json } = await setup(t, { 'a.md': '#' });
  const { status, body } = await json('/api/doc');
  assert.equal(status, 404);
  assert.match(body.error, /README\.md/);
});

test('GET /api/doc blocks symlinks pointing outside', async (t) => {
  const outside = tmpDocs({ 'secret.md': '# secret' });
  const { json, root } = await setup(t, DOCS);
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'leak.md'));
  assert.equal((await json('/api/doc?p=leak.md')).status, 403);
});

test('GET /api/list returns dirs first, then md files, hiding dotfiles', async (t) => {
  const { json } = await setup(t, DOCS);
  const { body } = await json('/api/list');
  assert.deepEqual(body.entries.map((e) => e.name), ['sub', '01-chapter1.md', 'README.md']);
  assert.equal((await json('/api/list?p=sub')).body.entries[0].path, 'sub/README.md'.replace('README.md', 'deep.md'));
  assert.equal((await json('/api/list?p=..')).status, 403);
});

test('GET /api/file serves images with a sandbox CSP; refuses dotfiles, traversal, folders', async (t) => {
  const { get, root } = await setup(t, DOCS);
  fs.writeFileSync(path.join(root, 'pic.png'), PNG);
  const ok = await get('/api/file?p=pic.png');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/png');
  assert.match(ok.headers.get('content-security-policy'), /^sandbox/);
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), PNG);
  assert.equal((await get('/api/file?p=.git%2Fconfig')).status, 404);
  assert.equal((await get('/api/file?p=..%2Fx')).status, 403);
  assert.equal((await get('/api/file?p=sub')).status, 404);
  assert.equal((await get('/api/file')).status, 400);
});

test('static: index, app assets and vendored xterm are served', async (t) => {
  const { get } = await setup(t, DOCS);
  assert.match(await (await get('/')).text(), /<title>shellbook<\/title>/);
  assert.equal((await get('/app.js')).status, 200);
  assert.equal((await get('/style.css')).status, 200);
  assert.equal((await get('/vendor/xterm/lib/xterm.js')).status, 200);
  assert.equal((await get('/vendor/xterm/css/xterm.css')).status, 200);
  assert.equal((await get('/vendor/addon-fit/lib/addon-fit.js')).status, 200);
});

test('security headers are set on every response', async (t) => {
  const { get } = await setup(t, DOCS);
  const r = await get('/');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('requests with a foreign Host header are rejected (DNS rebinding)', async (t) => {
  const { port } = await setup(t, DOCS);
  const status = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/api/info', headers: { Host: 'evil.example.com' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(status, 403);
});

test('GET /api/browse lists sub-folders, parent and README hint', async (t) => {
  const { json, root } = await setup(t, DOCS);
  const { status, body } = await json(`/api/browse?path=${encodeURIComponent(root)}`);
  assert.equal(status, 200);
  assert.equal(body.path, root);
  assert.deepEqual(body.dirs, ['sub']); // dotfolders hidden, files ignored
  assert.equal(body.parent, path.dirname(root));
  assert.equal(body.hasReadme, true);
  assert.equal((await json('/api/browse?path=%2F')).body.parent, null);
  assert.equal((await json(`/api/browse?path=${encodeURIComponent(path.join(root, 'nope'))}`)).status, 404);
  assert.equal((await json(`/api/browse?path=${encodeURIComponent(path.join(root, 'notes.txt'))}`)).status, 400);
  assert.equal((await json('/api/browse')).body.path, root); // default: current folder
});

test('POST /api/folder switches the document folder', async (t) => {
  const other = tmpDocs({ 'README.md': '# Other book\n' });
  const { json, sb } = await setup(t, DOCS);
  const post = (body) => json('/api/folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const r = await post({ path: other });
  assert.equal(r.status, 200);
  assert.equal(r.body.root, other);
  assert.equal(r.body.cd, `cd -- '${other}'`);
  assert.equal(sb.getRoot(), other);
  assert.equal((await json('/api/doc')).body.title, 'Other book');
  assert.equal((await json('/api/doc?p=01-chapter1.md')).status, 404); // old docs are gone
});

test('POST /api/folder validates input', async (t) => {
  const { json, root } = await setup(t, DOCS);
  const post = (body, raw) => json('/api/folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify(body) });
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ path: 42 })).status, 400);
  assert.equal((await post({ path: path.join(root, 'missing') })).status, 404);
  assert.equal((await post({ path: path.join(root, 'notes.txt') })).status, 400);
  assert.equal((await post(null, '{bad json')).status, 400);
});

test('POST /api/folder quotes awkward folder names in the cd command', async (t) => {
  const odd = tmpDocs({ "it's a dir/README.md": '#' });
  const { json } = await setup(t, DOCS);
  const r = await json('/api/folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: path.join(odd, "it's a dir") }) });
  assert.match(r.body.cd, /^cd -- '.*it'\\''s a dir'$/);
});
