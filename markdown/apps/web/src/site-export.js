// 資料夾 → gh-pages 靜態網站：遍歷、轉檔、寫入 site/（native）或下載 zip（fallback）
// 假設：開啟的資料夾即 repo 根目錄（Action 檔放 .github/workflows/，站點放 site/）
import JSZip from 'jszip';
import {
  renderMarkdown,
  sanitizeHtml,
  mdPathToHtmlPath,
  pageTitleFromMarkdown,
  buildNavHtml,
  buildDirIndexPage,
  buildSitePage,
  buildSiteIndex,
  workflowYaml,
  sanitizeOutDir,
  invalidPathReason,
  rewriteMdLinks,
} from '@md-gh/core';
import { loadChildren } from './fs.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

/** 遞迴列出所有目錄（給來源選擇器）：根相對路徑陣列，跳過隱藏/SKIP */
export async function listDirs(root) {
  const out = [];
  async function walk(node, rel) {
    const children = node.children ?? (node.handle ? await loadChildren(node) : node.children ?? []);
    for (const c of children) {
      if (c.name.startsWith('.') || SKIP_DIRS.has(c.name)) continue;
      if (c.kind !== 'directory') continue;
      const r = rel ? rel + '/' + c.name : c.name;
      out.push(r);
      await walk(c, r);
    }
  }
  await walk(root, '');
  return out.sort((a, b) => a.localeCompare(b));
}

/** 遞迴收集檔案：[{ rel（來源根相對路徑）, node }]，跳過隱藏檔、SKIP_DIRS、輸出目錄（前綴比對，支援巢狀） */
export async function collectFiles(root, outDir, srcNode = root) {
  const base = srcNode.path;
  const baseRel = base.slice(root.path.length + 1); // 來源相對 repo 根（根即 ''）
  const outRaw = (outDir ?? '').replace(/\/+$/, '');
  // 輸出目錄換算成「來源相對」：不在來源內就不用過濾
  const out = !outRaw
    ? ''
    : !baseRel
      ? outRaw
      : outRaw === baseRel || outRaw.startsWith(baseRel + '/')
        ? outRaw.slice(baseRel.length + 1)
        : '';
  const files = [];
  async function walk(node) {
    const children = node.children ?? (node.handle ? await loadChildren(node) : node.children ?? []);
    for (const c of children) {
      const rel = c.path.slice(base.length + 1);
      if (!rel || c.name.startsWith('.')) continue;
      if (out && (rel === out || rel.startsWith(out + '/'))) continue;
      if (c.kind === 'directory') {
        if (SKIP_DIRS.has(c.name)) continue;
        await walk(c);
      } else {
        files.push({ rel, node: c });
      }
    }
  }
  await walk(srcNode);
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

async function readRawBytes(node) {
  if (node.virtual) {
    if (node.content !== undefined) return new TextEncoder().encode(node.content);
    if (node.file) return new Uint8Array(await node.file.arrayBuffer());
    return new Uint8Array(0);
  }
  const file = await node.handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

function hasNul(bytes) {
  for (let i = 0; i < Math.min(bytes.length, 8192); i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

/** 產生站點檔案表：Map<站點內路徑, string|Uint8Array>；srcNode 預設整包（root） */
export async function buildSiteFileMap(root, outDir, onProgress, srcNode = root) {
  const collected = await collectFiles(root, outDir, srcNode);
  const mdFiles = collected.filter((f) => /\.md$/i.test(f.rel));
  const otherFiles = collected.filter((f) => !/\.md$/i.test(f.rel));

  // 先讀所有 md（標題要拿來做 nav）
  const pages = [];
  for (const f of mdFiles) {
    const bytes = await readRawBytes(f.node);
    const text = hasNul(bytes) ? '' : new TextDecoder().decode(bytes);
    const title = pageTitleFromMarkdown(text, f.rel.split('/').pop());
    pages.push({ ...f, text, title, href: mdPathToHtmlPath(f.rel) });
    onProgress?.(`讀取 ${f.rel}`);
  }
  pages.sort((a, b) => a.href.localeCompare(b.href));

  const out = new Map();
  const bodies = new Map();
  for (const p of pages) {
    const dirty = rewriteMdLinks(renderMarkdown(p.text)); // 站內 .md 連結 → .html
    const bodyHtml = await sanitizeHtml(dirty);
    bodies.set(p.href, bodyHtml);
    out.set(p.href, buildSitePage({ title: p.title, bodyHtml, href: p.href }));
    onProgress?.(`轉換 ${p.rel}`);
  }

  // 每個子目錄一個 index.html（麵包屑上一層的落點）
  const dirs = new Map(); // rel -> { pages: [], subdirs: Set }
  const ensureDir = (r) => {
    if (!dirs.has(r)) dirs.set(r, { pages: [], subdirs: new Set() });
    return dirs.get(r);
  };
  ensureDir('');
  for (const p of pages) {
    const parts = p.href.split('/');
    parts.pop();
    ensureDir(parts.join('/')).pages.push(p);
    let cur = '';
    for (const seg of parts) {
      ensureDir(cur).subdirs.add(seg);
      cur = cur ? cur + '/' + seg : seg;
      ensureDir(cur);
    }
  }
  for (const [rel, d] of dirs) {
    if (!rel) continue;
    out.set(
      rel + '/index.html',
      buildDirIndexPage({
        dir: rel,
        pages: d.pages,
        subdirs: [...d.subdirs].sort((a, b) => a.localeCompare(b)),
        href: rel + '/index.html',
      })
    );
    onProgress?.(`目錄索引 ${rel}/`);
  }

  // 首頁：根目錄 README.md 優先，否則頁面清單
  const readme = pages.find((p) => /^readme\.html$/i.test(p.href) && !p.href.includes('/'));
  const indexBody = readme
    ? bodies.get(readme.href)
    : `<h1>${pages.length} 頁文件</h1>\n` +
      buildNavHtml(pages.map((q) => ({ href: q.href, title: q.title })));
  out.set(
    'index.html',
    buildSiteIndex({
      title: readme ? readme.title : '首頁',
      bodyHtml: indexBody,
    })
  );

  // 非 md 原樣複製（含圖片等二進位）
  for (const f of otherFiles) {
    out.set(f.rel, await readRawBytes(f.node));
    onProgress?.(`複製 ${f.rel}`);
  }

  out.set('.nojekyll', '');
  return { fileMap: out, pages };
}

async function ensureDir(parent, name, ctx) {
  try {
    return await parent.getDirectoryHandle(name, { create: true });
  } catch (e) {
    throw new Error(`${ctx}：建目錄「${name}」失敗（${e.name} ${e.message}）`);
  }
}

async function removePath(rootHandle, rel) {
  const parts = rel.split('/');
  let dir = rootHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      dir = await dir.getDirectoryHandle(parts[i]);
    } catch {
      return;
    }
  }
  try {
    await dir.removeEntry(parts[parts.length - 1], { recursive: true });
  } catch (e) {
    if (e.name !== 'NotFoundError') throw e;
  }
}

/** 寫入磁碟：<root>/<outDir>/… ＋ <root>/.github/workflows/gh-pages.yml
 *  outDir 可含子路徑（如 docs/site）；先清空舊輸出；單檔失敗記下繼續，最後回報。
 *  回傳 { outDir, written, failed: [{ rel, error }] } */
export async function writeSiteToDisk(root, outDirInput, fileMap, branch, onProgress) {
  const outDir = sanitizeOutDir(outDirInput);
  await removePath(root.handle, outDir); // 清舊輸出，避免殘留
  let dir = root.handle;
  for (const seg of outDir.split('/')) {
    dir = await ensureDir(dir, seg, `輸出目錄 ${outDir}`);
  }
  const siteHandle = dir;
  const failed = [];
  let written = 0;
  for (const [rel, data] of fileMap) {
    const bad = invalidPathReason(rel);
    if (bad) {
      failed.push({ rel, error: bad });
      continue;
    }
    try {
      const parts = rel.split('/');
      let d = siteHandle;
      for (let i = 0; i < parts.length - 1; i++) {
        d = await ensureDir(d, parts[i], outDir + '/' + rel);
      }
      let fh;
      try {
        fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
      } catch (e) {
        throw new Error(`${outDir}/${rel}：建檔失敗（${e.name} ${e.message}）`);
      }
      const w = await fh.createWritable();
      await w.write(data);
      await w.close();
      written++;
      onProgress?.(`寫入 ${outDir}/${rel} (${written}/${fileMap.size})`);
    } catch (e) {
      failed.push({ rel, error: e.message });
    }
  }
  try {
    const ghDir = await ensureDir(await ensureDir(root.handle, '.github', 'Action'), 'workflows', 'Action');
    const wf = await ghDir.getFileHandle('gh-pages.yml', { create: true });
    const w = await wf.createWritable();
    await w.write(workflowYaml({ siteDir: outDir, branch }));
    await w.close();
    onProgress?.('寫入 .github/workflows/gh-pages.yml');
  } catch (e) {
    failed.push({ rel: '.github/workflows/gh-pages.yml', error: e.message });
  }
  return { outDir, written, failed };
}

/** 整包下載 zip；includeWorkflow=false 時只包站點 */
export async function downloadSiteZip(rootName, outDir, fileMap, branch, onProgress, includeWorkflow = true) {
  const zip = new JSZip();
  for (const [rel, data] of fileMap) {
    zip.file(`${outDir}/${rel}`, data);
    onProgress?.(`打包 ${outDir}/${rel}`);
  }
  if (includeWorkflow) {
    zip.file('.github/workflows/gh-pages.yml', workflowYaml({ siteDir: outDir, branch }));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${rootName}-${outDir}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
