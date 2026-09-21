import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGitConfig,
  parseHead,
  parsePackedRefs,
  parseCommitObject,
  parseGithubRepo,
  shortSha,
  branchFromRef,
} from '../src/gitinfo.mjs';

describe('gitinfo 純函數', () => {
  it('parseGitConfig 取 remotes', () => {
    const cfg = `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = git@github.com:octo/hello.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[remote "up"]\n\turl = https://github.com/upstream/hello.git\n[branch "main"]\n\tremote = origin\n`;
    assert.deepEqual(parseGitConfig(cfg).remotes, {
      origin: 'git@github.com:octo/hello.git',
      up: 'https://github.com/upstream/hello.git',
    });
  });
  it('parseHead 分支與 detached', () => {
    assert.deepEqual(parseHead('ref: refs/heads/main\n'), { ref: 'refs/heads/main' });
    assert.deepEqual(parseHead('a'.repeat(40)), { sha: 'a'.repeat(40) });
    assert.deepEqual(parseHead('garbage'), {});
  });
  it('parsePackedRefs 跳過註解與 peeled', () => {
    const t = `# pack-refs with: peeled fully-peeled sorted \n${'b'.repeat(40)} refs/heads/main\n${'c'.repeat(40)} refs/tags/v1\n^${'d'.repeat(40)}\n`;
    assert.deepEqual(parsePackedRefs(t), [
      { sha: 'b'.repeat(40), ref: 'refs/heads/main' },
      { sha: 'c'.repeat(40), ref: 'refs/tags/v1' },
    ]);
  });
  it('parseCommitObject 取 subject/author', () => {
    const t = `tree ${'e'.repeat(40)}\nparent ${'f'.repeat(40)}\nauthor A U <a@x> 1726000000 +0800\ncommitter A U <a@x> 1726000000 +0800\n\nfeat: hello\n\nbody\n`;
    const c = parseCommitObject(t);
    assert.equal(c.subject, 'feat: hello');
    assert.equal(c.authorName, 'A U');
    assert.deepEqual(c.parents, ['f'.repeat(40)]);
  });
  it('parseGithubRepo 各種 URL', () => {
    assert.deepEqual(parseGithubRepo('https://github.com/octo/hello.git'), { owner: 'octo', repo: 'hello' });
    assert.deepEqual(parseGithubRepo('git@github.com:octo/hello.git'), { owner: 'octo', repo: 'hello' });
    assert.deepEqual(parseGithubRepo('https://github.com/octo/hello'), { owner: 'octo', repo: 'hello' });
    assert.equal(parseGithubRepo('https://gitlab.com/octo/hello.git'), null);
    assert.equal(parseGithubRepo(''), null);
  });
  it('shortSha/branchFromRef', () => {
    assert.equal(shortSha('abcdef1234567890'), 'abcdef1');
    assert.equal(branchFromRef('refs/heads/main'), 'main');
    assert.equal(branchFromRef('refs/tags/v1'), null);
  });
});
