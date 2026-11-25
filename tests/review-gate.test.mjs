import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publishReviewGate, resolvePullRequests } from '../scripts/review-gate.mjs';

const HEAD = 'a'.repeat(40);
const NEW_HEAD = 'b'.repeat(40);
const RUN = 'https://github.com/owner/repo/actions/runs/10';
const makeReview = (id, state = 'APPROVED', sha = HEAD, type = 'User') => ({
  user: { id, login: `user${id}`, type }, state, commit_id: sha,
});

function fixture() {
  const pr = { number: 28, user: { id: 1 }, state: 'open', base: { ref: 'main' },
    head: { sha: HEAD }, labels: [{ name: 'high-risk' }] };
  const reviews = [];
  const writes = [];
  const api = {
    async get(path) {
      if (path === '/pulls/28') return structuredClone(pr);
      if (path === '/collaborators/user2/permission') return { permission: 'admin' };
      if (path === '/collaborators/user3/permission') return { permission: 'write' };
      if (path === '/collaborators/user4/permission') return { permission: 'read' };
      assert.fail(`Unexpected GET ${path}`);
    },
    async *list(path) {
      assert.equal(path, '/pulls/28/reviews');
      yield* reviews;
    },
    async post(path, payload) { writes.push({ path, ...payload }); },
  };
  return { api, pr, reviews, writes };
}

test('high-risk gate passes on two distinct qualified approvals and fails after dismissal or a new head', async () => {
  const { api, pr, reviews, writes } = fixture();
  reviews.push(makeReview(1), makeReview(2), makeReview(2), makeReview(4), makeReview(5, 'APPROVED', HEAD, 'Bot'));
  await publishReviewGate(api, pr.number, RUN);
  assert.equal(writes.at(-1).state, 'failure');
  assert.match(writes.at(-1).description, /1\/2/);

  const second = makeReview(3);
  reviews.push(second, makeReview(3, 'COMMENTED', NEW_HEAD));
  await publishReviewGate(api, pr.number, RUN);
  assert.deepEqual(writes.at(-1), {
    path: `/statuses/${HEAD}`, context: 'Review gate', state: 'success',
    description: 'High risk: 2/2 valid approvals for current revision', target_url: RUN,
  });

  second.state = 'DISMISSED';
  await publishReviewGate(api, pr.number, RUN);
  assert.equal(writes.at(-1).state, 'failure');
  assert.match(writes.at(-1).description, /1\/2/);

  pr.head.sha = NEW_HEAD;
  await publishReviewGate(api, pr.number, RUN);
  assert.equal(writes.at(-1).path, `/statuses/${NEW_HEAD}`);
  assert.match(writes.at(-1).description, /0\/2/);
});

test('standard risk delegates approval enforcement to GitHub and does not read reviews', async () => {
  const { api, pr, writes } = fixture();
  pr.labels = [];
  api.list = () => assert.fail('standard PR must not load votes');
  await publishReviewGate(api, pr.number, RUN);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].state, 'success');
});

test('a changing head is not marked green using votes from an earlier API snapshot', async () => {
  const { api, pr, reviews, writes } = fixture();
  reviews.push(makeReview(2), makeReview(3));
  const get = api.get;
  api.get = async (path) => {
    if (path.endsWith('/user3/permission')) pr.head.sha = NEW_HEAD;
    return get(path);
  };
  await publishReviewGate(api, pr.number, RUN);
  assert.deepEqual(writes.map(({ state }) => state), ['pending']);
});

test('fork review run with an empty PR list resolves via repository ID and source branch', async () => {
  const event = { workflow_run: { event: 'pull_request_review', path: '.github/workflows/review-events.yml',
    head_repository: { id: 7 }, head_branch: 'topic', pull_requests: [] } };
  const api = { async *list(path) {
    assert.equal(path, '/pulls?state=open&base=main');
    yield { number: 42, head: { repo: { id: 8 }, ref: 'topic' } };
    yield { number: 43, head: { repo: { id: 7 }, ref: 'other' } };
    yield { number: 44, head: { repo: { id: 7 }, ref: 'topic' } };
  } };
  assert.deepEqual(await resolvePullRequests(api, 'workflow_run', event), [44]);
});
