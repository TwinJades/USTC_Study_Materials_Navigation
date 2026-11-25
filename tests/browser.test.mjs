/**
 * 真实页面浏览器回归：course.html + app.mjs + style.css + 模式按钮。
 *
 * 不引入第三方依赖：直接启动本机 Chrome/Edge 的 headless 模式，通过
 * DevTools 协议（Node 内置 WebSocket）执行页面脚本并读取计算样式。
 * 合成 catalog 只存在于内存与临时 HTTP 服务中，不写入仓库或 dist。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCatalog, renderSourcesHtml } from '../scripts/build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_DIR = path.join(ROOT, 'site');
const COURSE_CODE = 'MATH1001';
const QUIZ_COURSE_CODE = 'MATH1002';
const QUESTION_SHA = 'a'.repeat(64);
const SOLUTION_SHA = 'b'.repeat(64);
const QUESTION_PAGE = 'https://example.org/ustc/math1001/2024-final';
const QUESTION_URL = 'https://example.org/ustc/math1001/2024-final.pdf';
const SOLUTION_URL = 'https://example.org/ustc/math1001/2024-final-solution.pdf';
const QUIZ_PAGE = 'https://example.org/ustc/math1002/quiz3';
const QUIZ_SOLUTION_URL = 'https://example.org/ustc/math1002/quiz3-sol.pdf';
const QUESTION_BYTES = 123456;
const SOLUTION_BYTES = 7890;
const SNAPSHOT_DATE = '2026-11-18';
const MODE_STORAGE_KEY_LEGACY = 'ustc-course-nav.mode';
const MODE_STORAGE_KEY_CATALOG = 'ustc-course-nav.mode.catalog';
const MODE_STORAGE_KEY_COURSE = 'ustc-course-nav.mode.course';
const THEME_STORAGE_KEY = 'ustc-course-nav.theme';

/* ------------------------------------------------------------------ */
/* 合成目录（只走正式 buildCatalog 投影，不接触 data/）                  */
/* ------------------------------------------------------------------ */

function createFixtureDataset() {
  return {
    courses: [
      { code: COURSE_CODE, name: '数学分析（浏览器回归）' },
      { code: QUIZ_COURSE_CODE, name: '数学分析 A2（小测参考答案回归）' },
      { code: 'PHYS1001', name: '力学（无资料回归）' },
    ],
    courseMetadata: {
      [COURSE_CODE]: { kind: 'common', tags: ['math'] },
      [QUIZ_COURSE_CODE]: { kind: 'common', tags: ['math'] },
      PHYS1001: { kind: 'common', tags: ['physics'] },
    },
    tags: [
      { id: 'math', label: '数学' },
      { id: 'physics', label: '物理' },
    ],
    sources: [
      {
        id: 'fixture-source',
        name: '浏览器回归测试来源',
        url: 'https://example.org/ustc/math1001',
        maintainer: '合成测试',
        kind: 'website',
        github: null,
        notes: '',
      },
    ],
    resources: [
      {
        id: 'browser-fixture-exam',
        course_codes: [COURSE_CODE],
        type: 'exams',
        title: '2024 期末（含解答）',
        authors: ['测试署名'],
        notes: '',
        coverage: {
          years: [2024],
          academic_years: [],
          exam_kind: 'final',
          exam_form: 'original',
          has_solutions: true,
          evidence_url: QUESTION_PAGE,
          note: '合成测试：卷面题头与配套解答分别取样。',
        },
        locations: [
          {
            source_id: 'fixture-source',
            page_url: QUESTION_PAGE,
            download_page: null,
            download_url: QUESTION_URL,
            access: 'public',
            page_kind: 'file',
            license_note: '仅链接原页面；授权以原页面声明为准（合成测试）',
            attribution: '课程组公开署名（合成测试）',
            file_snapshot: {
              sha256: QUESTION_SHA,
              bytes: QUESTION_BYTES,
              checked_at: SNAPSHOT_DATE,
            },
          },
          {
            source_id: 'fixture-source',
            page_url: null,
            download_page: null,
            download_url: SOLUTION_URL,
            access: 'public',
            page_kind: 'file',
            license_note: '仅链接原页面；授权以原页面声明为准（合成测试）',
            attribution: '课程组公开署名（合成测试）',
            role: 'solution',
            file_snapshot: {
              sha256: SOLUTION_SHA,
              bytes: SOLUTION_BYTES,
              checked_at: SNAPSHOT_DATE,
            },
          },
          {
            source_id: 'icourse-club',
            page_url: 'https://icourse.club/course/123/#review-456',
            download_page: null,
            download_url: null,
            access: 'login',
            page_kind: 'page',
            attachment_snapshots: [
              { sha256: '3'.repeat(64), bytes: 1234, checked_at: SNAPSHOT_DATE },
              { sha256: '4'.repeat(64), bytes: 5678, checked_at: SNAPSHOT_DATE },
            ],
          },
        ],
        verified_at: SNAPSHOT_DATE,
      },
      {
        id: 'browser-fixture-quiz',
        course_codes: [QUIZ_COURSE_CODE],
        type: 'homework',
        title: '2025 秋 第一次小测（含参考答案）',
        authors: ['测试署名'],
        notes: '',
        exercise_source: '2025 秋课程主页第一次随堂小测（含较长出处描述用于窄屏换行检验）',
        coverage: {
          years: [2025],
          academic_years: [],
          exam_kind: 'quiz',
          exam_form: 'original',
          has_solutions: true,
          evidence_url: QUIZ_PAGE,
          note: '',
        },
        locations: [
          {
            source_id: 'fixture-source',
            page_url: QUIZ_PAGE,
            download_page: null,
            download_url: `${QUIZ_PAGE}.pdf`,
            access: 'public',
            page_kind: 'file',
          },
          {
            source_id: 'fixture-source',
            page_url: null,
            download_page: null,
            download_url: QUIZ_SOLUTION_URL,
            access: 'public',
            page_kind: 'file',
            role: 'solution',
          },
        ],
        verified_at: SNAPSHOT_DATE,
      },
    ],
    monitoring: { links: [] },
    traffic: {},
  };
}

function createFixtureCatalog() {
  return buildCatalog(createFixtureDataset());
}

function createFixtureSourcesHtml(catalog) {
  return renderSourcesHtml({
    coverage: [],
    sources: [],
    generalLogs: [],
    courseLogs: [],
    unmappedLogs: [],
    blocked: [],
    incomplete: [],
    health: {},
    checkedAt: null,
    withResources: catalog.counts.with_resources,
    withoutResources: catalog.counts.without_resources,
    resources: catalog.counts.resources,
    courseCount: catalog.counts.courses,
    sourceCount: catalog.sources.length,
    usedSourceCount: catalog.sources.length,
    logCount: 0,
    catalog,
  });
}

/* ------------------------------------------------------------------ */
/* 浏览器发现                                                          */
/* ------------------------------------------------------------------ */

function findOnPath(names) {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const dir of dirs) {
      for (const candidate of [name, `${name}.exe`]) {
        const absolute = path.join(dir, candidate);
        if (existsSync(absolute)) return absolute;
      }
    }
  }
  return null;
}

function findBrowser() {
  const absoluteCandidates = [];
  if (process.platform === 'win32') {
    absoluteCandidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
    );
  } else if (process.platform === 'darwin') {
    absoluteCandidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else {
    absoluteCandidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    );
  }

  const candidates = [
    process.env.CHROME_PATH,
    ...absoluteCandidates,
    findOnPath(['google-chrome', 'google-chrome-stable', 'chrome', 'chromium', 'chromium-browser']),
    process.env.EDGE_PATH,
  ];
  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    );
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    candidates.push('/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable');
  }
  candidates.push(findOnPath(['msedge', 'microsoft-edge', 'microsoft-edge-stable']));

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

const BROWSER_PATH = findBrowser();

/* ------------------------------------------------------------------ */
/* 临时静态服务                                                        */
/* ------------------------------------------------------------------ */

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
]);

function sendText(response, status, text) {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(text);
}

/** 只读服务 site/，并用内存中的合成 catalog 与 sources.html 覆盖对应路由。 */
async function startSiteServer(catalog, { failCatalog = false } = {}) {
  const catalogBody = JSON.stringify(catalog);
  const sourcesBody = createFixtureSourcesHtml(catalog);
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' });
      response.end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    } catch {
      sendText(response, 400, 'bad request');
      return;
    }
    if (pathname === '/data/catalog.json') {
      if (failCatalog) return sendText(response, 503, 'catalog unavailable');
      const headers = {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(catalogBody),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      };
      response.writeHead(200, headers);
      if (request.method === 'HEAD') response.end();
      else response.end(catalogBody);
      return;
    }
    if (pathname === '/sources.html') {
      const headers = {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(sourcesBody),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      };
      response.writeHead(200, headers);
      if (request.method === 'HEAD') response.end();
      else response.end(sourcesBody);
      return;
    }

    const segments = pathname.split('/').filter((segment) => segment !== '' && segment !== '.');
    if (pathname.includes('\0') || pathname.includes('\\') || segments.includes('..')) {
      sendText(response, 403, 'forbidden');
      return;
    }
    let absolute = path.resolve(SITE_DIR, ...segments);
    if (absolute !== SITE_DIR && !absolute.startsWith(SITE_DIR + path.sep)) {
      sendText(response, 403, 'forbidden');
      return;
    }
    let info;
    try {
      info = await stat(absolute);
      if (info.isDirectory()) {
        absolute = path.join(absolute, 'index.html');
        info = await stat(absolute);
      }
    } catch {
      sendText(response, 404, 'not found');
      return;
    }
    if (!info.isFile()) {
      sendText(response, 404, 'not found');
      return;
    }
    const headers = {
      'content-type': MIME_TYPES.get(path.extname(absolute).toLowerCase()) ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    };
    response.writeHead(200, headers);
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(absolute).pipe(response);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return { server, origin: `http://127.0.0.1:${port}` };
}

/* ------------------------------------------------------------------ */
/* Headless 浏览器与最小 CDP 客户端                                    */
/* ------------------------------------------------------------------ */

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function launchBrowser(executable, userDataDir) {
  const child = spawn(
    executable,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--disable-search-engine-choice-screen',
      '--disable-dev-shm-usage',
      '--metrics-recording-only',
      '--no-sandbox',
      '--remote-allow-origins=*',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--window-size=1280,900',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
  );
  let stderr = '';
  let launchError = null;
  child.on('error', (error) => {
    launchError = error;
  });
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  return {
    child,
    launchError: () => launchError,
    stderr: () => stderr,
  };
}

async function waitForDevToolsPort(portFile, browser) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (browser.launchError()) {
      throw new Error(`浏览器启动失败：${browser.launchError().message}（${browser.stderr()}）`);
    }
    if (browser.child.exitCode !== null) {
      throw new Error(`浏览器提前退出（code=${browser.child.exitCode}）：${browser.stderr()}`);
    }
    try {
      const content = await readFile(portFile, 'utf8');
      const [portLine] = content.trim().split(/\r?\n/u);
      const port = Number(portLine);
      if (Number.isInteger(port) && port > 0) return port;
    } catch {
      // 端口文件尚未生成。
    }
    await delay(50);
  }
  throw new Error(`等待 DevTools 端口超时：${browser.stderr()}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}：${url}`);
  return response.json();
}

async function waitForPageTarget(port, browser) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // 浏览器尚未就绪。
    }
    if (browser.launchError()) {
      throw new Error(`浏览器启动失败：${browser.launchError().message}`);
    }
    if (browser.child.exitCode !== null) {
      throw new Error(`浏览器提前退出（code=${browser.child.exitCode}）：${browser.stderr()}`);
    }
    await delay(50);
  }
  throw new Error(`等待页面 target 超时：${browser.stderr()}`);
}

function createCdpClient(webSocket) {
  let nextId = 0;
  const pending = new Map();

  webSocket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (typeof message.id !== 'number') return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) {
      entry.reject(new Error(`${message.error.message}（code=${message.error.code}）`));
    } else {
      entry.resolve(message.result);
    }
  });

  webSocket.addEventListener('close', () => {
    for (const entry of pending.values()) entry.reject(new Error('CDP 连接已关闭。'));
    pending.clear();
  });

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = (nextId += 1);
      pending.set(id, { resolve, reject });
      webSocket.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.text
        ?? '未知异常';
      throw new Error(`页面脚本执行失败：${description}`);
    }
    return result.result?.value;
  }

  async function waitFor(expression, timeout = 15000) {
    const deadline = Date.now() + timeout;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const value = await evaluate(expression);
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await delay(100);
    }
    throw new Error(`等待页面状态超时：${expression}${lastError ? `（最后一次错误：${lastError.message}）` : ''}`);
  }

  return { send, evaluate, waitFor, close: () => webSocket.close() };
}

function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const webSocket = new WebSocket(url);
    webSocket.addEventListener('open', () => resolve(webSocket), { once: true });
    webSocket.addEventListener('error', () => reject(new Error(`WebSocket 连接失败：${url}`)), {
      once: true,
    });
  });
}

/* ------------------------------------------------------------------ */
/* 清理                                                                */
/* ------------------------------------------------------------------ */

async function stopBrowser(browser) {
  if (!browser || !browser.child.pid || browser.child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(browser.child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 10000,
    });
    return;
  }
  await new Promise((resolve) => {
    browser.child.once('exit', resolve);
    browser.child.kill('SIGKILL');
    setTimeout(resolve, 5000).unref?.();
  });
}

/* ------------------------------------------------------------------ */
/* 测试                                                                */
/* ------------------------------------------------------------------ */

test(
  'course.html 在详细模式展示题面与解答的完整文件摘要，简洁模式隐藏摘要并保留链接',
  {
    skip: BROWSER_PATH
      ? false
      : '未找到 Chrome/Edge 可执行文件；设置 CHROME_PATH 或 EDGE_PATH 后运行。',
    timeout: 90000,
  },
  async (t) => {
    const catalog = createFixtureCatalog();
    const { server, origin } = await startSiteServer(catalog);
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'ustc-nav-browser-'));
    let browser = null;
    let cdp = null;

    t.after(async () => {
      try {
        cdp?.close();
      } catch {
        // 已关闭。
      }
      await stopBrowser(browser);
      await new Promise((resolve) => server.close(resolve));
      await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(
        () => {},
      );
    });

    browser = launchBrowser(BROWSER_PATH, userDataDir);
    const port = await waitForDevToolsPort(path.join(userDataDir, 'DevToolsActivePort'), browser);
    const target = await waitForPageTarget(port, browser);
    const webSocket = await connectWebSocket(target.webSocketDebuggerUrl);
    cdp = createCdpClient(webSocket);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const courseUrl = `${origin}/course.html?code=${encodeURIComponent(COURSE_CODE)}`;
    await cdp.send('Page.navigate', { url: courseUrl });
    try {
      await cdp.waitFor(
        `document.readyState === 'complete'
          && document.querySelector('#course-content')
          && !document.querySelector('#course-content').hidden
          && document.querySelector('li.location .file-snapshot') !== null`,
        20000,
      );
    } catch (error) {
      const loadError = await cdp
        .evaluate(`document.querySelector('#load-error')?.textContent ?? ''`)
        .catch(() => '');
      throw new Error(`${error.message}${loadError ? `；页面错误：${loadError}` : ''}`);
    }

    assert.equal(await cdp.evaluate('document.title.includes("数学分析（浏览器回归）")'), true);

    const questionUrlLiteral = JSON.stringify(QUESTION_URL);
    const solutionUrlLiteral = JSON.stringify(SOLUTION_URL);

    const readableState = `(() => {
      const isVisible = (node) => {
        if (!node) return false;
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return node.getClientRects().length > 0;
      };
      const links = [...document.querySelectorAll('a')];
      const visibleLinkTexts = (href) => links
        .filter((link) => link.href === href && isVisible(link))
        .map((link) => link.textContent.trim());
      const snapshots = [...document.querySelectorAll('.file-snapshot')];
      const codeNodes = [...document.querySelectorAll('.file-snapshot code')];
      const toggle = document.querySelector('[data-mode-toggle]');
      return {
        mode: document.body.dataset.mode ?? null,
        pressed: toggle?.getAttribute('aria-pressed') ?? null,
        toggleHidden: toggle?.hidden ?? null,
        toggleVisible: isVisible(toggle),
        snapshotCount: snapshots.length,
        snapshotVisible: snapshots.map(isVisible),
        snapshotTexts: snapshots.map((node) => node.textContent),
        codeTexts: codeNodes.map((node) => node.textContent),
        questionLinkTexts: visibleLinkTexts(${questionUrlLiteral}),
        solutionLinkTexts: visibleLinkTexts(${solutionUrlLiteral}),
        bodyText: document.body.innerText,
        storage: localStorage.getItem(${JSON.stringify(MODE_STORAGE_KEY_COURSE)}),
      };
    })()`;

    const compact = await cdp.evaluate(readableState);
    assert.equal(compact.mode, null);
    assert.equal(compact.pressed, 'false');
    assert.equal(compact.toggleHidden, false);
    assert.equal(compact.toggleVisible, true);
    assert.equal(compact.snapshotCount, 3);
    assert.deepEqual(compact.snapshotVisible, [false, false, false], '简洁模式必须隐藏文件摘要');
    assert.equal(compact.bodyText.includes('3'.repeat(64)), false);
    assert.equal(compact.bodyText.includes('4'.repeat(64)), false);
    assert.equal(compact.codeTexts.includes(QUESTION_SHA), true);
    assert.equal(compact.codeTexts.includes(SOLUTION_SHA), true);
    assert.equal(compact.bodyText.includes(QUESTION_SHA), false);
    assert.equal(compact.bodyText.includes(SOLUTION_SHA), false);
    assert.equal(compact.storage, null);
    assert.equal(
      compact.questionLinkTexts.some((text) => text.includes('题目')),
      true,
      '简洁模式保留可点击的题面链接',
    );
    assert.equal(
      compact.solutionLinkTexts.some((text) => text.includes('配套解答')),
      true,
      '简洁模式保留可点击的配套解答链接',
    );

    await cdp.evaluate(`document.querySelector('[data-mode-toggle]').click()`);
    await cdp.waitFor(`document.body.dataset.mode === 'detailed'`);

    const detailed = await cdp.evaluate(`(() => {
      const isVisible = (node) => {
        if (!node) return false;
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return node.getClientRects().length > 0;
      };
      const toggle = document.querySelector('[data-mode-toggle]');
      const rows = [...document.querySelectorAll('li.location')].map((row) => {
        const snapshot = row.querySelector('.file-snapshot');
        return {
          hrefs: [...row.querySelectorAll('a')].map((link) => link.href),
          snapshotVisible: isVisible(snapshot),
          snapshotText: snapshot?.textContent ?? '',
          codeText: snapshot?.querySelector('code')?.textContent ?? '',
        };
      });
      return {
        mode: document.body.dataset.mode ?? null,
        pressed: toggle?.getAttribute('aria-pressed') ?? null,
        toggleVisible: isVisible(toggle),
        snapshotCount: document.querySelectorAll('.file-snapshot').length,
        rows,
        bodyText: document.body.innerText,
        storage: localStorage.getItem(${JSON.stringify(MODE_STORAGE_KEY_COURSE)}),
      };
    })()`);

    assert.equal(detailed.mode, 'detailed');
    assert.equal(detailed.pressed, 'true');
    assert.equal(detailed.toggleVisible, true);
    assert.equal(detailed.storage, 'detailed');
    assert.equal(detailed.snapshotCount, 3);
    const login = await cdp.evaluate(`(() => {
      const item = document.querySelector('.attachment-snapshots');
      const row = item.closest('li.location');
      return {
        hrefs: [...row.querySelectorAll('a')].map(a => a.href),
        downloads: row.querySelectorAll('[download], button').length,
        hashes: [...item.querySelectorAll('ul li code')].map(code => code.textContent),
        text: item.innerText,
      };
    })()`);
    assert.deepEqual(login.hrefs, ['https://icourse.club/course/123/#review-456']);
    assert.equal(login.downloads, 0);
    assert.deepEqual(login.hashes, ['3'.repeat(64), '4'.repeat(64)]);
    assert.match(login.text, /原帖附件取样（2 个，需登录原帖获取）/u);
    assert.match(login.text, new RegExp(`${SNAPSHOT_DATE}.*1,234 字节`, 'u'));
    assert.match(login.text, new RegExp(`${SNAPSHOT_DATE}.*5,678 字节`, 'u'));

    const questionRow = detailed.rows.find((row) => row.hrefs.includes(QUESTION_URL));
    const solutionRow = detailed.rows.find((row) => row.hrefs.includes(SOLUTION_URL));
    assert.ok(questionRow, '详细模式必须列出题面文件入口');
    assert.ok(solutionRow, '详细模式必须把配套解答作为独立位置列出');
    assert.notEqual(questionRow, solutionRow);

    assert.equal(questionRow.snapshotVisible, true);
    assert.equal(solutionRow.snapshotVisible, true);
    assert.equal(questionRow.codeText, QUESTION_SHA, '题面摘要必须是完整 64 位 SHA-256');
    assert.equal(solutionRow.codeText, SOLUTION_SHA, '解答摘要必须是完整 64 位 SHA-256');
    assert.match(questionRow.snapshotText, /直链文件取样/u);
    assert.match(questionRow.snapshotText, new RegExp(`${SNAPSHOT_DATE}.*123,456 字节`, 'u'));
    assert.match(solutionRow.snapshotText, /直链文件取样/u);
    assert.match(solutionRow.snapshotText, new RegExp(`${SNAPSHOT_DATE}.*7,890 字节`, 'u'));
    assert.equal(detailed.bodyText.includes(QUESTION_SHA), true);
    assert.equal(detailed.bodyText.includes(SOLUTION_SHA), true);

    await cdp.evaluate(`document.querySelector('[data-mode-toggle]').click()`);
    await cdp.waitFor(
      `!document.body.dataset.mode
        && document.querySelector('[data-mode-toggle]').getAttribute('aria-pressed') === 'false'`,
    );

    const compactAgain = await cdp.evaluate(readableState);
    assert.equal(compactAgain.mode, null);
    assert.equal(compactAgain.pressed, 'false');
    assert.deepEqual(compactAgain.snapshotVisible, [false, false, false]);
    assert.equal(compactAgain.bodyText.includes(QUESTION_SHA), false);
    assert.equal(compactAgain.bodyText.includes(SOLUTION_SHA), false);
    assert.equal(compactAgain.storage, null);
    assert.equal(compactAgain.questionLinkTexts.some((text) => text.includes('题目')), true);
    assert.equal(compactAgain.solutionLinkTexts.some((text) => text.includes('配套解答')), true);
  },
);

async function openBrowserEnv(t, options) {
  const catalog = createFixtureCatalog();
  const { server, origin } = await startSiteServer(catalog, options);
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'ustc-nav-browser-'));
  const browser = launchBrowser(BROWSER_PATH, userDataDir);
  const port = await waitForDevToolsPort(path.join(userDataDir, 'DevToolsActivePort'), browser);
  const target = await waitForPageTarget(port, browser);
  const webSocket = await connectWebSocket(target.webSocketDebuggerUrl);
  const cdp = createCdpClient(webSocket);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const extraClients = [];
  t.after(async () => {
    for (const client of extraClients) {
      try {
        client.close();
      } catch {
        // 已关闭。
      }
    }
    try {
      cdp.close();
    } catch {
      // 已关闭。
    }
    await stopBrowser(browser);
    await new Promise((resolve) => server.close(resolve));
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(
      () => {},
    );
  });

  async function openTab(url) {
    const { targetId } = await cdp.send('Target.createTarget', { url });
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const found = targets.find((entry) => entry.id === targetId && entry.webSocketDebuggerUrl);
    if (!found) throw new Error(`找不到新建标签页 target：${targetId}`);
    const ws = await connectWebSocket(found.webSocketDebuggerUrl);
    const client = createCdpClient(ws);
    extraClients.push(client);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    return client;
  }

  return { origin, cdp, openTab };
}

test(
  '居中搜索态、顶栏显示模式与主题圆按钮、两组隔离与跨标签页同步',
  {
    skip: BROWSER_PATH
      ? false
      : '未找到 Chrome/Edge 可执行文件；设置 CHROME_PATH 或 EDGE_PATH 后运行。',
    timeout: 90000,
  },
  async (t) => {
    const { origin, cdp, openTab } = await openBrowserEnv(t);

    await cdp.send('Page.navigate', { url: `${origin}/` });
    await cdp.waitFor(`document.readyState === 'complete' && document.body.dataset.hero === 'centered'`);

    // 预置旧的全站键，重载后两组均应保持默认简洁且不迁移旧键，主题默认浅色，且初始居中隐藏结果与页脚。
    await cdp.evaluate(`localStorage.setItem(${JSON.stringify(MODE_STORAGE_KEY_LEGACY)}, 'detailed')`);
    await cdp.send('Page.reload', { ignoreCache: true });
    await cdp.waitFor(`document.readyState === 'complete' && document.body.dataset.hero === 'centered'`);

    const indexCompact = await cdp.evaluate(`(() => {
      const isVisible = (node) => Boolean(node && getComputedStyle(node).display !== 'none' && node.getClientRects().length > 0);
      return {
        hero: document.body.dataset.hero ?? null,
        mode: document.body.dataset.mode ?? null,
        theme: document.documentElement.dataset.theme ?? null,
        pressed: document.querySelector('[data-mode-toggle]')?.getAttribute('aria-pressed') ?? null,
        introVisible: isVisible(document.querySelector('.intro')),
        filtersVisible: isVisible(document.querySelector('.filter-groups')),
        tagDrawerVisible: isVisible(document.querySelector('#tag-drawer')),
        resultsVisible: isVisible(document.querySelector('.results')),
        footerVisible: isVisible(document.querySelector('.site-footer')),
        catalogKey: localStorage.getItem(${JSON.stringify(MODE_STORAGE_KEY_CATALOG)}),
        courseKey: localStorage.getItem(${JSON.stringify(MODE_STORAGE_KEY_COURSE)}),
        themeKey: localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}),
      };
    })()`);
    assert.equal(indexCompact.hero, 'centered');
    assert.equal(indexCompact.mode, null);
    assert.equal(indexCompact.theme, 'light');
    assert.equal(indexCompact.pressed, 'false');
    assert.equal(indexCompact.introVisible, false);
    assert.equal(indexCompact.filtersVisible, false);
    assert.equal(indexCompact.tagDrawerVisible, false);
    assert.equal(indexCompact.resultsVisible, false, '未点击搜索框时不应展示结果区');
    assert.equal(indexCompact.footerVisible, false, '未点击搜索框时不应展示页脚');
    assert.equal(indexCompact.catalogKey, null);
    assert.equal(indexCompact.courseKey, null);
    assert.equal(indexCompact.themeKey, null);

    const iconCheck = await cdp.evaluate(`(() => {
      return ['[data-mode-toggle]', '[data-theme-toggle]'].map((sel) => {
        const btn = document.querySelector(sel);
        const r = btn.getBoundingClientRect();
        const visibleSvg = [...btn.querySelectorAll('svg')].find((s) => getComputedStyle(s).display !== 'none');
        const sr = visibleSvg?.getBoundingClientRect();
        return {
          width: r.width,
          height: r.height,
          svgWidth: sr?.width ?? 0,
          svgHeight: sr?.height ?? 0,
        };
      });
    })()`);
    for (const item of iconCheck) {
      assert.equal(Math.abs(item.width - item.height) <= 1, true, '顶栏圆按钮应为正圆');
      assert.equal(item.svgWidth >= 14 && item.svgHeight >= 14, true, '顶栏圆按钮内 SVG 图标不得被压缩隐藏');
    }

    // 点击搜索框：从居中态平滑展开，显示结果与页脚。
    const qBox = await cdp.evaluate(`(() => {
      const r = document.querySelector('#q').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: qBox.x, y: qBox.y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: qBox.x, y: qBox.y });
    await cdp.waitFor(`document.body.dataset.hero === 'expanded' && getComputedStyle(document.querySelector('.results')).display !== 'none'`);
    assert.equal(
      await cdp.evaluate(`getComputedStyle(document.querySelector('.site-footer')).display !== 'none'`),
      true,
    );

    const sourcesTab = await openTab(`${origin}/sources.html`);
    await sourcesTab.waitFor(`document.readyState === 'complete' && document.querySelector('[data-mode-toggle]') !== null`);
    assert.equal(await sourcesTab.evaluate(`document.body.dataset.mode ?? null`), null);

    const courseTab = await openTab(`${origin}/course.html?code=${COURSE_CODE}`);
    await courseTab.waitFor(`document.readyState === 'complete' && document.querySelector('#course-content') && !document.querySelector('#course-content').hidden`);
    assert.equal(await courseTab.evaluate(`document.body.dataset.mode ?? null`), null);

    // 顶栏主题圆按钮循环切换：light -> dark -> system -> light，全站同步。
    await cdp.evaluate(`document.querySelector('[data-theme-toggle]').click()`);
    await cdp.waitFor(`document.documentElement.dataset.theme === 'dark'`);
    await sourcesTab.waitFor(`document.documentElement.dataset.theme === 'dark'`);
    await courseTab.waitFor(`document.documentElement.dataset.theme === 'dark'`);
    await cdp.evaluate(`document.querySelector('[data-theme-toggle]').click()`);
    await cdp.waitFor(`document.documentElement.dataset.theme === 'system'`);
    await cdp.evaluate(`document.querySelector('[data-theme-toggle]').click()`);
    await cdp.waitFor(`document.documentElement.dataset.theme === 'light'`);

    // 重新打开全新首页在居中态直接切详细：自动展开并展示学科抽屉按钮。
    await cdp.send('Page.navigate', { url: `${origin}/` });
    await cdp.waitFor(`document.readyState === 'complete' && document.body.dataset.hero === 'centered'`);
    await cdp.evaluate(`document.querySelector('[data-mode-toggle]').click()`);
    await cdp.waitFor(`document.body.dataset.mode === 'detailed' && document.body.dataset.hero === 'expanded'`);
    await sourcesTab.waitFor(`document.body.dataset.mode === 'detailed'`);
    assert.equal(await courseTab.evaluate(`document.body.dataset.mode ?? null`), null);
    const indexDetailed = await cdp.evaluate(`(() => {
      const isVisible = (node) => Boolean(node && getComputedStyle(node).display !== 'none' && node.getClientRects().length > 0);
      return {
        introVisible: isVisible(document.querySelector('.intro')),
        filtersVisible: isVisible(document.querySelector('.filter-groups')),
        tagToggleVisible: isVisible(document.querySelector('#tag-toggle')),
        tagDrawerOpen: document.querySelector('#tag-drawer')?.dataset.open ?? null,
      };
    })()`);
    assert.equal(indexDetailed.introVisible, true);
    assert.equal(indexDetailed.filtersVisible, true);
    assert.equal(indexDetailed.tagToggleVisible, true);
    assert.equal(indexDetailed.tagDrawerOpen, 'false');

    // 点击右侧学科按钮，抽屉展开。
    await cdp.evaluate(`document.querySelector('#tag-toggle').click()`);
    await cdp.waitFor(`document.querySelector('#tag-drawer').dataset.open === 'true'`);

    // 课程详情切换到详细：首页和来源页均不受影响。
    await courseTab.evaluate(`document.querySelector('[data-mode-toggle]').click()`);
    await courseTab.waitFor(`document.body.dataset.mode === 'detailed'`);
    await cdp.evaluate(`document.querySelector('[data-mode-toggle]').click()`);
    await cdp.waitFor(`!document.body.dataset.mode`);
    await sourcesTab.waitFor(`!document.body.dataset.mode`);
    assert.equal(await courseTab.evaluate(`document.body.dataset.mode ?? null`), 'detailed');
  },
);

test(
  '带筛选 URL 直接展开且切模式保留状态；单叉在有内容或悬停聚焦时显现，一键清除后留在展开态',
  {
    skip: BROWSER_PATH
      ? false
      : '未找到 Chrome/Edge 可执行文件；设置 CHROME_PATH 或 EDGE_PATH 后运行。',
    timeout: 90000,
  },
  async (t) => {
    const { origin, cdp } = await openBrowserEnv(t);
    const queryUrl = `${origin}/?q=${encodeURIComponent('数学')}&type=exams&year=2024&tag=math&status=none`;

    await cdp.send('Page.navigate', { url: queryUrl });
    await cdp.waitFor(`document.readyState === 'complete' && document.querySelector('#no-results') && !document.querySelector('#no-results').hidden`);
    await cdp.waitFor(`getComputedStyle(document.querySelector('#clear-search')).opacity === '1'`);

    const readFormState = `(() => ({
      hero: document.body.dataset.hero ?? null,
      mode: document.body.dataset.mode ?? null,
      search: location.search,
      statusText: document.querySelector('#result-status')?.textContent ?? '',
      noResultsText: document.querySelector('#no-results-text')?.textContent ?? '',
      q: document.querySelector('#q')?.value ?? '',
      type: document.querySelector('#type')?.value ?? '',
      year: document.querySelector('#year')?.value ?? '',
      yearHidden: document.querySelector('#year-group')?.hidden ?? null,
      statusWith: document.querySelector('input[name="status"][value="with"]')?.checked ?? null,
      statusWithout: document.querySelector('input[name="status"][value="without"]')?.checked ?? null,
      tagMath: document.querySelector('input[name="tag"][value="math"]')?.checked ?? null,
      tagDrawerOpen: document.querySelector('#tag-drawer')?.dataset.open ?? null,
      tagExpanded: document.querySelector('#tag-toggle')?.getAttribute('aria-expanded') ?? null,
      clearOpacity: getComputedStyle(document.querySelector('#clear-search')).opacity,
      activeId: document.activeElement?.id ?? null,
    }))()`;

    const beforeToggle = await cdp.evaluate(readFormState);
    assert.equal(beforeToggle.hero, 'expanded');
    assert.equal(beforeToggle.mode, null);
    assert.equal(beforeToggle.q, '数学');
    assert.equal(beforeToggle.type, 'exams');
    assert.equal(beforeToggle.year, '2024');
    assert.equal(beforeToggle.statusWith, false);
    assert.equal(beforeToggle.statusWithout, false);
    assert.equal(beforeToggle.tagMath, true);
    assert.equal(beforeToggle.clearOpacity, '1', '输入框或筛选有内容时清除叉号应直接可见（照顾手机端）');
    assert.doesNotMatch(beforeToggle.noResultsText, /清除筛选|点击.*按钮/);

    // 切模式不得破坏 URL、表单状态与结果。
    await cdp.evaluate(`document.querySelector('[data-mode-toggle]').click()`);
    await cdp.waitFor(`document.body.dataset.mode === 'detailed'`);
    const whileDetailed = await cdp.evaluate(readFormState);
    assert.equal(whileDetailed.search, beforeToggle.search);
    assert.equal(whileDetailed.statusText, beforeToggle.statusText);
    assert.equal(whileDetailed.q, beforeToggle.q);
    assert.equal(whileDetailed.type, beforeToggle.type);
    assert.equal(whileDetailed.year, beforeToggle.year);
    assert.equal(whileDetailed.statusWith, false);
    assert.equal(whileDetailed.statusWithout, false);
    assert.equal(whileDetailed.tagMath, true);
    assert.equal(whileDetailed.tagDrawerOpen, 'true');

    await cdp.evaluate(`document.querySelector('[data-mode-toggle]').click()`);
    await cdp.waitFor(`!document.body.dataset.mode`);

    // 键盘焦点移到 #clear-search 后按 Enter 一键复位，且保持在展开态。
    await cdp.send('Page.bringToFront');
    await cdp.evaluate(`document.querySelector('#clear-search').focus()`);
    await cdp.waitFor(`document.activeElement?.id === 'clear-search' && getComputedStyle(document.querySelector('#clear-search')).opacity === '1'`);
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      text: '\r',
      unmodifiedText: '\r',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await cdp.waitFor(`location.search === '' && document.querySelectorAll('#course-list li').length === 3`);

    const afterClear = await cdp.evaluate(readFormState);
    assert.equal(afterClear.hero, 'expanded', '一键清除后应停留在展开态');
    assert.equal(afterClear.search, '');
    assert.equal(afterClear.q, '');
    assert.equal(afterClear.type, 'all');
    assert.equal(afterClear.yearHidden, true);
    assert.equal(afterClear.statusWith, true);
    assert.equal(afterClear.statusWithout, true);
    assert.equal(afterClear.tagMath, false);
    assert.equal(afterClear.tagDrawerOpen, 'false');
    assert.equal(afterClear.tagExpanded, 'false');
    assert.equal(afterClear.activeId, 'q', '清除后焦点应回到搜索输入框');

    // 移开焦点与鼠标后空框应隐藏叉号；鼠标移到搜索框上时再次显现。
    await cdp.evaluate(`document.activeElement?.blur()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await cdp.waitFor(`getComputedStyle(document.querySelector('#clear-search')).opacity === '0'`);

    const box = await cdp.evaluate(`(() => {
      const r = document.querySelector('.search-input-wrap').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await cdp.waitFor(`getComputedStyle(document.querySelector('#clear-search')).opacity === '1'`);
  },
);

test(
  '手机与桌面首页搜索和课程详情按钮排版',
  {
    skip: BROWSER_PATH
      ? false
      : '未找到 Chrome/Edge 可执行文件；设置 CHROME_PATH 或 EDGE_PATH 后运行。',
    timeout: 90000,
  },
  async (t) => {
    const { origin, cdp } = await openBrowserEnv(t);

    for (const viewport of [
      { width: 320, height: 720, deviceScaleFactor: 2, mobile: true },
      { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
      { width: 800, height: 900, deviceScaleFactor: 1, mobile: false },
      { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', viewport);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: viewport.mobile });

      await cdp.send('Page.navigate', { url: `${origin}/` });
      await cdp.waitFor(`document.readyState === 'complete' && document.querySelectorAll('#course-list li').length === 3`);
      const indexLayout = await cdp.evaluate(`(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        toggleRect: document.querySelector('[data-mode-toggle]').getBoundingClientRect().toJSON(),
        inputRect: document.querySelector('#q').getBoundingClientRect().toJSON(),
        clearRect: document.querySelector('#clear-search').getBoundingClientRect().toJSON(),
        submitRect: document.querySelector('.query-actions button').getBoundingClientRect().toJSON(),
      }))()`);
      assert.equal(indexLayout.scrollWidth <= indexLayout.innerWidth, true, `首页在 ${viewport.width}px 下不应水平溢出`);
      assert.equal(indexLayout.clearRect.right <= indexLayout.inputRect.right + 1, true);
      assert.equal(indexLayout.toggleRect.right <= viewport.width + 1, true);
      assert.ok(Math.abs(indexLayout.inputRect.top - indexLayout.submitRect.top) < 2, `搜索按钮在 ${viewport.width}px 应与输入框同排`);
      assert.ok(indexLayout.submitRect.left >= indexLayout.inputRect.right);
      assert.ok(indexLayout.submitRect.right <= viewport.width);
      if (viewport.mobile) assert.ok(indexLayout.submitRect.height >= 44);

      await cdp.send('Page.navigate', { url: `${origin}/course.html?code=${QUIZ_COURSE_CODE}` });
      await cdp.waitFor(`document.readyState === 'complete' && document.querySelector('#course-content') && !document.querySelector('#course-content').hidden`);
      const courseLayout = await cdp.evaluate(`(() => {
        const refButtons = document.querySelectorAll('.exercise-references .link-button').length;
        const headerPosition = getComputedStyle(document.querySelector('.site-header')).position;
        const actionButton = document.querySelector('.compact-link-actions .link-button');
        const originalRect = actionButton.closest('.compact-links').querySelector('.compact-link-group > a')?.getBoundingClientRect().toJSON();
        const sourceRect = actionButton.closest('.compact-links').querySelector('.source-note').getBoundingClientRect().toJSON();
        const buttons = [...document.querySelectorAll('.compact-link-actions .link-button')].map((el) => ({
          text: el.textContent.trim(),
          rect: el.getBoundingClientRect().toJSON(),
        }));
        return {
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          headerPosition,
          originalRect,
          sourceRect,
          refButtons,
          buttons,
        };
      })()`);
      assert.equal(courseLayout.scrollWidth <= courseLayout.innerWidth, true, `课程详情在 ${viewport.width}px 下不应水平溢出`);
      assert.equal(courseLayout.refButtons, 0, '配套解答按钮不应混在出处段落内');
      assert.equal(courseLayout.buttons.length, 2, '应并排显示题目与配套解答按钮');
      const [qBtn, solBtn] = courseLayout.buttons;
      assert.equal(qBtn.rect.right <= viewport.width && solBtn.rect.right <= viewport.width, true);
      assert.equal(Math.abs(qBtn.rect.height - solBtn.rect.height) <= 2, true, '按钮高度应一致');
      assert.equal(qBtn.rect.right <= solBtn.rect.left + 1 || qBtn.rect.bottom <= solBtn.rect.top + 1, true, '按钮不得互相重叠');
      assert.equal(courseLayout.headerPosition, viewport.mobile ? 'static' : 'sticky');
      if (viewport.mobile) {
        assert.ok(courseLayout.originalRect, '应保留独立的原始页面入口');
        assert.ok(courseLayout.sourceRect.bottom <= courseLayout.originalRect.top);
        assert.ok(Math.abs(qBtn.rect.top - solBtn.rect.top) < 2, '题目与配套解答应在同一行');
        if (viewport.width >= 390) {
          assert.ok(Math.abs(courseLayout.originalRect.top - qBtn.rect.top) < 2);
          assert.ok(courseLayout.originalRect.right <= qBtn.rect.left + 1);
        }
      }
    }
  },
);

test('首页目录加载失败时显示恢复提示', {
  skip: !BROWSER_PATH,
  timeout: 90000,
}, async (t) => {
  const { origin, cdp } = await openBrowserEnv(t, { failCatalog: true });
  await cdp.send('Page.navigate', { url: `${origin}/` });
  await cdp.waitFor(`document.querySelector('#load-error')?.textContent.includes('请刷新页面')`);
  assert.equal(await cdp.evaluate(`document.querySelector('#load-error').checkVisibility()`), true);
});

test(
  '公告栏：悬吊挂牌入口、未读提醒、横屏双栏宽板与竖屏居中适配',
  {
    skip: BROWSER_PATH
      ? false
      : '未找到 Chrome/Edge 可执行文件；设置 CHROME_PATH 或 EDGE_PATH 后运行。',
    timeout: 90000,
  },
  async (t) => {
    const { origin, cdp } = await openBrowserEnv(t);

    // 1. 首次访问应点亮未读红点且无临时预览切换条；打开公告栏后清除并写入 localStorage。
    await cdp.send('Page.navigate', { url: `${origin}/?q=${encodeURIComponent('数学')}` });
    await cdp.waitFor(
      `document.readyState === 'complete' && !document.querySelector('.announcement-toggle').hidden && document.querySelectorAll('#course-list li').length === 2`,
    );
    const initialState = await cdp.evaluate(`(() => {
      const btn = document.querySelector('.announcement-toggle');
      const r = btn.getBoundingClientRect();
      const sr = btn.querySelector('svg').getBoundingClientRect();
      return {
        unread: btn.dataset.unread ?? null,
        width: r.width,
        height: r.height,
        svgWidth: sr.width,
        svgHeight: sr.height,
        seen: localStorage.getItem('ustc-course-nav.announcements.seen'),
        hasPreviewBar: Boolean(document.querySelector('.announcement-preview-bar')),
        hasPreviewStrip: Boolean(document.querySelector('.announcement-preview-strip')),
      };
    })()`);
    assert.equal(initialState.unread, 'true');
    assert.equal(initialState.hasPreviewBar, false, '正式版不应渲染底部预览条');
    assert.equal(initialState.hasPreviewStrip, false, '正式版不应渲染面板预览条');
    assert.equal(Math.abs(initialState.width - initialState.height) <= 1, true, '公告入口按钮应为正圆');
    assert.equal(initialState.svgWidth >= 14 && initialState.svgHeight >= 14, true);
    assert.equal(initialState.seen, null);

    await cdp.evaluate(`document.querySelector('.announcement-toggle').click()`);
    await cdp.waitFor(
      `document.querySelector('.announcement-toggle').getAttribute('aria-expanded') === 'true'`,
    );
    const afterOpen = await cdp.evaluate(`(() => {
      const btn = document.querySelector('.announcement-toggle');
      const hiddenPanelRect = document.querySelector('#announcement-projects').getBoundingClientRect();
      return {
        unread: btn.dataset.unread ?? null,
        seen: localStorage.getItem('ustc-course-nav.announcements.seen'),
        newsText: document.querySelector('#announcement-news').textContent,
        hiddenPanelHeight: hiddenPanelRect.height,
        search: location.search,
        courseCount: document.querySelectorAll('#course-list li').length,
      };
    })()`);
    assert.equal(afterOpen.unread, null, '打开公告栏后未读红点应消除');
    assert.ok(afterOpen.seen, '应写入已读版本号到 localStorage');
    assert.match(afterOpen.newsText, /公告栏上线/);
    assert.equal(afterOpen.hiddenPanelHeight, 0, '非活动 tabpanel 不应占高度');
    assert.equal(afterOpen.courseCount, 2, '打开公告栏不得影响当前搜索结果');

    // 2. 鼠标点击切页不应留下 :focus-visible 蓝框，键盘方向键可正常切换。
    const projTabBox = await cdp.evaluate(`(() => {
      const r = document.querySelector('#announcement-projects-tab').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: projTabBox.x, y: projTabBox.y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: projTabBox.x, y: projTabBox.y });
    await cdp.waitFor(`document.querySelector('#announcement-projects-tab').getAttribute('aria-selected') === 'true'`);
    assert.equal(
      await cdp.evaluate(`document.querySelector('#announcement-projects-tab').matches(':focus-visible')`),
      false,
      '鼠标点击 tab 不应出现残留焦点蓝框',
    );
    const projectText = await cdp.evaluate(`document.querySelector('#announcement-projects').textContent`);
    assert.match(projectText, /USTC Question Bank/);
    assert.match(projectText, /DDNdles/);

    // 键盘 ArrowLeft / ArrowRight 切换回近期更新再切回衍生项目。
    await cdp.evaluate(`document.querySelector('#announcement-projects-tab').focus()`);
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      windowsVirtualKeyCode: 37,
      nativeVirtualKeyCode: 37,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      windowsVirtualKeyCode: 37,
      nativeVirtualKeyCode: 37,
    });
    await cdp.waitFor(`document.querySelector('#announcement-news-tab').getAttribute('aria-selected') === 'true'`);

    // 3. 点击关闭按钮退出。
    await cdp.evaluate(`document.querySelector('#announcements [data-close]').click()`);
    await cdp.waitFor(`document.querySelector('.announcement-toggle').getAttribute('aria-expanded') === 'false'`);

    // 4. 校验桌面 1280px / 1600px 与手机 390px / 320px 下的比例、方向与键盘导航。
    const viewports = [
      { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
      { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false },
      { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
      { width: 320, height: 720, deviceScaleFactor: 2, mobile: true },
    ];

    for (const viewport of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', viewport);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: viewport.mobile });
      await cdp.send('Page.navigate', { url: `${origin}/` });
      await cdp.waitFor(`document.readyState === 'complete' && !document.querySelector('.announcement-toggle').hidden`);

      await cdp.evaluate(`document.querySelector('.announcement-toggle').click()`);
      await cdp.waitFor(`document.querySelector('.announcement-toggle').getAttribute('aria-expanded') === 'true'`);
      await new Promise((resolve) => setTimeout(resolve, 260));

      const metrics = await cdp.evaluate(`(() => {
        const panel = document.querySelector('#announcements');
        const toggle = document.querySelector('.announcement-toggle');
        const tablist = panel.querySelector('.announcement-tablist');
        const body = panel.querySelector('.announcement-body');
        return {
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          rect: panel.getBoundingClientRect().toJSON(),
          toggleRect: toggle.getBoundingClientRect().toJSON(),
          tablistRect: tablist.getBoundingClientRect().toJSON(),
          bodyRect: body.getBoundingClientRect().toJSON(),
          orientation: tablist.getAttribute('aria-orientation'),
        };
      })()`);

      assert.equal(metrics.scrollWidth <= metrics.innerWidth, true, `${viewport.width}px 不应横向溢出`);
      assert.equal(metrics.toggleRect.right <= viewport.width + 1, true);
      assert.ok(metrics.rect.left >= -1 && metrics.rect.right <= viewport.width + 1, `${viewport.width}px 不应超出左右视口`);
      assert.ok(metrics.rect.top >= -1 && metrics.rect.bottom <= viewport.height + 1, `${viewport.width}px 不应超出上下视口`);
      const centerDiff = Math.abs((metrics.rect.left + metrics.rect.right) / 2 - viewport.width / 2);
      assert.ok(centerDiff <= 12, `${viewport.width}px 下公告板应水平居中`);

      if (!viewport.mobile) {
        const minW = viewport.width >= 1600 ? 900 : 720;
        assert.ok(metrics.rect.width >= minW, `桌面 ${viewport.width}px 公告板应按比例放大`);
        assert.equal(metrics.orientation, 'vertical');
        assert.ok(metrics.tablistRect.right <= metrics.bodyRect.left + 2, '桌面端导航栏应在正文左侧');

        // 纵向 tablist 支持 ArrowDown 切换。
        await cdp.evaluate(`document.querySelector('#announcement-news-tab').focus()`);
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'ArrowDown',
          code: 'ArrowDown',
          windowsVirtualKeyCode: 40,
          nativeVirtualKeyCode: 40,
        });
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'ArrowDown',
          code: 'ArrowDown',
          windowsVirtualKeyCode: 40,
          nativeVirtualKeyCode: 40,
        });
        await cdp.waitFor(`document.querySelector('#announcement-projects-tab').getAttribute('aria-selected') === 'true'`);
      } else {
        assert.equal(metrics.orientation, 'horizontal');
        assert.ok(metrics.tablistRect.bottom <= metrics.bodyRect.top + 2, '手机端导航栏应在正文上方');
        assert.ok(metrics.rect.height <= Math.ceil(viewport.height * 0.74), '手机端公告板应轻巧收紧高度');
        assert.ok(metrics.rect.left >= 14 && viewport.width - metrics.rect.right >= 14, '手机端两侧应留呼吸边距');
      }

      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      });
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      });
      await cdp.waitFor(`document.querySelector('.announcement-toggle').getAttribute('aria-expanded') === 'false'`);
    }
  },
);
