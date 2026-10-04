'use strict';
const path = require('path');
const { Marked } = require('marked');

const SHELL_LANGS = new Set(['shell', 'sh', 'bash', 'zsh']);
const MD_EXT = /\.(md|markdown)$/i;
const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

/** Split "a/b.md?x=1#frag" into its parts. */
function splitHref(href) {
  const hashAt = href.indexOf('#');
  const hash = hashAt === -1 ? '' : href.slice(hashAt + 1);
  let rest = hashAt === -1 ? href : href.slice(0, hashAt);
  const qAt = rest.indexOf('?');
  if (qAt !== -1) rest = rest.slice(0, qAt);
  let file = rest;
  try { file = decodeURI(rest); } catch { /* keep raw */ }
  return { file, hash };
}

/**
 * Render markdown to safe HTML.
 *  - Raw HTML in the source is escaped, never emitted.
 *  - ```shell / sh / bash / zsh fences become runnable blocks.
 *  - Relative .md links become in-app navigation, relative images go through /api/file.
 *
 * @param {string} source
 * @param {{docPath?: string, exists?: (relPath: string) => boolean}} [opts]
 *        docPath is the root-relative posix path of the document being rendered.
 */
function renderMarkdown(source, { docPath = 'README.md', exists = () => true } = {}) {
  const docDir = path.posix.dirname(docPath);
  const seen = new Map();
  let title = null;
  let shellBlocks = 0;

  /** Resolve an href against this document. Returns null when it leaves the folder. */
  const resolveLocal = (file) => {
    const joined = file.startsWith('/') ? path.posix.normalize(file.slice(1)) : path.posix.normalize(path.posix.join(docDir, file));
    if (joined === '..' || joined.startsWith('../')) return null;
    return joined === '.' ? '' : joined;
  };

  const marked = new Marked({
    gfm: true,
    renderer: {
      html({ text }) {
        return escapeHtml(text);
      },
      heading({ tokens, depth, text }) {
        const inner = this.parser.parseInline(tokens);
        let slug = slugify(text) || 'section';
        const n = seen.get(slug) || 0;
        seen.set(slug, n + 1);
        if (n > 0) slug = `${slug}-${n}`;
        if (depth === 1 && title === null) title = text;
        return `<h${depth} id="${escapeHtml(slug)}">${inner}</h${depth}>\n`;
      },
      code({ text, lang }) {
        const language = (lang || '').trim().split(/\s+/)[0].toLowerCase();
        const body = escapeHtml(text);
        if (SHELL_LANGS.has(language)) {
          shellBlocks += 1;
          return (
            `<div class="shell-block" data-testid="shell-block">` +
            `<div class="shell-bar"><span class="shell-lang">${escapeHtml(language)}</span>` +
            `<button type="button" class="run-btn" data-run>執行</button></div>` +
            `<pre><code data-shell>${body}</code></pre></div>\n`
          );
        }
        const cls = language ? ` class="language-${escapeHtml(language)}"` : '';
        return `<pre><code${cls}>${body}</code></pre>\n`;
      },
      link({ href, title: linkTitle, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const t = linkTitle ? ` title="${escapeHtml(linkTitle)}"` : '';
        href = href || '';
        if (href.startsWith('#')) {
          return `<a href="${escapeHtml(href)}" data-anchor="${escapeHtml(href.slice(1))}"${t}>${inner}</a>`;
        }
        if (EXTERNAL.test(href) || href.startsWith('//')) {
          if (!/^(https?|mailto):/i.test(href)) return `<span class="blocked-link"${t}>${inner}</span>`;
          return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"${t}>${inner}</a>`;
        }
        const { file, hash } = splitHref(href);
        const target = resolveLocal(file);
        if (target === null) return `<span class="blocked-link"${t}>${inner}</span>`;
        if (MD_EXT.test(target)) {
          const missing = exists(target) ? '' : ' class="missing"';
          const frag = hash ? `#${encodeURIComponent(hash)}` : '';
          return (
            `<a href="/?p=${encodeURIComponent(target)}${frag}" data-doc="${escapeHtml(target)}"` +
            ` data-hash="${escapeHtml(hash)}"${missing}${t}>${inner}</a>`
          );
        }
        return `<a href="/api/file?p=${encodeURIComponent(target)}" target="_blank" rel="noopener"${t}>${inner}</a>`;
      },
      image({ href, title: imgTitle, text }) {
        href = href || '';
        const t = imgTitle ? ` title="${escapeHtml(imgTitle)}"` : '';
        if (/^https?:\/\//i.test(href)) {
          return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}" loading="lazy"${t}>`;
        }
        const target = EXTERNAL.test(href) ? null : resolveLocal(splitHref(href).file);
        if (target === null) return `<span class="blocked-link">${escapeHtml(text)}</span>`;
        return `<img src="/api/file?p=${encodeURIComponent(target)}" alt="${escapeHtml(text)}" loading="lazy"${t}>`;
      },
    },
  });

  const html = marked.parse(source);
  return { html, title, shellBlocks };
}

module.exports = { renderMarkdown, escapeHtml, slugify, SHELL_LANGS, MD_EXT };
