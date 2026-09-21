import { createEditor } from './editor.js';
import { renderPreview } from './preview.js';
import { exportMarkdownToHtml } from '@md-gh/core';
import {
  NATIVE,
  isTextName,
  pickDirectoryNative,
  pickDirectoryFallback,
  loadChildren,
  readNodeText,
  writeNodeText,
} from './fs.js';

const $ = (id) => document.getElementById(id);
const status = (t) => ($('status').textContent = t);
const previewEl = $('preview');
const treeEl = $('tree');
const tabsEl = $('tabs');
const workarea = $('workarea');

const mdView = { mode: 'split' };
let root = null; // 資料夾根節點
let tabs = []; // [{ node|null, title, content, saved, dirty }]
let activeIdx = -1;
let switching = false;

const DEMO = `# Hello MD Editor\n\n> [!NOTE]\n> 開啟左側資料夾，或直接在這裡編輯。顯示與 github.com 一致。\n\n| 功能 | 狀態 |\n|---|:---:|\n| table | ✅ |\n| mermaid | ✅ |\n| tex | ✅ |\n\n- [x] 資料夾＋檔案樹＋分頁\n- [ ] terminal（尚未實作）\n\n\`\`\`mermaid\ngraph TD;A[編輯]-->B[預覽];B-->C[儲存];\n\`\`\`\n\n行內 $E=mc^2$，獨立：\n\n$$\nx = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n$$\n\n\`\`\`js\nconst price = "$99"; // code 裡的 $ 不是數學\n\`\`\`\n`;

const isMd = (name) => /\.md$/i.test(name ?? '');

// ---------- Editor（單一 CodeMirror，隨分頁切換內容）----------

const editor = createEditor($('editor'), {
  initial: '',
  onChange: (v) => {
    if (switching || activeIdx < 0) return;
    const t = tabs[activeIdx];
    t.content = v;
    setDirty(t, v !== t.saved);
    if (isMd(t.title)) renderPreview(previewEl, v);
  },
});

function setDirty(t, d) {
  t.dirty = d;
  renderTabs();
}

function syncEditorToTab() {
  switching = true;
  const t = tabs[activeIdx];
  editor.value = t.content;
  switching = false;
  $('md-views').hidden = !isMd(t.title);
  workarea.className = isMd(t.title) ? mdView.mode : 'edit';
  if (isMd(t.title)) renderPreview(previewEl, t.content);
}

// ---------- 分頁 ----------

function renderTabs() {
  tabsEl.innerHTML = '';
  tabs.forEach((t, i) => {
    const d = document.createElement('div');
    d.className = 'tab' + (i === activeIdx ? ' active' : '');
    const label = document.createElement('span');
    label.textContent = (t.dirty ? '● ' : '') + t.title;
    if (t.dirty) label.className = 'dirty';
    const x = document.createElement('span');
    x.className = 'x';
    x.textContent = '✕';
    x.onclick = (e) => {
      e.stopPropagation();
      closeTab(i);
    };
    d.onclick = () => activateTab(i);
    d.append(label, x);
    tabsEl.appendChild(d);
  });
}

async function openNode(node) {
  if (node.kind === 'directory') {
    node.expanded = !node.expanded;
    if (node.expanded) await loadChildren(node).catch((e) => status(`讀取失敗：${e.message}`));
    renderTree();
    return;
  }
  const found = tabs.findIndex((t) => t.node === node);
  if (found >= 0) return activateTab(found);
  if (!isTextName(node.name)) {
    try {
      await readNodeText(node);
    } catch (e) {
      return status(`${node.name}：${e.message}`);
    }
  }
  try {
    const text = await readNodeText(node);
    tabs.push({ node, title: node.name, content: text, saved: text, dirty: false });
    activateTab(tabs.length - 1);
    status(`已開啟 ${node.path}`);
  } catch (e) {
    status(`開啟失敗：${e.message}`);
  }
}

function activateTab(i) {
  if (activeIdx >= 0) tabs[activeIdx].content = editor.value;
  activeIdx = i;
  syncEditorToTab();
  renderTabs();
  renderTree();
}

function closeTab(i) {
  const t = tabs[i];
  if (t.dirty && !confirm(`「${t.title}」尚未儲存，確定關閉？`)) return;
  tabs.splice(i, 1);
  if (!tabs.length) {
    activeIdx = -1;
    switching = true;
    editor.value = '';
    switching = false;
    previewEl.innerHTML = '';
    $('md-views').hidden = true;
  } else {
    activeIdx = Math.min(i, tabs.length - 1);
    syncEditorToTab();
  }
  renderTabs();
  renderTree();
}

// ---------- 檔案樹 ----------

function iconFor(node) {
  if (node.kind === 'directory') return node.expanded ? '📂' : '📁';
  if (isMd(node.name)) return '📝';
  if (/\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(node.name)) return '🖼️';
  if (/\.(js|mjs|ts|json)$/i.test(node.name)) return '📜';
  if (/\.html?$/i.test(node.name)) return '🌐';
  if (/\.css$/i.test(node.name)) return '🎨';
  return '📄';
}

function renderTree() {
  treeEl.innerHTML = '';
  if (!root) return;
  const build = (node, container) => {
    const wrap = document.createElement('div');
    wrap.className = 'tnode';
    const row = document.createElement('div');
    row.className = 'trow';
    const activeNode = activeIdx >= 0 ? tabs[activeIdx].node : null;
    if (activeNode === node) row.classList.add('active');
    const caret = document.createElement('span');
    caret.className = 'caret';
    caret.textContent = node.kind === 'directory' ? (node.expanded ? '▾' : '▸') : '';
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = iconFor(node);
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = node.name;
    const dirtyTab = tabs.find((t) => t.node === node && t.dirty);
    if (dirtyTab) {
      const dot = document.createElement('span');
      dot.className = 'dirty';
      dot.textContent = ' ●';
      nm.appendChild(dot);
    }
    row.append(caret, icon, nm);
    row.onclick = () => openNode(node);
    row.oncontextmenu = (e) => {
      e.preventDefault();
      nodeMenu(node);
    };
    wrap.appendChild(row);
    if (node.kind === 'directory' && node.expanded && node.children) {
      const kids = document.createElement('div');
      kids.className = 'tkids';
      node.children.forEach((c) => build(c, kids));
      wrap.appendChild(kids);
    }
    container.appendChild(wrap);
  };
  build(root, treeEl);
}

async function nodeMenu(node) {
  const action = prompt(`對「${node.name}」執行動作：\nrename=重新命名\ndelete=刪除\n（取消則不動作）`, '');
  if (action === 'rename') await renameNode(node);
  else if (action === 'delete') await deleteNode(node);
}

async function renameNode(node) {
  const name = prompt('新檔名：', node.name);
  if (!name || name === node.name) return;
  try {
    if (node.virtual || !node.handle) {
      node.name = name;
      node.path = node.path.replace(/[^/]+$/, name);
    } else {
      // File System Access 無萬用 rename：複製後刪舊
      if (node.kind === 'file') {
        const text = await readNodeText(node);
        const parent = await parentHandle(node);
        const h = await parent.getFileHandle(name, { create: true });
        const w = await h.createWritable();
        await w.write(text);
        await w.close();
        await parent.removeEntry(node.name);
        node.name = name;
        node.handle = h;
        node.path = node.path.replace(/[^/]+$/, name);
      } else {
        return status('資料夾重新命名尚未支援。');
      }
    }
    const t = tabs.find((x) => x.node === node);
    if (t) {
      t.title = node.name;
      renderTabs();
    }
    renderTree();
    status(`已重新命名為 ${name}`);
  } catch (e) {
    status(`重新命名失敗：${e.message}`);
  }
}

async function parentHandle(node) {
  // 從 root 沿 path 找到父目錄 handle
  const parts = node.path.split('/');
  let cur = root;
  for (let i = 1; i < parts.length - 1; i++) {
    await loadChildren(cur);
    cur = cur.children.find((c) => c.name === parts[i] && c.kind === 'directory');
    if (!cur) throw new Error('找不到父目錄');
  }
  await loadChildren(cur);
  return cur.handle;
}

async function deleteNode(node) {
  if (!confirm(`確定刪除「${node.path}」？`)) return;
  try {
    if (node.virtual || !node.handle) {
      removeVirtual(node);
    } else {
      const parent = await parentHandle(node);
      await parent.removeEntry(node.name, { recursive: node.kind === 'directory' });
      await loadChildrenForce(parent);
    }
    tabs.filter((t) => t.node === node).forEach((t) => closeTab(tabs.indexOf(t)));
    renderTree();
    status(`已刪除 ${node.name}`);
  } catch (e) {
    status(`刪除失敗：${e.message}`);
  }
}

function removeVirtual(node) {
  const parts = node.path.split('/');
  let cur = root;
  for (let i = 1; i < parts.length - 1; i++) {
    cur = cur.children.find((c) => c.name === parts[i]);
  }
  cur.children = cur.children.filter((c) => c !== node);
}

async function loadChildrenForce(node) {
  node.children = null;
  await loadChildren(node);
}

// ---------- 頂欄動作 ----------

$('open-folder').onclick = async () => {
  try {
    root = NATIVE ? await pickDirectoryNative() : await pickDirectoryFallback();
    if (!root) return;
    if (NATIVE) await loadChildren(root);
    $('folder-name').textContent = root.name;
    $('backend-tag').textContent = NATIVE ? '可寫回磁碟' : '唯讀＋下載存檔';
    $('tree-hint').hidden = true;
    renderTree();
    status(`已載入資料夾 ${root.name}（${NATIVE ? 'Chromium 模式' : '相容模式'}）`);
  } catch (e) {
    if (e.name !== 'AbortError') status(`開啟失敗：${e.message}`);
  }
};

async function targetDir() {
  if (!root) {
    status('請先開啟資料夾。');
    return null;
  }
  const t = activeIdx >= 0 ? tabs[activeIdx].node : null;
  let dir = root;
  if (t) {
    if (t.kind === 'directory') dir = t;
    else {
      const parts = t.path.split('/');
      let cur = root;
      for (let i = 1; i < parts.length - 1; i++) {
        if (cur.children) cur = cur.children.find((c) => c.name === parts[i]);
      }
      if (cur && cur.kind === 'directory') dir = cur;
    }
  }
  if (dir.handle) await loadChildren(dir);
  return dir;
}

$('new-file').onclick = async () => {
  const dir = await targetDir();
  if (!dir) return;
  const name = prompt('檔名（含副檔名）：', 'untitled.md');
  if (!name) return;
  try {
    let node;
    if (NATIVE && dir.handle) {
      const h = await dir.handle.getFileHandle(name, { create: true });
      node = { name, kind: 'file', path: dir.path + '/' + name, handle: h };
      await loadChildrenForce(root === dir ? dir : dir);
      if (root !== dir) await loadChildrenForce(dir);
    } else {
      node = { name, kind: 'file', path: dir.path + '/' + name, content: '', virtual: true };
      dir.children = dir.children || [];
      dir.children.push(node);
      dir.children.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'directory' ? -1 : 1) : a.name.localeCompare(b.name)));
    }
    renderTree();
    tabs.push({ node, title: name, content: '', saved: '', dirty: false });
    activateTab(tabs.length - 1);
    status(`已新增 ${name}`);
  } catch (e) {
    status(`新增失敗：${e.message}`);
  }
};

$('new-folder').onclick = async () => {
  const dir = await targetDir();
  if (!dir) return;
  const name = prompt('資料夾名稱：', 'new-folder');
  if (!name) return;
  try {
    if (NATIVE && dir.handle) {
      const h = await dir.handle.getDirectoryHandle(name, { create: true });
      await loadChildrenForce(dir);
      void h;
    } else {
      dir.children = dir.children || [];
      dir.children.push({ name, kind: 'directory', path: dir.path + '/' + name, children: [], expanded: true, virtual: true });
    }
    renderTree();
    status(`已新增資料夾 ${name}`);
  } catch (e) {
    status(`新增失敗：${e.message}`);
  }
};

async function saveActive() {
  if (activeIdx < 0) return;
  const t = tabs[activeIdx];
  t.content = editor.value;
  try {
    const where = await writeNodeText(t.node ?? { name: t.title, virtual: true }, t.content);
    t.saved = t.content;
    setDirty(t, false);
    status(where === 'disk' ? `已儲存到磁碟：${t.node.path}` : `已下載 ${t.title}（相容模式：請手動放回資料夾）`);
  } catch (e) {
    status(`儲存失敗：${e.message}`);
  }
}

$('save-file').onclick = saveActive;
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveActive();
  }
});
window.addEventListener('beforeunload', (e) => {
  if (tabs.some((t) => t.dirty)) e.preventDefault();
});

document.querySelectorAll('#md-views [data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    mdView.mode = b.getAttribute('data-view');
    document.querySelectorAll('#md-views [data-view]').forEach((x) => x.classList.toggle('on', x === b));
    if (activeIdx >= 0 && isMd(tabs[activeIdx].title)) workarea.className = mdView.mode;
  })
);
if (mdView.mode === 'split') {
  document.querySelector('#md-views [data-view="split"]')?.classList.add('on');
}

$('download-html').onclick = () => {
  if (activeIdx < 0 || !isMd(tabs[activeIdx].title)) return status('請先開啟一個 .md 分頁。');
  const t = tabs[activeIdx];
  const html = exportMarkdownToHtml(editor.value);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  a.download = t.title.replace(/\.md$/i, '.html');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  status(`已匯出 ${a.download}（獨立檔，可放任何靜態主機）`);
};

// ---------- 啟動：未命名 DEMO 分頁 ----------

tabs.push({ node: null, title: 'untitled.md', content: DEMO, saved: DEMO, dirty: false });
activeIdx = 0;
$('backend-tag').textContent = NATIVE ? '可寫回磁碟' : '相容模式';
syncEditorToTab();
renderTabs();
status(NATIVE ? '就緒：按「開啟資料夾」載入本機目錄（可寫回）' : '就緒：此瀏覽器為相容模式（唯讀＋下載存檔），建議用 Chrome/Edge 開啟資料夾');
