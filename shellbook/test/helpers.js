'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

function tmpDocs(files = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shellbook-')));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

/** WebSocket client with helpers to wait for output text. */
class Client {
  constructor(url, opts) {
    this.msgs = [];
    this.text = '';
    this.ws = new WebSocket(url, opts);
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      this.msgs.push(m);
      if (m.type === 'output') this.text += m.data;
    });
    this.opened = new Promise((res, rej) => {
      this.ws.once('open', res);
      this.ws.once('error', rej);
      this.ws.once('unexpected-response', (_req, r) => rej(Object.assign(new Error(`HTTP ${r.statusCode}`), { status: r.statusCode })));
    });
  }
  input(data) { this.ws.send(JSON.stringify({ type: 'input', data })); }
  async waitFor(pattern, timeout = 5000) {
    const start = Date.now();
    const ok = () => (pattern instanceof RegExp ? pattern.test(this.text) : this.text.includes(pattern));
    while (!ok()) {
      if (Date.now() - start > timeout) throw new Error(`timeout waiting for ${pattern}; got: ${JSON.stringify(this.text.slice(-300))}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  async waitForMsg(type, timeout = 5000) {
    const start = Date.now();
    while (!this.msgs.some((m) => m.type === type)) {
      if (Date.now() - start > timeout) throw new Error(`timeout waiting for message ${type}`);
      await new Promise((r) => setTimeout(r, 20));
    }
    return this.msgs.find((m) => m.type === type);
  }
  close() {
    return new Promise((res) => {
      if (this.ws.readyState === WebSocket.CLOSED) return res();
      this.ws.once('close', res);
      this.ws.close();
    });
  }
}

module.exports = { tmpDocs, Client };
