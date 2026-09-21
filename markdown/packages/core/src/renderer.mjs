// 共用 renderer：以「和 github.com 顯示一致」為目標（GFM + mermaid + TeX）
// 注意：只管顯示一致，不管 GitHub API（push 等操作請在 VSCode 自己做）
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import frontMatter from 'markdown-it-front-matter';
import { full as emoji } from 'markdown-it-emoji';
import hljs from 'highlight.js';
import katex from 'katex';

let _md = null;

function slugify(s) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// --- GitHub Alert：> [!NOTE] / TIP / IMPORTANT / WARNING / CAUTION ---
// 階段一（token）：標記 blockquote class + 移除標記文字
// 階段二（字串）：補上 GitHub 式的標題列（Note/Tip/...）
const ALERT_TYPES = new Set(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']);
const ALERT_TITLES = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };
function alertPlugin(md) {
  md.core.ruler.after('block', 'gh-alert', (state) => {
    const toks = state.tokens;
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== 'blockquote_open') continue;
      const pOpen = toks[i + 1];
      const inline = toks[i + 2];
      if (!pOpen || pOpen.type !== 'paragraph_open') continue;
      if (!inline || inline.type !== 'inline') continue;
      const m = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/.exec(inline.content);
      if (!m) continue;
      const kind = m[1].toLowerCase();
      toks[i].attrJoin('class', `markdown-alert markdown-alert-${kind}`);
      inline.content = inline.content.slice(m[0].length);
      if (inline.children && inline.children.length) {
        const first = inline.children[0];
        if (first.type === 'text') first.content = first.content.replace(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/, '');
      }
    }
    return false;
  });
}

function addAlertTitles(html) {
  return html.replace(/<blockquote class="markdown-alert markdown-alert-([a-z]+)">/g, (m, k) => {
    return `${m}<p class="markdown-alert-title">${ALERT_TITLES[k] ?? k}</p>`;
  });
}

// --- heading id（GitHub 式 slug）---
function headingIdPlugin(md) {
  md.core.ruler.after('inline', 'gh-heading-id', (state) => {
    const toks = state.tokens;
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== 'heading_open') continue;
      const inline = toks[i + 1];
      if (!inline || inline.type !== 'inline') continue;
      const text = inline.content;
      toks[i].attrSet('id', slugify(text));
    }
    return false;
  });
}

// --- code 保護：fenced code 與行內 code 裡的 $ 不是數學（GitHub 亦然）---
// ```math 例外：留給 extractMath；```mermaid：保護起來直接還原，避免內容被數學誤判
export function extractCode(src) {
  const slots = [];
  let text = (src ?? '').replace(/^(```|~~~)([^`\n~]*)\n([\s\S]*?)^\1[ \t]*$/gm, (m, _f, info, code) => {
    const lang = (info || '').trim().split(/\s+/)[0].toLowerCase();
    if (lang === 'math') {
      slots.push({ kind: 'math', tex: code.trim() });
      return `\n@@CODE-${slots.length - 1}@@\n`;
    }
    slots.push({ kind: lang === 'mermaid' ? 'mermaid' : 'fence', lang, code: code.replace(/\n$/, '') });
    return `@@CODE-${slots.length - 1}@@`;
  });
  // 行內 code：1~2 個反引號，且前後不可緊鄰反引號（避免咬到 ``` 圍欄殘段）
  text = text.replace(/(?<!`)(`{1,2})(?!`)([^`\n]*?)(?<!`)\1(?!`)/g, (_, _q, code) => {
    slots.push({ kind: 'span', code });
    return `@@CODE-${slots.length - 1}@@`;
  });
  return { text, slots };
}

function restoreCode(html, slots) {
  return html.replace(/<p>@@CODE-(\d+)@@<\/p>|@@CODE-(\d+)@@/g, (m, b, s) => {
    const slot = slots[Number(b ?? s)];
    if (!slot) return m;
    const esc = escapeHtml(slot.code ?? '');
    if (slot.kind === 'mermaid') return `<pre class="mermaid">${esc}</pre>`;
    if (slot.kind === 'math') {
      try {
        return katex.renderToString(slot.tex, { displayMode: true, throwOnError: false, strict: false });
      } catch {
        return `<code>${escapeHtml(slot.tex)}</code>`;
      }
    }
    if (slot.kind === 'fence') {
      const lang = slot.lang;
      if (lang && hljs.getLanguage(lang)) {
        try {
          const out = hljs.highlight(slot.code, { language: lang, ignoreIllegals: true }).value;
          return `<pre><code class="hljs language-${lang}">${out}</code></pre>`;
        } catch {
          // fallthrough
        }
      }
      return `<pre><code${lang ? ` class="language-${lang}"` : ''}>${esc}</code></pre>`;
    }
    return `<code>${esc}</code>`;
  });
}

// --- math 保護：抽出後還原（code 已先被保護，所以這裡看到的 $ 都是真的數學）---
export function extractMath(src) {
  const slots = [];
  let text = src.replace(/^```math[ \t]*\n([\s\S]*?)^```[ \t]*$/gm, (_, tex) => {
    slots.push({ kind: 'display', tex: tex.trim() });
    return `\n@@MATH-${slots.length - 1}@@\n`;
  });
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    slots.push({ kind: 'display', tex: tex.trim() });
    return `@@MATH-${slots.length - 1}@@`;
  });
  text = text.replace(/(?<!\$)\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)/g, (_, tex) => {
    slots.push({ kind: 'inline', tex: tex.trim() });
    return `@@MATH-${slots.length - 1}@@`;
  });
  return { text, slots };
}

function restoreMath(html, slots) {
  return html.replace(/@@MATH-(\d+)@@/g, (_, n) => {
    const s = slots[Number(n)];
    if (!s) return '';
    try {
      return katex.renderToString(s.tex, {
        displayMode: s.kind === 'display',
        throwOnError: false,
        strict: false,
      });
    } catch {
      return `<code>${escapeHtml(s.tex)}</code>`;
    }
  });
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getMd() {
  if (_md) return _md;
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
  md.use(footnote);
  md.use(taskLists, { enabled: true, label: true });
  md.use(frontMatter, () => {});
  md.use(emoji);
  md.use(alertPlugin);
  md.use(headingIdPlugin);

  // fence 備援（正常流程 fences 已被 extractCode 保護，這裡只處理漏網之魚）
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, slf) => {
    const tok = tokens[idx];
    const lang = (tok.info || '').trim().split(/\s+/)[0].toLowerCase();
    if (lang === 'mermaid') {
      return `<pre class="mermaid">${escapeHtml(tok.content)}</pre>\n`;
    }
    if (defaultFence) return defaultFence(tokens, idx, options, env, slf);
    return `<pre><code>${escapeHtml(tok.content)}</code></pre>\n`;
  };
  _md = md;
  return md;
}

/** md -> 未消毒 html（含 katex/mermaid）。消毒請再走 sanitizeHtml。 */
export function renderMarkdown(src) {
  const { text: t1, slots: codeSlots } = extractCode(src ?? '');
  const { text: t2, slots: mathSlots } = extractMath(t1);
  let html = getMd().render(t2);
  html = restoreMath(html, mathSlots);
  html = restoreCode(html, codeSlots);
  html = addAlertTitles(html);
  return html;
}
