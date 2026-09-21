// Pages 匯出：產 standalone HTML（內嵌最小樣式 + CDN 載 mermaid/katex）
import { renderMarkdown } from './renderer.mjs';

const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
const KATEX_CSS_CDN = 'https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css';

function escapeTitle(s) {
  return (s ?? 'Markdown Export').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 已有 bodyHtml（消毒過）時直接包殼 */
export function wrapStandaloneHtml({ title = 'Markdown Export', bodyHtml = '', extraHead = '' } = {}) {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeTitle(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5.8.1/github-markdown.min.css" />
<link rel="stylesheet" href="${KATEX_CSS_CDN}" />
<style>
body{box-sizing:border-box;min-width:200px;max-width:980px;margin:0 auto;padding:24px;background:#fff}
.markdown-body{box-sizing:border-box;min-width:200px;max-width:980px;margin:0 auto}
.markdown-alert{padding:.5rem 1rem;margin-bottom:1rem;border-left:.25em solid #888;border-radius:6px;background:#f6f8fa}
.markdown-alert-title{font-weight:600;margin:0 0 .25rem}
.markdown-alert-note{border-color:#0969da}.markdown-alert-tip{border-color:#1a7f37}
.markdown-alert-important{border-color:#8250df}.markdown-alert-warning{border-color:#9a6700}
.markdown-alert-caution{border-color:#d1242f}
pre.mermaid{background:#f6f8fa;padding:16px;border-radius:6px}
@media (max-width:767px){body{padding:12px}}
</style>
${extraHead}
</head>
<body>
<article class="markdown-body">
${bodyHtml}
</article>
<script src="${MERMAID_CDN}"></script>
<script>
(function(){try{if(window.mermaid){mermaid.initialize({startOnLoad:true,securityLevel:'loose'});mermaid.run();}}catch(e){console.warn(e);}})();
</script>
</body>
</html>
`;
}

/** md 源 -> standalone HTML（未消毒；呼叫端若要嚴格請先 sanitizeHtml） */
export function exportMarkdownToHtml(mdSrc, { title } = {}) {
  const body = renderMarkdown(mdSrc);
  const docTitle = title ?? guessTitle(mdSrc);
  return wrapStandaloneHtml({ title: docTitle, bodyHtml: body });
}

function guessTitle(mdSrc) {
  const m = /^\s{0,3}#{1,6}\s+(.+?)\s*$/m.exec(mdSrc ?? '');
  return m ? m[1].replace(/[*_`[\]()]/g, '').slice(0, 120) : 'Markdown Export';
}
