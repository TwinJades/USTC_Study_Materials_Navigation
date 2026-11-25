import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';

import {
  checkLinks,
  classifyResponse,
  createHttpTransport,
  parsePublicHttpUrl,
} from '../scripts/lib/link-health.mjs';
import {
  HEALTH_EVIDENCE_LABELS,
  classifyHealth,
  summarizeHealth,
} from '../site/assets/health-evidence.mjs';
import {
  chunkMarker,
  createGitHubClient,
  diffFiles,
  githubFileUrl,
  MONITOR_ISSUE_MARKER,
  monitorIssueBody,
  treeToFiles,
} from '../scripts/lib/github.mjs';
import {
  formatReport,
  MONITORING_RELATIVE_PATH,
  parseArgs,
  runMonitor,
} from '../scripts/monitor.mjs';

const NOW = new Date('2026-11-18T00:00:00.000Z');
const HEAD_OLD = 'a'.repeat(40);
const HEAD_NEW = 'b'.repeat(40);
const MONITORING_BRANCH = 'monitoring-data';
const PUBLIC_LOOKUP = async () => [{ address: '93.184.216.34', family: 4 }];

function linkRecord(url) {
  return {
    url,
    status: 'reachable',
    http_status: 200,
    reason: 'ok',
    checked_at: NOW.toISOString(),
    final_url: url,
  };
}

function linkStub(urls) {
  return async (list) => (list.length ? list : urls).map(linkRecord);
}

// ---------------------------------------------------------------------------
// Link health

test('links: reachable, missing, auth, rate limit, server error and network failures are classified', async () => {
  const calls = [];
  const transport = async ({ url, method, signal }) => {
    calls.push({ url, method });
    assert.ok(signal, 'transport receives an abort signal');
    const path = new URL(url).pathname;
    if (path === '/ok') return { status: 200, headers: {}, text: '<html>course materials</html>' };
    if (path === '/gone') return { status: 410, headers: {}, text: '' };
    if (path === '/auth') return { status: 403, headers: {}, text: '' };
    if (path === '/rate') return { status: 429, headers: {}, text: '' };
    if (path === '/broken') return { status: 503, headers: {}, text: '' };
    if (path === '/missing') return { status: 404, headers: {}, text: '' };
    if (path === '/dns') {
      const error = new Error('getaddrinfo ENOTFOUND');
      error.code = 'ENOTFOUND';
      throw error;
    }
    throw new Error(`unexpected ${url}`);
  };

  const links = await checkLinks(
    [
      'https://example.com/ok',
      'https://example.com/gone',
      'https://example.com/auth',
      'https://example.com/rate',
      'https://example.com/broken',
      'https://example.com/missing',
      'https://example.com/dns',
    ],
    { transport, lookup: PUBLIC_LOOKUP, now: () => NOW.getTime() },
  );

  const byPath = Object.fromEntries(links.map((link) => [new URL(link.url).pathname, link]));
  assert.equal(byPath['/ok'].status, 'reachable');
  assert.equal(byPath['/ok'].reason, 'ok');
  assert.equal(byPath['/gone'].status, 'missing');
  assert.equal(byPath['/missing'].status, 'missing');
  assert.equal(byPath['/auth'].status, 'unknown');
  assert.equal(byPath['/auth'].reason, 'auth_required');
  assert.equal(byPath['/rate'].reason, 'rate_limited');
  assert.equal(byPath['/broken'].reason, 'server_error');
  assert.equal(byPath['/dns'].reason, 'dns_error');
  assert.equal(byPath['/ok'].checked_at, NOW.toISOString());
  for (const link of links) {
    assert.deepEqual(
      Object.keys(link).sort(),
      ['checked_at', 'final_url', 'http_status', 'reason', 'status', 'url'].sort(),
    );
  }
  assert.ok(calls.every((call) => call.method === 'HEAD'));
});

test('links: HEAD 405 retries with a bounded GET without changing the result', async () => {
  const methods = [];
  const transport = async ({ method }) => {
    methods.push(method);
    return {
      status: method === 'HEAD' ? 405 : 200,
      headers: {},
      text: method === 'GET' ? '<html>ok</html>' : '',
    };
  };
  const [link] = await checkLinks(['https://example.com/head405'], {
    transport,
    lookup: PUBLIC_LOOKUP,
    now: () => NOW.getTime(),
  });
  assert.deepEqual(methods, ['HEAD', 'GET']);
  assert.equal(link.status, 'reachable');
  assert.equal(link.http_status, 200);
});

test('links: redirects to private or link-local addresses are blocked before the next request', async () => {
  const requested = [];
  const transport = async ({ url }) => {
    requested.push(url);
    return {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      text: '',
    };
  };
  const [link] = await checkLinks(['https://example.com/forward'], {
    transport,
    lookup: PUBLIC_LOOKUP,
    now: () => NOW.getTime(),
  });
  assert.equal(requested.length, 1, 'the private redirect target must not be requested');
  assert.equal(link.status, 'unknown');
  assert.equal(link.reason, 'private_host');
  assert.match(link.final_url, /169\.254\.169\.254/);
});

test('links: DNS answers pointing at private space are rejected before any request', async () => {
  let requested = 0;
  const transport = async () => {
    requested += 1;
    return { status: 200, headers: {}, text: '' };
  };
  const [link] = await checkLinks(['https://internal.example/page'], {
    transport,
    lookup: async () => [{ address: '10.1.2.3', family: 4 }],
    now: () => NOW.getTime(),
  });
  assert.equal(requested, 0);
  assert.equal(link.status, 'unknown');
  assert.equal(link.reason, 'private_host');
});

test('links: credentials, localhost, redirect loops, login pages and timeouts are unknown', async () => {
  const requested = [];
  const transport = async ({ url, signal }) => {
    requested.push(url);
    const path = new URL(url).pathname;
    if (path === '/loop') {
      return { status: 302, headers: { location: '/loop' }, text: '' };
    }
    if (path === '/page') {
      return { status: 302, headers: { location: 'https://example.com/login' }, text: '' };
    }
    if (path === '/login') {
      return { status: 200, headers: {}, text: '<html><title>登录</title></html>' };
    }
    if (path === '/slow') {
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      const error = new Error('aborted');
      error.name = 'TimeoutError';
      throw error;
    }
    return { status: 200, headers: {}, text: '' };
  };

  const links = await checkLinks(
    [
      'https://user:secret@example.com/private',
      'http://localhost/admin',
      'https://example.com/loop',
      'https://example.com/page',
      'https://example.com/slow',
    ],
    { transport, lookup: PUBLIC_LOOKUP, now: () => NOW.getTime(), maxRedirects: 2, timeoutMs: 20 },
  );
  const byPath = Object.fromEntries(links.map((link) => [link.url, link]));
  assert.equal(byPath['https://user:secret@example.com/private'].reason, 'credentials_in_url');
  assert.equal(byPath['http://localhost/admin'].reason, 'private_host');
  assert.equal(byPath['https://example.com/loop'].reason, 'too_many_redirects');
  assert.equal(byPath['https://example.com/page'].reason, 'login_required');
  assert.equal(byPath['https://example.com/slow'].reason, 'timeout');
  assert.ok(!requested.some((url) => url.includes('user:secret')));
  assert.ok(!requested.includes('http://localhost/admin'));
});

test('links: URL policy rejects non-http and malformed values', () => {
  assert.equal(parsePublicHttpUrl('ftp://example.com/file').reason, 'unsupported_scheme');
  assert.equal(parsePublicHttpUrl('not a url').reason, 'invalid_url');
  assert.equal(parsePublicHttpUrl('https://example.com/a#frag').url.hash, '');
  assert.deepEqual(classifyResponse({ status: 200, originalUrl: 'https://a/x', finalUrl: 'https://a/x' }), {
    status: 'reachable',
    reason: 'ok',
  });
  assert.equal(
    classifyResponse({
      status: 200,
      originalUrl: 'https://a/x',
      finalUrl: 'https://a/x',
      text: '<html><title>Page not found</title></html>',
    }).reason,
    'error_page',
  );
});

test('links: loopback fixture (test-only) reports HEAD 405 fallback through the real transport', async () => {
  let headCount = 0;
  let getCount = 0;
  const server = http.createServer((request, response) => {
    if (request.method === 'HEAD') {
      headCount += 1;
      response.writeHead(405, { allow: 'GET' });
      response.end();
      return;
    }
    getCount += 1;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<html><body>课程资料</body></html>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    const links = await checkLinks([`http://127.0.0.1:${port}/page`], {
      transport: createHttpTransport(),
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      allowPrivate: true,
      now: () => NOW.getTime(),
      timeoutMs: 4000,
    });
    assert.equal(links[0].status, 'reachable');
    assert.equal(headCount, 1);
    assert.equal(getCount, 1);

    const blocked = await checkLinks([`http://127.0.0.1:${port}/page`], {
      transport: createHttpTransport(),
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      now: () => NOW.getTime(),
      timeoutMs: 4000,
    });
    assert.equal(blocked[0].status, 'unknown');
    assert.equal(blocked[0].reason, 'private_host');
    assert.equal(headCount, 1, 'blocked loopback URLs must not be requested');
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('links: transport connects only to the addresses approved by hop validation (DNS pinning)', async () => {
  let receivedHost = null;
  const server = http.createServer((request, response) => {
    receivedHost = request.headers.host;
    response.writeHead(200, { 'content-type': 'text/plain', connection: 'close' });
    response.end('pinned');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    // `pinned.invalid` never resolves publicly. Only the injected lookup result
    // (loopback) is approved, so a transport that resolves again would fail.
    const links = await checkLinks([`http://pinned.invalid:${port}/probe`], {
      transport: createHttpTransport(),
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      allowPrivate: true,
      now: () => NOW.getTime(),
      timeoutMs: 4000,
    });
    assert.equal(links[0].status, 'reachable');
    assert.equal(receivedHost, `pinned.invalid:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('transport: sends JSON bodies so GitHub POST/PATCH/PUT calls work on the real transport', async () => {
  let receivedBody = '';
  let receivedLength = null;
  const server = http.createServer((request, response) => {
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      receivedBody += chunk;
    });
    request.on('end', () => {
      receivedLength = request.headers['content-length'];
      response.writeHead(201, { 'content-type': 'application/json', connection: 'close' });
      response.end('{"ok":true}');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    const body = JSON.stringify({ body: 'comment' });
    const transport = createHttpTransport();
    const response = await transport({
      url: `http://pinned.invalid:${port}/write`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      addresses: [{ address: '127.0.0.1', family: 4 }],
      signal: AbortSignal.timeout(4000),
    });
    assert.equal(response.status, 201);
    assert.equal(response.text, '{"ok":true}');
    assert.equal(receivedBody, body);
    assert.equal(receivedLength, String(Buffer.byteLength(body)));
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('links: redirects from different origins to one target share its per-domain limit', async () => {
  let targetActive = 0;
  let maxTargetActive = 0;
  const transport = async ({ url }) => {
    const host = new URL(url).hostname;
    if (host === 'target.test') {
      targetActive += 1;
      maxTargetActive = Math.max(maxTargetActive, targetActive);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (host === 'target.test') targetActive -= 1;
    if (host === 'a.test' || host === 'b.test') {
      return {
        status: 302,
        headers: { location: 'https://target.test/shared' },
        text: '',
      };
    }
    return { status: 200, headers: {}, text: 'ok' };
  };

  const links = await checkLinks(
    ['https://a.test/start', 'https://b.test/start'],
    {
      transport,
      lookup: PUBLIC_LOOKUP,
      now: () => NOW.getTime(),
      concurrency: 4,
      perDomain: 1,
    },
  );
  assert.deepEqual(links.map((link) => link.status), ['reachable', 'reachable']);
  assert.equal(maxTargetActive, 1, 'the shared redirect target must never run concurrently');
});

// ---------------------------------------------------------------------------
// GitHub fixtures

function createGithubFixture(options = {}) {
  const state = {
    head: options.head ?? HEAD_OLD,
    tree: options.tree ?? null,
    truncated: options.truncated ?? false,
    issue: options.issue ?? null,
    comments: options.comments ? [...options.comments] : [],
    nextCommentId: 1,
    monitoringSha: options.monitoringSha ?? null,
    monitoringContent: options.monitoringContent ?? null,
    defaultBranch: options.defaultBranch ?? 'main',
    puts: [],
    requests: [],
    treeCalls: [],
    failCommentStatus: options.failCommentStatus ?? null,
    conflictOnPut: options.conflictOnPut ?? false,
    tokenSeen: [],
  };

  const json = (status, value) => ({
    status,
    headers: { 'content-type': 'application/json' },
    text: JSON.stringify(value),
  });

  async function transport({ url, method = 'GET', headers = {}, body }) {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname);
    state.requests.push({ method, path, headers, body });
    if (headers.authorization) state.tokenSeen.push(headers.authorization);

    if (method === 'GET' && path === '/repos/o/r') {
      return json(200, { default_branch: state.defaultBranch, full_name: 'o/r' });
    }
    if (method === 'GET' && path === '/repos/o/r/branches/main') {
      return json(200, { name: 'main', commit: { sha: state.head } });
    }
    if (method === 'GET' && path.startsWith('/repos/o/r/git/trees/')) {
      const sha = path.slice('/repos/o/r/git/trees/'.length);
      const recursive = parsed.searchParams.get('recursive') === '1';
      state.treeCalls.push({ sha, recursive });
      if (state.tree && state.tree[sha]) {
        const listing = state.tree[sha][recursive ? 'recursive' : 'direct'];
        if (!listing) return json(404, { message: 'Not Found' });
        return json(200, listing);
      }
      return json(404, { message: 'Not Found' });
    }
    if (path === '/repos/o/r/issues' && method === 'GET') {
      return json(200, state.issue ? [state.issue] : []);
    }
    if (path === '/repos/o/r/issues' && method === 'POST') {
      const payload = JSON.parse(body);
      state.issue = {
        number: 7,
        state: 'open',
        title: payload.title,
        body: payload.body,
        pull_request: undefined,
      };
      return json(201, state.issue);
    }
    if (path === '/repos/o/r/issues/7' && method === 'GET') {
      if (!state.issue) return json(404, { message: 'Not Found' });
      return json(200, state.issue);
    }
    if (path === '/repos/o/r/issues/7' && method === 'PATCH') {
      state.issue = { ...state.issue, state: 'open' };
      return json(200, state.issue);
    }
    if (path === '/repos/o/r/issues/7/comments' && method === 'GET') {
      return json(200, state.comments);
    }
    if (path === '/repos/o/r/issues/7/comments' && method === 'POST') {
      if (state.failCommentStatus) {
        return json(state.failCommentStatus, { message: 'boom' });
      }
      const payload = JSON.parse(body);
      const comment = { id: state.nextCommentId++, body: payload.body };
      state.comments.push(comment);
      return json(201, comment);
    }
    if (path === `/repos/o/r/contents/${MONITORING_RELATIVE_PATH}` && method === 'GET') {
      assert.equal(parsed.searchParams.get('ref'), MONITORING_BRANCH);
      if (!state.monitoringSha) return json(404, { message: 'Not Found' });
      return json(200, {
        type: 'file',
        sha: state.monitoringSha,
        content: state.monitoringContent,
        encoding: 'base64',
        ...options.monitoringMetadata,
      });
    }
    if (method === 'GET' && path === `/repos/o/r/git/blobs/${state.monitoringSha}` && options.blob) {
      return json(options.blobStatus ?? 200, options.blob);
    }
    if (path === `/repos/o/r/contents/${MONITORING_RELATIVE_PATH}` && method === 'PUT') {
      const payload = JSON.parse(body);
      assert.equal(payload.branch, MONITORING_BRANCH);
      if (state.conflictOnPut || (payload.sha && payload.sha !== state.monitoringSha)) {
        return json(409, { message: 'sha does not match the current file' });
      }
      state.puts.push(payload);
      state.monitoringSha = blobSha(Buffer.from(payload.content, 'base64'));
      state.monitoringContent = payload.content;
      return json(200, { content: { sha: state.monitoringSha }, commit: { sha: 'commit-1' } });
    }
    return json(404, { message: `unhandled ${method} ${path}` });
  }

  return { state, transport, client: createGitHubClient({ token: 'test-token', transport }) };
}

function treeFromFiles(files) {
  return {
    [HEAD_OLD]: {
      recursive: {
        sha: HEAD_OLD,
        truncated: false,
        tree: Object.entries(files).map(([path, sha]) => ({
          path,
          type: 'blob',
          mode: '100644',
          sha,
        })),
      },
    },
    [HEAD_NEW]: {
      recursive: {
        sha: HEAD_NEW,
        truncated: false,
        tree: Object.entries(files).map(([path, sha]) => ({
          path,
          type: 'blob',
          mode: '100644',
          sha,
        })),
      },
    },
  };
}

function blobSha(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function seedMonitoring(fixture, monitoring) {
  const content = encodeMonitoring(monitoring);
  fixture.state.monitoringContent = content;
  fixture.state.monitoringSha = blobSha(Buffer.from(content, 'base64'));
}

function encodeMonitoring(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8').toString('base64');
}

function monitoringWith(files, { head = HEAD_OLD, issueNumber = null } = {}) {
  return {
    schema_version: 1,
    checked_at: '2026-11-17T00:00:00.000Z',
    links: [],
    repositories: {
      'src-a': {
        head_sha: head,
        files: Object.entries(files).map(([path, sha]) => ({ path, sha, type: 'blob' })),
        last_checked_at: '2026-11-17T00:00:00.000Z',
      },
    },
    issue_number: issueNumber,
  };
}

function baseRunOptions(fixture, { monitoring = null, mode = 'dry-run' } = {}) {
  if (mode === 'publish' && monitoring && fixture.state && !fixture.state.monitoringSha) {
    seedMonitoring(fixture, monitoring);
  }
  const saved = { value: null };
  const sources = [
    {
      id: 'src-a',
      name: '资料仓库 A',
      url: 'https://example.com/source-a',
      github: { owner: 'o', repo: 'r', branch: 'main' },
    },
  ];
  return {
    saved,
    options: {
      mode,
      sources,
      resources: [],
      loadMonitoring: async () => monitoring,
      saveMonitoring: async (value) => {
        saved.value = value;
      },
      client: fixture.client,
      checkLinksImpl: linkStub(['https://example.com/source-a']),
      now: () => NOW,
      target: { owner: 'o', repo: 'r' },
      token: 'test-token',
    },
  };
}

test('github: tokens are confined to api.github.com and paths cannot change the host', async () => {
  const seen = [];
  const transport = async ({ url, headers }) => {
    seen.push({ url, headers });
    return {
      status: 200,
      headers: {},
      text: JSON.stringify({ default_branch: 'main' }),
    };
  };

  const client = createGitHubClient({ token: 'secret-token', transport });
  await client.getRepo('o', 'r');
  assert.equal(new URL(seen[0].url).origin, 'https://api.github.com');
  assert.equal(seen[0].headers.authorization, 'Bearer secret-token');

  assert.throws(
    () => createGitHubClient({ token: 'secret-token', apiBase: 'https://example.test' }),
    /api\.github\.com/,
  );
  assert.throws(
    () => createGitHubClient({ token: 'secret-token', apiBase: 'http://127.0.0.1:9' }),
    /api\.github\.com/,
  );
  assert.throws(
    () => createGitHubClient({ token: null, apiBase: 'https://example.test' }),
    /api\.github\.com/,
  );

  const anonymous = createGitHubClient({
    token: null,
    apiBase: 'http://127.0.0.1:9',
    transport,
  });
  await anonymous.request('/rate_limit');
  const loopbackRequest = seen.at(-1);
  assert.equal(loopbackRequest.url, 'http://127.0.0.1:9/rate_limit');
  assert.equal(loopbackRequest.headers.authorization, undefined);

  await assert.rejects(
    () => client.request('//evil.example/steal'),
    /path must start with a single/,
  );
  await assert.rejects(
    () => client.request('https://evil.example/steal'),
    /path must start with a single/,
  );
});

test('github: tree helpers produce stable baselines and a set difference', () => {
  const files = treeToFiles([
    { path: 'b.txt', type: 'blob', sha: '2' },
    { path: 'a.txt', type: 'blob', sha: '1' },
    { path: 'dir', type: 'tree', sha: 't' },
    { path: 'a.txt', type: 'blob', sha: '1' },
  ]);
  assert.deepEqual(files.map((file) => file.path), ['a.txt', 'b.txt']);

  const diff = diffFiles(
    [
      { path: 'keep', sha: '1', type: 'blob' },
      { path: 'change', sha: '2', type: 'blob' },
      { path: 'remove', sha: '3', type: 'blob' },
    ],
    [
      { path: 'keep', sha: '1', type: 'blob' },
      { path: 'change', sha: '2b', type: 'blob' },
      { path: 'add', sha: '4', type: 'blob' },
    ],
  );
  assert.deepEqual(diff.added.map((file) => file.path), ['add']);
  assert.deepEqual(diff.modified.map((file) => file.path), ['change']);
  assert.deepEqual(diff.removed.map((file) => file.path), ['remove']);
  assert.equal(diff.hasChanges, true);
  assert.equal(diffFiles([], []).hasChanges, false);
  assert.equal(
    githubFileUrl('o', 'r', 'main', 'a b/c.txt'),
    'https://github.com/o/r/blob/main/a%20b/c.txt',
  );
});

test('monitor: dry-run initialises the baseline in the report but writes nothing', async () => {
  const fixture = createGithubFixture({ tree: treeFromFiles({ 'a.txt': 'sha-a' }) });
  const { options, saved } = baseRunOptions(fixture, { mode: 'dry-run' });
  const report = await runMonitor(options);

  assert.equal(report.repositories[0].status, 'initialized');
  assert.equal(report.monitoring.repositories['src-a'].head_sha, HEAD_OLD);
  assert.equal(report.monitoring.repositories['src-a'].files.length, 1);
  assert.equal(saved.value, null);
  assert.equal(fixture.state.puts.length, 0);
  assert.equal(fixture.state.issue, null);
  assert.ok(
    fixture.state.requests.every((request) => ['GET'].includes(request.method)),
    'dry-run must not issue write requests',
  );
  assert.ok(fixture.state.tokenSeen.every((value) => value === 'Bearer test-token'));
});

test('monitor: repository baselines for deregistered sources do not leak into monitoring', async () => {
  const fixture = createGithubFixture({ tree: treeFromFiles({ 'a.txt': 'sha-a' }) });
  const monitoring = monitoringWith({ 'a.txt': 'sha-a' });
  monitoring.repositories['src-old'] = {
    head_sha: HEAD_OLD,
    files: [],
    last_checked_at: '2026-01-01T00:00:00.000Z',
  };
  const { options } = baseRunOptions(fixture, { mode: 'dry-run', monitoring });
  const report = await runMonitor(options);
  assert.deepEqual(Object.keys(report.monitoring.repositories), ['src-a']);
});

test('monitor: write-local saves the first baseline and skips the tree when the head is unchanged', async () => {
  const fixture = createGithubFixture({ tree: treeFromFiles({ 'a.txt': 'sha-a' }) });
  const first = baseRunOptions(fixture, { mode: 'write-local' });
  const report = await runMonitor(first.options);
  assert.equal(report.repositories[0].status, 'initialized');
  assert.equal(first.saved.value.repositories['src-a'].head_sha, HEAD_OLD);
  assert.ok(
    fixture.state.requests.every((request) => request.method === 'GET'),
    'write-local must not call GitHub write APIs',
  );

  const treeCallsAfterFirst = fixture.state.treeCalls.length;
  const second = baseRunOptions(fixture, {
    mode: 'write-local',
    monitoring: first.saved.value,
  });
  const secondReport = await runMonitor(second.options);
  assert.equal(secondReport.repositories[0].status, 'unchanged');
  assert.equal(fixture.state.treeCalls.length, treeCallsAfterFirst);
  assert.equal(second.saved.value.repositories['src-a'].head_sha, HEAD_OLD);
});

test('monitor: write-local keeps the old baseline while file changes await publication', async () => {
  const oldFiles = { 'keep.txt': 'sha-keep', 'change.txt': 'sha-old', 'remove.txt': 'sha-remove' };
  const tree = treeFromFiles(oldFiles);
  tree[HEAD_NEW].recursive.tree = [
    { path: 'keep.txt', type: 'blob', sha: 'sha-keep' },
    { path: 'change.txt', type: 'blob', sha: 'sha-new' },
    { path: 'add.txt', type: 'blob', sha: 'sha-add' },
  ];
  const fixture = createGithubFixture({ head: HEAD_NEW, tree });
  const monitoring = monitoringWith(oldFiles);
  const { options, saved } = baseRunOptions(fixture, { mode: 'write-local', monitoring });
  const report = await runMonitor(options);

  assert.equal(report.repositories[0].status, 'changed');
  assert.deepEqual(report.repositories[0].diff.added.map((f) => f.path), ['add.txt']);
  assert.deepEqual(report.repositories[0].diff.modified.map((f) => f.path), ['change.txt']);
  assert.deepEqual(report.repositories[0].diff.removed.map((f) => f.path), ['remove.txt']);
  assert.deepEqual(report.pending_sources, ['src-a']);
  assert.equal(saved.value.repositories['src-a'].head_sha, HEAD_OLD, 'pending changes are not swallowed');
  assert.equal(fixture.state.issue, null);
});

test('monitor: publish refuses a missing seed even when the checkout has a baseline', async () => {
  const fixture = createGithubFixture();
  const { options, saved } = baseRunOptions(fixture, { mode: 'publish' });
  options.loadMonitoring = () => monitoringWith({ 'local.txt': HEAD_OLD });
  options.checkLinksImpl = () => assert.fail('must not check links with no published baseline');
  await assert.rejects(runMonitor(options), { code: 'remote_monitoring_missing' });
  assert.equal(saved.value, null);
  assert.ok(fixture.state.requests.every(({ method }) => method === 'GET'));
});

test('monitor: publish refuses to write when monitoring-data is the default branch', async () => {
  const fixture = createGithubFixture({ defaultBranch: MONITORING_BRANCH });
  const { options } = baseRunOptions(fixture, { mode: 'publish', monitoring: monitoringWith({}) });
  await assert.rejects(runMonitor(options), { code: 'invalid_target' });
  assert.ok(fixture.state.requests.every(({ method }) => method === 'GET'));
});

function largeMonitoringFixture(bytes, { blobStatus, blobPatch, contentsPatch } = {}) {
  const sha = blobSha(bytes);
  return createGithubFixture({
    head: HEAD_NEW,
    tree: treeFromFiles({ 'new.txt': HEAD_NEW }),
    monitoringSha: sha,
    monitoringMetadata: { encoding: 'none', content: '', size: bytes.length, ...contentsPatch },
    blobStatus,
    blob: { sha, encoding: 'base64', content: `${bytes.toString('base64')}\n`, ...blobPatch },
  });
}

test('monitor: publish reads a large baseline by its blob SHA before checking, then PUTs with that SHA', async () => {
  const baseline = monitoringWith({ 'old.txt': HEAD_OLD });
  baseline.repositories['src-retired'] = {
    head_sha: HEAD_OLD,
    files: [],
    last_checked_at: baseline.checked_at,
  };
  const fixture = largeMonitoringFixture(Buffer.from(`${JSON.stringify(baseline)}${' '.repeat(1024 * 1024)}`));
  const startingSha = fixture.state.monitoringSha;
  const { options, saved } = baseRunOptions(fixture, { mode: 'publish' });
  const checkLinks = options.checkLinksImpl;
  options.checkLinksImpl = (...args) => {
    assert.deepEqual(fixture.state.requests.map(({ method, path }) => [method, path]), [
      ['GET', '/repos/o/r'],
      ['GET', `/repos/o/r/contents/${MONITORING_RELATIVE_PATH}`],
      ['GET', `/repos/o/r/git/blobs/${startingSha}`],
    ]);
    return checkLinks(...args);
  };
  const report = await runMonitor(options);

  assert.equal(report.repositories[0].status, 'changed');
  assert.deepEqual(report.repositories[0].diff.removed.map(({ path }) => path), ['old.txt']);
  assert.equal(fixture.state.comments.length, 1);
  assert.deepEqual(fixture.state.puts.map(({ sha }) => sha), [startingSha]);
  assert.equal(saved.value.repositories['src-a'].head_sha, HEAD_NEW);
  assert.equal(Object.hasOwn(saved.value.repositories, 'src-retired'), false);
  const published = JSON.parse(Buffer.from(fixture.state.puts[0].content, 'base64'));
  assert.equal(Object.hasOwn(published.repositories, 'src-retired'), false);
});

test('monitor: an unreadable or invalid large remote baseline makes no writes', async (t) => {
  const baseline = monitoringWith({ 'old.txt': HEAD_OLD });
  const valid = JSON.stringify(baseline);
  const invalidHead = JSON.stringify({
    ...baseline,
    repositories: { 'src-a': { ...baseline.repositories['src-a'], head_sha: 'wrong', files: [] } },
  });
  const invalidLink = JSON.stringify({ ...baseline, links: [null] });
  for (const [name, text, response, expectedError] of [
    ['missing blob', valid, { blobStatus: 404 }, { status: 404 }],
    ['wrong blob SHA', valid, { blobPatch: { sha: HEAD_NEW } }, { code: 'invalid_response' }],
    ['wrong blob bytes', valid, { blobPatch: { content: 'e30=' } }, { code: 'invalid_response' }],
    ['invalid JSON', '{', {}, { code: 'invalid_remote_monitoring' }],
    ['JSON null', 'null', {}, { code: 'invalid_monitoring' }],
    ['invalid schema', '{}', {}, { code: 'invalid_monitoring' }],
    ['invalid repository head SHA', invalidHead, {}, { code: 'invalid_monitoring', message: /head_sha/ }],
    ['invalid link entry', invalidLink, {}, { code: 'invalid_monitoring', message: /links\[0\]/ }],
    ['missing starting SHA', valid, { contentsPatch: { sha: null } }, { code: 'invalid_response' }],
    ['non-file', valid, { contentsPatch: { type: 'symlink' } }, { code: 'remote_content_unavailable' }],
  ]) {
    await t.test(name, async () => {
      const fixture = largeMonitoringFixture(Buffer.from(text), response);
      const { options, saved } = baseRunOptions(fixture, { mode: 'publish' });
      options.checkLinksImpl = () => assert.fail('baseline must be verified before checking links');
      await assert.rejects(runMonitor(options), expectedError);
      assert.equal(saved.value, null);
      assert.deepEqual(fixture.state.requests.filter(({ method }) => method !== 'GET'), []);
      if (expectedError.code === 'remote_content_unavailable') {
        assert.equal(fixture.state.requests.length, 2, 'non-files must not trigger a blob read');
      }
    });
  }
});

test('monitor: publish creates the marked issue, posts once and advances the baseline', async () => {
  const oldFiles = { 'old.txt': HEAD_OLD };
  const tree = treeFromFiles(oldFiles);
  tree[HEAD_NEW].recursive.tree = [
    { path: 'old.txt', type: 'blob', sha: HEAD_OLD },
    { path: 'new.txt', type: 'blob', sha: HEAD_NEW },
  ];
  const fixture = createGithubFixture({ head: HEAD_NEW, tree });
  const monitoring = monitoringWith(oldFiles);
  const { options, saved } = baseRunOptions(fixture, { mode: 'publish', monitoring });
  const report = await runMonitor(options);

  assert.equal(report.repositories[0].status, 'changed');
  assert.equal(fixture.state.issue.title, '资料来源变化待核验');
  assert.ok(fixture.state.issue.body.includes(MONITOR_ISSUE_MARKER));
  assert.equal(fixture.state.comments.length, 1);
  assert.match(fixture.state.comments[0].body, /new\.txt/);
  assert.match(fixture.state.comments[0].body, new RegExp(HEAD_NEW.slice(0, 8)));
  assert.equal(report.issue_number, 7);
  assert.equal(saved.value.repositories['src-a'].head_sha, HEAD_NEW);
  assert.equal(saved.value.issue_number, 7);
  assert.equal(fixture.state.puts.length, 1);
  const uploaded = JSON.parse(Buffer.from(fixture.state.puts[0].content, 'base64').toString('utf8'));
  assert.equal(uploaded.repositories['src-a'].head_sha, HEAD_NEW);
  assert.equal(uploaded.schema_version, 1);
});

test('monitor: repeated publish is idempotent and posts no duplicate comments', async () => {
  const oldFiles = { 'old.txt': HEAD_OLD };
  const tree = treeFromFiles(oldFiles);
  tree[HEAD_NEW].recursive.tree = [{ path: 'new.txt', type: 'blob', sha: HEAD_NEW }];
  const fixture = createGithubFixture({ head: HEAD_NEW, tree });
  const first = baseRunOptions(fixture, { mode: 'publish', monitoring: monitoringWith(oldFiles) });
  await runMonitor(first.options);
  const commentCount = fixture.state.comments.length;

  const second = baseRunOptions(fixture, { mode: 'publish', monitoring: first.saved.value });
  const report = await runMonitor(second.options);
  assert.equal(report.repositories[0].status, 'unchanged');
  assert.equal(fixture.state.comments.length, commentCount);
  assert.equal(report.notifications.posted, 0);
});

test('monitor: notification failure rejects the run and does not advance the baseline or write monitoring', async () => {
  const oldFiles = { 'old.txt': HEAD_OLD };
  const tree = treeFromFiles(oldFiles);
  tree[HEAD_NEW].recursive.tree = [{ path: 'new.txt', type: 'blob', sha: HEAD_NEW }];
  const fixture = createGithubFixture({
    head: HEAD_NEW,
    tree,
    failCommentStatus: 503,
  });
  const { options, saved } = baseRunOptions(fixture, {
    mode: 'publish',
    monitoring: monitoringWith(oldFiles),
  });

  await assert.rejects(() => runMonitor(options), (error) => {
    assert.equal(error.status, 503);
    return true;
  });
  assert.equal(saved.value, null);
  assert.equal(fixture.state.puts.length, 0, 'monitoring must not be overwritten');
  assert.equal(fixture.state.comments.length, 0);
});

test('monitor: long change reports are chunked under the comment limit and stay idempotent', async () => {
  const oldFiles = { 'old.txt': HEAD_OLD };
  const tree = treeFromFiles(oldFiles);
  tree[HEAD_NEW].recursive.tree = [{ path: 'old.txt', type: 'blob', sha: HEAD_OLD }];
  for (let i = 0; i < 900; i += 1) {
    tree[HEAD_NEW].recursive.tree.push({
      path: `exams/2025/course-${String(i).padStart(4, '0')}-final-paper-with-a-long-name.pdf`,
      type: 'blob',
      sha: i.toString(16).padStart(40, '0'),
    });
  }
  const fixture = createGithubFixture({ head: HEAD_NEW, tree });
  const first = baseRunOptions(fixture, { mode: 'publish', monitoring: monitoringWith(oldFiles) });
  const report = await runMonitor(first.options);

  assert.ok(fixture.state.comments.length > 1, 'report is split into chunks');
  assert.equal(report.notifications.posted, fixture.state.comments.length);
  const markers = new Set();
  for (const comment of fixture.state.comments) {
    assert.ok(comment.body.length <= 30_000, `chunk too long: ${comment.body.length}`);
    const marker = comment.body.split('\n')[0];
    assert.match(marker, /^<!-- ustc-source-monitor source=src-a old=/);
    assert.ok(!markers.has(marker), 'chunk markers are unique');
    markers.add(marker);
  }

  const second = baseRunOptions(fixture, { mode: 'publish', monitoring: first.saved.value });
  await runMonitor(second.options);
  assert.equal(fixture.state.comments.length, report.notifications.posted);
});

test('monitor: a truncated recursive tree is expanded through subtrees without losing files', async () => {
  const tree = {
    [HEAD_OLD]: {
      recursive: {
        sha: HEAD_OLD,
        truncated: true,
        tree: [
          { path: 'a.txt', type: 'blob', sha: 'sha-a' },
          { path: 'dir', type: 'tree', sha: 't2' },
        ],
      },
      direct: {
        sha: HEAD_OLD,
        truncated: false,
        tree: [
          { path: 'a.txt', type: 'blob', sha: 'sha-a' },
          { path: 'dir', type: 'tree', sha: 't2' },
        ],
      },
    },
    t2: {
      recursive: {
        sha: 't2',
        truncated: true,
        tree: [{ path: 'b.txt', type: 'blob', sha: 'sha-b' }],
      },
      direct: {
        sha: 't2',
        truncated: false,
        tree: [
          { path: 'b.txt', type: 'blob', sha: 'sha-b' },
          { path: 'sub', type: 'tree', sha: 't3' },
        ],
      },
    },
    t3: {
      recursive: {
        sha: 't3',
        truncated: false,
        tree: [{ path: 'c.txt', type: 'blob', sha: 'sha-c' }],
      },
    },
  };
  const fixture = createGithubFixture({ tree });
  const { options } = baseRunOptions(fixture, { mode: 'dry-run' });
  const report = await runMonitor(options);
  assert.deepEqual(
    report.repositories[0].files.map((file) => file.path),
    ['a.txt', 'dir/b.txt', 'dir/sub/c.txt'],
  );
  assert.equal(report.repositories[0].status, 'initialized');
  assert.ok(fixture.state.treeCalls.some((call) => call.sha === 't3'));
});

test('monitor: publish keeps the starting SHA so a remote edit during checks causes a conflict', async () => {
  const oldFiles = { 'old.txt': HEAD_OLD };
  const tree = treeFromFiles(oldFiles);
  tree[HEAD_NEW].recursive.tree = [{ path: 'new.txt', type: 'blob', sha: HEAD_NEW }];
  const fixture = createGithubFixture({
    head: HEAD_NEW,
    tree,
    monitoringSha: HEAD_OLD,
    monitoringContent: encodeMonitoring(monitoringWith(oldFiles)),
  });
  const baseTransport = fixture.transport;
  let remoteEdited = false;
  const transport = async (requestOptions) => {
    const path = new URL(requestOptions.url).pathname;
    if (!remoteEdited && path.endsWith('/branches/main')) {
      remoteEdited = true;
      fixture.state.monitoringSha = 'mon-remote-edit';
      fixture.state.monitoringContent = encodeMonitoring(
        monitoringWith({ 'edited.txt': 'sha-edited' }),
      );
    }
    return baseTransport(requestOptions);
  };
  const client = createGitHubClient({ token: 'test-token', transport });
  // The local checkout has no monitoring file; the remote content must be the
  // baseline (otherwise this would be treated as an initial baseline).
  const { options, saved } = baseRunOptions({ client }, {
    mode: 'publish',
    monitoring: null,
  });

  await assert.rejects(() => runMonitor(options), (error) => {
    assert.equal(error.code, 'conflict');
    return true;
  });
  assert.equal(remoteEdited, true);
  assert.equal(saved.value, null);
  assert.equal(fixture.state.puts.length, 0);
  assert.equal(fixture.state.monitoringSha, 'mon-remote-edit');
  const putRequest = fixture.state.requests.filter((request) => request.method === 'PUT').at(-1);
  assert.ok(putRequest, 'publish must attempt the final PUT');
  assert.equal(JSON.parse(putRequest.body).sha, HEAD_OLD);
});

test('monitor: contents update conflict is reported and never overwrites the concurrent file', async () => {
  const oldFiles = { 'old.txt': HEAD_OLD };
  const tree = treeFromFiles(oldFiles);
  tree[HEAD_NEW].recursive.tree = [{ path: 'new.txt', type: 'blob', sha: HEAD_NEW }];
  const fixture = createGithubFixture({ head: HEAD_NEW, tree, conflictOnPut: true });
  const { options, saved } = baseRunOptions(fixture, {
    mode: 'publish',
    monitoring: monitoringWith(oldFiles),
  });

  await assert.rejects(() => runMonitor(options), (error) => {
    assert.equal(error.code, 'conflict');
    return true;
  });
  assert.equal(saved.value, null);
  assert.equal(fixture.state.puts.length, 0);
});

test('monitor: monitoring reports link failures without touching resources', async () => {
  const fixture = createGithubFixture({ tree: treeFromFiles({ 'a.txt': 'sha-a' }) });
  const sources = [
    {
      id: 'src-a',
      name: 'A',
      url: 'https://example.com/source-a',
      github: { owner: 'o', repo: 'r', branch: 'main' },
    },
  ];
  const resources = [
    {
      id: 'res-1',
      locations: [
        {
          source_id: 'src-a',
          page_url: 'https://example.com/missing',
          download_page: null,
          download_url: null,
        },
      ],
    },
  ];
  const resourcesSnapshot = structuredClone(resources);
  const { options } = baseRunOptions(fixture, { mode: 'dry-run' });
  options.sources = sources;
  options.resources = resources;
  options.checkLinksImpl = async (urls) =>
    urls.map((url) => ({
      url,
      status: url.endsWith('/missing') ? 'missing' : 'reachable',
      http_status: url.endsWith('/missing') ? 404 : 200,
      reason: url.endsWith('/missing') ? 'not_found' : 'ok',
      checked_at: NOW.toISOString(),
      final_url: url,
    }));

  const report = await runMonitor(options);
  assert.equal(report.links.length, 2);
  assert.equal(report.link_summary.missing, 1);
  assert.equal(report.monitoring.repositories['src-a'].head_sha, HEAD_OLD);
  assert.deepEqual(resources, resourcesSnapshot);
});

test('monitor: GitHub rate limiting is a per-source error and keeps the previous baseline', async () => {
  const transport = async ({ url }) => {
    if (new URL(url).pathname.endsWith('/branches/main')) {
      return {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
        text: JSON.stringify({ message: 'API rate limit exceeded' }),
      };
    }
    throw new Error(`unexpected request ${url}`);
  };
  const client = createGitHubClient({ token: 'test-token', transport });
  await assert.rejects(() => client.getBranchHead('o', 'r', 'main'), (error) => {
    assert.equal(error.code, 'rate_limited');
    return true;
  });

  const { options } = baseRunOptions({ client }, {
    mode: 'dry-run',
    monitoring: monitoringWith({ 'a.txt': 'sha-a' }),
  });
  const report = await runMonitor(options);
  assert.equal(report.repositories[0].status, 'error');
  assert.equal(report.repositories[0].error.code, 'rate_limited');
  assert.equal(report.monitoring.repositories['src-a'].head_sha, HEAD_OLD);
  assert.deepEqual(report.monitoring.repositories['src-a'].files, [
    { path: 'a.txt', sha: 'sha-a', type: 'blob' },
  ]);
});

test('monitor: branch 404 is a source error that preserves the previous baseline', async () => {
  const transport = async ({ url }) => {
    if (new URL(url).pathname.endsWith('/branches/main')) {
      return { status: 404, headers: {}, text: JSON.stringify({ message: 'Branch not found' }) };
    }
    throw new Error(`unexpected request ${url}`);
  };
  const client = createGitHubClient({ token: 'test-token', transport });
  const { options, saved } = baseRunOptions({ client }, {
    mode: 'write-local',
    monitoring: monitoringWith({ 'a.txt': 'sha-a' }),
  });
  const report = await runMonitor(options);
  assert.equal(report.repositories[0].status, 'error');
  assert.equal(report.repositories[0].error.code, 'branch_not_found');
  assert.equal(saved.value.repositories['src-a'].head_sha, HEAD_OLD);
  assert.deepEqual(saved.value.repositories['src-a'].files, [
    { path: 'a.txt', sha: 'sha-a', type: 'blob' },
  ]);
});

// ---------------------------------------------------------------------------
// CLI helpers and chunk marker shape

test('monitor: arguments default to dry-run and reject conflicting modes', () => {
  assert.deepEqual(parseArgs([]), { mode: 'dry-run', repo: null, help: false });
  assert.equal(parseArgs(['--publish', '--repo', 'o/r']).mode, 'publish');
  assert.equal(parseArgs(['--publish', '--repo', 'o/r']).repo, 'o/r');
  assert.equal(parseArgs(['--load-published']).mode, 'load-published');
  assert.throws(() => parseArgs(['--dry-run', '--publish']), /只能选择一个运行模式/);
  assert.throws(() => parseArgs(['--unknown']), /未知参数/);
});

test('github: chunk markers are stable and safe for idempotent comment matching', () => {
  const marker = chunkMarker({
    sourceId: 'src a/1',
    oldHead: HEAD_OLD,
    newHead: HEAD_NEW,
    chunk: 2,
    chunks: 5,
  });
  assert.match(marker, /source=src-a-1/);
  assert.match(marker, /chunk=2\/5/);
  assert.ok(marker.endsWith(' -->'));
  assert.ok(monitorIssueBody().includes(MONITOR_ISSUE_MARKER));
});

// ---------------------------------------------------------------------------
// Link health evidence and preflight write protection

test('health evidence: categories distinguish HTTP responses, preflight stops and never-checked entries', () => {
  const checkedAt = NOW.toISOString();
  const cases = [
    [{ status: 'reachable', http_status: 200, reason: 'ok', checked_at: checkedAt }, 'responded'],
    [{ status: 'unknown', http_status: 503, reason: 'server_error', checked_at: checkedAt }, 'responded'],
    [{ status: 'missing', http_status: 410, reason: 'not_found', checked_at: checkedAt }, 'missing'],
    [{ status: 'unknown', http_status: 401, reason: 'auth_required', checked_at: checkedAt }, 'auth'],
    [{ status: 'reachable', http_status: 200, reason: 'login_required', checked_at: checkedAt }, 'auth'],
    [{ status: 'unknown', http_status: null, reason: 'private_host', checked_at: checkedAt }, 'preflight'],
    [{ status: 'unknown', http_status: 302, reason: 'private_host', checked_at: checkedAt }, 'preflight'],
    [{ status: 'unknown', http_status: null, reason: 'dns_error', checked_at: checkedAt }, 'preflight'],
    [{ status: 'unknown', http_status: null, reason: 'timeout', checked_at: checkedAt }, 'no_response'],
    [{ status: 'unknown', http_status: null, reason: 'connection_refused', checked_at: checkedAt }, 'no_response'],
    [{ status: 'unchecked', http_status: null, reason: null, checked_at: null }, 'unchecked'],
    [{ url: 'https://example.com/never-checked' }, 'unchecked'],
    [null, 'unchecked'],
  ];
  for (const [entry, expected] of cases) {
    assert.equal(classifyHealth(entry), expected, JSON.stringify(entry));
  }
  assert.equal(
    classifyHealth({ status: 'unknown', http_status: 503, checked_at: checkedAt }),
    'responded',
    '5xx is an observed response, not a missing file',
  );
  assert.deepEqual(
    Object.keys(HEALTH_EVIDENCE_LABELS).sort(),
    ['auth', 'missing', 'no_response', 'preflight', 'responded', 'unchecked'],
  );
});

test('health evidence: summary counts observed HTTP responses without merging categories', () => {
  const checkedAt = NOW.toISOString();
  const entries = [
    { status: 'unknown', http_status: null, reason: 'private_host', checked_at: checkedAt },
    { status: 'unknown', http_status: 302, reason: 'private_host', checked_at: checkedAt },
    { status: 'unknown', http_status: null, reason: 'timeout', checked_at: checkedAt },
    { status: 'unknown', http_status: 403, reason: 'auth_required', checked_at: checkedAt },
    { status: 'missing', http_status: 404, reason: 'not_found', checked_at: checkedAt },
    { status: 'reachable', http_status: 200, reason: 'ok', checked_at: checkedAt },
    { status: 'unchecked', http_status: null, reason: null, checked_at: null },
  ];
  const summary = summarizeHealth(entries);
  assert.deepEqual(summary, {
    unchecked: 1,
    preflight: 2,
    no_response: 1,
    auth: 1,
    missing: 1,
    responded: 1,
    httpResponses: 4,
  });
  const categories =
    summary.unchecked +
    summary.preflight +
    summary.no_response +
    summary.auth +
    summary.missing +
    summary.responded;
  assert.equal(categories, entries.length, 'the six categories partition the entries');
  assert.equal(
    summary.httpResponses,
    4,
    'a redirect-hop 302, auth, missing and a 2xx all count as observed responses',
  );
});

test('monitor: a wholly preflighted write-local run keeps usable baseline coverage and reports no write', async () => {
  const fixture = createGithubFixture({ tree: treeFromFiles({ 'a.txt': 'sha-a' }) });
  const baseline = monitoringWith({ 'a.txt': 'sha-a' });
  baseline.links = [
    {
      url: 'https://example.com/source-a',
      status: 'reachable',
      http_status: 200,
      reason: 'ok',
      checked_at: '2026-11-17T00:00:00.000Z',
      final_url: 'https://example.com/source-a',
    },
  ];
  const { options, saved } = baseRunOptions(fixture, {
    mode: 'write-local',
    monitoring: baseline,
  });
  options.resources = [
    {
      id: 'res-1',
      locations: [
        {
          source_id: 'src-a',
          page_url: 'https://example.com/hop',
          download_page: null,
          download_url: null,
        },
      ],
    },
  ];
  options.checkLinksImpl = async (urls) =>
    urls.map((url) => ({
      url,
      status: 'unknown',
      http_status: url.endsWith('/hop') ? 302 : null,
      reason: 'private_host',
      checked_at: NOW.toISOString(),
      final_url: url,
    }));

  const report = await runMonitor(options);
  assert.equal(saved.value, null, 'a blocked run must not replace the saved baseline');
  assert.equal(report.write_skipped.reason, 'preflight_only');
  assert.equal(report.write_skipped.links, 2);
  assert.equal(report.write_skipped.baseline_http_responses, 1);
  assert.equal(report.link_health.preflight, 2);
  assert.equal(report.link_health.httpResponses, 1, 'the redirect hop response is still reported');
  assert.equal(report.link_summary.total, 2);
  assert.ok(fixture.state.requests.every((request) => request.method === 'GET'));

  const text = formatReport(report);
  assert.match(text, /有 HTTP 响应证据 1 条/);
  assert.match(text, /环境提示：全部链接/);
  assert.match(text, /既有 1 条有响应证据的检查结果保持不变/);
  assert.doesNotMatch(text, /write-local：已写入/);
});

test('monitor: publish keeps monitoring and the notification issue untouched when every link is preflighted', async () => {
  const oldFiles = { 'old.txt': HEAD_OLD };
  const tree = treeFromFiles(oldFiles);
  tree[HEAD_NEW].recursive.tree = [{ path: 'new.txt', type: 'blob', sha: HEAD_NEW }];
  const fixture = createGithubFixture({ head: HEAD_NEW, tree });
  const baseline = monitoringWith(oldFiles);
  baseline.links = [
    {
      url: 'https://example.com/source-a',
      status: 'reachable',
      http_status: 200,
      reason: 'ok',
      checked_at: '2026-11-17T00:00:00.000Z',
      final_url: 'https://example.com/source-a',
    },
  ];
  const { options, saved } = baseRunOptions(fixture, {
    mode: 'publish',
    monitoring: baseline,
  });
  options.checkLinksImpl = async (urls) =>
    urls.map((url) => ({
      url,
      status: 'unknown',
      http_status: null,
      reason: 'private_host',
      checked_at: NOW.toISOString(),
      final_url: url,
    }));

  const report = await runMonitor(options);
  assert.equal(report.write_skipped.reason, 'preflight_only');
  assert.deepEqual(report.pending_sources, ['src-a']);
  assert.equal(report.remote, null);
  assert.deepEqual(saved.value, baseline, 'deploy uses the previous usable snapshot');
  assert.equal(fixture.state.puts.length, 0);
  assert.equal(fixture.state.comments.length, 0);
  assert.equal(fixture.state.issue, null);
  assert.ok(fixture.state.requests.every((request) => request.method === 'GET'));

  const text = formatReport(report);
  assert.match(text, /未写入 monitoring，也未发送 Issue 通知/);
  assert.match(text, /待发布通知的来源（本次未发送）：src-a/);
});

test('monitor: a wholly preflighted run still records a baseline with no usable HTTP coverage', async () => {
  const fixture = createGithubFixture({ tree: treeFromFiles({ 'a.txt': 'sha-a' }) });
  const { options, saved } = baseRunOptions(fixture, { mode: 'write-local' });
  options.checkLinksImpl = async (urls) =>
    urls.map((url) => ({
      url,
      status: 'unknown',
      http_status: null,
      reason: 'private_host',
      checked_at: NOW.toISOString(),
      final_url: url,
    }));

  const report = await runMonitor(options);
  assert.equal(report.write_skipped, null, 'a first baseline is still useful to record');
  assert.ok(saved.value);
  assert.equal(saved.value.links[0].reason, 'private_host');
  assert.match(formatReport(report), /write-local：已写入/);
});

test('monitor: an empty URL set is not treated as preflight-blocked', async () => {
  const fixture = createGithubFixture({ tree: treeFromFiles({ 'a.txt': 'sha-a' }) });
  const { options, saved } = baseRunOptions(fixture, { mode: 'write-local' });
  options.sources = [];
  options.resources = [];
  options.checkLinksImpl = async () => [];

  const report = await runMonitor(options);
  assert.equal(report.write_skipped, null);
  assert.deepEqual(report.link_health, {
    unchecked: 0,
    preflight: 0,
    no_response: 0,
    auth: 0,
    missing: 0,
    responded: 0,
    httpResponses: 0,
  });
  assert.ok(saved.value);
  assert.deepEqual(saved.value.links, []);
});