// UI 接線：漸進式單步 normal-order 化簡（避免 FACT/FIB 等大 trace 卡住）
import { parseProgram, parseSingleExpr } from './lambda/parser.js';
import { pretty, toHtml } from './lambda/pretty.js';
import { stepOnce, expandDefs } from './lambda/reducer.js';
import { clone } from './lambda/ast.js';
import { CHURCH_SRC, CHURCH_GROUPS, tryDecode } from './lambda/church.js';
import { EXAMPLES } from './lambda/examples.js';
import { escapeHtml } from './ui_escape.js';

const $ = (id) => document.getElementById(id);
const srcEl = $('src'), exSel = $('example'), traceEl = $('trace'),
  statusEl = $('status'), errEl = $('error'), counterEl = $('counter'),
  resultEl = $('result'), libEl = $('lib'),
  loadBtn = $('load'), stepBtn = $('step'), autoBtn = $('auto'), resetBtn = $('reset'),
  speedEl = $('speed'), maxEl = $('maxsteps');

let S = null; // { current, count, max, seen, done, timer, playing }

function churchLibMap() {
  const m = new Map();
  for (const [k, src] of Object.entries(CHURCH_SRC)) m.set(k, parseSingleExpr(src));
  return m;
}

function showError(msg) {
  if (!msg) { errEl.hidden = true; errEl.textContent = ''; return; }
  errEl.hidden = false;
  errEl.textContent = msg;
}

function setButtons() {
  const done = !S || S.done;
  stepBtn.disabled = done;
  autoBtn.disabled = done;
  autoBtn.textContent = S?.playing ? '⏸ 暫停' : '▶ 自動播放';
}

function appendStep(exprHtml, label, isAlpha) {
  const li = document.createElement('li');
  li.innerHTML = `<div class="expr">${exprHtml}</div><span class="label${isAlpha ? ' alpha' : ''}">${escapeHtml(label)}</span>`;
  traceEl.appendChild(li);
  li.scrollIntoView({ block: 'nearest' });
  return li;
}

function finish(kind) {
  S.done = true;
  stopAuto();
  const last = S.current;
  const dec = tryDecode(last);
  resultEl.hidden = false;
  const prettyLast = pretty(last);
  resultEl.innerHTML =
    kind === 'normal'
      ? `<b>✓ Normal form</b>（共 ${S.count} 步）：<code>${escapeHtml(prettyLast)}</code>` +
        (dec ? `<br/>${escapeHtml(dec.text)}` : '<br/>（無法解讀為數字/布林——這本身就是答案）')
      : kind === 'loop'
        ? `<b>∞ 偵測到循環</b>（第 ${S.count} 步回到已見過的式子，疑似發散如 Ω）。此項無 normal form。`
        : `<b>… 達到步數上限 ${S.max}</b>。可能需要更大上限（如 FACT/FIB），或此項發散。`;
  statusEl.textContent =
    kind === 'normal' ? `完成：normal form（${S.count} 步）`
    : kind === 'loop' ? `停止：循環/發散（${S.count} 步）`
    : `停止：步數上限（${S.count}/${S.max}）`;
  counterEl.textContent = `Step ${S.count} / 上限 ${S.max}`;
  // 最後一項標示
  const items = traceEl.querySelectorAll('li');
  items.forEach((li) => li.classList.remove('current'));
  if (items.length) items[items.length - 1].classList.add('current');
  setButtons();
}

/** 執行一步：渲染 current（含即將化簡的 redex 高亮）再前進 */
function doStep() {
  if (!S || S.done) return;
  const s = stepOnce(S.current);
  if (!s) { finish('normal'); return; }
  appendStep(toHtml(S.current, s.path), `Step ${S.count} → β: (λ${escapeHtml(s.paramName)}. …) ${escapeHtml(s.argText)}`, false);
  if (s.alphas.length) {
    appendStep(`<span class="alpha">α-轉換：${escapeHtml(s.alphas.join('；'))}</span>`, '(避免變數捕獲的重新命名)', true);
  }
  S.current = s.next;
  S.count++;
  const key = pretty(S.current);
  counterEl.textContent = `Step ${S.count} / 上限 ${S.max}`;
  statusEl.textContent = `化簡中…（第 ${S.count} 步）`;
  if (S.seen.has(key)) {
    appendStep(toHtml(S.current, null), `Step ${S.count}：回到已見過的式子`, false);
    finish('loop');
    return;
  }
  S.seen.add(key);
  if (S.count >= S.max) { finish('limit'); return; }
  const items = traceEl.querySelectorAll('li');
  items.forEach((li) => li.classList.remove('current'));
  if (items.length) items[items.length - 1].classList.add('current');
}

function load() {
  showError('');
  stopAuto();
  traceEl.innerHTML = '';
  resultEl.hidden = true;
  try {
    const prog = parseProgram(srcEl.value);
    if (prog.mains.length === 0) throw new Error('沒有可化簡的運算式（只有定義，沒有主式）');
    const lib = churchLibMap();
    for (const [k, v] of prog.defs) lib.set(k, v); // 使用者定義可覆蓋
    const main = prog.mains[prog.mains.length - 1];
    const start = expandDefs(main, lib);
    const max = Math.max(1, Math.min(10000, parseInt(maxEl.value, 10) || 500));
    S = { current: start, count: 0, max, seen: new Set([pretty(start)]), done: false, playing: false, timer: null };
    statusEl.textContent = '已載入，Step 0（按「單步」或「自動播放」開始）';
    counterEl.textContent = `Step 0 / 上限 ${max}`;
    appendStep(toHtml(start, null), '起始式（library 名稱已展開為純 λ 項）', false);
    setButtons();
  } catch (e) {
    showError(`解析失敗：${e.message}`);
    S = null;
    setButtons();
  }
}

function stopAuto() {
  if (S?.timer) { clearTimeout(S.timer); S.timer = null; }
  if (S) S.playing = false;
  setButtons();
}

function tickAuto() {
  if (!S || !S.playing || S.done) return;
  // 速度 1..10 → 每 tick 1..6 步，每步 render；大數字仍順暢
  const perTick = 1 + Math.floor((parseInt(speedEl.value, 10) || 4) / 2);
  for (let i = 0; i < perTick && !S.done; i++) doStep();
  if (!S.done) {
    const interval = Math.max(30, 600 - (parseInt(speedEl.value, 10) || 4) * 55);
    S.timer = setTimeout(tickAuto, interval);
  }
}

function toggleAuto() {
  if (!S || S.done) return;
  if (S.playing) { stopAuto(); return; }
  S.playing = true;
  setButtons();
  tickAuto();
}

// ---- 範例下拉 ----
function buildExamples() {
  const groups = [...new Set(EXAMPLES.map((e) => e.group))];
  for (const g of groups) {
    const og = document.createElement('optgroup');
    og.label = g;
    for (const e of EXAMPLES.filter((x) => x.group === g)) {
      const o = document.createElement('option');
      o.textContent = e.title;
      o.value = EXAMPLES.indexOf(e);
      og.appendChild(o);
    }
    exSel.appendChild(og);
  }
  exSel.addEventListener('change', () => {
    const e = EXAMPLES[parseInt(exSel.value, 10)];
    if (!e) return;
    srcEl.value = e.code;
    maxEl.value = e.maxSteps;
    load();
    statusEl.textContent = `範例：${e.title} —— ${e.desc}`;
  });
}

// ---- Library 速查 ----
function buildLib() {
  for (const { group, names } of CHURCH_GROUPS) {
    const div = document.createElement('div');
    div.className = 'lib-group';
    const b = document.createElement('b');
    b.textContent = group;
    div.appendChild(b);
    for (const n of names) {
      const btn = document.createElement('button');
      btn.textContent = n;
      btn.title = `${n} = ${CHURCH_SRC[n]}`;
      btn.addEventListener('click', () => {
        const s = srcEl.selectionStart ?? srcEl.value.length;
        const epos = srcEl.selectionEnd ?? s;
        srcEl.value = srcEl.value.slice(0, s) + n + srcEl.value.slice(epos);
        srcEl.focus();
      });
      div.appendChild(btn);
    }
    const def = document.createElement('div');
    def.style.display = 'none';
    div.appendChild(def);
    // hover title 已含定義；另附 details 展開全部
    libEl.appendChild(div);
  }
  const det = document.createElement('details');
  det.innerHTML = `<summary>展開全部定義原始碼</summary><pre>${escapeHtml(
    Object.entries(CHURCH_SRC).map(([k, v]) => `${k} = ${v}`).join('\n')
  )}</pre>`;
  libEl.appendChild(det);
}

loadBtn.addEventListener('click', load);
stepBtn.addEventListener('click', doStep);
autoBtn.addEventListener('click', toggleAuto);
resetBtn.addEventListener('click', load);
srcEl.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') load();
});

buildExamples();
buildLib();
setButtons();
// 預設載入第一個範例的 trace 起點（不展開），讓畫面不空
load();
