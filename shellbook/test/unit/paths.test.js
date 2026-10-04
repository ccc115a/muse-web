'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { resolveInside, isInside, PathError } = require('../../src/paths');
const { tmpDocs } = require('../helpers');

test('isInside: root itself, children, siblings, parents', () => {
  assert.equal(isInside('/a/b', '/a/b'), true);
  assert.equal(isInside('/a/b', '/a/b/c/d'), true);
  assert.equal(isInside('/a/b', '/a/bc'), false); // prefix trap
  assert.equal(isInside('/a/b', '/a'), false);
  assert.equal(isInside('/a/b', '/a/b/../c'), false);
});

test('resolveInside: resolves normal and nested paths', () => {
  const root = tmpDocs({ 'README.md': '#', 'sub/a.md': '#' });
  assert.equal(resolveInside(root, 'README.md').rel, 'README.md');
  assert.equal(resolveInside(root, 'sub/a.md').rel, 'sub/a.md');
  assert.equal(resolveInside(root, 'sub/../README.md').rel, 'README.md');
  assert.equal(resolveInside(root, 'sub/a.md').abs, path.join(root, 'sub', 'a.md'));
});

test('resolveInside: leading slash means folder root, not filesystem root', () => {
  const root = tmpDocs({ 'README.md': '#' });
  const r = resolveInside(root, '/README.md');
  assert.equal(r.abs, path.join(root, 'README.md'));
});

test('resolveInside: allows paths that do not exist yet (caller decides 404)', () => {
  const root = tmpDocs();
  assert.equal(resolveInside(root, 'nope/new.md').rel, 'nope/new.md');
});

for (const bad of ['../x', '../../etc/passwd', 'a/../../x', '..', 'sub/../../..']) {
  test(`resolveInside: rejects traversal ${JSON.stringify(bad)}`, () => {
    const root = tmpDocs({ 'sub/a.md': '#' });
    assert.throws(() => resolveInside(root, bad), (e) => e instanceof PathError && e.status === 403);
  });
}

test('resolveInside: rejects empty, non-string and NUL bytes', () => {
  const root = tmpDocs();
  for (const v of ['', undefined, null, 42, {}, 'a\0b']) {
    assert.throws(() => resolveInside(root, v), (e) => e instanceof PathError && e.status === 400);
  }
});

test('resolveInside: rejects a missing root', () => {
  assert.throws(() => resolveInside('/definitely/not/here', 'a.md'), (e) => e.status === 404);
});

test('resolveInside: rejects symlinks that escape the folder', () => {
  const outside = tmpDocs({ 'secret.md': 'secret' });
  const root = tmpDocs({ 'README.md': '#' });
  fs.symlinkSync(outside, path.join(root, 'link'));
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'file-link.md'));
  assert.throws(() => resolveInside(root, 'link/secret.md'), (e) => e.status === 403);
  assert.throws(() => resolveInside(root, 'file-link.md'), (e) => e.status === 403);
});

test('resolveInside: allows symlinks that stay inside the folder', () => {
  const root = tmpDocs({ 'real/a.md': '#' });
  fs.symlinkSync(path.join(root, 'real'), path.join(root, 'alias'));
  assert.equal(resolveInside(root, 'alias/a.md').rel, 'alias/a.md');
});
