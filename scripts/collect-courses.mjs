#!/usr/bin/env node
/**
 * 从官方本科开课确定课程全集。
 *
 * 三种输入，全部只接受官方开课目录（catalog.ustc.edu.cn）数据：
 *   node scripts/collect-courses.mjs              直接请求官方 API
 *   node scripts/collect-courses.mjs --stdin      从标准输入读取最小化官方响应
 *   node scripts/collect-courses.mjs --browser    启动一次性本机同源桥，等待浏览器页面 POST
 *
 * 采集或归并出错时保留现有 data/courses.json；仅提取课程归属字段，不保留教学班、教师、人数及原始响应。
 */

import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CATALOG_BASE_URL,
  COURSE_QUERY_URL,
  ROOT,
  SEMESTER_TARGETS,
  TAG_DEFINITIONS,
  createMetadataDraft,
  mergeCourseRecords,
  paths,
  selectTargetSemesters,
  writeJsonAtomic,
} from './lib/data.mjs';

const ALLOWED_ORIGIN = CATALOG_BASE_URL;
const BROWSER_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const WORK_DIR = path.join(ROOT, '.task-work', 'collect');
const FAILURE_REPORT = path.join(WORK_DIR, 'last-failure.json');
const DRAFT_REPORT = path.join(WORK_DIR, 'collect-report.json');
const METADATA_DRAFT = path.join(WORK_DIR, 'course-metadata-draft.json');

const args = new Set(process.argv.slice(2));

if (args.has('--help') || args.has('-h')) {
  console.log(`用法：npm run collect:courses [-- --stdin | --browser]

默认直接请求 https://catalog.ustc.edu.cn 官方 API。
--stdin    从标准输入读取最小化官方响应 {semesters, terms: [{id, rows}]}（仅内存解析）
--browser  启动一次性 127.0.0.1 同源桥，打印 URL 与短期 token，仅接受来自 catalog.ustc.edu.cn 的 POST 请求

任一模式出错时均保留现有 data/courses.json。`);
  process.exit(0);
}

if (args.has('--stdin') && args.has('--browser')) {
  console.error('--stdin 与 --browser 只能选一个。');
  process.exitCode = 1;
  process.exit();
}

const unknownArgs = [...args].filter(
  (arg) => !['--stdin', '--browser'].includes(arg),
);
if (unknownArgs.length) {
  console.error(`未知参数：${unknownArgs.join(', ')}`);
  process.exitCode = 1;
  process.exit();
}

const MODE = args.has('--browser') ? 'browser' : args.has('--stdin') ? 'stdin' : 'direct';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function fetchOfficialJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'accept-language': 'zh-CN,zh;q=0.9',
          referer: COURSE_QUERY_URL,
          'user-agent': 'USTC-Course-Navigation/0.1 (official catalog collector)',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const finalUrl = new URL(response.url);
      if (finalUrl.hostname !== 'catalog.ustc.edu.cn') {
        throw new Error(`官方 API 被重定向到非官方主机：${finalUrl.hostname}`);
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const snippet = text.replace(/\s+/g, ' ').slice(0, 120);
        throw new Error(`HTTP ${response.status}${snippet ? `：${snippet}` : ''}`);
      }
      const text = await response.text();
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        throw new Error('响应不是 JSON（可能是登录页、错误页或网关拦截）');
      }
      return value;
    } catch (error) {
      lastError = error;
      if (attempt === 1) await sleep(1200);
    }
  }
  throw new Error(`${url} 请求失败：${lastError?.message ?? lastError}`);
}

async function collectDirect() {
  console.log('读取官方学期列表…');
  const semesterList = await fetchOfficialJson(`${CATALOG_BASE_URL}/api/teach/semester/list`);
  if (!Array.isArray(semesterList) || semesterList.length === 0) {
    throw new Error('官方学期列表为空或不是数组');
  }
  const { selected, missing } = selectTargetSemesters(semesterList);
  if (missing.length) {
    throw new Error(
      `官方学期列表缺少目标学期：${missing.map((item) => `${item.id}/${item.code}`).join('、')}`,
    );
  }

  const terms = [];
  for (const semester of selected) {
    console.log(`读取 ${semester.label}（${semester.id}/${semester.code}）本科开课…`);
    const lessons = await fetchOfficialJson(
      `${CATALOG_BASE_URL}/api/teach/lesson/list-for-teach/${semester.id}`,
    );
    if (!Array.isArray(lessons) || lessons.length === 0) {
      throw new Error(`${semester.label} 教学班响应为空`);
    }
    terms.push({ ...semester, lessons });
  }
  return terms;
}

function readStdinPayload() {
  let text;
  try {
    text = readFileSync(0, 'utf8');
  } catch (error) {
    throw new Error(`读取标准输入失败：${error?.message ?? error}`);
  }
  if (!text.trim()) throw new Error('标准输入为空；请通过管道传入从官方开课页面获取的最小化 JSON 响应');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`标准输入不是合法 JSON：${error?.message ?? error}`);
  }
}

/**
 * 只接受四个固定目标学期。rows 仅保留解析所需字段由 merge 完成，
 * 本函数不复制教师、教学班等附加信息。
 */
function normalizeIncomingPayload(payload) {
  if (!isPlainObject(payload)) throw new Error('输入必须是对象 {semesters, terms}');
  const semesterMetadata = Array.isArray(payload.semesters) ? payload.semesters : [];
  const terms = Array.isArray(payload.terms) ? payload.terms : [];
  if (terms.length === 0) throw new Error('terms 不能为空');

  const rowsById = new Map();
  for (const term of terms) {
    if (!isPlainObject(term)) throw new Error('terms 的每一项必须是对象');
    const id = String(term.id ?? '');
    if (!id) throw new Error('terms 缺少 id');
    if (!SEMESTER_TARGETS.some((target) => String(target.id) === id)) {
      throw new Error(`terms 含非目标学期 id=${id}；仅接受 ${SEMESTER_TARGETS.map((t) => t.id).join(' / ')}`);
    }
    if (rowsById.has(id)) throw new Error(`terms 含重复学期 id=${id}`);
    const rows = term.rows ?? term.lessons;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error(`学期 id=${id} 的 rows 为空`);
    }
    rowsById.set(id, rows);
  }

  return SEMESTER_TARGETS.map((target) => {
    const rows = rowsById.get(String(target.id));
    if (!rows) throw new Error(`缺少目标学期 id=${target.id}/${target.code} 的 rows`);
    const meta = semesterMetadata.find(
      (entry) => isPlainObject(entry) && String(entry.id) === String(target.id),
    );
    if (meta && meta.code !== undefined && String(meta.code) !== String(target.code)) {
      throw new Error(
        `学期 id=${target.id} 的 code 不一致：收到 ${String(meta.code)}，应为 ${target.code}`,
      );
    }
    const label =
      (typeof meta?.name === 'string' && meta.name.trim()) ||
      (typeof meta?.cn === 'string' && meta.cn.trim()) ||
      (typeof meta?.title === 'string' && meta.title.trim()) ||
      target.label;
    return {
      id: target.id,
      code: target.code,
      order: target.order,
      label,
      lessons: rows,
    };
  });
}

function safeTokenEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function applyCors(response, origin) {
  response.setHeader('Vary', 'Origin');
  if (origin === ALLOWED_ORIGIN) {
    response.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    // Chrome Private Network Access：官方公网页面访问本机回环端口时需显式允许。
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
}

function sendJson(response, status, value, origin) {
  applyCors(response, origin);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'close',
  });
  response.end(JSON.stringify(value));
}

/**
 * 一次性本机同源桥。仅接受官方 catalog origin、短期随机 token、
 * application/json 且 body 不超过 16 MiB；成功一次即关停。
 */
async function collectBrowser() {
  const token = randomBytes(32).toString('base64url');
  let settled = false;
  let resolvePayload;
  let rejectPayload;
  const payloadPromise = new Promise((resolve, reject) => {
    resolvePayload = resolve;
    rejectPayload = reject;
  });

  const server = createServer((request, response) => {
    const origin = request.headers.origin;
    if (request.method === 'OPTIONS') {
      if (origin !== ALLOWED_ORIGIN) {
        sendJson(response, 403, { ok: false, error: 'origin not allowed' }, origin);
        return;
      }
      applyCors(response, origin);
      response.writeHead(204, {
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type, x-collect-token',
        'access-control-max-age': '600',
        'cache-control': 'no-store',
        connection: 'close',
      });
      response.end();
      return;
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' }, origin);
      return;
    }
    if (settled) {
      sendJson(response, 409, { ok: false, error: 'already received' }, origin);
      return;
    }
    if (origin !== ALLOWED_ORIGIN) {
      sendJson(response, 403, { ok: false, error: 'origin not allowed' }, origin);
      return;
    }
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (requestUrl.pathname !== '/collect') {
      sendJson(response, 404, { ok: false, error: 'not found' }, origin);
      return;
    }
    const suppliedToken =
      requestUrl.searchParams.get('token') ?? request.headers['x-collect-token'] ?? '';
    if (!safeTokenEqual(suppliedToken, token)) {
      sendJson(response, 403, { ok: false, error: 'invalid token' }, origin);
      return;
    }
    const contentType = String(request.headers['content-type'] ?? '');
    if (!/^application\/json(?:;|$)/i.test(contentType)) {
      sendJson(response, 415, { ok: false, error: 'content-type must be application/json' }, origin);
      return;
    }
    const announcedLength = Number(request.headers['content-length'] ?? 0);
    if (Number.isFinite(announcedLength) && announcedLength > MAX_BODY_BYTES) {
      sendJson(response, 413, { ok: false, error: 'body too large' }, origin);
      request.destroy();
      return;
    }

    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        sendJson(response, 413, { ok: false, error: 'body too large' }, origin);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge || settled) return;
      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        sendJson(response, 400, { ok: false, error: 'invalid json' }, origin);
        return;
      }
      let terms;
      try {
        terms = normalizeIncomingPayload(payload);
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error?.message ?? String(error) }, origin);
        return;
      }
      settled = true;
      sendJson(response, 200, { ok: true }, origin);
      resolvePayload(terms);
    });
    request.on('error', () => {
      if (!settled && !response.headersSent) {
        sendJson(response, 400, { ok: false, error: 'request error' }, origin);
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  server.on('error', (error) => {
    if (!settled) rejectPayload(error);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  if (!port) {
    server.close();
    throw new Error('无法启动本机桥');
  }

  console.log('已启动一次性本机同源桥（仅监听 127.0.0.1）。');
  console.log(`POST http://127.0.0.1:${port}/collect?token=${token}`);
  console.log(`允许 Origin：${ALLOWED_ORIGIN}；body ≤ 16 MiB；成功接收一次后立即关闭。`);
  console.log('在浏览器打开的 catalog.ustc.edu.cn 页面执行同源 fetch，POST {semesters, terms} 最小化数据。');

  const timeout = setTimeout(() => {
    rejectPayload(new Error('等待浏览器数据超时（10 分钟）'));
  }, BROWSER_TIMEOUT_MS);

  try {
    return await payloadPromise;
  } finally {
    clearTimeout(timeout);
    settled = true;
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

function writeFailureReport(error, extra = {}) {
  try {
    writeJsonAtomic(FAILURE_REPORT, {
      generated_at: new Date().toISOString(),
      mode: MODE,
      error: error?.message ?? String(error),
      preserved_courses: paths.courses,
      ...extra,
    });
  } catch {
    // 诊断报告写入失败不应掩盖原始错误。
  }
}

function finalize(terms) {
  const merged = mergeCourseRecords(terms);

  if (merged.invalid.length) {
    const detail = {
      invalid: merged.invalid,
      stats: merged.stats,
    };
    const error = new Error(
      `官方记录有 ${merged.invalid.length} 条缺少必需字段（课程代码、名称、教育层次、课程类别或课程层次）`,
    );
    error.details = detail;
    throw error;
  }
  if (merged.conflicts.length) {
    const conflictCodes = [...new Set(merged.conflicts.map((conflict) => conflict.code))].sort();
    const detail = {
      conflict_codes: conflictCodes,
      conflicts: merged.conflicts,
      stats: merged.stats,
    };
    const error = new Error(
      `同一学期同码存在 ${merged.conflicts.length} 项名称或最终 kind 冲突（${conflictCodes.join('、')}）`,
    );
    error.details = detail;
    throw error;
  }
  if (merged.courses.length === 0) {
    const error = new Error('合并后的本科课程清单为空');
    error.details = { stats: merged.stats };
    throw error;
  }

  writeJsonAtomic(METADATA_DRAFT, createMetadataDraft(merged));
  writeJsonAtomic(DRAFT_REPORT, {
    generated_at: new Date().toISOString(),
    mode: MODE,
    official_source: `${CATALOG_BASE_URL}/api/teach/lesson/list-for-teach/{id}`,
    semesters: merged.stats.semesters,
    stats: merged.stats,
    name_changes: merged.nameChanges,
    classification_changes: merged.classificationChanges,
    invalid: merged.invalid,
    conflicts: merged.conflicts,
    metadata_draft: {
      path: path.relative(ROOT, METADATA_DRAFT).split(path.sep).join('/'),
      note: 'kind 已按官方最新学期记录生成；tags 留空，须逐课核实内容后填写。',
    },
    tag_definitions: TAG_DEFINITIONS.map(({ id, label, hint }) => ({ id, label, hint })),
  });
  writeJsonAtomic(paths.courses, merged.courses);

  for (const semester of merged.stats.semesters) {
    console.log(
      `${semester.label}（${semester.code}）：教学班 ${semester.total_lessons}，本科教学班 ${semester.undergraduate_lessons}，本科课程 ${semester.undergraduate_courses}，非本科 ${semester.skipped_by_education}，无效 ${semester.invalid_lessons}`,
    );
  }
  console.log(
    `合并完成：${merged.courses.length} 门本科课程；名称变化 ${merged.nameChanges.length}，分类变化 ${merged.classificationChanges.length}，冲突 0，无效 0。`,
  );
  console.log(`已写入 ${paths.courses}`);
  console.log(`分类草稿：${METADATA_DRAFT}（tags 为空，需研究后填写正式 data/course-metadata.json）`);
  console.log(`采集报告：${DRAFT_REPORT}`);
}

async function main() {
  let terms;
  if (MODE === 'direct') {
    terms = await collectDirect();
  } else if (MODE === 'stdin') {
    terms = normalizeIncomingPayload(readStdinPayload());
  } else {
    terms = await collectBrowser();
  }
  finalize(terms);
}

try {
  await main();
} catch (error) {
  console.error(`采集失败：${error?.message ?? error}`);
  console.error('现有 data/courses.json 保持不变。');
  if (MODE === 'direct') {
    console.error(
      'Node 直连官方 API 若被网关拦截，可改用 `npm run collect:courses -- --stdin`，' +
        '由浏览器页面同源读取后把最小化 {semesters, terms} 通过管道传入。',
    );
  }
  writeFailureReport(error, error?.details ?? {});
  process.exitCode = 1;
}
