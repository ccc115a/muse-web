// 資料夾檔案系統層：Chromium 用 File System Access API（可寫回磁碟），
// 其他瀏覽器 fallback 用 webkitdirectory（唯讀＋下載存檔）。
// 節點模型：{ name, kind: 'file'|'directory', path, handle?, file?, children?, expanded?, virtual? }

export const NATIVE = typeof window !== 'undefined' && !!window.showDirectoryPicker;

export function isTextName(name) {
  // 明確二進位副檔名先擋；其餘讀進來後再驗 NUL
  return !/\.(png|jpe?g|gif|webp|bmp|ico|pdf|zip|tar|gz|7z|mp3|mp4|mov|wav|exe|dll|so|bin|dat|woff2?|ttf|otf|eot)$/i.test(name);
}

function sortEntries(list) {
  return list.sort((a, b) =>
    a.kind !== b.kind ? (a.kind === 'directory' ? -1 : 1) : a.name.localeCompare(b.name, 'zh-Hant')
  );
}

// ---------- Native（File System Access）----------

export async function pickDirectoryNative() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  return { name: handle.name, kind: 'directory', path: handle.name, handle, children: null, expanded: true };
}

export async function loadChildren(node) {
  if (node.children) return node.children;
  const list = [];
  for await (const [name, handle] of node.handle.entries()) {
    list.push({
      name,
      kind: handle.kind,
      path: node.path + '/' + name,
      handle,
      children: null,
      expanded: false,
    });
  }
  node.children = sortEntries(list);
  return node.children;
}

async function readHandleText(handle) {
  const file = await handle.getFile();
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // NUL 檢查：有 NUL 視為二進位
  for (let i = 0; i < Math.min(bytes.length, 8192); i++) {
    if (bytes[i] === 0) throw new Error('二進位檔，無法以文字開啟');
  }
  return new TextDecoder().decode(buf);
}

async function writeHandleText(handle, text) {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

// ---------- Fallback（webkitdirectory，唯讀）----------

export function pickDirectoryFallback() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.onchange = () => {
      const files = [...(input.files ?? [])];
      if (!files.length) return resolve(null);
      resolve(buildVirtualTree(files));
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function buildVirtualTree(files) {
  const rootName = (files[0].webkitRelativePath || files[0].name).split('/')[0];
  const root = { name: rootName, kind: 'directory', path: rootName, children: [], expanded: true, virtual: true };
  const dirs = new Map([[rootName, root]]);
  for (const f of files) {
    const rel = f.webkitRelativePath || f.name;
    const parts = rel.split('/');
    let dirPath = parts[0];
    for (let i = 1; i < parts.length - 1; i++) {
      const p = dirPath + '/' + parts[i];
      if (!dirs.has(p)) {
        const node = { name: parts[i], kind: 'directory', path: p, children: [], expanded: false, virtual: true };
        dirs.set(p, node);
        dirs.get(dirPath).children.push(node);
      }
      dirPath = p;
    }
    dirs.get(dirPath).children.push({
      name: parts[parts.length - 1],
      kind: 'file',
      path: rel,
      file: f,
      virtual: true,
    });
  }
  for (const d of dirs.values()) d.children = sortEntries(d.children);
  return root;
}

async function readVirtualText(node) {
  if (node.content !== undefined) return node.content; // 本機新建的
  const buf = await node.file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < Math.min(bytes.length, 8192); i++) {
    if (bytes[i] === 0) throw new Error('二進位檔，無法以文字開啟');
  }
  return new TextDecoder().decode(buf);
}

// ---------- 統一介面 ----------

export async function readNodeText(node) {
  if (node.virtual) return readVirtualText(node);
  if (node.handle) return readHandleText(node.handle);
  return node.content ?? '';
}

export async function writeNodeText(node, text) {
  if (node.virtual || !node.handle) {
    // fallback／未命名：下載存檔
    downloadText(text, node.name);
    return 'download';
  }
  await writeHandleText(node.handle, text);
  return 'disk';
}

export function downloadText(text, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name || 'untitled.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
