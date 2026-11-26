import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CONTEXT = 'Review gate';
const RISK_LABEL = 'high-risk';
const SHA = /^[0-9a-f]{40}$/;
const validNumber = (n) => Number.isSafeInteger(n) && n > 0;
const highRisk = (pr) => pr.labels.some(({ name }) => name === RISK_LABEL);
const openMain = (pr) => pr.state === 'open' && pr.base.ref === 'main';

export async function resolveHeadShas(api, eventName, event) {
  if (eventName === 'pull_request_target') {
    if (event.pull_request.base.ref !== 'main' && event.changes?.base?.ref?.from !== 'main') return [];
    return [...new Set([
      event.pull_request.head.sha,
      ...(event.action === 'synchronize' ? [event.before] : []),
    ].filter(sha => typeof sha === 'string' && SHA.test(sha)))];
  }
  if (eventName === 'workflow_dispatch') {
    const number = Number(event.inputs.pull_request);
    if (!validNumber(number)) throw new Error('Expected a positive pull request number');
    const pr = await api.get(`/pulls/${number}`);
    return openMain(pr) ? [pr.head.sha] : [];
  }
  if (eventName !== 'workflow_run') throw new Error(`Unsupported event: ${eventName}`);
  const run = event.workflow_run;
  if (run.event !== 'pull_request_review' || run.path !== '.github/workflows/review-events.yml') return [];
  // Fork workflow runs can omit pull_requests. Resolve the source repo and ref
  // via GitHub's API without reading contributor-provided artifacts.
  const repo = run.head_repository;
  if (!repo || !run.head_branch) return [];
  const shas = new Set();
  for await (const pr of api.list('/pulls?state=open&base=main')) {
    if (pr.head.repo?.id === repo.id && pr.head.ref === run.head_branch) shas.add(pr.head.sha);
  }
  return [...shas];
}

async function validApprovals(api, pr) {
  // REST returns reviews in chronological order. Comments do not replace an
  // approval; a later request for changes or dismissal does.
  const latest = new Map();
  for await (const review of api.list(`/pulls/${pr.number}/reviews`)) {
    if (review.user?.type !== 'User' || review.user.id === pr.user.id) continue;
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) {
      latest.set(review.user.id, review);
    }
  }
  let count = 0;
  for (const review of latest.values()) {
    if (review.state !== 'APPROVED' || review.commit_id !== pr.head.sha) continue;
    const { permission } = await api.get(`/collaborators/${encodeURIComponent(review.user.login)}/permission`);
    if (permission === 'write' || permission === 'admin') count += 1;
  }
  return count;
}

async function pullRequestsAtHead(api, sha) {
  const numbers = [];
  const risky = [];
  for await (const pr of api.list('/pulls?state=open&base=main')) {
    if (pr.head.sha !== sha) continue;
    numbers.push(pr.number);
    if (highRisk(pr)) risky.push(pr);
  }
  risky.sort((a, b) => a.number - b.number);
  return { numbers, risky };
}

export async function publishReviewGate(api, sha, runUrl) {
  if (typeof sha !== 'string' || !SHA.test(sha)) throw new Error('Expected a valid head SHA');
  // Commit statuses are shared by every PR at this head. Re-read the whole
  // group under the SHA-level workflow lock, regardless of which PR triggered it.
  let snapshot = await pullRequestsAtHead(api, sha);
  const post = (state, description) => api.post(`/statuses/${sha}`, {
    state, context: CONTEXT, description, target_url: runUrl,
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const { numbers, risky } = snapshot;
    if (!numbers.length) return;
    if (risky.length) await post('pending', 'Counting approvals for high-risk PRs at this head');
    let blocked;
    for (const pr of risky) {
      const count = await validApprovals(api, pr);
      if (count < 2) {
        blocked = `High risk: PR #${pr.number} has ${count}/2 valid approvals for current revision`;
        break;
      }
    }
    snapshot = await pullRequestsAtHead(api, sha);
    if (!snapshot.numbers.length) return;
    if (risky.map(pr => pr.number).join() !== snapshot.risky.map(pr => pr.number).join()) continue;
    const description = blocked ?? (risky.length
      ? 'All high-risk PRs at this head have two valid approvals'
      : 'Standard risk: GitHub enforces the normal approval requirement');
    await post(blocked ? 'failure' : 'success', description);
    console.log(`${sha}: ${description}`);
    return;
  }
}

function githubApi(repo, token) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) throw new Error('Missing GitHub repository or token');
  const base = `https://api.github.com/repos/${repo}`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  async function request(path, body) {
    const response = await fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { ...headers, 'content-type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`GitHub ${body ? 'POST' : 'GET'} ${path}: HTTP ${response.status}`);
    return response.json();
  }
  return {
    get: request,
    post: request,
    async *list(path) {
      const separator = path.includes('?') ? '&' : '?';
      for (let page = 1; ; page += 1) {
        const rows = await request(`${path}${separator}per_page=100&page=${page}`);
        if (!Array.isArray(rows)) throw new Error(`GitHub ${path}: expected a list`);
        yield* rows;
        if (rows.length < 100) return;
      }
    },
  };
}

async function main(env, mode) {
  const api = githubApi(env.GITHUB_REPOSITORY, env.GITHUB_TOKEN);
  if (mode === 'resolve') {
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    const shas = await resolveHeadShas(api, env.GITHUB_EVENT_NAME, event);
    appendFileSync(env.GITHUB_OUTPUT, `shas=${JSON.stringify(shas)}\n`);
  } else if (mode === 'publish') {
    await publishReviewGate(api, env.HEAD_SHA, `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`);
  } else {
    throw new Error(`Unknown review gate mode: ${mode}`);
  }
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invoked.toLowerCase() === import.meta.url.toLowerCase()) {
  await main(process.env, process.argv[2]);
}
