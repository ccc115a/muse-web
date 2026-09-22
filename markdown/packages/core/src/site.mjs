// 靜態網站產生的純函數（無 IO，方便單測；IO 在 apps/web/src/site-export.js）
// 流程：資料夾內每個 .md → 同 renderer 轉 HTML（含 nav）→ 其餘檔案原樣複製

export function mdPathToHtmlPath(p) {
  return p.replace(/\.md$/i, '.html');
}

/** 取第一個 # 標題當頁名，否則用檔名 */
export function pageTitleFromMarkdown(src, fallback) {
  const m = /^\s{0,3}#{1,6}\s+(.+?)\s*$/m.exec(src ?? '');
  if (m) return m[1].replace(/[*_`[\]()]/g, '').slice(0, 120);
  return fallback ?? 'Untitled';
}

function esc(s) {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** pages: [{ href（站點根相對路徑）, title }]；rel：本頁到站點根的相對前綴 */
export function buildNavHtml(pages, rel = '') {
  const items = pages
    .map((p) => `<li><a href="${esc(rel + p.href)}">${esc(p.title)}</a></li>`)
    .join('\n');
  return `<ul class="site-nav">\n${items}\n</ul>`;
}

/** 站點內頁模板：無側欄，頂部麵包屑（首頁／上層目錄可點）＋內文 */
export function buildSitePage({ title = 'Untitled', bodyHtml = '', href = '' } = {}) {
  const segs = href ? href.split('/').slice(0, -1) : [];
  const depth = segs.length;
  const rel = '../'.repeat(depth);
  let crumb = `<a href="${rel}index.html">⌂ 首頁</a>`;
  segs.forEach((s, i) => {
    crumb += ` / <a href="${rel + segs.slice(0, i + 1).join('/')}/index.html">${esc(s)}</a>`;
  });
  crumb += ` / ${esc(title)}`;
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5.8.1/github-markdown.min.css" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css" />
<style>
body{margin:0;background:#fff}
header.crumb{padding:10px 24px;border-bottom:1px solid #d0d7de;background:#f6f8fa;font-size:.88em}
header.crumb a{color:#0969da;text-decoration:none}
header.crumb a:hover{text-decoration:underline}
article{box-sizing:border-box;max-width:980px;padding:24px}
.markdown-alert{padding:.5rem 1rem;margin-bottom:1rem;border-left:.25em solid #888;border-radius:6px;background:#f6f8fa}
.markdown-alert-title{font-weight:600;margin:0 0 .25rem}
.markdown-alert-note{border-color:#0969da}.markdown-alert-tip{border-color:#1a7f37}
.markdown-alert-important{border-color:#8250df}.markdown-alert-warning{border-color:#9a6700}
.markdown-alert-caution{border-color:#d1242f}
pre.mermaid{background:#f6f8fa;padding:16px;border-radius:6px}
@media (max-width:767px){nav.site{display:none}article{padding:12px}}
</style>
</head>
<body>
<header class="crumb">${crumb}</header>
<article class="markdown-body">
${bodyHtml}
</article>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>
(function(){try{if(window.mermaid){mermaid.initialize({startOnLoad:true,securityLevel:'loose'});mermaid.run();}}catch(e){console.warn(e);}})();
</script>
</body>
</html>
`;
}

/** 站內 .md 連結改寫成 .html（相對連結才動；絕對 URL／mailto／純錨點／data: 不動）
 *  例：1.1.md → 1.1.html、../a.md#sec → ../a.html#sec */
export function rewriteMdLinks(html) {
  return (html ?? '').replace(/(href|src)="([^"]*)"/g, (m, attr, url) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|data:)/i.test(url)) return m;
    const cut = (() => {
      const q = url.indexOf('?');
      const h = url.indexOf('#');
      const i = q < 0 ? h : h < 0 ? q : Math.min(q, h);
      return i < 0 ? [url, ''] : [url.slice(0, i), url.slice(i)];
    })();
    if (!/\.md$/i.test(cut[0])) return m;
    return `${attr}="${cut[0].replace(/\.md$/i, '.html')}${cut[1]}"`;
  });
}

/** 首頁：README 若存在則用其內文，否則列出所有頁面 */
export function buildSiteIndex({ title = '首頁', bodyHtml = '' } = {}) {
  return buildSitePage({ title, bodyHtml, href: 'index.html' });
}

/** 目錄索引頁（上一層落點）：直屬頁面＋子目錄；href 為本站根相對路徑 */
export function buildDirIndexPage({ dir = '', pages = [], subdirs = [], href = '' } = {}) {
  const name = dir.split('/').pop();
  let body = `<h1>${esc(name)}</h1>\n<h2>本目錄</h2>\n<ul>\n`;
  body += pages.map((p) => `<li><a href="${esc(p.href.split('/').pop())}">${esc(p.title)}</a></li>`).join('\n');
  body += '\n</ul>';
  if (subdirs.length) {
    body +=
      '\n<h2>子目錄</h2>\n<ul>\n' +
      subdirs.map((s) => `<li><a href="${esc(s)}/index.html">${esc(s)}/</a></li>`).join('\n') +
      '\n</ul>';
  }
  return buildSitePage({ title: name, bodyHtml: body, href });
}

/** 輸出目錄正規化：去空白/前後斜線，擋掉空段、`.`、`..`（否則 getDirectoryHandle 報 Name is not allowed） */
export function sanitizeOutDir(input) {
  const raw = (input ?? '').split('/').map((s) => s.trim());
  if (raw.some((s) => s === '..')) throw new Error('輸出目錄不可含 ..（會寫到 repo 外面）');
  const parts = raw.filter((s) => s && s !== '.');
  if (!parts.length) throw new Error('輸出目錄名稱無效（不可為空、不可只有斜線或 .）');
  if (parts.some((s) => s.length > 255)) throw new Error('輸出目錄名稱過長（單段不可超過 255 字元）');
  return parts.join('/');
}

/** 發佈來源目錄正規化：'' 或 '/' 表 repo 根；其餘為根相對路徑，不可含 .. */
export function sanitizeSrcDir(input) {
  const s = (input ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!s) return '';
  const raw = s.split('/').map((x) => x.trim());
  if (raw.some((x) => x === '..')) throw new Error('來源目錄不可含 ..');
  const parts = raw.filter((x) => x && x !== '.');
  if (!parts.length) return '';
  if (parts.some((x) => x.length > 255)) throw new Error('來源目錄名稱過長');
  return parts.join('/');
}

/** 檢查站點內相對路徑每段是否合法，回傳問題描述（無問題回 null） */
export function invalidPathReason(rel) {
  if (!rel) return '路徑為空';
  for (const seg of rel.split('/')) {
    if (!seg) return `含空路徑段：${rel}`;
    if (seg === '.' || seg === '..') return `含非法段 ${seg}：${rel}`;
    if (seg.length > 255) return `段過長：${rel}`;
  }
  return null;
}

/** GitHub Action：官方 Pages 部署（Settings → Pages → Source 選 GitHub Actions） */
export function workflowYaml({ siteDir = 'site', branch = 'main' } = {}) {
  return `name: Deploy static site to Pages
on:
  push:
    branches: ["${branch}"]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: "pages"
  cancel-in-progress: false
jobs:
  deploy:
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
        with:
          # 新 repo 尚未開通過 Pages 時自動開通，免去手動到 Settings 開
          enablement: true
      - uses: actions/upload-pages-artifact@v3
        with:
          path: '${siteDir}'
      - id: deployment
        uses: actions/deploy-pages@v4
`;
}
