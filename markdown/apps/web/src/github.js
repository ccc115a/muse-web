// GitHub 公開資訊（免登入；公開 repo 可用，私人 repo 會 404/403 並提示）
// 注意：本站不做任何寫入操作，push 照樣在 VSCode 做

const HEADERS = { Accept: 'application/vnd.github+json' };

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers: HEADERS });
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    throw new Error('GitHub API 免登入額度用完（60/hr），稍後再試');
  }
  if (res.status === 404) throw new Error('repo 不存在或為私人（免登入看不到）');
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
}

export function repoUrl(owner, repo) {
  return `https://github.com/${owner}/${repo}`;
}

export function actionsUrl(owner, repo) {
  return `https://github.com/${owner}/${repo}/actions`;
}

export function pagesSettingsUrl(owner, repo) {
  return `https://github.com/${owner}/${repo}/settings/pages`;
}

export function pagesSiteUrl(owner, repo) {
  return `https://${owner}.github.io/${repo}/`;
}

export async function getRepoInfo(owner, repo) {
  const j = await api(`/repos/${owner}/${repo}`);
  return {
    fullName: j.full_name,
    description: j.description,
    stars: j.stargazers_count,
    defaultBranch: j.default_branch,
    isPrivate: j.private,
    updatedAt: j.updated_at ? new Date(j.updated_at).toLocaleString('zh-Hant') : '',
  };
}

export async function getActionRuns(owner, repo, n = 5) {
  const j = await api(`/repos/${owner}/${repo}/actions/runs?per_page=${n}`);
  return (j.workflow_runs ?? []).map((r) => ({
    name: r.name,
    branch: r.head_branch,
    status: r.status, // queued | in_progress | completed
    conclusion: r.conclusion, // success | failure | cancelled | null
    sha: (r.head_sha ?? '').slice(0, 7),
    time: r.updated_at ? new Date(r.updated_at).toLocaleString('zh-Hant') : '',
    url: r.html_url,
  }));
}
