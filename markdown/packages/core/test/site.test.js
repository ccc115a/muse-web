import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mdPathToHtmlPath,
  pageTitleFromMarkdown,
  buildNavHtml,
  buildSitePage,
  buildSiteIndex,
  workflowYaml,
  sanitizeOutDir,
  invalidPathReason,
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
  it('buildSitePage 含 nav＋內文＋mermaid', () => {
    const h = buildSitePage({ title: 'T', bodyHtml: '<p>hi</p>', navHtml: '<ul></ul>', depth: 1 });
    assert.match(h, /<title>T<\/title>/);
    assert.match(h, /<p>hi<\/p>/);
    assert.match(h, /mermaid/);
    assert.match(h, /href="\.\.\/index\.html"/); // depth=1 回根
  });
  it('buildSiteIndex 即 depth 0 首頁', () => {
    const h = buildSiteIndex({ title: 'H', bodyHtml: 'x', navHtml: '' });
    assert.match(h, /href="index\.html"/);
  });
  it('sanitizeOutDir 擋尾斜線/空/. /..', () => {
    assert.equal(sanitizeOutDir('site/'), 'site');
    assert.equal(sanitizeOutDir(' docs/site '), 'docs/site');
    assert.throws(() => sanitizeOutDir(''), /無效/);
    assert.throws(() => sanitizeOutDir('///'), /無效/);
    assert.throws(() => sanitizeOutDir('a/../b'), /不可含 \.\./);
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
    assert.match(y, /path: 'site'/);
    assert.match(y, /branches: \["main"\]/);
    assert.match(y, /\$\{\{ steps\.deployment\.outputs\.page_url \}\}/);
  });
});
