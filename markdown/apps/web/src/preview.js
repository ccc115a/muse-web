import mermaid from 'mermaid';
import { renderMarkdown } from '@md-gh/core';
import { sanitizeHtmlSync } from '@md-gh/core';

mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });

let seq = 0;
/** 與 Pages 匯出同 renderer；回傳已插入 DOM */
export async function renderPreview(el, mdSrc) {
  const dirty = renderMarkdown(mdSrc ?? '');
  let clean = dirty;
  try {
    clean = sanitizeHtmlSync(dirty);
  } catch {
    const { sanitizeHtml } = await import('@md-gh/core');
    clean = await sanitizeHtml(dirty);
  }
  el.innerHTML = clean;
  // mermaid：每個 pre.mermaid 給唯一 id 避免重複 render 衝突
  const blocks = el.querySelectorAll('pre.mermaid');
  for (const b of blocks) b.setAttribute('id', `mmd-${Date.now()}-${seq++}`);
  try {
    await mermaid.run({ nodes: blocks });
  } catch (e) {
    console.warn('mermaid render failed', e);
  }
}
