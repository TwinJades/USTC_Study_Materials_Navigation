/**
 * vLab 自建站回归：真实子进程 `scripts/serve.mjs --vlab`。
 *
 * 隔离发布目录：把 `scripts/` 整体复制到临时目录，dist 只放一个 html 和一个
 * 静态资源；SQLite 放在发布目录之外的绝对路径。端口用 `YEXI_VLAB_PORT=0`，
 * 监听地址只从启动日志读取，顺带验证日志报告的是真实端口。
 *
 * 覆盖：静态服务与越界路径、统计接口的三字段隐私契约、跨站与畸形请求不计入、
 * 重启后累计保留、昨日数与累计数语义，以及站点脚本 visit-stats.mjs 的完整链路。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY_MS = 24 * 60 * 60 * 1000;
const STATS_KEYS = ['site_total_views', 'site_views_date_utc', 'site_views_yesterday'];
const INDEX_MARKER = 'vlab fixture index';
const ASSET_MARKER = 'console.log("vlab fixture asset");';

function utcDay(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* 隔离发布目录                                                        */
/* ------------------------------------------------------------------ */

async function createRelease() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yexi-vlab-'));
  const release = path.join(root, 'release');
  await cp(path.join(ROOT, 'scripts'), path.join(release, 'scripts'), { recursive: true });
  await mkdir(path.join(release, 'dist', 'assets'), { recursive: true });
  await writeFile(
    path.join(release, 'dist', 'index.html'),
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${INDEX_MARKER}</title><p>${INDEX_MARKER}</p></html>`,
  );
  await writeFile(path.join(release, 'dist', 'assets', 'app.js'), `${ASSET_MARKER}\n`);
  const dbPath = path.join(root, 'var', 'stats.sqlite');
  await mkdir(path.dirname(dbPath), { recursive: true });
  return { root, release, dbPath };
}

/**
 * 每个用例一份发布目录，收尾按「先停子进程、再删目录」的固定顺序执行：
 * Windows 上子进程的工作目录会锁住临时目录。
 */
async function harness(t) {
  const release = await createRelease();
  const running = new Set();
  t.after(async () => {
    for (const server of running) await stopServer(server);
    await rm(release.root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  });
  return {
    release,
    async start(env) {
      const server = await startServer(release, env);
      running.add(server);
      return server;
    },
  };
}

/* ------------------------------------------------------------------ */
/* 子进程与 HTTP                                                       */
/* ------------------------------------------------------------------ */

async function startServer(release, env = {}) {
  const child = spawn(process.execPath, [path.join(release.release, 'scripts', 'serve.mjs'), '--vlab'], {
    // 工作目录放在发布目录之外：dist 与 SQLite 都必须相对脚本解析，而不是相对 cwd。
    cwd: os.tmpdir(),
    env: { ...process.env, YEXI_VLAB_PORT: '0', YEXI_STATS_DB: release.dbPath, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  const collect = (chunk) => {
    output += chunk.toString('utf8');
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`服务器 20 秒内没有输出监听地址：\n${output}`)), 20000);
    const check = () => {
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\//u);
      if (!match) return;
      clearTimeout(timer);
      resolve(`http://127.0.0.1:${match[1]}`);
    };
    child.stdout.on('data', check);
    child.stderr.on('data', check);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`服务器提前退出（code=${code}, signal=${signal}）：\n${output}`));
    });
  });

  return { child, origin, output: () => output };
}

async function stopServer(server) {
  const { child } = server;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

// 直接给 path：URL 构造器会把 `/../x` 归一化成 `/x`，测越界必须保留原始路径。
function request(origin, pathname, { method = 'GET', headers = {}, body } = {}) {
  const base = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: base.hostname, port: base.port, path: pathname, method, headers, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) });
        });
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function visitHeaders(overrides = {}) {
  return { 'sec-fetch-site': 'same-origin', 'x-yexi-visit': '1', ...overrides };
}

function postVisit(origin, headers = visitHeaders()) {
  return request(origin, '/api/visits', { method: 'POST', headers });
}

function assertStats(payload) {
  assert.deepEqual(Object.keys(payload).sort(), STATS_KEYS, '统计响应只暴露三个字段');
  const { site_views_yesterday: yesterday, site_views_date_utc: stamp, site_total_views: total } = payload;
  assert.ok(yesterday === null || Number.isInteger(yesterday), '昨日浏览数必须是整数或 null');
  assert.match(String(stamp), /^\d{4}-\d{2}-\d{2}$/u, '必须给出 UTC 日标记');
  assert.ok(Number.isInteger(total) && total >= 0, '累计浏览数必须是非负整数');
  for (const value of Object.values(payload)) {
    assert.ok(
      !/127\.0\.0\.1|user-agent|sec-fetch|cookie|referer/iu.test(String(value)),
      '统计响应不得回显请求信息',
    );
  }
  return { yesterday, stamp, total };
}

/* ------------------------------------------------------------------ */
/* 直接读写 SQLite                                                     */
/* ------------------------------------------------------------------ */

// 与 scripts/lib/visit-stats.mjs 同一份 DDL：服务器自己会建表，这里提前种数据。
function seedDay(dbPath, day, views) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('CREATE TABLE IF NOT EXISTS daily_visits (day TEXT PRIMARY KEY, views INTEGER NOT NULL) STRICT');
    db.prepare('INSERT OR REPLACE INTO daily_visits (day, views) VALUES (?, ?)').run(day, views);
  } finally {
    db.close();
  }
}

function readStoredDays(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const columns = db
      .prepare('PRAGMA table_info(daily_visits)')
      .all()
      .map((column) => column.name);
    const rows = db.prepare('SELECT day, views FROM daily_visits ORDER BY day').all();
    return { columns, rows: rows.map((row) => ({ ...row })) };
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------------ */
/* 静态服务                                                            */
/* ------------------------------------------------------------------ */

test('vlab: 服务隔离 dist，拒绝越界路径与发布目录外的数据库', async (t) => {
  const { start } = await harness(t);
  const server = await start();

  const index = await request(server.origin, '/');
  assert.equal(index.status, 200);
  assert.match(index.headers['content-type'], /^text\/html/u);
  assert.ok(index.text.includes(INDEX_MARKER));

  const asset = await request(server.origin, '/assets/app.js');
  assert.equal(asset.status, 200);
  assert.match(asset.headers['content-type'], /^text\/javascript/u);
  assert.ok(asset.text.includes('vlab fixture asset'));

  const head = await request(server.origin, '/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.text, '');

  const blocked = [
    ['/../var/stats.sqlite', 403],
    ['/%2e%2e/%2e%2e/var/stats.sqlite', 403],
    ['/assets/..%5c..%5cvar%5cstats.sqlite', 400],
  ];
  for (const [pathname, expected] of blocked) {
    const response = await request(server.origin, pathname);
    assert.equal(response.status, expected, `${pathname} 的响应码`);
    assert.ok(!/SQLite format/u.test(response.text), '不得泄露数据库内容');
  }

  const outside = await request(server.origin, '/stats.sqlite');
  assert.equal(outside.status, 404, '数据库位于发布目录之外，不能通过静态路径访问');

  const nearMiss = await request(server.origin, '/api/visits/');
  assert.equal(nearMiss.status, 404, '统计接口只认精确路径，不参与静态回退');
});

/* ------------------------------------------------------------------ */
/* 统计接口契约                                                        */
/* ------------------------------------------------------------------ */

test('vlab: 首次访问只返回三个计数，昨日为空但给出 UTC 日标记', async (t) => {
  const { release, start } = await harness(t);
  const server = await start();

  const dayBefore = utcDay(0);
  const yesterdayBefore = utcDay(-1);
  const response = await postVisit(server.origin);
  const yesterdayAfter = utcDay(-1);
  const dayAfter = utcDay(0);

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^application\/json/u);
  assert.equal(response.headers['cache-control'], 'no-store', '统计响应不得被缓存');
  assert.equal(response.headers['set-cookie'], undefined, '统计接口不得写 cookie');

  const stats = assertStats(response.json());
  assert.equal(stats.yesterday, null, '没有任何历史日时不补 0');
  assert.ok([yesterdayBefore, yesterdayAfter].includes(stats.stamp), '日标记必须是被统计的 UTC 昨日');
  assert.equal(stats.total, 1);

  const proxied = await postVisit(server.origin, visitHeaders({ 'transfer-encoding': 'chunked' }));
  assert.equal(proxied.status, 200, '代理转发的空分块请求应计数');
  const second = assertStats(proxied.json());
  assert.equal(second.total, 2, '同日重复上报累加');
  assert.equal(second.yesterday, null);
  assert.equal(second.stamp, stats.stamp);

  // 提交已经落盘；趁服务器还在运行读库，不依赖进程退出时的刷盘时机。
  const stored = readStoredDays(release.dbPath);
  assert.deepEqual(stored.columns.sort(), ['day', 'views'], '只保存日期与计数，不存请求信息');
  assert.equal(stored.rows.length, 1);
  assert.ok([dayBefore, dayAfter].includes(stored.rows[0].day), '日期按 UTC 天记录');
  assert.equal(stored.rows[0].views, 2);
});

test('vlab: 跨站、缺版本头、带请求体与 GET 都不计数', async (t) => {
  const { start } = await harness(t);
  const server = await start();

  assert.equal(assertStats((await postVisit(server.origin)).json()).total, 1);

  const body = '{"course":"MATH1001"}';
  const rejected = [
    ['跨站来源', 403, { headers: visitHeaders({ 'sec-fetch-site': 'cross-site' }) }],
    ['同站子域', 403, { headers: visitHeaders({ 'sec-fetch-site': 'same-site' }) }],
    ['无来源标记', 403, { headers: { 'x-yexi-visit': '1' } }],
    ['缺版本头', 403, { headers: { 'sec-fetch-site': 'same-origin' } }],
    ['版本头错误', 403, { headers: visitHeaders({ 'x-yexi-visit': '2' }) }],
    [
      '带请求体',
      400,
      {
        headers: visitHeaders({
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
        }),
        body,
      },
    ],
    ['分块请求带内容', 400, { headers: visitHeaders({ 'transfer-encoding': 'chunked' }), body }],
  ];
  for (const [label, expected, options] of rejected) {
    const response = await request(server.origin, '/api/visits', { method: 'POST', ...options });
    assert.equal(response.status, expected, `${label} 的响应码`);
    assert.ok(!response.text.includes('site_total_views'), `${label} 不得返回统计 JSON`);
  }

  const read = await request(server.origin, '/api/visits', { method: 'GET', headers: visitHeaders() });
  assert.equal(read.status, 405);
  assert.equal(read.headers.allow, 'POST');
  assert.ok(!read.text.includes('site_total_views'), 'GET 不得返回统计 JSON');

  const after = assertStats((await postVisit(server.origin)).json());
  assert.equal(after.total, 2, '被拒绝的请求不能计数');
});

test('vlab: 重启后累计保留，昨日数从 SQLite 读取', async (t) => {
  const { release, start } = await harness(t);

  const first = await start();
  const before = assertStats((await postVisit(first.origin)).json());
  assert.equal(before.total, 1);
  assert.equal(before.yesterday, null);
  await stopServer(first);

  const seededDay = utcDay(-1);
  seedDay(release.dbPath, seededDay, 7);

  const second = await start();
  const after = assertStats((await postVisit(second.origin)).json());
  assert.equal(after.stamp, seededDay, '日标记仍是昨日');
  assert.equal(after.yesterday, 7, '昨日数来自前一天的行');
  assert.equal(after.total, 9, '累计数是所有日期之和，跨重启保留');

  const third = assertStats((await postVisit(second.origin)).json());
  assert.equal(third.yesterday, 7, '同一天内昨日数保持不变');
  assert.equal(third.total, 10);
});

test('vlab: 只有更早的数据时昨日数是已知的 0，不是 null', async (t) => {
  const { release, start } = await harness(t);
  // 只有三天前的数据；昨天这一行不存在。
  seedDay(release.dbPath, utcDay(-3), 4);

  const server = await start();
  const stats = assertStats((await postVisit(server.origin)).json());
  assert.equal(stats.stamp, utcDay(-1));
  assert.equal(stats.yesterday, 0, '历史已存在但昨日无访问：明确为 0');
  assert.equal(stats.total, 5, '累计数包含所有日期');
});

/* ------------------------------------------------------------------ */
/* 站点脚本 visit-stats.mjs 的完整链路                                  */
/* ------------------------------------------------------------------ */

function createStatsDom() {
  const appended = [];
  const items = new Map();
  for (const key of ['site_views_yesterday', 'site_total_views']) {
    const value = { textContent: '' };
    const date = { append: (text) => appended.push({ key, text }) };
    const item = {
      hidden: true,
      querySelector: (selector) => {
        if (selector === '[data-stat-value]') return value;
        if (selector === '[data-stat-date]') return date;
        return null;
      },
    };
    items.set(key, { item, value });
  }
  const container = {
    hidden: true,
    querySelector: (selector) => {
      const match = selector.match(/^\[data-stat-item="([^"]+)"\]$/u);
      return match ? (items.get(match[1])?.item ?? null) : null;
    },
  };
  return {
    document: { getElementById: (id) => (id === 'site-stats' ? container : null) },
    container,
    items,
    appended,
  };
}

async function until(predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('等待站点脚本完成超时');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test('vlab: 站点脚本上报一次并渲染昨日与累计', async (t) => {
  const { release, start } = await harness(t);
  const seededDay = utcDay(-1);
  seedDay(release.dbPath, seededDay, 7);

  // 站点脚本按自身位置解析 ../api/visits；放在 <root>/assets 下才得到 /api/visits。
  const modulePath = path.join(release.root, 'assets', 'visit-stats.mjs');
  await mkdir(path.dirname(modulePath), { recursive: true });
  await cp(path.join(ROOT, 'site', 'assets', 'visit-stats.mjs'), modulePath);

  const server = await start();

  const dom = createStatsDom();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.document = dom.document;
  globalThis.fetch = (input, init = {}) => {
    const url = input instanceof URL ? input : new URL(String(input));
    calls.push({ url, init });
    // 浏览器里 ../api/visits 落在站点根；本地模块是 file: URL，这里换成同源地址。
    const relative = path.relative(release.root, fileURLToPath(url)).split(path.sep).join('/');
    // 浏览器自动附加 Sec-Fetch-Site，页面脚本无法伪造，这里补上同样的值。
    return realFetch(new URL(`/${relative}`, server.origin), {
      ...init,
      headers: { ...init.headers, 'sec-fetch-site': 'same-origin' },
    });
  };
  try {
    await import(pathToFileURL(modulePath).href);
    await until(() => dom.container.hidden === false);
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.document;
  }

  assert.equal(calls.length, 1, '每次完整加载只上报一次');
  const [{ url, init }] = calls;
  assert.ok(url.pathname.endsWith('/api/visits'), `上报路径 ${url.pathname}`);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['x-yexi-visit'], '1', '必须带版本头');
  assert.equal(init.body, undefined, '不得携带请求体');
  assert.equal(init.credentials, 'omit', '不得携带凭据');

  const yesterday = dom.items.get('site_views_yesterday');
  const total = dom.items.get('site_total_views');
  assert.equal(yesterday.value.textContent, '7');
  assert.equal(total.value.textContent, '8', '本次访问计入累计');
  assert.equal(yesterday.item.hidden, false);
  assert.equal(total.item.hidden, false);
  assert.deepEqual(dom.appended, [{ key: 'site_views_yesterday', text: ` · ${seededDay}` }], '昨日数旁标注 UTC 日期');

  const stored = readStoredDays(release.dbPath);
  assert.deepEqual(stored.columns.sort(), ['day', 'views'], '只保存日期与计数');
  assert.equal(stored.rows.length, 2, '种下的昨日行与本次访问各一行');
  assert.deepEqual(stored.rows[0], { day: seededDay, views: 7 });
  assert.ok(stored.rows[1].day > seededDay, '本次访问记在今天');
  assert.equal(stored.rows[1].views, 1);
});

/* ------------------------------------------------------------------ */
/* 配置约束                                                            */
/* ------------------------------------------------------------------ */

test('vlab: 缺少绝对路径的 YEXI_STATS_DB 时拒绝启动', async (t) => {
  const { release } = await harness(t);

  for (const value of [undefined, 'var/stats.sqlite']) {
    const env = { ...process.env, YEXI_VLAB_PORT: '0' };
    delete env.YEXI_STATS_DB;
    if (value !== undefined) env.YEXI_STATS_DB = value;

    const child = spawn(process.execPath, [path.join(release.release, 'scripts', 'serve.mjs'), '--vlab'], {
      cwd: os.tmpdir(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    const [code] = await once(child, 'exit');
    clearTimeout(timer);

    assert.notEqual(code, 0, `YEXI_STATS_DB=${value} 时应以非零状态退出`);
    assert.match(output, /YEXI_STATS_DB/u, '错误信息必须点明缺失的环境变量');
    assert.ok(!/http:\/\/127\.0\.0\.1:\d+\//u.test(output), '配置不完整时不得开始监听');
  }
});
