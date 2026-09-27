// app.js — webpy 筆記本 UI (純前端, 零依賴, 跑在主線程; Python 跑在 Worker)
import { AsyncPyodideWorker } from "./AsyncPyodideWorker.js";

const notebookEl = document.getElementById("notebook");
const statusEl = document.getElementById("engineStatus");

const worker = new AsyncPyodideWorker("./pyodide.worker.js");
worker.onStdout = (t) => appendCellLog(activeCellId, t + "\n", false);
worker.onStderr = (t) => appendCellLog(activeCellId, t + "\n", true);
worker.onReady = () => {
  statusEl.textContent = "● 核心就緒 (Pyodide wasm)";
  statusEl.className = "pill ok";
  enableAll(true);
};

let cells = [];       // {id, kind:'code'|'md', src}
let execCount = 0;
let activeCellId = null;
let uid = 0;
const cellOutputs = new Map(); // id -> {text, isErr}

function enableAll(on) {
  document.querySelectorAll("button").forEach((b) => { if (b.id !== "btnLoad") b.disabled = !on; });
}

// ---------- cell 渲染 ----------
function render() {
  notebookEl.innerHTML = "";
  cells.forEach((c, idx) => {
    const div = document.createElement("div");
    div.className = "cell";
    div.dataset.id = c.id;
    const head = document.createElement("div");
    head.className = "cell-head";
    head.innerHTML = `<span class="badge">${c.kind === "code" ? "Code [" + (c.n ?? " ") + "]" : "Markdown"}</span>
      <span>#${idx + 1}</span><span class="spacer"></span>`;
    const mkBtn = (t, title, fn) => {
      const b = document.createElement("button");
      b.className = "icon-btn"; b.textContent = t; b.title = title;
      b.onclick = (e) => { e.stopPropagation(); fn(); };
      return b;
    };
    if (c.kind === "code") head.appendChild(mkBtn("▶", "執行此 cell (Shift+Enter)", () => runCell(c.id)));
    head.appendChild(mkBtn("↑", "上移", () => move(c.id, -1)));
    head.appendChild(mkBtn("↓", "下移", () => move(c.id, 1)));
    head.appendChild(mkBtn("＋", "下方插入 code", () => insertAt(indexOf(c.id) + 1, "code")));
    head.appendChild(mkBtn("✕", "刪除", () => remove(c.id)));
    div.appendChild(head);

    if (c.kind === "code") {
      const ta = document.createElement("textarea");
      ta.className = "code";
      ta.value = c.src;
      ta.placeholder = "# 在此寫 Python, Shift+Enter 執行";
      ta.oninput = () => { c.src = ta.value; autosave(); };
      ta.onkeydown = (e) => {
        if (e.shiftKey && e.key === "Enter") { e.preventDefault(); runCell(c.id); }
      };
      div.appendChild(ta);
      const out = document.createElement("div");
      out.className = "output";
      out.id = "out-" + c.id;
      const buf = cellOutputs.get(c.id);
      if (buf) out.innerHTML = buf.html;
      div.appendChild(out);
    } else {
      const ta = document.createElement("textarea");
      ta.className = "code";
      ta.value = c.src;
      ta.style.minHeight = "60px";
      ta.oninput = () => { c.src = ta.value; view.innerHTML = md(c.src); autosave(); };
      div.appendChild(ta);
      const view = document.createElement("div");
      view.className = "md-view";
      view.innerHTML = md(c.src);
      div.appendChild(view);
    }
    notebookEl.appendChild(div);
  });
}

function md(src) {
  // 極簡 markdown: # ## - `code` **bold** [text](url), 其餘段落化
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return esc(src)
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/^- (.*)$/gm, "<li>$1</li>")
    .replace(/\n\n/g, "<br><br>");
}

const indexOf = (id) => cells.findIndex((c) => c.id === id);
function insertAt(i, kind, src = "") {
  const c = { id: "c" + (++uid), kind, src: src || (kind === "code" ? 'print("Hello webpy 👋")\n' : "# 標題\n用 **Markdown** 寫筆記") };
  cells.splice(i, 0, c);
  render(); autosave();
}
function move(id, d) {
  const i = indexOf(id), j = i + d;
  if (i < 0 || j < 0 || j >= cells.length) return;
  [cells[i], cells[j]] = [cells[j], cells[i]];
  render(); autosave();
}
function remove(id) {
  cells = cells.filter((c) => c.id !== id);
  cellOutputs.delete(id);
  render(); autosave();
}

// ---------- 執行 ----------
function appendCellLog(id, text, isErr) {
  if (!id) return;
  const el = document.getElementById("out-" + id);
  const buf = cellOutputs.get(id) || { html: "" };
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  buf.html += `<span class="${isErr ? "err" : ""}">${esc(text)}</span>`;
  cellOutputs.set(id, buf);
  if (el) { el.innerHTML = buf.html; el.scrollTop = el.scrollHeight; }
}

async function runCell(id) {
  const cell = cells.find((c) => c.id === id);
  if (!cell || cell.kind !== "code") return;
  await worker.ready();
  activeCellId = id;
  cellOutputs.set(id, { html: "" });
  const el = document.getElementById("out-" + id);
  if (el) el.innerHTML = "";
  document.querySelector(`[data-id="${id}"]`)?.classList.add("running");
  const t0 = performance.now();
  try {
    const res = await worker.run(cell.src);
    cell.n = ++execCount;
    if (res !== undefined) {
      const s = typeof res === "string" ? res : JSON.stringify(res, null, 2);
      appendCellLog(id, (s ? "\n→ " + s : "") + `\n[done ${(performance.now() - t0).toFixed(0)}ms]`, false);
    } else {
      appendCellLog(id, `[done ${(performance.now() - t0).toFixed(0)}ms]`, false);
    }
  } catch (e) {
    appendCellLog(id, String(e.message || e), true);
  } finally {
    document.querySelector(`[data-id="${id}"]`)?.classList.remove("running");
    render(); // 更新執行計數, 但保留 output
    const buf = cellOutputs.get(id);
    const el2 = document.getElementById("out-" + id);
    if (el2 && buf) el2.innerHTML = buf.html;
  }
}

async function runAll() {
  for (const c of cells) if (c.kind === "code") await runCell(c.id);
}

// ---------- toolbar ----------
document.getElementById("btnRunAll").onclick = runAll;
document.getElementById("btnAddCode").onclick = () => insertAt(cells.length, "code");
document.getElementById("btnAddMd").onclick = () => insertAt(cells.length, "md");
document.getElementById("btnClear").onclick = () => { cellOutputs.clear(); render(); };
document.getElementById("btnInterrupt").onclick = async () => {
  statusEl.textContent = "重啟核心中…"; statusEl.className = "pill loading";
  await worker.restart();
  statusEl.textContent = "● 核心就緒 (已中斷重啟)"; statusEl.className = "pill ok";
};
document.getElementById("btnRestart").onclick = async () => {
  execCount = 0;
  await worker.restart();
  statusEl.textContent = "● 核心已重啟"; statusEl.className = "pill ok";
};
document.getElementById("btnPkg").onclick = async () => {
  const name = document.getElementById("pkgInput").value.trim();
  if (!name) return;
  statusEl.textContent = `安裝 ${name} 中…`; statusEl.className = "pill loading";
  try { await worker.pipInstall(name); statusEl.textContent = `● ${name} 安裝完成`; }
  catch (e) { statusEl.textContent = "安裝失敗: " + e.message; }
  statusEl.className = "pill ok";
};
document.getElementById("btnSave").onclick = () => {
  const blob = new Blob([JSON.stringify({ app: "webpy", cells }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "notebook.webpy.json"; a.click();
  localStorage.setItem("webpy-autosave", JSON.stringify(cells));
};
document.getElementById("btnLoad").onclick = () => document.getElementById("fileInput").click();
document.getElementById("fileInput").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    cells = data.cells || data;
    uid = cells.length + 1;
    render();
  } catch { alert("檔案格式錯誤"); }
};

function autosave() {
  try { localStorage.setItem("webpy-autosave", JSON.stringify(cells)); } catch {}
}

// ---------- 預設範例 ----------
function defaultCells() {
  const saved = localStorage.getItem("webpy-autosave");
  if (saved) { try { const c = JSON.parse(saved); if (Array.isArray(c) && c.length) { uid = c.length + 1; return c; } } catch {} }
  uid = 0;
  return [
    { id: "c" + (++uid), kind: "md", src: "# 🐍 webpy 範例筆記本\n完整 Python 語法 (Pyodide wasm) · **Shift+Enter** 執行 cell" },
    { id: "c" + (++uid), kind: "code", src: 'import sys\nprint(sys.version)\n\n# 列表推導 / f-string / decorator 都支援\ndef double(fn):\n    return lambda *a, **k: fn(*a, **k) * 2\n\n@double\ndef add(a, b):\n    return a + b\n\nprint(add(3, 4))\nprint([x*x for x in range(10) if x % 2 == 0])' },
    { id: "c" + (++uid), kind: "code", src: '# JS 變數可經 context 注入, 這裡示範回傳 dict 給 JS\n{"sum": sum(range(1, 10001)), "status": "ok"}' },
    { id: "c" + (++uid), kind: "code", src: '# 重度運算測試: 跑在 Worker, 左上 spinner 應持續旋轉不卡頓\nimport time\nt0 = time.time()\ntotal = sum(i * 3 for i in range(1, 1_000_001))\nprint(f"done in {time.time()-t0:.2f}s")\ntotal' },
  ];
}

enableAll(false);
cells = defaultCells();
render();
