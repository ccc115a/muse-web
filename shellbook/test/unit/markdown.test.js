'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown, slugify } = require('../../src/markdown');

const render = (md, opts) => renderMarkdown(md, opts);

test('shell fences become runnable blocks', () => {
  const { html, shellBlocks } = render('```shell\necho hi\n```');
  assert.equal(shellBlocks, 1);
  assert.match(html, /class="shell-block"/);
  assert.match(html, /<button type="button" class="run-btn" data-run>執行<\/button>/);
  assert.match(html, /<code data-shell>echo hi<\/code>/);
});

test('sh, bash, zsh and info strings are also runnable; case-insensitive', () => {
  for (const lang of ['sh', 'bash', 'zsh', 'SHELL', 'shell title="x"']) {
    const { shellBlocks } = render('```' + lang + '\nls\n```');
    assert.equal(shellBlocks, 1, lang);
  }
});

test('non-shell code is displayed but never runnable', () => {
  for (const lang of ['js', 'python', 'json', '']) {
    const { html, shellBlocks } = render('```' + lang + '\necho hi\n```');
    assert.equal(shellBlocks, 0);
    assert.doesNotMatch(html, /data-run|data-shell/);
  }
  assert.match(render('```js\nx\n```').html, /language-js/);
});

test('indented code blocks are not runnable', () => {
  assert.equal(render('    echo hi').shellBlocks, 0);
});

test('code content is HTML-escaped and keeps multiple lines', () => {
  const { html } = render('```shell\necho "<b>&</b>"\nls\n```');
  assert.match(html, /echo &quot;&lt;b&gt;&amp;&lt;\/b&gt;&quot;\nls/);
  assert.doesNotMatch(html, /<b>/);
});

test('counts several blocks', () => {
  assert.equal(render('```shell\na\n```\n\ntext\n\n```bash\nb\n```').shellBlocks, 2);
});

test('raw HTML in markdown is escaped (no script injection)', () => {
  const { html } = render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\ntext <b onclick="x()">b</b>');
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img[^>]*onerror/i);
  assert.doesNotMatch(html, /<b onclick/i);
  assert.match(html, /&lt;script&gt;/);
});

test('javascript: / data: / vbscript: links are neutralised', () => {
  for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x']) {
    const { html } = render(`[x](${href})`);
    assert.doesNotMatch(html, /<a /, href);
    assert.match(html, /blocked-link/);
  }
});

test('external links open in a new tab safely', () => {
  const { html } = render('[g](https://example.com/a?b=1) [m](mailto:a@b.co)');
  assert.match(html, /href="https:\/\/example.com\/a\?b=1" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /href="mailto:a@b.co"/);
});

test('relative .md links become in-app navigation', () => {
  const { html } = render('[c1](01-chapter1.md)');
  assert.match(html, /href="\/\?p=01-chapter1\.md"/);
  assert.match(html, /data-doc="01-chapter1\.md"/);
});

test('relative links resolve against the current document folder', () => {
  const opts = { docPath: 'guide/part1/index.md' };
  assert.match(render('[a](next.md)', opts).html, /data-doc="guide\/part1\/next\.md"/);
  assert.match(render('[a](./next.md)', opts).html, /data-doc="guide\/part1\/next\.md"/);
  assert.match(render('[a](../README.md)', opts).html, /data-doc="guide\/README\.md"/);
  assert.match(render('[a](/top.md)', opts).html, /data-doc="top\.md"/);
});

test('links that climb out of the folder are blocked', () => {
  const { html } = render('[x](../../etc/passwd.md)', { docPath: 'a.md' });
  assert.match(html, /blocked-link/);
  assert.doesNotMatch(html, /data-doc/);
});

test('hash fragments and query strings on md links', () => {
  const { html } = render('[x](ch2.md#保持狀態) [y](ch3.md?x=1)');
  assert.match(html, /data-doc="ch2\.md" data-hash="保持狀態"/);
  assert.match(html, /href="\/\?p=ch2\.md#%E4%BF%9D%E6%8C%81%E7%8B%80%E6%85%8B"/);
  assert.match(html, /data-doc="ch3\.md"/);
});

test('percent-encoded and unicode filenames', () => {
  const { html } = render('[x](%E7%AC%AC%E4%B8%80%E7%AB%A0.md)');
  assert.match(html, /data-doc="第一章\.md"/);
});

test('links to missing documents are marked', () => {
  const exists = (p) => p === 'real.md';
  const { html } = render('[a](real.md) [b](gone.md)', { exists });
  assert.match(html, /data-doc="real\.md" data-hash=""(?! class)/);
  assert.match(html, /data-doc="gone\.md" data-hash="" class="missing"/);
});

test('in-page anchors stay in-page', () => {
  const { html } = render('[top](#intro)');
  assert.match(html, /data-anchor="intro"/);
});

test('non-markdown relative links go through /api/file', () => {
  const { html } = render('[pdf](<files/a b.pdf>)', { docPath: 'x/y.md' });
  assert.match(html, /href="\/api\/file\?p=x%2Ffiles%2Fa%20b\.pdf"/);
});

test('images: relative go through /api/file, https stay, others blocked', () => {
  const { html } = render('![a](img/p.png) ![b](https://e.com/p.png) ![c](javascript:x)', { docPath: 'd/r.md' });
  assert.match(html, /src="\/api\/file\?p=d%2Fimg%2Fp\.png"/);
  assert.match(html, /src="https:\/\/e\.com\/p\.png"/);
  assert.doesNotMatch(html, /javascript:/);
});

test('headings get stable, unique ids and the first h1 is the title', () => {
  const { html, title } = render('# Hello World\n\n## Sec\n\n## Sec\n\n## 保持 狀態');
  assert.equal(title, 'Hello World');
  assert.match(html, /<h1 id="hello-world">/);
  assert.match(html, /<h2 id="sec">/);
  assert.match(html, /<h2 id="sec-1">/);
  assert.match(html, /<h2 id="保持-狀態">/);
});

test('title is null without an h1', () => {
  assert.equal(render('## only h2').title, null);
});

test('slugify strips punctuation but keeps CJK', () => {
  assert.equal(slugify('  Hi, World! '), 'hi-world');
  assert.equal(slugify('第一章：基本'), '第一章基本');
});

test('gfm tables and inline formatting render', () => {
  const { html } = render('| a | b |\n|---|---|\n| 1 | **2** |');
  assert.match(html, /<table>/);
  assert.match(html, /<strong>2<\/strong>/);
});
