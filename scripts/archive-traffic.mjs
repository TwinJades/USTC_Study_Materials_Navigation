#!/usr/bin/env node
// Daily repository traffic archive.
//
// GitHub exposes /traffic/views for ~14 days only, so completed UTC days are
// copied into one JSON file on the dedicated `traffic-history` branch. That
// branch is an orphan holding only `traffic-history.json`; the default branch is
// never touched and pushes are never forced.
//
// Modes: (default) fetch + merge in memory; `--publish` merge, commit, push.
// Scope: date, count, uniques. No referrers, paths, URLs, users or credentials,
// and no per-run timestamps, so unchanged data re-merges byte-for-byte.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ARCHIVE_BRANCH = 'traffic-history';
export const ARCHIVE_FILE = 'traffic-history.json';
export const SCHEMA_VERSION = 1;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const IDENTITY = {
  GIT_AUTHOR_NAME: 'github-actions[bot]',
  GIT_AUTHOR_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
  GIT_COMMITTER_NAME: 'github-actions[bot]',
  GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
};

export class ArchiveError extends Error {
  constructor(message, { code = 'archive_error', status = null, cause } = {}) {
    super(message);
    this.name = 'ArchiveError';
    this.code = code;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

const bad = (message, code) => new ArchiveError(message, { code });
const num = (v) => Number.isSafeInteger(v) && v >= 0;
const day = (v) => typeof v === 'string' && DATE.test(v) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

// Strict by design: an unknown schema or field stops the run instead of
// silently dropping already archived history.
export function parseArchive(text) {
  if (text === null || text === undefined || String(text).trim() === '') {
    return { schema_version: SCHEMA_VERSION, days: {} };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    throw new ArchiveError('归档文件不是有效 JSON；为避免覆盖历史，本次停止。', { code: 'invalid_archive', cause });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      Object.keys(data).sort().join(',') !== 'days,schema_version' || data.schema_version !== SCHEMA_VERSION ||
      !data.days || typeof data.days !== 'object' || Array.isArray(data.days)) {
    throw bad('不支持的归档文件格式。', 'invalid_archive');
  }
  const days = {};
  for (const [date, e] of Object.entries(data.days)) {
    if (!day(date) || !e || typeof e !== 'object' ||
        Object.keys(e).sort().join(',') !== 'count,uniques' || !num(e.count) || !num(e.uniques)) {
      throw bad(`归档条目必须是非负整数 count/uniques：${date}。`, 'invalid_archive');
    }
    days[date] = { count: e.count, uniques: e.uniques };
  }
  return { schema_version: SCHEMA_VERSION, days };
}

// Sorted dates, fixed field order: unchanged data serializes identically.
export function serializeArchive({ days }) {
  const sorted = {};
  for (const date of Object.keys(days).sort()) sorted[date] = days[date];
  return `${JSON.stringify({ schema_version: SCHEMA_VERSION, days: sorted }, null, 2)}\n`;
}

export function mergeTrafficHistory(archive, payload, { todayUtc }) {
  if (!day(todayUtc)) throw bad(`当前 UTC 日期无效：${todayUtc}。`, 'bad_args');
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.views)) {
    throw bad('GitHub Traffic 响应缺少 views 数组。', 'invalid_response');
  }
  const days = { ...archive.days };
  const returned = new Map();
  let partial = 0;
  payload.views.forEach((row, index) => {
    const date = typeof row?.timestamp === 'string' ? row.timestamp.slice(0, 10) : null;
    if (!day(date) || !Number.isFinite(Date.parse(row.timestamp)) || !num(row.count) || !num(row.uniques)) {
      throw bad(`GitHub Traffic 第 ${index} 行数据无效。`, 'invalid_response');
    }
    if (returned.has(date)) throw bad(`GitHub Traffic 返回了重复日期：${date}。`, 'invalid_response');
    // The current UTC day is still counting: freeze nothing, guess nothing.
    if (date >= todayUtc) partial += 1;
    else returned.set(date, { count: row.count, uniques: row.uniques });
  });
  const stats = { added: 0, updated: 0, unchanged: 0 };
  for (const date of [...returned.keys()].sort()) {
    const next = returned.get(date);
    const previous = days[date];
    const same = previous && previous.count === next.count && previous.uniques === next.uniques;
    stats[previous ? (same ? 'unchanged' : 'updated') : 'added'] += 1;
    days[date] = next;
  }
  return { archive: { schema_version: SCHEMA_VERSION, days }, completed: returned.size, partial, ...stats };
}

export async function fetchTrafficViews({ repo, token, fetchImpl = fetch, timeoutMs = 15_000 }) {
  if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/u.test(repo.trim())) {
    throw bad('目标仓库必须是 owner/name。', 'missing_repo');
  }
  if (typeof token !== 'string' || token.trim() === '') {
    throw bad('缺少 GitHub token：请设置 TRAFFIC_TOKEN，或在 Actions 中使用有 Traffic 读取权限的 GITHUB_TOKEN。', 'missing_token');
  }
  let response;
  try {
    response = await fetchImpl(`https://api.github.com/repos/${repo.trim()}/traffic/views`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'USTC-course-navigation-traffic-archive/1.0',
        'x-github-api-version': '2022-11-28',
        authorization: `Bearer ${token}`,
      },
    });
  } catch (cause) {
    throw new ArchiveError(`读取 GitHub Traffic 失败：${cause?.message ?? cause}`, { code: 'traffic_unavailable', cause });
  }
  if (!response.ok) {
    const hint = [401, 403, 404].includes(response.status)
      ? '；GITHUB_TOKEN 没有该仓库的 Traffic 读取权限时，请配置对该仓库有 push 权限的 Actions secret TRAFFIC_TOKEN'
      : '';
    throw new ArchiveError(`读取 GitHub Traffic 失败：HTTP ${response.status}${hint}。`,
      { code: 'traffic_unavailable', status: response.status });
  }
  try {
    return await response.json();
  } catch (cause) {
    throw new ArchiveError('GitHub Traffic 响应不是有效 JSON。', { code: 'invalid_response', cause });
  }
}

function runGit(args, { cwd, input, env } = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    input,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// Reads the archive via the checkout's own origin, so the credentials
// actions/checkout persisted in .git/config are used as-is; no token is ever
// placed on a command line or in output. A missing branch is a normal first
// run. An existing branch without a usable file is broken: fail, do not
// silently reinitialize over it.
export function readArchive({ cwd = process.cwd(), git = runGit } = {}) {
  if (git(['ls-remote', '--heads', 'origin', `refs/heads/${ARCHIVE_BRANCH}`], { cwd }).trim() === '') {
    return { parent: null, content: null };
  }
  const ref = `refs/remotes/origin/${ARCHIVE_BRANCH}`;
  git(['fetch', '--no-tags', '--depth=1', 'origin', `+refs/heads/${ARCHIVE_BRANCH}:${ref}`], { cwd });
  const parent = git(['rev-parse', '--verify', `${ref}^{commit}`], { cwd }).trim();
  const present = git(['ls-tree', '--name-only', parent, '--', ARCHIVE_FILE], { cwd }).trim() !== '';
  const content = present ? git(['show', `${parent}:${ARCHIVE_FILE}`], { cwd }) : null;
  if (content === null || content.trim() === '') {
    throw bad(`${ARCHIVE_BRANCH} 分支已存在但缺少可用的 ${ARCHIVE_FILE}；为避免重建覆盖，本次停止。`, 'invalid_archive');
  }
  return { parent, content };
}

// Builds one commit holding only traffic-history.json and pushes it as a
// fast-forward. A rejected push fails the run; nothing is ever forced.
export function publishArchive({ content, parent = null, cwd = process.cwd(), git = runGit, message = 'chore(traffic): archive completed UTC days' } = {}) {
  const blob = git(['hash-object', '-w', '--stdin'], { cwd, input: content }).trim();
  const scratch = mkdtempSync(join(tmpdir(), 'traffic-archive-'));
  try {
    const index = { GIT_INDEX_FILE: join(scratch, 'index') };
    git(parent ? ['read-tree', parent] : ['read-tree', '--empty'], { cwd, env: index });
    git(['update-index', '--add', '--cacheinfo', `100644,${blob},${ARCHIVE_FILE}`], { cwd, env: index });
    const tree = git(['write-tree'], { cwd, env: index }).trim();
    const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message], { cwd, env: IDENTITY }).trim();
    try {
      git(['push', 'origin', `${commit}:refs/heads/${ARCHIVE_BRANCH}`], { cwd });
    } catch (error) {
      throw new ArchiveError(
        `推送 ${ARCHIVE_BRANCH} 失败（退出码 ${error.status ?? 1}）：${String(error.stderr ?? '').trim() || '无输出'}。` +
          '未使用强制推送；下一次定时运行会重新合并并快进推送。',
        { code: 'push_rejected', cause: error },
      );
    }
    return { commit, parent };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export async function runArchive({
  mode = 'dry-run',
  repo = process.env.GITHUB_REPOSITORY ?? null,
  token = process.env.TRAFFIC_TOKEN || process.env.GITHUB_TOKEN || null,
  cwd = process.cwd(),
  now = () => new Date(),
  fetchImpl = fetch,
  git = runGit,
} = {}) {
  if (mode !== 'dry-run' && mode !== 'publish') throw bad(`未知模式：${mode}。`, 'bad_args');
  const payload = await fetchTrafficViews({ repo, token, fetchImpl });
  const todayUtc = now().toISOString().slice(0, 10);
  const remote = mode === 'publish' ? readArchive({ cwd, git }) : { parent: null, content: null };
  const merged = mergeTrafficHistory(parseArchive(remote.content), payload, { todayUtc });
  const content = serializeArchive(merged.archive);
  const report = {
    mode,
    today_utc: todayUtc,
    returned: payload.views.length,
    completed: merged.completed,
    partial: merged.partial,
    added: merged.added,
    updated: merged.updated,
    unchanged: merged.unchanged,
    total_days: Object.keys(merged.archive.days).length,
    pushed: false,
    commit: null,
    reason: null,
  };
  if (content === remote.content) {
    report.reason = 'unchanged';
  } else if (merged.completed === 0) {
    report.reason = 'no_completed_days';
  } else if (mode === 'publish') {
    report.commit = publishArchive({
      content,
      parent: remote.parent,
      cwd,
      git,
      message: `chore(traffic): ${report.added} added, ${report.updated} revised, ${report.total_days} total`,
    }).commit;
    report.pushed = true;
  }
  return report;
}

export function formatReport(r) {
  const lines = [
    `归档摘要：GitHub 返回 ${r.returned} 天，其中已结束 UTC 日 ${r.completed} 天` +
      `（新增 ${r.added}，修订 ${r.updated}，未变 ${r.unchanged}）；归档合计 ${r.total_days} 天。`,
  ];
  if (r.partial > 0) lines.push(`跳过 ${r.partial} 条未结束的 UTC 日（${r.today_utc} 当天仍为部分数据）。`);
  if (r.mode === 'dry-run') lines.push('dry-run：未推送 traffic-history 分支。');
  else if (r.reason === 'unchanged') lines.push('publish：归档内容无变化，未提交也未推送。');
  else if (r.reason === 'no_completed_days') lines.push('publish：本次没有可归档的已结束 UTC 日，未提交。');
  else lines.push(`publish：已快进推送到 ${ARCHIVE_BRANCH}，commit ${r.commit}（文件 ${ARCHIVE_FILE}）。`);
  return lines.join('\n');
}

export function parseArgs(argv) {
  const options = { mode: 'dry-run', help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--publish') options.mode = 'publish';
    else throw bad(`未知参数：${arg}`, 'bad_args');
  }
  return options;
}

const USAGE = '用法：node scripts/archive-traffic.mjs [--publish]\n\n' +
  '  （默认）  读取 GitHub Traffic，在内存中合并，不推送\n' +
  '  --publish 合并 traffic-history 分支，提交并快进推送（不强制、不改默认分支）\n\n' +
  '  环境变量：TRAFFIC_TOKEN（优先）或 GITHUB_TOKEN；读取 Traffic 需要该仓库的 push 权限。';

const redact = (text, secrets) => secrets
  .filter((s) => typeof s === 'string' && s.length >= 4)
  .reduce((out, s) => out.split(s).join('***'), String(text));

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const secrets = [process.env.TRAFFIC_TOKEN, process.env.GITHUB_TOKEN];
  try {
    console.log(formatReport(await runArchive({ mode: args.mode })));
  } catch (error) {
    console.error(`归档失败：${redact(error?.message ?? error, secrets)}`);
    if (error?.code === 'traffic_unavailable' || error?.code === 'missing_token') {
      console.error('GitHub Traffic 只提供近 14 天，缺少读取权限时不写入任何 0；请确认 TRAFFIC_TOKEN 或工作流 GITHUB_TOKEN 对该仓库有 push 权限。');
    }
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
const isDirectRun = invokedPath !== null && (invokedPath === import.meta.url ||
  (process.platform === 'win32' && invokedPath.toLowerCase() === import.meta.url.toLowerCase()));
if (isDirectRun) {
  main().catch((error) => {
    console.error(`归档失败：${error?.stack ?? error}`);
    process.exitCode = 1;
  });
}