// 專案設定檔 .mdeditor.json（取代 prompt）：{ siteDir, branch }
// 不存在就建一個帶預設值的；使用者直接開檔編輯
import { loadChildren } from './fs.js';

const FILE = '.mdeditor.json';

export function defaultConfig(defaultBranch = 'main') {
  return { srcDir: '', siteDir: 'site', branch: defaultBranch };
}

/** 只讀設定（不存在就回預設，不建檔）：發佈流程用 */
export async function readProjectConfig(root, defaultBranch = 'main') {
  if (root.handle) await loadChildren(root).catch(() => {});
  const node = root.children?.find((c) => c.kind === 'file' && c.name === FILE);
  if (!node) return defaultConfig(defaultBranch);
  try {
    const text = node.handle ? await (await node.handle.getFile()).text() : (node.content ?? '');
    return { ...defaultConfig(defaultBranch), ...JSON.parse(text) };
  } catch {
    return defaultConfig(defaultBranch);
  }
}

/** 寫回設定檔（建檔若無），回傳 node；呼叫端自行 renderTree＋同步分頁 */
export async function writeProjectConfig(root, cfg) {
  const text = JSON.stringify(cfg, null, 2) + '\n';
  let node;
  if (root.handle) {
    const h = await root.handle.getFileHandle(FILE, { create: true });
    const w = await h.createWritable();
    await w.write(text);
    await w.close();
    root.children = null;
    await loadChildren(root).catch(() => {});
    node = root.children?.find((c) => c.kind === 'file' && c.name === FILE);
  } else {
    node = root.children?.find((c) => c.kind === 'file' && c.name === FILE);
    if (node) node.content = text;
    else {
      node = { name: FILE, kind: 'file', path: root.path + '/' + FILE, content: text, virtual: true };
      root.children = root.children ?? [];
      root.children.push(node);
    }
  }
  return node;
}

/** 找或建設定檔，回傳 { config, node }；node 可直接開成分頁編輯 */
export async function ensureProjectConfig(root, defaultBranch = 'main') {
  if (root.handle) await loadChildren(root).catch(() => {});
  let node = root.children?.find((c) => c.kind === 'file' && c.name === FILE);
  if (node?.handle) {
    try {
      const text = await (await node.handle.getFile()).text();
      return { config: { ...defaultConfig(defaultBranch), ...JSON.parse(text) }, node };
    } catch {
      // 壞掉就沿用預設（不覆寫使用者檔案）
      return { config: defaultConfig(defaultBranch), node };
    }
  }
  if (node?.virtual) {
    try {
      return { config: { ...defaultConfig(defaultBranch), ...JSON.parse(node.content ?? '') }, node };
    } catch {
      return { config: defaultConfig(defaultBranch), node };
    }
  }
  // 建新檔
  const text = JSON.stringify(defaultConfig(defaultBranch), null, 2) + '\n';
  if (root.handle) {
    const h = await root.handle.getFileHandle(FILE, { create: true });
    const w = await h.createWritable();
    await w.write(text);
    await w.close();
    root.children = null;
    await loadChildren(root).catch(() => {});
    node = root.children?.find((c) => c.kind === 'file' && c.name === FILE);
  } else {
    node = { name: FILE, kind: 'file', path: root.path + '/' + FILE, content: text, virtual: true };
    root.children = root.children ?? [];
    root.children.push(node);
  }
  return { config: defaultConfig(defaultBranch), node };
}
