import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/renderer.mjs';
import { sanitizeHtml } from '../src/sanitize.mjs';
import { exportMarkdownToHtml } from '../src/export.mjs';

describe('GFM parity', () => {
  it('table', () => {
    const h = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n');
    assert.match(h, /<table/);
  });
  it('task list', () => {
    const h = renderMarkdown('- [x] done\n- [ ] todo\n');
    assert.match(h, /checkbox/);
  });
  it('strikethrough', () => {
    const h = renderMarkdown('~~del~~');
    assert.match(h, /<s>|<del>/);
  });
  it('alert NOTE（含標題列）', () => {
    const h = renderMarkdown('> [!NOTE]\n> hello\n');
    assert.match(h, /markdown-alert-note/);
    assert.match(h, /markdown-alert-title/);
    assert.match(h, />Note</);
    assert.doesNotMatch(h, /\[!NOTE\]/);
  });
  it('code 裡的 $ 不是數學（GitHub 亦然）', () => {
    const h1 = renderMarkdown('```js\nconst p = "$x$";\n```');
    assert.doesNotMatch(h1, /katex/);
    assert.match(h1, /\$x\$/);
    const h2 = renderMarkdown('行內 `$E=mc^2$` 保持原樣');
    assert.doesNotMatch(h2, /katex/);
    assert.match(h2, /<code>\$E=mc\^2\$<\/code>/);
  });
  it('attrs 語法保持字面（GitHub 不支援 attrs）', () => {
    const h = renderMarkdown('# H {#id}\n');
    assert.match(h, /\{#id\}/);
  });
  it('footnote', () => {
    const h = renderMarkdown('hi[^1]\n\n[^1]: note\n');
    assert.match(h, /footnote/);
  });
  it('mermaid passthrough', () => {
    const h = renderMarkdown('```mermaid\ngraph TD;A-->B;\n```');
    assert.match(h, /<pre class="mermaid">/);
    assert.match(h, /graph TD/);
  });
  it('math inline + display + block', () => {
    const h1 = renderMarkdown('能量 $E=mc^2$ 好');
    assert.match(h1, /katex/);
    const h2 = renderMarkdown('$$\nx^2\n$$');
    assert.match(h2, /katex-display|katex/);
    const h3 = renderMarkdown('```math\n\\frac{a}{b}\n```');
    assert.match(h3, /katex/);
  });
  it('heading id', () => {
    const h = renderMarkdown('# Hello World\n');
    assert.match(h, /id="hello-world"/);
  });
  it('code highlight', () => {
    const h = renderMarkdown('```js\nconst a = 1;\n```');
    assert.match(h, /hljs/);
  });
  it('emoji', () => {
    const h = renderMarkdown(':rocket:');
    assert.match(h, /🚀/);
  });
});

describe('sanitize + export', () => {
  it('擋 script', async () => {
    const dirty = renderMarkdown('<script>alert(1)</script>\n\n# hi');
    const clean = await sanitizeHtml(dirty);
    assert.doesNotMatch(clean, /<script/);
    assert.match(clean, /hi/);
  });
  it('export 含 css + mermaid cdn', () => {
    const html = exportMarkdownToHtml('# T\n\n```mermaid\ngraph TD;A-->B\n```\n');
    assert.match(html, /github-markdown/);
    assert.match(html, /mermaid/);
    assert.match(html, /<title>T<\/title>/);
  });
});
