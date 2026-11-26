// Minimal, dependency-free GitHub REST client for the source monitor.
//
// Security properties:
// - Requests are only ever made to https://api.github.com; owner/repo/branch
//   only become encoded path segments. Tests may supply a loopback `apiBase`
//   only with `token: null`; any other origin is rejected at construction.
//   `//`-prefixed paths are rejected and the constructed URL's origin is
//   checked before a request.
// - The bearer token is attached only when the request origin is exactly
//   https://api.github.com; the transport uses `redirect: 'manual'` and a 3xx
//   is an error, so the header cannot be forwarded by a redirect.
// - This client does not perform DNS validation or IP pinning: the API host is
//   fixed and is not user-controlled. Public source links are checked by
//   link-health.mjs instead.
// - The token is never stored in reports or monitoring data.
// - All tree walking is read-only. Notifications are comments on the single
//   issue carrying the monitor marker.

import { createHash } from 'node:crypto';

import { createHttpTransport } from './link-health.mjs';

export const GITHUB_API_ORIGIN = 'https://api.github.com';
export const GITHUB_API_BASE = GITHUB_API_ORIGIN;
export const MONITOR_ISSUE_TITLE = '资料来源变化待核验';
export const MONITOR_ISSUE_MARKER = '<!-- ustc-source-monitor -->';
export const MAX_COMMENT_CHARS = 30_000;
export const MAX_TREE_ENTRIES = 250_000;

const USER_AGENT = 'USTC-course-navigation-source-monitor/1.0';
const API_VERSION = '2022-11-28';

export class GitHubApiError extends Error {
  constructor(message, { status = null, code = 'api_error', url = null, body = null } = {}) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.code = code;
    this.url = url;
    this.body = body;
  }
}

function getHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return entry ? entry[1] : null;
}

function encodeSegment(value, label) {
  const text = String(value ?? '').trim();
  if (!text || text.includes('/') || text.includes('\\') || /\s/.test(text)) {
    throw new GitHubApiError(`invalid ${label}`, { code: 'invalid_repository' });
  }
  return encodeURIComponent(text);
}

function apiErrorFor(status, url, text) {
  let code = 'api_error';
  if (status === 401) code = 'unauthorized';
  else if (status === 403) code = 'forbidden';
  else if (status === 404) code = 'not_found';
  else if (status === 409) code = 'conflict';
  else if (status === 422) code = 'unprocessable';
  else if (status === 429) code = 'rate_limited';
  else if (status >= 500) code = 'server_error';
  else if (status >= 300 && status < 400) code = 'redirected';
  return new GitHubApiError(`GitHub API ${status} for ${url}`, {
    status,
    code,
    url,
    body: text ? text.slice(0, 2000) : null,
  });
}

export function createGitHubClient(options = {}) {
  const {
    token = null,
    transport = createHttpTransport(),
    apiBase = GITHUB_API_BASE,
    timeoutMs = 30_000,
    maxCommentChars = MAX_COMMENT_CHARS,
  } = options;

  const base = new URL(apiBase);
  const isApiOrigin = base.origin === GITHUB_API_ORIGIN;
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  const isLoopback =
    (base.protocol === 'http:' || base.protocol === 'https:') &&
    loopbackHosts.has(base.hostname);
  if (!isApiOrigin) {
    if (token) {
      throw new TypeError('GitHub token may only be sent to https://api.github.com');
    }
    if (!isLoopback) {
      throw new TypeError(
        'GitHub API base must be https://api.github.com (loopback is allowed only without a token)',
      );
    }
  }
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.pathname !== '/' && base.pathname !== '')
  ) {
    throw new TypeError('GitHub API base must be a bare origin');
  }
  const baseOrigin = base.origin;
  const baseUrl = isApiOrigin ? GITHUB_API_ORIGIN : baseOrigin;

  async function request(path, { method = 'GET', body, accept, allowStatus = [] } = {}) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
      throw new TypeError('GitHub API path must start with a single / and stay relative');
    }
    let url;
    try {
      url = new URL(`${baseUrl}${path}`);
    } catch {
      throw new TypeError(`invalid GitHub API path: ${path}`);
    }
    if (url.origin !== baseOrigin) {
      throw new GitHubApiError('GitHub API path would change the request origin', {
        code: 'cross_origin',
        url: url.href,
      });
    }
    const headers = {
      accept: accept ?? 'application/vnd.github+json',
      'user-agent': USER_AGENT,
      'x-github-api-version': API_VERSION,
    };
    if (token) {
      if (url.origin !== GITHUB_API_ORIGIN) {
        throw new GitHubApiError('Refusing to attach a GitHub token to a non-api.github.com URL', {
          code: 'insecure_origin',
          url: url.href,
        });
      }
      headers.authorization = `Bearer ${token}`;
    }
    if (body !== undefined) headers['content-type'] = 'application/json; charset=utf-8';
    const requestUrl = url.href;

    let response;
    try {
      response = await transport({
        url: requestUrl,
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        maxBytes: 32 * 1024 * 1024,
      });
    } catch (error) {
      if (error instanceof GitHubApiError) throw error;
      throw new GitHubApiError(`GitHub API request failed: ${error?.message ?? error}`, {
        code: error?.name === 'TimeoutError' || error?.name === 'AbortError'
          ? 'timeout'
          : 'network_error',
        url: requestUrl,
      });
    }

    const text = typeof response.text === 'string' ? response.text : '';
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (response.status >= 200 && response.status < 300) {
      return { status: response.status, data, headers: response.headers, text };
    }
    if (allowStatus.includes(response.status)) {
      return { status: response.status, data, headers: response.headers, text };
    }
    if ((response.status === 403 || response.status === 429) &&
        getHeader(response.headers, 'x-ratelimit-remaining') === '0') {
      throw new GitHubApiError(`GitHub API rate limit exhausted for ${requestUrl}`, {
        status: response.status,
        code: 'rate_limited',
        url: requestUrl,
        body: text.slice(0, 2000),
      });
    }
    throw apiErrorFor(response.status, requestUrl, text);
  }

  async function paginate(path, { perPage = 100, maxPages = 20 } = {}) {
    const items = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const separator = path.includes('?') ? '&' : '?';
      const { data } = await request(`${path}${separator}per_page=${perPage}&page=${page}`);
      if (!Array.isArray(data)) {
        throw new GitHubApiError(`Expected a list from ${path}`, { code: 'invalid_response' });
      }
      items.push(...data);
      if (data.length < perPage) return items;
    }
    throw new GitHubApiError(`Pagination limit reached for ${path}`, { code: 'pagination_limit' });
  }

  const repoBase = (owner, repo) =>
    `/repos/${encodeSegment(owner, 'owner')}/${encodeSegment(repo, 'repository')}`;

  async function getRepo(owner, repo) {
    const { data } = await request(repoBase(owner, repo));
    if (!data || typeof data.default_branch !== 'string') {
      throw new GitHubApiError('Repository response is missing default_branch', {
        code: 'invalid_response',
      });
    }
    return data;
  }

  async function getBranchHead(owner, repo, branch) {
    const encoded = encodeURIComponent(branch);
    const { status, data } = await request(`${repoBase(owner, repo)}/branches/${encoded}`, {
      allowStatus: [404],
    });
    if (status === 404) {
      throw new GitHubApiError(`Branch not found: ${branch}`, { status, code: 'branch_not_found' });
    }
    const sha = data?.commit?.sha;
    if (typeof sha !== 'string' || !/^[0-9a-f]{40,64}$/i.test(sha)) {
      throw new GitHubApiError('Branch response is missing a commit SHA', {
        code: 'invalid_response',
      });
    }
    return sha;
  }

  async function getTree(owner, repo, sha, { recursive = false } = {}) {
    const suffix = recursive ? '?recursive=1' : '';
    const { data } = await request(
      `${repoBase(owner, repo)}/git/trees/${encodeURIComponent(sha)}${suffix}`,
    );
    if (!data || !Array.isArray(data.tree)) {
      throw new GitHubApiError('Tree response is malformed', { code: 'invalid_response' });
    }
    return {
      sha: data.sha ?? sha,
      truncated: data.truncated === true,
      tree: data.tree,
    };
  }

  // Complete tree walk. A truncated recursive listing is expanded through
  // per-directory listings so no subtree is silently dropped.
  async function getCompleteTree(owner, repo, rootSha) {
    const entries = [];
    const visited = new Set();
    let truncatedRegions = 0;

    async function walk(treeSha, prefix) {
      const key = `${treeSha}\u0000${prefix}`;
      if (visited.has(key)) return;
      visited.add(key);

      const listing = await getTree(owner, repo, treeSha, { recursive: true });
      if (!listing.truncated) {
        for (const entry of listing.tree) {
          entries.push({ ...entry, path: `${prefix}${entry.path}` });
          if (entries.length > MAX_TREE_ENTRIES) {
            throw new GitHubApiError('Repository tree is too large to walk', {
              code: 'tree_too_large',
            });
          }
        }
        return;
      }

      truncatedRegions += 1;
      const direct = await getTree(owner, repo, treeSha, { recursive: false });
      for (const entry of direct.tree) {
        const path = `${prefix}${entry.path}`;
        if (entry.type === 'tree') {
          await walk(entry.sha, `${path}/`);
        } else {
          entries.push({ ...entry, path });
        }
        if (entries.length > MAX_TREE_ENTRIES) {
          throw new GitHubApiError('Repository tree is too large to walk', {
            code: 'tree_too_large',
          });
        }
      }
      if (direct.truncated) {
        throw new GitHubApiError('Directory listing is truncated and cannot be expanded', {
          code: 'tree_incomplete',
        });
      }
    }

    await walk(rootSha, '');
    return { sha: rootSha, entries, truncatedRegions };
  }

  async function getCompleteTreeFiles(owner, repo, rootSha) {
    const { entries } = await getCompleteTree(owner, repo, rootSha);
    return treeToFiles(entries);
  }

  async function findMonitorIssue(owner, repo, { number = null } = {}) {
    const matches = (issue) =>
      issue &&
      !issue.pull_request &&
      issue.title === MONITOR_ISSUE_TITLE &&
      String(issue.body ?? '').includes(MONITOR_ISSUE_MARKER);

    if (number) {
      const { status, data } = await request(`${repoBase(owner, repo)}/issues/${number}`, {
        allowStatus: [404],
      });
      if (status === 200 && matches(data)) {
        return data;
      }
    }

    const issues = await paginate(`${repoBase(owner, repo)}/issues?state=all`);
    return issues.find(matches) ?? null;
  }

  async function createIssue(owner, repo, body) {
    const { data } = await request(`${repoBase(owner, repo)}/issues`, {
      method: 'POST',
      body: { title: MONITOR_ISSUE_TITLE, body },
    });
    if (!data || typeof data.number !== 'number') {
      throw new GitHubApiError('Issue creation returned no number', { code: 'invalid_response' });
    }
    return data;
  }

  async function reopenIssue(owner, repo, number) {
    const { data } = await request(`${repoBase(owner, repo)}/issues/${number}`, {
      method: 'PATCH',
      body: { state: 'open' },
    });
    return data;
  }

  async function ensureMonitorIssue(owner, repo, { number = null, body }) {
    let issue = await findMonitorIssue(owner, repo, { number });
    if (!issue) {
      issue = await createIssue(owner, repo, body);
      return { issue, created: true, reopened: false };
    }
    let reopened = false;
    if (issue.state === 'closed') {
      issue = await reopenIssue(owner, repo, issue.number);
      reopened = true;
    }
    return { issue, created: false, reopened };
  }

  async function listComments(owner, repo, issueNumber) {
    return paginate(`${repoBase(owner, repo)}/issues/${issueNumber}/comments`);
  }

  async function createComment(owner, repo, issueNumber, body) {
    if (body.length > 65_536) {
      throw new GitHubApiError('Comment exceeds GitHub hard limit', { code: 'comment_too_large' });
    }
    const { data } = await request(`${repoBase(owner, repo)}/issues/${issueNumber}/comments`, {
      method: 'POST',
      body: { body },
    });
    if (!data || typeof data.id !== 'number') {
      throw new GitHubApiError('Comment creation returned no id', { code: 'invalid_response' });
    }
    return data;
  }

  async function getContents(owner, repo, path, { ref = null } = {}) {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const { status, data } = await request(
      `${repoBase(owner, repo)}/contents/${encodedPath}${query}`,
      { allowStatus: [404] },
    );
    if (status === 404) return null;
    return data;
  }

  async function getBlob(owner, repo, sha) {
    if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) {
      throw new GitHubApiError('Contents response is missing a valid blob SHA', {
        code: 'invalid_response',
      });
    }
    const { data } = await request(`${repoBase(owner, repo)}/git/blobs/${sha}`);
    if (data?.sha !== sha || data.encoding !== 'base64' || typeof data.content !== 'string' ||
        /[^A-Za-z0-9+/=\r\n]/.test(data.content)) {
      throw new GitHubApiError(`Invalid Git blob response for ${sha}`, { code: 'invalid_response' });
    }
    const bytes = Buffer.from(data.content, 'base64');
    const actualSha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (actualSha !== sha) {
      throw new GitHubApiError(`Git blob content does not match ${sha}`, { code: 'invalid_response' });
    }
    return bytes;
  }

  async function putContents(owner, repo, path, { content, message, branch, sha = null }) {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const body = {
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
    };
    if (sha) body.sha = sha;
    try {
      const { status, data } = await request(`${repoBase(owner, repo)}/contents/${encodedPath}`, {
        method: 'PUT',
        body,
      });
      return { status, data };
    } catch (error) {
      if (error instanceof GitHubApiError && (error.status === 409 || error.status === 422) &&
          /sha|does not match|conflict/i.test(error.body ?? '')) {
        error.code = 'conflict';
      }
      throw error;
    }
  }

  return {
    token,
    apiBase: baseUrl,
    request,
    getRepo,
    getBranchHead,
    getTree,
    getCompleteTree,
    getCompleteTreeFiles,
    findMonitorIssue,
    ensureMonitorIssue,
    listComments,
    createComment,
    getContents,
    getBlob,
    putContents,
  };
}

export function treeToFiles(entries) {
  const byPath = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.sha !== 'string') continue;
    if (entry.type !== 'blob' && entry.type !== 'commit') continue;
    byPath.set(entry.path, { path: entry.path, sha: entry.sha, type: entry.type });
  }
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function diffFiles(previousFiles = [], nextFiles = []) {
  const previous = new Map(previousFiles.map((file) => [file.path, file]));
  const next = new Map(nextFiles.map((file) => [file.path, file]));

  const added = [];
  const modified = [];
  const removed = [];

  for (const [path, file] of next) {
    const old = previous.get(path);
    if (!old) {
      added.push({ ...file });
    } else if (old.sha !== file.sha || old.type !== file.type) {
      modified.push({ ...file, previous_sha: old.sha });
    }
  }
  for (const [path, file] of previous) {
    if (!next.has(path)) removed.push({ ...file });
  }

  const sortByPath = (items) => items.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    added: sortByPath(added),
    modified: sortByPath(modified),
    removed: sortByPath(removed),
    hasChanges: added.length + modified.length + removed.length > 0,
  };
}
export function githubFileUrl(owner, repo, branch, path) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const encodedBranch = branch.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${encodedBranch}/${encodedPath}`;
}


export function monitorIssueBody() {
  return [
    MONITOR_ISSUE_MARKER,
    '',
    '本 Issue 由每周资料来源监控自动维护，请勿删除顶部注释标记或修改标题。',
    '',
    '本 Issue 仅记录已登记 GitHub 仓库的文件路径与对象 SHA 变化，供维护者人工核验课程归属、年份与授权后决定是否录入正式索引。',
  ].join('\n');
}

export function sanitizeMarkerValue(value) {
  return String(value ?? '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, 80);
}

export function chunkMarker({ sourceId, oldHead, newHead, chunk, chunks }) {
  const oldValue = oldHead ? sanitizeMarkerValue(oldHead) : 'none';
  const newValue = sanitizeMarkerValue(newHead);
  return `<!-- ustc-source-monitor source=${sanitizeMarkerValue(sourceId)} old=${oldValue} new=${newValue} chunk=${chunk}/${chunks} -->`;
}


/**
 * Split a comment body into chunks under `maxChars`, preferring line
 * boundaries and never splitting a line unless it alone exceeds the budget.
 * Each chunk is prefixed with its idempotency marker by the caller.
 */
export function chunkText(text, maxChars = MAX_COMMENT_CHARS) {
  if (maxChars < 100) throw new TypeError('maxChars is too small');
  const lines = String(text).split('\n');
  const chunks = [];
  let buffer = '';

  const flush = () => {
    if (buffer) chunks.push(buffer);
    buffer = '';
  };

  for (const line of lines) {
    if (line.length > maxChars) {
      flush();
      for (let start = 0; start < line.length; start += maxChars) {
        chunks.push(line.slice(start, start + maxChars));
      }
      continue;
    }
    const candidate = buffer ? `${buffer}\n${line}` : line;
    if (candidate.length > maxChars) {
      flush();
      buffer = line;
    } else {
      buffer = candidate;
    }
  }
  flush();
  return chunks;
}

export const __test = { getHeader };
