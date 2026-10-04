(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const docEl = $('doc'), scrollEl = $('doc-scroll'), backBtn = $('back-btn'), crumb = $('crumb');
  const statusEl = $('term-status');

  let root = null; // { root, name, entry, cd }
  let currentPath = null;
  let histIdx = 0;

  /* ───────────── documents ───────────── */

  const api = async (url, opts) => {
    const res = await fetch(url, opts);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { status: res.status });
    return body;
  };

  function updateBack() {
    const atEntry = root && currentPath === root.entry;
    backBtn.disabled = histIdx === 0 && (atEntry || !root);
  }

  function scrollToHash(hash) {
    const el = hash && document.getElementById(decodeURIComponent(hash));
    if (el) el.scrollIntoView(); else scrollEl.scrollTop = 0;
  }

  async function showFolderListing(message) {
    docEl.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'notice';
    box.dataset.testid = 'notice';
    const p = document.createElement('p');
    p.textContent = message;
    box.appendChild(p);
    try {
      const { entries } = await api('/api/list');
      const mds = entries.filter((e) => e.type === 'md');
      if (mds.length) {
        const ul = document.createElement('ul');
        for (const e of mds) {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.textContent = e.name;
          a.href = `/?p=${encodeURIComponent(e.path)}`;
          a.dataset.doc = e.path;
          li.appendChild(a);
          ul.appendChild(li);
        }
        box.appendChild(ul);
      }
    } catch { /* listing is optional */ }
    docEl.appendChild(box);
  }

  /** Load and display a document. `mode`: 'push' | 'replace' | 'none' (popstate). */
  async function loadDoc(p, { mode = 'push', hash = '' } = {}) {
    try {
      const doc = await api(`/api/doc?p=${encodeURIComponent(p || '')}`);
      docEl.innerHTML = doc.html;
      document.title = `${doc.title} · shellbook`;
      currentPath = doc.path;
      crumb.textContent = doc.path;
    } catch (err) {
      currentPath = p || null;
      crumb.textContent = p || '';
      await showFolderListing(err.message);
    }
    const url = `/?p=${encodeURIComponent(currentPath || '')}${hash ? `#${hash}` : ''}`;
    if (mode === 'push') { histIdx += 1; history.pushState({ idx: histIdx }, '', url); }
    else if (mode === 'replace') history.replaceState({ idx: histIdx }, '', url);
    scrollToHash(hash);
    updateBack();
  }

  window.addEventListener('popstate', (e) => {
    histIdx = (e.state && e.state.idx) || 0;
    const q = new URLSearchParams(location.search);
    loadDoc(q.get('p') || '', { mode: 'none', hash: location.hash.slice(1) });
  });

  backBtn.addEventListener('click', () => {
    if (histIdx > 0) history.back();
    else if (root && root.entry) loadDoc(root.entry, { mode: 'replace' });
  });

  docEl.addEventListener('click', (e) => {
    const run = e.target.closest('[data-run]');
    if (run) return runBlock(run);
    const link = e.target.closest('a[data-doc]');
    if (link && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      return loadDoc(link.dataset.doc, { hash: link.dataset.hash || '' });
    }
    const anchor = e.target.closest('a[data-anchor]');
    if (anchor) {
      e.preventDefault();
      const el = document.getElementById(decodeURIComponent(anchor.dataset.anchor));
      if (el) el.scrollIntoView();
    }
  });

  /* ───────────── terminal ───────────── */

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    scrollback: 5000,
    theme: { background: '#101c27', foreground: '#d6e2ea', cursor: '#d6e2ea', selectionBackground: '#2c4a60' },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open($('terminal'));

  const sessionId = (() => {
    let id = sessionStorage.getItem('shellbook.session');
    if (!id) {
      const bytes = crypto.getRandomValues(new Uint8Array(12));
      id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      sessionStorage.setItem('shellbook.session', id);
    }
    return id;
  })();

  let ws = null;
  let retry = 0;

  const setStatus = (state, text) => { statusEl.dataset.state = state; statusEl.textContent = text; };
  const isOpen = () => ws && ws.readyState === WebSocket.OPEN;
  const send = (msg) => isOpen() && ws.send(JSON.stringify(msg));

  function connect() {
    try { fit.fit(); } catch { /* not visible yet */ }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?session=${sessionId}&cols=${term.cols}&rows=${term.rows}`);
    ws.onopen = () => { retry = 0; };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'ready') {
        setStatus('open', msg.restored ? '已連線（還原先前的 shell）' : '已連線');
        if (msg.restored) term.reset();
        send({ type: 'resize', cols: term.cols, rows: term.rows });
      } else if (msg.type === 'output') {
        term.write(msg.data);
      } else if (msg.type === 'exit') {
        setStatus('closed', 'shell 已結束');
        term.write('\r\n\x1b[33m[shell 已結束，按任意鍵啟動新的 shell]\x1b[0m\r\n');
      }
    };
    ws.onclose = () => {
      setStatus('closed', '已斷線，重新連線中…');
      setTimeout(connect, Math.min(5000, 300 * 2 ** retry++));
    };
  }

  term.onData((data) => {
    send({ type: 'input', data });
    if (statusEl.dataset.state === 'closed' && isOpen()) setStatus('open', '已連線');
  });

  function relayout() {
    try { fit.fit(); } catch { return; }
    send({ type: 'resize', cols: term.cols, rows: term.rows });
  }
  new ResizeObserver(relayout).observe($('terminal'));

  function runBlock(btn) {
    const code = btn.closest('.shell-block').querySelector('code[data-shell]').textContent.replace(/\s+$/, '');
    if (!isOpen()) { setStatus('closed', '終端機尚未連線，請稍候再試'); return; }
    send({ type: 'input', data: code.replace(/\r?\n/g, '\r') + '\r' });
    btn.textContent = '已送出';
    btn.classList.add('sent');
    setTimeout(() => { btn.textContent = '執行'; btn.classList.remove('sent'); }, 1200);
    term.focus();
  }

  /* resizer */
  const resizer = $('resizer');
  resizer.addEventListener('pointerdown', (e) => {
    resizer.setPointerCapture(e.pointerId);
    resizer.classList.add('active');
    const move = (ev) => {
      const h = Math.min(window.innerHeight - 160, Math.max(120, window.innerHeight - ev.clientY));
      document.documentElement.style.setProperty('--term-h', `${h}px`);
    };
    const up = () => {
      resizer.classList.remove('active');
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('pointerup', up);
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', up);
  });

  /* ───────────── folder dialog ───────────── */

  const dlg = $('folder-dialog'), pathInput = $('folder-path'), listEl = $('folder-list'), hint = $('folder-hint');
  let browsing = null;

  async function browse(p) {
    try {
      const r = await api(`/api/browse?path=${encodeURIComponent(p || '')}`);
      browsing = r;
      pathInput.value = r.path;
      hint.textContent = r.hasReadme ? '這個資料夾有 README.md' : '這個資料夾沒有 README.md';
      listEl.innerHTML = '';
      const add = (label, target) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.dataset.testid = 'dir-item';
        b.addEventListener('click', () => browse(target));
        li.appendChild(b);
        listEl.appendChild(li);
      };
      if (r.parent) add('..', r.parent);
      for (const d of r.dirs) add(`${d}/`, `${r.path}/${d}`.replace(/\/{2,}/g, '/'));
    } catch (err) {
      hint.textContent = err.message;
    }
  }

  $('folder-btn').addEventListener('click', () => { dlg.showModal(); browse(root ? root.root : ''); });
  $('folder-go').addEventListener('click', () => browse(pathInput.value));
  pathInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); browse(pathInput.value); } });
  $('folder-cancel').addEventListener('click', () => dlg.close());
  $('folder-select').addEventListener('click', async () => {
    if (!browsing) return;
    try {
      root = await api('/api/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: browsing.path }),
      });
    } catch (err) { hint.textContent = err.message; return; }
    dlg.close();
    $('folder-name').textContent = root.name;
    // keep the same shell, just move it: Ctrl-U clears any half-typed line first
    send({ type: 'input', data: `\x15${root.cd}\r` });
    await loadDoc(root.entry || '', { mode: 'push' });
  });

  /* ───────────── boot ───────────── */

  (async function init() {
    try {
      root = await api('/api/info');
    } catch (err) {
      docEl.textContent = `無法連線到 shellbook 伺服器：${err.message}`;
      return;
    }
    $('folder-name').textContent = root.name;
    const q = new URLSearchParams(location.search);
    history.replaceState({ idx: 0 }, '', location.href);
    await loadDoc(q.get('p') || root.entry || '', { mode: 'replace', hash: location.hash.slice(1) });
    connect();
  })();
})();
