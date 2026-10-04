'use strict';
// End-to-end over real HTTP + real WebSocket + real pty shells (no browser needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createShellbook } = require('../../src/server');
const { tmpDocs, Client } = require('../helpers');

async function boot(t, files = { 'README.md': '# Hi\n\n```shell\necho from-block\n```\n' }, opts = {}) {
  const sb = createShellbook({ root: tmpDocs(files), shell: '/bin/bash', ...opts });
  const { url, port } = await sb.listen(0);
  t.after(() => sb.close());
  const wsUrl = (sid = 'session-0001', extra = '') => `ws://127.0.0.1:${port}/ws?session=${sid}${extra}`;
  return { sb, url, port, wsUrl };
}
const connect = async (t, url, opts) => {
  const c = new Client(url, opts);
  t.after(() => c.close());
  await c.opened;
  return c;
};

test('connect → ready → run a command → get output', async (t) => {
  const { wsUrl } = await boot(t);
  const c = await connect(t, wsUrl());
  assert.deepEqual((await c.waitForMsg('ready')).restored, false);
  c.input('echo $((20+22))\r');
  await c.waitFor(/[\r\n]42\r\n/);
});

test('shell is continuous: variables, cwd and functions survive across many commands', async (t) => {
  const { wsUrl } = await boot(t);
  const c = await connect(t, wsUrl());
  c.input('export NAME=shellbook\r');
  c.input('cd /usr\r');
  c.input('greet() { echo "hi $NAME in $(pwd)"; }\r');
  c.input('greet\r');
  await c.waitFor('hi shellbook in /usr');
});

test('the shell starts inside the document folder', async (t) => {
  const { wsUrl, sb } = await boot(t);
  const c = await connect(t, wsUrl());
  c.input('echo cwd=$(pwd)\r');
  await c.waitFor(`cwd=${sb.getRoot()}`);
});

test('reconnecting with the same session restores the same shell and its output', async (t) => {
  const { wsUrl } = await boot(t);
  const first = await connect(t, wsUrl('session-keep01'));
  first.input('export KEEP=alive; echo marker-one\r');
  await first.waitFor('marker-one');
  await first.close();

  const second = await connect(t, wsUrl('session-keep01'));
  const ready = await second.waitForMsg('ready');
  assert.equal(ready.restored, true);
  await second.waitFor('marker-one'); // scrollback replay
  assert.ok(second.msgs.find((m) => m.type === 'output' && m.replay));
  second.input('echo KEEP=$KEEP\r');
  await second.waitFor('KEEP=alive'); // same process, same variables
});

test('different session ids get isolated shells', async (t) => {
  const { wsUrl } = await boot(t);
  const a = await connect(t, wsUrl('session-aaaa01'));
  const b = await connect(t, wsUrl('session-bbbb02'));
  a.input('export WHO=a\r');
  b.input('echo who=[$WHO]\r');
  await b.waitFor('who=[]');
});

test('two tabs on one session both see the output', async (t) => {
  const { wsUrl } = await boot(t);
  const a = await connect(t, wsUrl('session-share01'));
  const b = await connect(t, wsUrl('session-share01'));
  a.input('echo broadcast-xyz\r');
  await a.waitFor('broadcast-xyz');
  await b.waitFor('broadcast-xyz');
});

test('running a markdown shell block end-to-end: fetch doc → extract block → send to terminal', async (t) => {
  const files = { 'README.md': '# Hi\n\n```shell\nX=7\necho "block says $((X*6))"\n```\n' };
  const { url, wsUrl } = await boot(t, files);
  const { html } = await (await fetch(`${url}/api/doc`)).json();
  const code = html.match(/<code data-shell>([\s\S]*?)<\/code>/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const c = await connect(t, wsUrl());
  c.input(code.trimEnd().replace(/\n/g, '\r') + '\r'); // exactly what the Run button does
  await c.waitFor('block says 42');
});

test('block output and hand-typed commands share the same shell', async (t) => {
  const { wsUrl } = await boot(t);
  const c = await connect(t, wsUrl());
  c.input('export STEP=one\r');          // from a "block"
  c.input('echo typed-$STEP\r');         // typed by hand
  await c.waitFor('typed-one');
});

test('exit then typing again starts a brand-new shell on the same connection', async (t) => {
  const { wsUrl } = await boot(t);
  const c = await connect(t, wsUrl('session-exit001'));
  c.input('export OLD=1; exit 5\r');
  const exit = await c.waitForMsg('exit');
  assert.equal(exit.code, 5);
  c.input('echo fresh=[$OLD]\r');
  await c.waitFor('fresh=[]');
});

test('resize message updates the pty size', async (t) => {
  const { wsUrl } = await boot(t);
  const c = await connect(t, wsUrl());
  c.ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 33 }));
  await new Promise((r) => setTimeout(r, 100));
  c.input('echo S=$(stty size)\r');
  await c.waitFor('S=33 120');
});

test('initial size can be passed in the URL', async (t) => {
  const { wsUrl } = await boot(t);
  const c = await connect(t, wsUrl('session-size001', '&cols=90&rows=20'));
  c.input('echo S=$(stty size)\r');
  await c.waitFor('S=20 90');
});

test('malformed or oversized messages do not crash the server', async (t) => {
  const { wsUrl } = await boot(t);
  const c = await connect(t, wsUrl());
  c.ws.send('not json');
  c.ws.send(JSON.stringify({ type: 'input', data: 123 }));
  c.ws.send(JSON.stringify({ type: 'nope' }));
  c.ws.send('null');
  await c.waitForMsg('error');
  c.input('echo still-alive\r');
  await c.waitFor('still-alive');
});

test('handshake: bad session id → 400, wrong path never upgrades', async (t) => {
  const { wsUrl, port } = await boot(t);
  await assert.rejects(connect(t, wsUrl('../../etc')), (e) => e.status === 400);
  await assert.rejects(connect(t, wsUrl('short')), (e) => e.status === 400);
  const wrong = new Client(`ws://127.0.0.1:${port}/other?session=session-0001`);
  await assert.rejects(wrong.opened);
});

test('handshake: cross-site Origin is refused, same-origin Origin is accepted', async (t) => {
  const { wsUrl, port } = await boot(t);
  await assert.rejects(connect(t, wsUrl(), { headers: { Origin: 'https://evil.example' } }), (e) => e.status === 403);
  await assert.rejects(connect(t, wsUrl(), { headers: { Origin: 'http://localhost:1' } }), (e) => e.status === 403);
  const ok = await connect(t, wsUrl('session-origin01'), { headers: { Origin: `http://127.0.0.1:${port}` } });
  await ok.waitForMsg('ready');
});

test('handshake: foreign Host header is refused', async (t) => {
  const { wsUrl } = await boot(t);
  await assert.rejects(connect(t, wsUrl(), { headers: { Host: 'evil.example.com' } }), (e) => e.status === 403);
});

test('folder switch: new documents are served, existing shell keeps running', async (t) => {
  const other = tmpDocs({ 'README.md': '# Second book\n' });
  const { url, wsUrl } = await boot(t);
  const c = await connect(t, wsUrl('session-switch01'));
  c.input('export BEFORE=yes\r');
  const info = await (await fetch(`${url}/api/folder`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: other }) })).json();
  c.input(`\x15${info.cd}\r`); // what the browser sends after switching
  c.input('echo now=$(pwd) before=$BEFORE\r');
  await c.waitFor(`now=${other} before=yes`);
  assert.equal((await (await fetch(`${url}/api/doc`)).json()).title, 'Second book');
});

test('closing the server terminates shells', async () => {
  const sb = createShellbook({ root: tmpDocs({ 'README.md': '#' }), shell: '/bin/bash' });
  const { port } = await sb.listen(0);
  const c = new Client(`ws://127.0.0.1:${port}/ws?session=session-close01`);
  await c.opened;
  await c.waitForMsg('ready');
  const { session } = sb.sessions.getOrCreate('session-close01');
  await sb.close();
  const t0 = Date.now();
  while (!session.exited && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 20));
  assert.equal(session.exited, true);
});

test('no shell can be spawned after close() (late handshake is refused)', async () => {
  const sb = createShellbook({ root: tmpDocs({ 'README.md': '#' }), shell: '/bin/bash' });
  const { port } = await sb.listen(0);
  assert.throws(() => { sb.sessions.killAll(); sb.sessions.getOrCreate('session-late001'); }, /closed/);
  const c = new Client(`ws://127.0.0.1:${port}/ws?session=session-late002`);
  await assert.rejects(c.opened, (e) => e.status === 503);
  await sb.close();
  assert.equal(sb.sessions.size, 0);
});
