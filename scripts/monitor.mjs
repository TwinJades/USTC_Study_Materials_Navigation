#!/usr/bin/env node
// Weekly source monitor.
//
// Modes:
//   --dry-run    real checks, print report, write nothing (default)
//   --write-local     real checks, write only the local monitoring snapshot
//   --load-published  copy the published snapshot into the local checkout
//   --publish         real checks, notify the monitor issue, then update the
//                     monitoring-data branch using the starting file SHA
//
// Monitoring data is a health report and change baseline. It never adds,
// removes or reclassifies courses/resources. A failed link check is reported
// as `unknown`; it does not delete a resource.

import { pathToFileURL } from 'node:url';

import { checkLinks, summarizeLinks } from './lib/link-health.mjs';
import {
  HEALTH_EVIDENCE_LABELS,
  classifyHealth,
  summarizeHealth,
} from '../site/assets/health-evidence.mjs';
import {
  MAX_COMMENT_CHARS,
  chunkMarker,
  chunkText,
  createGitHubClient,
  diffFiles,
  githubFileUrl,
  monitorIssueBody,
} from './lib/github.mjs';

export const MONITORING_RELATIVE_PATH = 'data/monitoring.json';
const MONITORING_BRANCH = 'monitoring-data';
export const MONITOR_MODES = ['dry-run', 'write-local', 'publish'];

export class MonitorError extends Error {
  constructor(message, { code = 'monitor_error', cause } = {}) {
    super(message);
    this.name = 'MonitorError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

const USAGE = `用法：node scripts/monitor.mjs [--dry-run|--write-local|--load-published|--publish] [--repo owner/repo]

  --dry-run        只读检查链接与仓库文件并输出报告（默认）
  --write-local    检查并仅写入本地 data/monitoring.json
  --load-published 从 monitoring-data 拉取快照写入本地 data/monitoring.json
  --publish        检查后发送 Issue 通知，更新 monitoring-data 分支并同步本地快照
  --repo           指定目标 owner/repo（默认取 GITHUB_REPOSITORY 或 git remote origin）

  环境变量：GITHUB_TOKEN（--publish 必需，其余模式可选）、GITHUB_REPOSITORY（可选）`;

export function parseArgs(argv) {
  const options = { mode: null, repo: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (['--dry-run', '--write-local', '--load-published', '--publish'].includes(arg)) {
      const mode = arg.slice(2);
      if (options.mode && options.mode !== mode) {
        throw new MonitorError(`只能选择一个运行模式（已有 --${options.mode}）`, {
          code: 'invalid_arguments',
        });
      }
      options.mode = mode;
    } else if (arg === '--repo') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new MonitorError('--repo 需要 owner/name 参数', { code: 'invalid_arguments' });
      }
      options.repo = value;
      i += 1;
    } else if (arg.startsWith('--repo=')) {
      options.repo = arg.slice('--repo='.length);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new MonitorError(`未知参数：${arg}`, { code: 'invalid_arguments' });
    }
  }
  if (!options.help && !options.mode) options.mode = 'dry-run';
  return options;
}

export function parseRepoSlug(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+?)(?:\.git)?$/);
  if (!match) throw new MonitorError(`无法识别的仓库目标：${text}`, { code: 'invalid_target' });
  return { owner: match[1], repo: match[2] };
}

function parseGitRemote(url) {
  const text = String(url ?? '').trim();
  let match = text.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!match) match = text.match(/^ssh:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!match) match = text.match(/^(?:[^@]+@)?[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

export async function resolveTarget({ explicit = null, env = process.env } = {}) {
  if (explicit) {
    const parsed = parseRepoSlug(explicit);
    return { ...parsed, source: 'argument' };
  }
  if (env.GITHUB_REPOSITORY) {
    const parsed = parseRepoSlug(env.GITHUB_REPOSITORY);
    return { ...parsed, source: 'GITHUB_REPOSITORY' };
  }
  const { execFileSync } = await import('node:child_process');
  let remote = '';
  try {
    remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    remote = '';
  }
  const parsed = remote ? parseGitRemote(remote) : null;
  if (!parsed) {
    throw new MonitorError('无法确定目标仓库：请设置 GITHUB_REPOSITORY、传入 --repo 或配置 git remote origin', {
      code: 'missing_target',
    });
  }
  return { ...parsed, source: 'git-remote' };
}

export function createEmptyMonitoring(schemaVersion = 1) {
  return {
    schema_version: schemaVersion,
    checked_at: null,
    links: [],
    repositories: {},
    issue_number: null,
  };
}

export function normalizeMonitoring(raw, schemaVersion = 1) {
  if (raw === null || raw === undefined) return createEmptyMonitoring(schemaVersion);
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MonitorError('data/monitoring.json 必须是对象', { code: 'invalid_monitoring' });
  }
  if (raw.schema_version !== schemaVersion) {
    throw new MonitorError(
      `data/monitoring.json 的 schema_version 必须为 ${schemaVersion}，实际为 ${raw.schema_version}`,
      { code: 'invalid_monitoring' },
    );
  }
  if (!Array.isArray(raw.links)) {
    throw new MonitorError('data/monitoring.json 的 links 必须是数组', { code: 'invalid_monitoring' });
  }
  if (raw.repositories === null || typeof raw.repositories !== 'object' || Array.isArray(raw.repositories)) {
    throw new MonitorError('data/monitoring.json 的 repositories 必须是对象', {
      code: 'invalid_monitoring',
    });
  }
  if (raw.issue_number !== null && raw.issue_number !== undefined &&
      !Number.isInteger(raw.issue_number)) {
    throw new MonitorError('data/monitoring.json 的 issue_number 必须是整数或 null', {
      code: 'invalid_monitoring',
    });
  }
  return {
    schema_version: schemaVersion,
    checked_at: typeof raw.checked_at === 'string' ? raw.checked_at : null,
    links: raw.links,
    repositories: { ...raw.repositories },
    issue_number: raw.issue_number ?? null,
  };
}

export function collectMonitorUrls(sources, resources) {
  const urls = [];
  const push = (value) => {
    if (typeof value === 'string' && value.trim()) urls.push(value.trim());
  };
  for (const source of sources) push(source?.url);
  for (const resource of resources) {
    for (const location of resource?.locations ?? []) {
      push(location?.page_url);
      push(location?.download_page);
      push(location?.download_url);
    }
  }
  return [...new Set(urls)];
}

function validateGithubDescriptor(source) {
  const github = source?.github;
  if (!github || typeof github !== 'object') {
    throw new MonitorError(`来源 ${source?.id ?? '（无 id）'} 缺少 github 仓库信息`, {
      code: 'invalid_source',
    });
  }
  const { owner, repo, branch } = github;
  if (typeof owner !== 'string' || !owner || typeof repo !== 'string' || !repo ||
      typeof branch !== 'string' || !branch) {
    throw new MonitorError(`来源 ${source?.id ?? '（无 id）'} 的 github 字段不完整`, {
      code: 'invalid_source',
    });
  }
  return { owner, repo, branch };
}

async function checkRepositorySources({ sources, baseline, client, nowIso, target }) {
  const results = [];
  const treeCache = new Map();
  const workflowUrl = target
    ? `https://github.com/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/actions`
    : null;

  for (const source of sources) {
    if (!source?.github) continue;
    let descriptor;
    try {
      descriptor = validateGithubDescriptor(source);
    } catch (error) {
      results.push({
        source_id: source?.id ?? '（无 id）',
        name: source?.name ?? '',
        status: 'error',
        error: { code: error.code ?? 'invalid_source', message: error.message },
      });
      continue;
    }

    const { owner, repo, branch } = descriptor;
    const previous = baseline[source.id] ?? null;
    const baseResult = {
      source_id: source.id,
      name: source.name ?? '',
      owner,
      repo,
      branch,
      previous_head: previous?.head_sha ?? null,
      head_sha: null,
      status: 'error',
      files: previous?.files ?? [],
      diff: null,
      error: null,
      workflow_url: workflowUrl,
    };

    try {
      const head = await client.getBranchHead(owner, repo, branch);
      baseResult.head_sha = head;
      if (previous && previous.head_sha === head) {
        baseResult.status = 'unchanged';
        results.push(baseResult);
        continue;
      }

      const key = `${owner}/${repo}@${head}`;
      let files = treeCache.get(key);
      if (!files) {
        files = await client.getCompleteTreeFiles(owner, repo, head);
        treeCache.set(key, files);
      }
      baseResult.files = files;
      baseResult.diff = diffFiles(previous?.files ?? [], files);
      baseResult.status = previous ? 'changed' : 'initialized';
      results.push(baseResult);
    } catch (error) {
      baseResult.status = 'error';
      baseResult.error = {
        code: error?.code ?? 'github_error',
        message: error?.message ?? String(error),
      };
      results.push(baseResult);
    }
  }

  return results;
}

function formatFileList(title, files, result) {
  if (files.length === 0) return [];
  const lines = [`#### ${title}（${files.length}）`];
  for (const file of files) {
    lines.push(
      `- [\`${file.path}\`](${githubFileUrl(result.owner, result.repo, result.branch, file.path)}) \`${file.sha.slice(0, 12)}\``,
    );
  }
  return lines;
}

export function buildSourceReport(result, { nowIso } = {}) {
  const { diff } = result;
  const oldHead = result.previous_head ?? '（首次基线）';
  const lines = [
    `### ${result.name || result.source_id}（${result.owner}/${result.repo}@${result.branch}）`,
    '',
    `- 来源 ID：\`${result.source_id}\``,
    `- 旧 head：\`${oldHead}\``,
    `- 新 head：\`${result.head_sha}\``,
    `- 变化：新增 ${diff?.added.length ?? 0} / 修改 ${diff?.modified.length ?? 0} / 删除 ${diff?.removed.length ?? 0}`,
    `- 发现时间：${nowIso ?? new Date().toISOString()}`,
  ];
  if (result.workflow_url) lines.push(`- 工作流：${result.workflow_url}`);
  lines.push('', '以下仅为文件变化，尚未核验课程、年份或授权。', '');
  lines.push(...formatFileList('新增', diff?.added ?? [], result));
  lines.push(...formatFileList('修改', diff?.modified ?? [], result));
  lines.push(...formatFileList('删除', diff?.removed ?? [], result));
  return lines.join('\n');
}

export function buildSourceChunks(result, { nowIso } = {}) {
  const text = buildSourceReport(result, { nowIso });
  // Reserve room for the longest marker (three chunk digits is plenty).
  const reserved = chunkMarker({
    sourceId: result.source_id,
    oldHead: result.previous_head,
    newHead: result.head_sha,
    chunk: 999,
    chunks: 999,
  }).length + 2;
  const budget = Math.max(1000, MAX_COMMENT_CHARS - reserved);
  const parts = chunkText(text, budget);
  return parts.map((part, index) => {
    const marker = chunkMarker({
      sourceId: result.source_id,
      oldHead: result.previous_head,
      newHead: result.head_sha,
      chunk: index + 1,
      chunks: parts.length,
    });
    return { marker, body: `${marker}\n${part}`, chunk: index + 1, chunks: parts.length };
  });
}

function commentMarkers(comments) {
  const markers = new Set();
  for (const comment of comments) {
    const body = String(comment?.body ?? '');
    for (const match of body.matchAll(/<!-- ustc-source-monitor [^>]*-->/g)) {
      markers.add(match[0]);
    }
  }
  return markers;
}

async function publishNotifications({ client, target, pending, issueNumber, nowIso }) {
  const chunks = pending.flatMap((result) => buildSourceChunks(result, { nowIso }));
  if (chunks.length === 0) return { issueNumber, posted: 0, skipped: 0 };

  const { issue } = await client.ensureMonitorIssue(target.owner, target.repo, {
    number: issueNumber,
    body: monitorIssueBody(),
  });
  const existingComments = await client.listComments(target.owner, target.repo, issue.number);
  const existing = commentMarkers(existingComments);

  let posted = 0;
  let skipped = 0;
  for (const chunk of chunks) {
    if (existing.has(chunk.marker)) {
      skipped += 1;
      continue;
    }
    await client.createComment(target.owner, target.repo, issue.number, chunk.body);
    existing.add(chunk.marker);
    posted += 1;
  }
  return { issueNumber: issue.number, posted, skipped };
}

function applyBaselineUpdates(baseline, repoResults, { mode, nowIso }) {
  const repositories = { ...baseline };
  for (const result of repoResults) {
    if (result.status === 'error') continue;
    const entry = {
      head_sha: result.head_sha,
      files: result.files,
      last_checked_at: nowIso,
    };
    if (result.status === 'initialized' || result.status === 'unchanged') {
      repositories[result.source_id] = entry;
    } else if (result.status === 'changed') {
      if (!result.diff?.hasChanges) {
        repositories[result.source_id] = entry;
      } else if (mode === 'write-local') {
        // Keep the old baseline: pending file changes must still be reported
        // the next time the monitor publishes. `--write-local` only adds a
        // baseline where none existed.
        if (!baseline[result.source_id]) repositories[result.source_id] = entry;
      }
      // publish assigns changed entries only after notification succeeds.
    }
  }
  return repositories;
}

async function readPublishedMonitoring(client, { owner, repo }) {
  const file = await client.getContents(owner, repo, MONITORING_RELATIVE_PATH, { ref: MONITORING_BRANCH });
  if (!file) {
    throw new MonitorError(`${MONITORING_BRANCH} 分支缺少 ${MONITORING_RELATIVE_PATH}`, {
      code: 'remote_monitoring_missing',
    });
  }
  if (file.type !== 'file' || (file.encoding !== 'none' &&
      (file.encoding !== 'base64' || typeof file.content !== 'string'))) {
    throw new MonitorError('无法读取已发布的监控快照', { code: 'remote_content_unavailable' });
  }
  if (typeof file.sha !== 'string' || !/^[0-9a-f]{40}$/.test(file.sha)) {
    throw new MonitorError('监控快照缺少有效的 blob SHA', { code: 'invalid_response' });
  }
  const bytes = file.encoding === 'none'
    ? await client.getBlob(owner, repo, file.sha)
    : Buffer.from(file.content, 'base64');
  let monitoring;
  try {
    monitoring = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new MonitorError('已发布的监控快照不是有效 JSON', {
      code: 'invalid_remote_monitoring', cause,
    });
  }
  const { validateMonitoringBaseline, formatIssue } = await import('./lib/data.mjs');
  const [error] = validateMonitoringBaseline(monitoring);
  if (error) {
    throw new MonitorError(`已发布的监控快照校验失败：${formatIssue(error)}`, { code: 'invalid_monitoring' });
  }
  return { monitoring, sha: file.sha };
}

function removeRetiredBaselines(repositories, sources) {
  const registered = new Set(sources.map(({ id }) => id));
  for (const id of Object.keys(repositories)) {
    if (!registered.has(id)) delete repositories[id];
  }
}

async function loadPublishedMonitoring(repo) {
  const { loadSources, paths, writeJsonAtomic } = await import('./lib/data.mjs');
  const target = await resolveTarget({ explicit: repo });
  const client = createGitHubClient({ token: process.env.GITHUB_TOKEN || null });
  const { monitoring, sha } = await readPublishedMonitoring(client, target);
  removeRetiredBaselines(monitoring.repositories, loadSources());
  writeJsonAtomic(paths.monitoring, monitoring);
  console.log(`已读取 ${MONITORING_BRANCH}:${MONITORING_RELATIVE_PATH}（blob ${sha}）`);
}

/**
 * Run one monitor pass. All I/O boundaries are injectable for tests.
 */
export async function runMonitor(options = {}) {
  const mode = options.mode ?? 'dry-run';
  if (!MONITOR_MODES.includes(mode)) {
    throw new MonitorError(`未知运行模式：${mode}`, { code: 'invalid_arguments' });
  }

  const now = options.now ?? (() => new Date());
  const nowDate = now();
  const nowIso = (nowDate instanceof Date ? nowDate : new Date(nowDate)).toISOString();

  let dataModule = options.data ?? null;
  const needDataModule = !options.sources || !options.resources || !options.loadMonitoring || !options.saveMonitoring;
  if (needDataModule && !dataModule) {
    try {
      dataModule = await import('./lib/data.mjs');
    } catch (error) {
      throw new MonitorError(`无法加载 scripts/lib/data.mjs：${error?.message ?? error}`, {
        code: 'data_module_missing',
        cause: error,
      });
    }
  }

  const schemaVersion = options.schemaVersion ?? dataModule?.MONITORING_SCHEMA_VERSION ?? 1;
  const sources = options.sources ?? (await dataModule.loadSources());
  const resources = options.resources ?? (await dataModule.loadResources());
  const loadMonitoring =
    options.loadMonitoring ??
    (() => dataModule.readJson(dataModule.paths.monitoring, null));
  const saveMonitoring =
    options.saveMonitoring ??
    ((value) => dataModule.writeJsonAtomic(dataModule.paths.monitoring, value));

  if (!Array.isArray(sources) || !Array.isArray(resources)) {
    throw new MonitorError('数据层返回的 sources 或 resources 不是数组', { code: 'invalid_data' });
  }

  let target = null;
  if (options.target) {
    target = { ...options.target };
  } else if (options.repo) {
    target = parseRepoSlug(options.repo);
  }
  if (mode === 'publish') {
    target = target ?? (await resolveTarget());
    if (!target.owner || !target.repo) {
      throw new MonitorError('publish 模式需要目标仓库 owner/repo', { code: 'missing_target' });
    }
  }

  const token = options.token ?? process.env.GITHUB_TOKEN ?? '';
  if (mode === 'publish' && !token) {
    throw new MonitorError('publish 模式需要 GITHUB_TOKEN', { code: 'missing_token' });
  }

  const client =
    options.client ??
    createGitHubClient({
      token: token || null,
      transport: options.githubTransport,
    });

  let baseline;
  // Retain the starting blob SHA so a concurrent snapshot update is not overwritten.
  let startingSha;
  if (mode === 'publish') {
    const { default_branch } = await client.getRepo(target.owner, target.repo);
    if (default_branch === MONITORING_BRANCH) {
      throw new MonitorError('监控数据分支不能是默认分支', { code: 'invalid_target' });
    }
    const published = await readPublishedMonitoring(client, target);
    baseline = published.monitoring;
    startingSha = published.sha;
  } else {
    baseline = normalizeMonitoring(await loadMonitoring(), schemaVersion);
  }

  const urls = options.urls ?? collectMonitorUrls(sources, resources);
  const checkLinksImpl = options.checkLinksImpl ?? checkLinks;
  const links = await checkLinksImpl(urls, {
    transport: options.transport,
    lookup: options.lookup,
    now: () => (nowDate instanceof Date ? nowDate.getTime() : Number(nowDate)),
    timeoutMs: options.timeoutMs,
    concurrency: options.concurrency,
    perDomain: options.perDomain,
    maxRedirects: options.maxRedirects,
    allowPrivate: options.allowPrivate ?? false,
  });

  // A runner whose DNS/address safety preflight blocks every URL produces no
  // new availability evidence. Overwriting a baseline that does contain real
  // HTTP evidence would erase useful coverage, so such runs write nothing and
  // report the reason instead. An empty URL list is not a blocked run.
  const linkHealth = summarizeHealth(links);
  const baselineLinkHealth = summarizeHealth(baseline.links);
  const baselineHasUsableCoverage =
    baselineLinkHealth.responded + baselineLinkHealth.auth + baselineLinkHealth.missing > 0;
  const whollyPreflighted = links.length > 0 && linkHealth.preflight === links.length;
  const writeSkipped =
    mode !== 'dry-run' && whollyPreflighted && baselineHasUsableCoverage
      ? {
          reason: 'preflight_only',
          links: links.length,
          baseline_http_responses: baselineLinkHealth.httpResponses,
        }
      : null;

  const repoResults = await checkRepositorySources({
    sources,
    baseline: baseline.repositories,
    client,
    nowIso,
    target,
  });

  const pending = repoResults.filter(
    (result) => result.status === 'changed' && result.diff?.hasChanges,
  );

  let issueNumber = baseline.issue_number ?? null;
  let notifications = { posted: 0, skipped: 0 };
  let repositories = applyBaselineUpdates(baseline.repositories, repoResults, { mode, nowIso });
  // Baselines for deregistered sources are removed: the monitoring schema
  // requires every repository key to exist in data/sources.json.
  removeRetiredBaselines(repositories, sources);

  if (mode === 'publish' && !writeSkipped) {
    const notificationResult = await publishNotifications({
      client,
      target,
      pending,
      issueNumber,
      nowIso,
    });
    issueNumber = notificationResult.issueNumber;
    notifications = {
      posted: notificationResult.posted,
      skipped: notificationResult.skipped,
    };
    // Only now advance changed baselines.
    for (const result of pending) {
      repositories[result.source_id] = {
        head_sha: result.head_sha,
        files: result.files,
        last_checked_at: nowIso,
      };
    }
  }

  const monitoring = {
    schema_version: schemaVersion,
    checked_at: nowIso,
    links,
    repositories,
    issue_number: issueNumber,
  };

  let remote = null;
  if (mode === 'write-local') {
    if (!writeSkipped) await saveMonitoring(monitoring);
  } else if (mode === 'publish' && writeSkipped) {
    // The sibling build still needs the last usable evidence, not this run's preflight failures.
    removeRetiredBaselines(baseline.repositories, sources);
    await saveMonitoring(baseline);
  } else if (mode === 'publish') {
    const payload = `${JSON.stringify(monitoring, null, 2)}\n`;
    const result = await client.putContents(
      target.owner,
      target.repo,
      MONITORING_RELATIVE_PATH,
      {
        content: payload,
        message: `chore: update source monitoring ${nowIso}`,
        branch: MONITORING_BRANCH,
        sha: startingSha,
      },
    );
    remote = {
      sha: result.data?.content?.sha ?? null,
      commit: result.data?.commit?.sha ?? null,
      branch: MONITORING_BRANCH,
    };
    try {
      await saveMonitoring(monitoring);
    } catch (error) {
      throw new MonitorError(
        `监控快照已发布，但同步写入本地 ${MONITORING_RELATIVE_PATH} 失败：${error.message}`,
        { code: 'local_sync_failed', cause: error },
      );
    }
  }

  return {
    mode,
    checked_at: nowIso,
    urls,
    links,
    link_summary: summarizeLinks(links),
    link_health: linkHealth,
    baseline_link_health: baselineLinkHealth,
    write_skipped: writeSkipped,
    repositories: repoResults,
    pending_sources: pending.map((result) => result.source_id),
    notifications,
    issue_number: issueNumber,
    monitoring,
    remote,
    target,
  };
}

export function formatReport(report) {
  const links = Array.isArray(report.links) ? report.links : [];
  const health = report.link_health ?? summarizeHealth(links);
  const total = report.link_summary?.total ?? links.length;
  const hopResponses = Math.max(
    0,
    health.httpResponses - health.responded - health.auth - health.missing,
  );
  const lines = [];
  lines.push(`时间：${report.checked_at}`);
  lines.push(`链接：共 ${total} 条。`);
  lines.push(
    `六类证据（互斥）：${HEALTH_EVIDENCE_LABELS.unchecked} ${health.unchecked}；` +
      `${HEALTH_EVIDENCE_LABELS.preflight} ${health.preflight}；` +
      `${HEALTH_EVIDENCE_LABELS.no_response} ${health.no_response}；` +
      `${HEALTH_EVIDENCE_LABELS.auth} ${health.auth}；` +
      `${HEALTH_EVIDENCE_LABELS.missing} ${health.missing}；` +
      `${HEALTH_EVIDENCE_LABELS.responded} ${health.responded}。`,
  );
  lines.push(
    `有 HTTP 响应证据 ${health.httpResponses} 条（含需登录或认证与确认 404/410` +
      `${hopResponses > 0 ? `；另有 ${hopResponses} 条仅重定向前跳有响应，终跳未确认` : ''}）。`,
  );
  if (health.preflight > 0) {
    const scope = total > 0 && health.preflight === total ? '全部' : `${health.preflight} 条`;
    lines.push(
      `环境提示：${scope}链接未通过安全预检，未向当前目标发出 HTTP 请求。`,
    );
  }

  const whollyPreflighted = total > 0 && health.preflight === total;
  const problems = whollyPreflighted
    ? []
    : links.filter((link) => {
        const category = classifyHealth(link);
        return category !== 'responded' && category !== 'unchecked';
      });
  if (problems.length > 0) {
    lines.push('需要人工关注的链接：');
    for (const link of problems) {
      const category = classifyHealth(link);
      const http = Number.isInteger(link.http_status) ? `，HTTP ${link.http_status}` : '';
      lines.push(
        `- [${HEALTH_EVIDENCE_LABELS[category]}] ${link.status}/${link.reason}${http}：${link.url}`,
      );
    }
  }

  if (report.repositories.length > 0) {
    lines.push('GitHub 仓库：');
    for (const result of report.repositories) {
      const repo = result.owner
        ? `${result.owner}/${result.repo}@${result.branch}`
        : result.source_id;
      if (result.status === 'error') {
        lines.push(`- ${result.source_id} (${repo}) 检查失败：${result.error.code} ${result.error.message}`);
        continue;
      }
      let line = `- ${result.source_id} (${repo}) head=${result.head_sha} ${result.status}`;
      if (result.diff && result.diff.hasChanges) {
        line += ` 新增 ${result.diff.added.length} / 修改 ${result.diff.modified.length} / 删除 ${result.diff.removed.length}`;
      }
      lines.push(line);
    }
  }

  if (report.notifications.posted || report.notifications.skipped) {
    lines.push(
      `Issue 通知：新增 ${report.notifications.posted} 条分块，跳过已有 ${report.notifications.skipped} 条。`,
    );
  }
  if (report.pending_sources.length > 0 && report.mode !== 'publish') {
    lines.push(`待发布通知的来源：${report.pending_sources.join('、')}`);
  }
  if (report.write_skipped) {
    const skipped = report.write_skipped;
    const extra = report.mode === 'publish' ? '，也未发送 Issue 通知' : '';
    lines.push(
      `${report.mode}：未写入 monitoring${extra}（本次 ${skipped.links} 条链接均止于预检）；既有 ${skipped.baseline_http_responses} 条有响应证据的检查结果保持不变。`,
    );
    if (report.pending_sources.length > 0) {
      lines.push(`待发布通知的来源（本次未发送）：${report.pending_sources.join('、')}`);
    }
  } else if (report.mode === 'dry-run') {
    lines.push('dry-run：仅输出报告，未执行写入。');
  } else if (report.mode === 'write-local') {
    lines.push('write-local：已写入本地 data/monitoring.json。');
  } else {
    lines.push(
      `publish：已更新 ${report.remote.branch} 分支的 ${MONITORING_RELATIVE_PATH}（commit ${report.remote.commit ?? '未知'}）。`,
    );
  }
  return lines.join('\n');
}

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
  try {
    if (args.mode === 'load-published') {
      await loadPublishedMonitoring(args.repo);
      return;
    }
    const report = await runMonitor({ mode: args.mode, repo: args.repo });
    console.log(formatReport(report));
  } catch (error) {
    console.error(`监控失败：${error.message}`);
    if (error.code === 'conflict') {
      console.error('data/monitoring.json 已被并发修改，本次保留远端版本；下次运行将自动重试。');
    }
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
const isDirectRun =
  invokedPath !== null &&
  (invokedPath === import.meta.url ||
    (process.platform === 'win32' && invokedPath.toLowerCase() === import.meta.url.toLowerCase()));
if (isDirectRun) {
  main().catch((error) => {
    console.error(`监控失败：${error?.stack ?? error}`);
    process.exitCode = 1;
  });
}
