'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const { ShellSession, SessionManager, shellQuote } = require('../../src/shell');
const { tmpDocs } = require('../helpers');

const until = async (fn, ms = 5000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 15));
  }
};
const make = (o = {}) => new ShellSession({ id: 'test-session-1', cwd: tmpDocs(), shell: '/bin/bash', ...o });

test('shellQuote round-trips through a real shell', () => {
  for (const s of ["plain", "with space", "it's", "a'b'c", '$HOME `x` "q" \\n', "日本語 路徑", "*"]) {
    const out = execFileSync('/bin/sh', ['-c', `printf %s ${shellQuote(s)}`]).toString();
    assert.equal(out, s);
  }
});

test('SessionManager.isValidId', () => {
  assert.equal(SessionManager.isValidId('abcdefgh'), true);
  assert.equal(SessionManager.isValidId(SessionManager.newId()), true);
  for (const bad of ['short', '', null, undefined, 'has space 123', '../../etc/x', 'a'.repeat(65), 'semi;colon1']) {
    assert.equal(SessionManager.isValidId(bad), false, String(bad));
  }
});

test('session runs commands and keeps state between them', async (t) => {
  const s = make();
  t.after(() => s.kill());
  s.write('export FOO=bar\r');
  s.write('cd /usr && echo cwd=$(pwd)\r');
  await until(() => s.buffer.includes('cwd=/usr'));
  s.write('echo foo=$FOO\r');
  await until(() => /foo=bar\r?\n/.test(s.buffer));
  s.write('echo still=$(pwd)\r');
  await until(() => /still=\/usr/.test(s.buffer));
});

test('session starts in the requested cwd', async (t) => {
  const cwd = tmpDocs();
  const s = make({ cwd });
  t.after(() => s.kill());
  s.write('echo here=$(pwd)\r');
  await until(() => s.buffer.includes(`here=${cwd}`));
});

test('session sets SHELLBOOK and TERM', async (t) => {
  const s = make();
  t.after(() => s.kill());
  s.write('echo v=$SHELLBOOK/$TERM\r');
  await until(() => s.buffer.includes('v=1/xterm-256color'));
});

test('output buffer is bounded to maxBuffer and keeps the newest data', async (t) => {
  const s = make({ maxBuffer: 2000 });
  t.after(() => s.kill());
  s.write('for i in $(seq 1 400); do echo line-$i; done; echo END-MARK\r');
  await until(() => s.buffer.includes('END-MARK\r\n'));
  assert.ok(s.buffer.length <= 2000);
  assert.ok(!s.buffer.includes('line-1\r\n'));
});

test('emits data and exit; writes after exit are ignored', async () => {
  const s = make();
  let exit = null;
  s.on('exit', (e) => { exit = e; });
  s.write('exit 3\r');
  await until(() => exit);
  assert.equal(exit.code, 3);
  assert.equal(s.exited, true);
  assert.doesNotThrow(() => { s.write('x'); s.resize(10, 10); s.kill(); });
});

test('resize changes the pty size', async (t) => {
  const s = make();
  t.after(() => s.kill());
  s.resize(100, 30);
  s.write('echo size=$(stty size)\r');
  await until(() => s.buffer.includes('size=30 100'));
  s.resize(NaN, -5); // clamped, must not throw
});

test('manager returns the same live session for the same id', async (t) => {
  const m = new SessionManager({ cwd: tmpDocs(), shell: '/bin/bash' });
  t.after(() => m.killAll());
  const a = m.getOrCreate('session-aaaa1');
  const b = m.getOrCreate('session-aaaa1');
  const c = m.getOrCreate('session-bbbb2');
  assert.equal(a.restored, false);
  assert.equal(b.restored, true);
  assert.equal(a.session, b.session);
  assert.notEqual(a.session, c.session);
  assert.equal(m.size, 2);
});

test('manager rejects invalid ids', () => {
  const m = new SessionManager({ cwd: tmpDocs() });
  assert.throws(() => m.getOrCreate('../bad'), /invalid session id/);
});

test('manager drops exited sessions and creates a fresh one next time', async (t) => {
  const m = new SessionManager({ cwd: tmpDocs(), shell: '/bin/bash' });
  t.after(() => m.killAll());
  const { session } = m.getOrCreate('session-exit01');
  session.write('exit\r');
  await until(() => session.exited);
  await until(() => !m.has('session-exit01'));
  const again = m.getOrCreate('session-exit01');
  assert.equal(again.restored, false);
  assert.notEqual(again.session, session);
});

test('manager kills sessions that stay detached past the idle timeout', async (t) => {
  const m = new SessionManager({ cwd: tmpDocs(), shell: '/bin/bash', idleTimeoutMs: 100 });
  t.after(() => m.killAll());
  const { session } = m.getOrCreate('session-idle01');
  const client = {};
  m.attach('session-idle01', client);
  m.detach('session-idle01', client);
  await until(() => session.exited);
});

test('re-attaching before the idle timeout keeps the session alive', async (t) => {
  const m = new SessionManager({ cwd: tmpDocs(), shell: '/bin/bash', idleTimeoutMs: 300 });
  t.after(() => m.killAll());
  const { session } = m.getOrCreate('session-idle02');
  const c1 = {};
  m.attach('session-idle02', c1);
  m.detach('session-idle02', c1);
  m.getOrCreate('session-idle02'); // reconnect clears the timer
  m.attach('session-idle02', {});
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(session.exited, false);
});
