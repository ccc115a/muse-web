// git / GitHub 專案資訊的純函數（無 IO；讀檔與 fetch 在 apps/web）

/** 解析 .git/config，取 remotes：{ name: url } */
export function parseGitConfig(text) {
  const remotes = {};
  let cur = null;
  for (const line of (text ?? '').split('\n')) {
    const sec = /^\s*\[\s*remote\s+"([^"]+)"\s*\]/.exec(line);
    if (sec) {
      cur = sec[1];
      continue;
    }
    if (/^\s*\[/.test(line)) {
      cur = null;
      continue;
    }
    if (cur) {
      const m = /^\s*url\s*=\s*(.+?)\s*$/.exec(line);
      if (m) remotes[cur] = m[1];
    }
  }
  return { remotes };
}

/** 解析 .git/HEAD → { ref } 或 { sha }（detached） */
export function parseHead(text) {
  const s = (text ?? '').trim();
  const m = /^ref:\s*(.+?)\s*$/.exec(s);
  if (m) return { ref: m[1] };
  if (/^[0-9a-f]{40}$/i.test(s)) return { sha: s.toLowerCase() };
  return {};
}

/** 解析 .git/packed-refs → [{ sha, ref }]（跳過註解與 peeled ^ 行） */
export function parsePackedRefs(text) {
  const out = [];
  for (const line of (text ?? '').split('\n')) {
    if (!line || line.startsWith('#') || line.startsWith('^')) continue;
    const m = /^([0-9a-f]{40})\s+(.+?)\s*$/.exec(line);
    if (m) out.push({ sha: m[1].toLowerCase(), ref: m[2] });
  }
  return out;
}

/** 解析 inflate 後的 commit 物件文字 */
export function parseCommitObject(text) {
  const idx = (text ?? '').indexOf('\n\n');
  const head = idx >= 0 ? text.slice(0, idx) : text;
  const message = idx >= 0 ? text.slice(idx + 2).trim() : '';
  const info = { parents: [], message, subject: message.split('\n')[0] ?? '' };
  for (const line of head.split('\n')) {
    if (line.startsWith('tree ')) info.tree = line.slice(5).trim();
    else if (line.startsWith('parent ')) info.parents.push(line.slice(7).trim());
    else if (line.startsWith('author ')) Object.assign(info, parseIdent(line.slice(7), 'author'));
    else if (line.startsWith('committer ')) Object.assign(info, parseIdent(line.slice(10), 'committer'));
  }
  return info;
}

function parseIdent(s, prefix) {
  const m = /^(.*)\s+<([^>]*)>\s+(\d+)\s+([+-]\d{4})/.exec(s);
  if (!m) return { [`${prefix}Name`]: s.trim() };
  const d = new Date(Number(m[3]) * 1000);
  return {
    [`${prefix}Name`]: m[1],
    [`${prefix}Email`]: m[2],
    [`${prefix}Date`]: Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-Hant'),
  };
}

/** remote URL → { owner, repo }（https/ssh/git 協定，github.com 才回傳） */
export function parseGithubRepo(url) {
  if (!url) return null;
  const m = /(?:github\.com[/:])([^/\s:]+)\/([^/\s]+?)(?:\.git)?\s*$/.exec(url.trim());
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

export function shortSha(sha) {
  return (sha ?? '').slice(0, 7);
}

export function branchFromRef(ref) {
  const m = /^refs\/heads\/(.+)$/.exec(ref ?? '');
  return m ? m[1] : null;
}
