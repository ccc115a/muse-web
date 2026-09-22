import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mdPathToHtmlPath,
  pageTitleFromMarkdown,
  buildNavHtml,
  buildDirIndexPage,
  buildSitePage,
  buildSiteIndex,
  workflowYaml,
  sanitizeOutDir,
  sanitizeSrcDir,
  invalidPathReason,
  rewriteMdLinks,
} from '../src/site.mjs';

describe('site 純函數', () => {
  it('mdPathToHtmlPath', () => {
    assert.equal(mdPathToHtmlPath('docs/a.md'), 'docs/a.html');
    assert.equal(mdPathToHtmlPath('A.MD'), 'A.html');
    assert.equal(mdPathToHtmlPath('noext'), 'noext');
  });
  it('pageTitleFromMarkdown 取首個標題', () => {
    assert.equal(pageTitleFromMarkdown('# Hello\n\nbody', 'a.md'), 'Hello');
    assert.equal(pageTitleFromMarkdown('no heading', 'a.md'), 'a.md');
    assert.equal(pageTitleFromMarkdown('# **B** `c`\n', 'x'), 'B c');
  });
  it('buildNavHtml 含連結與相對前綴', () => {
    const h = buildNavHtml([{ href: 'a.html', title: 'A' }], '../');
    assert.match(h, /href="\.\.\/a\.html"/);
    assert.match(h, />A</);
  });
  it('buildSitePage 無側欄＋麵包屑可回上層', () => {
    const h = buildSitePage({ title: 'B', bodyHtml: '<p>hi</p>', href: 'docs/sub/b.html' });
    assert.match(h, /<title>B<\/title>/);
    assert.match(h, /<p>hi<\/p>/);
    assert.match(h, /mermaid/);
    assert.doesNotMatch(h, /<nav/);
    assert.match(h, /<a href="\.\.\/\.\.\/index\.html">⌂ 首頁<\/a>/);
    assert.match(h, /<a href="\.\.\/\.\.\/docs\/index\.html">docs<\/a>/);
    assert.match(h, /<a href="\.\.\/\.\.\/docs\/sub\/index\.html">sub<\/a>/);
  });
  it('buildSiteIndex 即根首頁', () => {
    const h = buildSiteIndex({ title: 'H', bodyHtml: 'x' });
    assert.match(h, /<a href="index\.html">⌂ 首頁<\/a>/);
  });
  it('buildDirIndexPage 列直屬頁面＋子目錄', () => {
    const h = buildDirIndexPage({
      dir: 'docs',
      pages: [{ href: 'docs/a.html', title: 'A' }],
      subdirs: ['sub'],
      href: 'docs/index.html',
    });
    assert.match(h, /<title>docs<\/title>/);
    assert.match(h, /<a href="a\.html">A<\/a>/);
    assert.match(h, /<a href="sub\/index\.html">sub\/<\/a>/);
    assert.match(h, /<a href="\.\.\/index\.html">⌂ 首頁<\/a>/);
  });
  it('sanitizeOutDir 擋尾斜線/空/. /..', () => {
    assert.equal(sanitizeOutDir('site/'), 'site');
    assert.equal(sanitizeOutDir(' docs/site '), 'docs/site');
    assert.throws(() => sanitizeOutDir(''), /無效/);
    assert.throws(() => sanitizeOutDir('///'), /無效/);
    assert.throws(() => sanitizeOutDir('a/../b'), /不可含 \.\./);
  });
  it('sanitizeSrcDir：空// 表根，其餘為相對路徑', () => {
    assert.equal(sanitizeSrcDir(''), '');
    assert.equal(sanitizeSrcDir('/'), '');
    assert.equal(sanitizeSrcDir('05-agent/'), '05-agent');
    assert.equal(sanitizeSrcDir('a/b'), 'a/b');
    assert.throws(() => sanitizeSrcDir('../x'), /不可含 \.\./);
  });
  it('rewriteMdLinks 只改站內 .md', () => {
    assert.equal(rewriteMdLinks('<a href="1.1.md">x</a>'), '<a href="1.1.html">x</a>');
    assert.equal(rewriteMdLinks('<a href="../a.md#sec">x</a>'), '<a href="../a.html#sec">x</a>');
    assert.equal(rewriteMdLinks('<a href="a.md?raw=1">x</a>'), '<a href="a.html?raw=1">x</a>');
    assert.equal(
      rewriteMdLinks('<a href="https://x/y.md">a</a><a href="#sec">b</a><a href="mailto:a@b">c</a><img src="i.png">'),
      '<a href="https://x/y.md">a</a><a href="#sec">b</a><a href="mailto:a@b">c</a><img src="i.png">'
    );
  });
  it('invalidPathReason 抓壞路徑', () => {
    assert.equal(invalidPathReason('a/b.html'), null);
    assert.match(invalidPathReason('a//b'), /空路徑段/);
    assert.match(invalidPathReason('../x'), /非法段/);
    assert.match(invalidPathReason(''), /為空/);
  });
  it('workflowYaml 官方 Pages Action', () => {
    const y = workflowYaml({ siteDir: 'site', branch: 'main' });
    assert.match(y, /deploy-pages@v4/);
    assert.match(y, /enablement: true/);
    assert.match(y, /path: 'site'/);
    assert.match(y, /branches: \["main"\]/);
    assert.match(y, /\$\{\{ steps\.deployment\.outputs\.page_url \}\}/);
  });
});
