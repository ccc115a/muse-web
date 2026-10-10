// Mini-Lean frontend: everything runs locally in the browser.
// The kernel/tactics are imported as ES modules (no backend, no bundling).
import { checkSource, freshEnv } from './src/lean.mjs';

const $ = (id) => document.getElementById(id);
const editor = $('editor'), output = $('output'), status = $('status'),
  stat = $('stat'), exampleSel = $('example');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function setStatus(s) { status.textContent = s; }

// ---- hash share (base64url of UTF-8) ---------------------------------------
function srcToHash(src) {
  const b = btoa(String.fromCharCode(...new TextEncoder().encode(src)));
  return '#s=' + b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function hashToSrc() {
  const m = location.hash.match(/^#s=([A-Za-z0-9\-_]+)$/);
  if (!m) return null;
  try {
    const b = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch { return null; }
}

// ---- examples manifest -------------------------------------------------------
let manifest = { files: [], descriptions: {} };
async function loadManifest() {
  const res = await fetch('examples/manifest.json');
  if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
  manifest = await res.json();
  exampleSel.innerHTML = '';
  for (const f of manifest.files) {
    const o = document.createElement('option');
    o.value = f;
    o.textContent = `${f} — ${manifest.descriptions?.[f] ?? ''}`;
    exampleSel.appendChild(o);
  }
}
async function loadExample(name) {
  setStatus(`載入 ${name}…`);
  const res = await fetch('examples/' + name);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  editor.value = await res.text();
  history.replaceState(null, '', location.pathname);
  setStatus('就緒');
  run();
}

// ---- run ---------------------------------------------------------------------
function renderGoals(goals) {
  if (!goals.length) return '<p class="ok-line">✓ 無剩餘子目標</p>';
  return goals.map((g) => {
    const hs = g.hyps.length
      ? g.hyps.map((h) => `<div class="hyp"><span class="nm">${esc(h.name)}</span> : ${esc(h.type)}</div>`).join('')
      : '<div class="hyp dim">（無假設）</div>';
    return `<div class="goal"><div class="tag">[${esc(g.tag)}]</div>${hs}<div class="tgt">⊢ ${esc(g.target)}</div></div>`;
  }).join('');
}

function run() {
  const src = editor.value;
  if (!src.trim()) {
    output.innerHTML = '<p class="dim">編輯器是空的。</p>';
    return;
  }
  const t0 = performance.now();
  setStatus('檢查中…');
  let r;
  try {
    r = checkSource(src, { filename: 'editor' });
  } catch (e) {
    output.innerHTML = `<div class="card fail"><b>內部錯誤</b><pre>${esc(e.stack ?? e.message)}</pre></div>`;
    setStatus('錯誤');
    return;
  }
  const ms = (performance.now() - t0).toFixed(1);
  stat.textContent = `耗時 ${ms} ms`;
  const cards = [];
  if (r.ok) {
    cards.push(`<div class="card ok"><b>✓ 全部通過</b>（${r.declResults.length} 個宣告，${ms} ms）${r.hasSorry ? ' — <span class="warn">含 sorry</span>' : ''}</div>`);
  } else {
    cards.push(`<div class="card fail"><b>✗ 失敗</b><pre>${esc(r.errors.join('\n'))}</pre></div>`);
  }
  for (const w of r.warnings) cards.push(`<div class="card warn">⚠ ${esc(w)}</div>`);
  for (const m of r.messages) cards.push(`<div class="card msg"><code>${esc(m.cmd)}</code> <span class="dim">line ${m.line}</span><pre>${esc(m.text)}</pre></div>`);
  for (const d of r.declResults) {
    const ax = d.axioms?.length ? `<div class="dim">uses axioms: ${esc(d.axioms.join(', '))}</div>` : '';
    const head = d.ok
      ? `<span class="ok-line">✓</span> <code>${esc(d.kw)} ${esc(d.name)}</code> <span class="dim">(${d.ms} ms)</span>${ax}`
      : `<span class="fail-line">✗</span> <code>${esc(d.kw)} ${esc(d.name)}</code>`;
    let body = '';
    if (d.ok && d.trace?.length) {
      const steps = d.trace.map((t, i) =>
        `<details${i === d.trace.length - 1 ? ' open' : ''}><summary>${esc(t.label)}</summary>${renderGoals(t.goals)}</details>`).join('');
      body = `<div class="trace">${steps}</div>
        ${d.proof ? `<details><summary>proof term</summary><pre>${esc(d.proof)}</pre></details>` : ''}`;
    }
    cards.push(`<div class="card decl">${head}${body}</div>`);
  }
  output.innerHTML = cards.join('');
  setStatus(r.ok ? '通過 ✓' : '失敗 ✗');
}

// ---- wire up -------------------------------------------------------------------
$('run').addEventListener('click', run);
$('clear').addEventListener('click', () => { output.innerHTML = '<p class="dim">已清空。</p>'; });
$('load').addEventListener('click', () => loadExample(exampleSel.value).catch((e) => {
  output.innerHTML = `<div class="card fail"><b>載入失敗</b><pre>${esc(e.message)}\n請改用靜態伺服器開啟（npm run serve），瀏覽器不允許 file:// 下 fetch 本地檔。</pre></div>`;
}));
exampleSel.addEventListener('change', () => $('load').click());
$('share').addEventListener('click', async () => {
  location.hash = srcToHash(editor.value);
  try {
    await navigator.clipboard.writeText(location.href);
    setStatus('連結已複製到剪貼簿 ✓');
  } catch { setStatus('連結已放入網址列'); }
});
editor.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = editor.selectionStart;
    editor.setRangeText('  ', s, editor.selectionEnd, 'end');
  }
});

(async () => {
  const shared = hashToSrc();
  try {
    await loadManifest();
    stat.textContent = `kernel 預載完成（prelude 常數 ${freshEnv().names().length} 個）`;
    if (shared !== null) {
      editor.value = shared;
      setStatus('已從連結載入');
      run();
    } else if (manifest.files.length) {
      await loadExample(manifest.files[0]);
    }
  } catch (e) {
    output.innerHTML = `<div class="card fail"><b>初始化失敗</b><pre>${esc(e.message)}\n請用靜態伺服器開啟本頁：npm run serve，然後瀏覽 http://127.0.0.1:8080/ 。</pre></div>`;
    setStatus('錯誤');
  }
})();
