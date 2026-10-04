'use strict';
const { EventEmitter } = require('events');
const crypto = require('crypto');
const pty = require('@lydell/node-pty');

/** POSIX single-quote escaping: safe to paste into any sh-compatible shell. */
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;
const clamp = (n, lo, hi, dflt) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt);

/** One long-lived pty shell. Output is kept (bounded) so late clients can replay it. */
class ShellSession extends EventEmitter {
  constructor({ id, cwd, shell, cols = 80, rows = 24, maxBuffer = 200_000, env = {} }) {
    super();
    this.id = id;
    this.cwd = cwd;
    this.maxBuffer = maxBuffer;
    this.buffer = '';
    this.exited = false;
    this.exitInfo = null;
    this.pty = pty.spawn(shell || process.env.SHELLBOOK_SHELL || process.env.SHELL || '/bin/bash', [], {
      name: 'xterm-256color',
      cols: clamp(cols, 2, 500, 80),
      rows: clamp(rows, 2, 200, 24),
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', SHELLBOOK: '1', ...env },
    });
    this.pty.onData((data) => {
      this.buffer += data;
      if (this.buffer.length > this.maxBuffer) this.buffer = this.buffer.slice(-this.maxBuffer);
      this.emit('data', data);
    });
    this.pty.onExit(({ exitCode, signal }) => {
      this.exited = true;
      this.exitInfo = { code: exitCode, signal: signal || null };
      this.emit('exit', this.exitInfo);
    });
  }

  write(data) {
    if (!this.exited) this.pty.write(data);
  }

  resize(cols, rows) {
    if (this.exited) return;
    this.pty.resize(clamp(cols, 2, 500, 80), clamp(rows, 2, 200, 24));
  }

  /** SIGHUP first (clean exit); if the shell is still alive shortly after, SIGKILL it. */
  kill() {
    if (this.exited) return;
    const pid = this.pty.pid;
    try { this.pty.kill(); } catch { /* already gone */ }
    const force = setInterval(() => {
      if (this.exited) return clearInterval(force);
      try { process.kill(pid, 'SIGKILL'); } catch { clearInterval(force); }
    }, 300);
    this.once('exit', () => clearInterval(force));
  }
}

/** Keeps sessions alive by id so a browser reload / reconnect lands in the same shell. */
class SessionManager {
  constructor({ cwd, shell, idleTimeoutMs = 30 * 60 * 1000, maxBuffer } = {}) {
    this.cwd = cwd;
    this.shell = shell;
    this.idleTimeoutMs = idleTimeoutMs;
    this.maxBuffer = maxBuffer;
    this.sessions = new Map(); // id -> { session, clients:Set, timer }
    this.closed = false;
  }

  static isValidId(id) {
    return typeof id === 'string' && SESSION_ID.test(id);
  }

  static newId() {
    return crypto.randomBytes(12).toString('base64url');
  }

  has(id) {
    return this.sessions.has(id);
  }

  get size() {
    return this.sessions.size;
  }

  /** @returns {{session: ShellSession, restored: boolean}} */
  getOrCreate(id, { cols, rows } = {}) {
    if (!SessionManager.isValidId(id)) throw new Error('invalid session id');
    if (this.closed) throw new Error('session manager is closed');
    const existing = this.sessions.get(id);
    if (existing && !existing.session.exited) {
      clearTimeout(existing.timer);
      return { session: existing.session, restored: true };
    }
    const session = new ShellSession({ id, cwd: this.cwd, shell: this.shell, cols, rows, maxBuffer: this.maxBuffer });
    const entry = { session, clients: new Set(), timer: null };
    this.sessions.set(id, entry);
    session.once('exit', () => {
      clearTimeout(entry.timer);
      if (this.sessions.get(id) === entry) this.sessions.delete(id);
    });
    return { session, restored: false };
  }

  /** Track attached clients; when the last one leaves, start the idle countdown. */
  attach(id, client) {
    this.sessions.get(id)?.clients.add(client);
  }

  detach(id, client) {
    const entry = this.sessions.get(id);
    if (!entry) return;
    entry.clients.delete(client);
    if (entry.clients.size === 0) {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => entry.session.kill(), this.idleTimeoutMs);
      entry.timer.unref?.();
    }
  }

  killAll() {
    this.closed = true; // a late websocket handshake must not spawn a shell nobody will reap
    for (const { session, timer } of this.sessions.values()) {
      clearTimeout(timer);
      session.kill();
    }
    this.sessions.clear();
  }
}

module.exports = { ShellSession, SessionManager, shellQuote };
