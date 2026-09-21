// 讀本機 .git（唯讀，不動工作區）：HEAD、分支、remotes、最後 commit
// 需要 File System Access（Chromium）；相容模式回傳 { supported: false }
import {
  parseGitConfig,
  parseHead,
  parsePackedRefs,
  parseCommitObject,
  parseGithubRepo,
  shortSha,
  branchFromRef,
} from '@md-gh/core';

async function child(dirHandle, name) {
  try {
    return await dirHandle.getDirectoryHandle(name);
  } catch {
    return null;
  }
}

async function readTextFile(dirHandle, name) {
  try {
    const fh = await dirHandle.getFileHandle(name);
    const f = await fh.getFile();
    return await f.text();
  } catch {
    return null;
  }
}

async function inflateLoose(dirHandle, sha) {
  try {
    const d = await dirHandle.getDirectoryHandle('objects');
    const sub = await d.getDirectoryHandle(sha.slice(0, 2));
    const fh = await sub.getFileHandle(sha.slice(2));
    const blob = await fh.getFile();
    const ds = new DecompressionStream('deflate');
    const text = await new Response(blob.stream().pipeThrough(ds)).text();
    if (!text.startsWith('commit ')) return null;
    return parseCommitObject(text.slice(text.indexOf('\0') + 1));
  } catch {
    return null;
  }
}

async function listRefsRecursive(dirHandle, prefix, out) {
  let entries = [];
  try {
    entries = await Array.fromAsync(dirHandle.values());
  } catch {
    return;
  }
  for (const h of entries) {
    if (h.kind === 'directory') {
      await listRefsRecursive(h, prefix + h.name + '/', out);
    } else {
      try {
        const sha = (await (await h.getFile()).text()).trim();
        if (/^[0-9a-f]{40}$/i.test(sha)) out.push({ sha: sha.toLowerCase(), ref: prefix + h.name });
      } catch {
        // 忽略讀不到的 ref
      }
    }
  }
}

export async function readGitInfo(root) {
  if (!root?.handle) return { supported: false };
  const git = await child(root.handle, '.git');
  if (!git) return { supported: true, isGit: false };

  const head = parseHead(await readTextFile(git, 'HEAD'));
  const branch = head.ref ? branchFromRef(head.ref) : null;

  // 分支：loose refs + packed-refs 合併
  const refs = [];
  const headsDir = await child(git, 'refs');
  if (headsDir) await listRefsRecursive(headsDir, 'refs/', refs);
  for (const r of parsePackedRefs(await readTextFile(git, 'packed-refs'))) {
    if (!refs.some((x) => x.ref === r.ref)) refs.push(r);
  }
  const branches = refs.filter((r) => r.ref.startsWith('refs/heads/')).map((r) => ({
    name: r.ref.slice('refs/heads/'.length),
    sha: r.sha,
    current: head.ref === r.ref,
  }));

  const { remotes } = parseGitConfig(await readTextFile(git, 'config'));
  const currentSha = head.sha ?? branches.find((b) => b.current)?.sha ?? null;

  let lastCommit = null;
  if (currentSha) {
    const c = await inflateLoose(git, currentSha);
    // packed 裡的 commit 解不開（要讀 packfile）→ 只顯示 SHA
    lastCommit = c
      ? { sha: currentSha, short: shortSha(currentSha), ...c }
      : { sha: currentSha, short: shortSha(currentSha), subject: '（commit 在 packfile 內，僅顯示 SHA）' };
  }

  const originUrl = remotes.origin ?? Object.values(remotes)[0] ?? null;
  return {
    supported: true,
    isGit: true,
    branch,
    detached: !head.ref,
    currentSha,
    branches,
    remotes,
    lastCommit,
    github: parseGithubRepo(originUrl),
  };
}
