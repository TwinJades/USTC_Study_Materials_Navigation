import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CONTEXT = 'Review gate';
const RISK_LABEL = 'high-risk';
const SHA = /^[0-9a-f]{40}$/;
const validNumber = (n) => Number.isSafeInteger(n) && n > 0;
const highRisk = (pr) => pr.labels.some(({ name }) => name === RISK_LABEL);
const openMain = (pr) => pr.state === 'open' && pr.base.ref === 'main';

// The workflow_run payload can omit pull_requests for forks. Use its GitHub
// repository ID and branch, not a contributor-provided artifact or branch name alone.
export async function resolvePullRequests(api, eventName, event) {
  if (eventName === 'pull_request_target' || eventName === 'workflow_dispatch') {
    const number = eventName === 'workflow_dispatch' ? Number(event.inputs.pull_request) : event.number;
    if (!validNumber(number)) throw new Error('Expected a positive pull request number');
    return [number];
  }
  if (eventName !== 'workflow_run') throw new Error(`Unsupported event: ${eventName}`);
  const run = event.workflow_run;
  if (run.event !== 'pull_request_review' || run.path !== '.github/workflows/review-events.yml') return [];
  const repo = run.head_repository;
  if (!repo || !run.head_branch) throw new Error('Review run has no source repository or branch');
  const numbers = [];
  for await (const pr of api.list('/pulls?state=open&base=main')) {
    if (pr.head.repo?.id === repo.id && pr.head.ref === run.head_branch) numbers.push(pr.number);
  }
  return numbers;
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

export async function publishReviewGate(api, number, runUrl) {
  const pr = await api.get(`/pulls/${number}`);
  if (!openMain(pr)) return;
  // Match the SHA used by the repository's existing PR checks. A new head
  // cannot inherit a result; GitHub separately enforces base synchronization.
  const sha = pr.head.sha;
  if (!SHA.test(sha)) throw new Error(`PR #${number} has no valid head SHA`);
  const post = (state, description) => api.post(`/statuses/${sha}`, {
    state, context: CONTEXT, description, target_url: runUrl,
  });
  const risky = highRisk(pr);
  if (risky) await post('pending', 'Counting approvals for this revision');
  const count = risky ? await validApprovals(api, pr) : null;
  const current = await api.get(`/pulls/${number}`);
  if (!openMain(current) || current.head.sha !== sha || highRisk(current) !== risky) return;
  const success = !risky || count >= 2;
  const description = risky
    ? `High risk: ${Math.min(count, 2)}/2 valid approvals for current revision`
    : 'Standard risk: GitHub enforces the normal approval requirement';
  await post(success ? 'success' : 'failure', description);
  console.log(`PR #${number} (${sha}): ${description}`);
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
    const numbers = await resolvePullRequests(api, env.GITHUB_EVENT_NAME, event);
    appendFileSync(env.GITHUB_OUTPUT, `numbers=${JSON.stringify(numbers)}\n`);
  } else if (mode === 'publish') {
    const number = Number(env.PR_NUMBER);
    if (!validNumber(number)) throw new Error('Expected a positive pull request number');
    await publishReviewGate(api, number, `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`);
  } else {
    throw new Error(`Unknown review gate mode: ${mode}`);
  }
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invoked.toLowerCase() === import.meta.url.toLowerCase()) {
  await main(process.env, process.argv[2]);
}
