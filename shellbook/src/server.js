'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { resolveInside, PathError } = require('./paths');
const { renderMarkdown, MD_EXT } = require('./markdown');
const { SessionManager, shellQuote } = require('./shell');

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const README = /^readme\.(md|markdown)$/i;
const MAX_INPUT = 1_000_000;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: http:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

const hostnameOf = (hostHeader = '') => {
  const h = hostHeader.trim().toLowerCase();
  return h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0];
};

const hasDotSegment = (rel) => rel.split('/').some((s) => s.startsWith('.') && s !== '.' && s !== '..');
const pkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`));

function createShellbook({ root, shell, allowedHosts = [], idleTimeoutMs, maxBuffer } = {}) {
  let docRoot = fs.realpathSync(path.resolve(root || process.cwd()));
  const allowed = new Set([...LOOPBACK, ...allowedHosts.map((h) => h.toLowerCase())]);
  const sessions = new SessionManager({ cwd: docRoot, shell, idleTimeoutMs, maxBuffer });

  const findReadme = (dir) => {
    try {
      return fs.readdirSync(dir).find((n) => README.test(n) && fs.statSync(path.join(dir, n)).isFile()) || null;
    } catch {
      return null;
    }
  };
  const info = () => ({
    root: docRoot,
    name: path.basename(docRoot) || docRoot,
    entry: findReadme(docRoot),
    cd: `cd -- ${shellQuote(docRoot)}`,
  });
  const existsRel = (rel) => {
    try { return fs.statSync(resolveInside(docRoot, rel).abs).isFile(); } catch { return false; }
  };

  const hostOk = (req) => allowed.has(hostnameOf(req.headers.host));
  const originOk = (req) => {
    const origin = req.headers.origin;
    if (!origin) return true; // non-browser clients
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  };

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!hostOk(req)) return res.status(403).json({ error: 'host not allowed' });
    res.set({ 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/info', (req, res) => res.json(info()));

  app.get('/api/doc', (req, res) => {
    let p = typeof req.query.p === 'string' ? req.query.p : '';
    if (p === '' || p === '.') {
      const entry = findReadme(docRoot);
      if (!entry) throw new PathError('此資料夾沒有 README.md', 404);
      p = entry;
    }
    let { abs, rel } = resolveInside(docRoot, p);
    if (hasDotSegment(rel)) throw new PathError('not found', 404);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      const entry = findReadme(abs);
      if (!entry) throw new PathError('此資料夾沒有 README.md', 404);
      ({ abs, rel } = resolveInside(docRoot, path.posix.join(rel, entry)));
    }
    if (!MD_EXT.test(abs)) throw new PathError('only markdown documents can be rendered', 415);
    if (!fs.existsSync(abs)) throw new PathError(`找不到文件：${rel}`, 404);
    const source = fs.readFileSync(abs, 'utf8');
    const out = renderMarkdown(source, { docPath: rel, exists: existsRel });
    res.json({ path: rel, title: out.title || path.posix.basename(rel), html: out.html, shellBlocks: out.shellBlocks });
  });

  app.get('/api/list', (req, res) => {
    const { abs, rel } = resolveInside(docRoot, typeof req.query.p === 'string' && req.query.p ? req.query.p : '.');
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new PathError('not a folder', 404);
    const entries = fs
      .readdirSync(abs, { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.') && d.name !== 'node_modules')
      .map((d) => ({ name: d.name, type: d.isDirectory() ? 'dir' : MD_EXT.test(d.name) ? 'md' : 'file' }))
      .filter((e) => e.type !== 'file')
      .map((e) => ({ ...e, path: path.posix.join(rel === '' ? '' : rel, e.name) }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'en', { numeric: true }) : a.type === 'dir' ? -1 : 1));
    res.json({ path: rel, entries });
  });

  app.get('/api/file', (req, res) => {
    const { abs, rel } = resolveInside(docRoot, typeof req.query.p === 'string' ? req.query.p : '');
    if (hasDotSegment(rel) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new PathError('not found', 404);
    // sandbox: even if someone opens an svg/html directly it cannot script this origin
    res.set('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
    res.sendFile(abs);
  });

  const expand = (p) => (p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);
  const asDir = (p) => {
    if (typeof p !== 'string' || p === '' || p.includes('\0')) throw new PathError('path is required', 400);
    const abs = path.resolve(expand(p));
    let real;
    try { real = fs.realpathSync(abs); } catch { throw new PathError(`資料夾不存在：${abs}`, 404); }
    if (!fs.statSync(real).isDirectory()) throw new PathError(`不是資料夾：${abs}`, 400);
    return real;
  };

  app.get('/api/browse', (req, res) => {
    const dir = asDir(typeof req.query.path === 'string' && req.query.path ? req.query.path : docRoot);
    let names = [];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      throw new PathError('沒有權限讀取此資料夾', 403);
    }
    const dirs = names
      .filter((d) => !d.name.startsWith('.') && (d.isDirectory() || (d.isSymbolicLink() && safeIsDir(path.join(dir, d.name)))))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const parent = path.dirname(dir);
    res.json({ path: dir, parent: parent === dir ? null : parent, dirs, hasReadme: !!findReadme(dir) });
  });

  app.post('/api/folder', (req, res) => {
    docRoot = asDir(req.body && req.body.path);
    sessions.cwd = docRoot; // future shells start here; running shells are never restarted
    res.json(info());
  });

  app.use('/vendor/xterm', express.static(pkgDir('@xterm/xterm')));
  app.use('/vendor/addon-fit', express.static(pkgDir('@xterm/addon-fit')));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof PathError) return res.status(err.status).json({ error: err.message });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_INPUT * 2 });

  const refuse = (socket, code, text) => {
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws') return socket.destroy();
    if (sessions.closed) return refuse(socket, 503, 'Service Unavailable');
    if (!hostOk(req) || !originOk(req)) return refuse(socket, 403, 'Forbidden');
    const sid = url.searchParams.get('session');
    if (!SessionManager.isValidId(sid)) return refuse(socket, 400, 'Bad Request');
    const cols = Number(url.searchParams.get('cols'));
    const rows = Number(url.searchParams.get('rows'));
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, sid, cols, rows));
  });

  function onConnection(ws, sid, cols, rows) {
    const send = (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
    let current = null;

    const start = () => {
      const { session, restored } = sessions.getOrCreate(sid, { cols, rows });
      const onData = (data) => send({ type: 'output', data });
      const onExit = ({ code, signal }) => {
        send({ type: 'exit', code, signal });
        current = null;
      };
      session.on('data', onData);
      session.once('exit', onExit);
      current = { session, off: () => { session.off('data', onData); session.off('exit', onExit); } };
      sessions.attach(sid, ws);
      send({ type: 'ready', restored });
      if (restored && session.buffer) send({ type: 'output', data: session.buffer, replay: true });
    };
    try {
      start();
    } catch {
      return ws.close(1013, 'server is shutting down');
    }

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return send({ type: 'error', message: 'invalid JSON' }); }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'input') {
        if (typeof msg.data !== 'string' || msg.data.length > MAX_INPUT) return send({ type: 'error', message: 'invalid input' });
        if (!current) {
          try { start(); } catch { return ws.close(1013, 'server is shutting down'); }
        } // shell exited earlier: typing starts a fresh one
        current.session.write(msg.data);
      } else if (msg.type === 'resize') {
        current?.session.resize(Number(msg.cols), Number(msg.rows));
      }
    });

    ws.on('close', () => {
      current?.off();
      sessions.detach(sid, ws);
    });
    ws.on('error', () => {});
  }

  const beat = setInterval(() => wss.clients.forEach((c) => c.ping()), 30_000);
  beat.unref();

  return {
    app, server, wss, sessions,
    getRoot: () => docRoot,
    listen(port = 0, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          const { port: p } = server.address();
          resolve({ port: p, host, url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${p}` });
        });
      });
    },
    close() {
      clearInterval(beat);
      sessions.killAll();
      wss.clients.forEach((c) => c.terminate());
      return new Promise((resolve) => { wss.close(); server.close(() => resolve()); server.closeAllConnections?.(); });
    },
  };
}

function safeIsDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

module.exports = { createShellbook, hostnameOf };
